"""In-memory font sessions and HarfBuzz shaping.

A session holds exactly one uploaded font, parsed and ready for shaping.
Sessions are isolated by unguessable IDs: fonts are never written to a
public directory and cannot be fetched by filename.  Everything the browser
draws (glyph outlines, positions and character associations) is produced by
the :func:`shape_text` computation in this module.
"""

from __future__ import annotations

import io
import secrets
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any

import uharfbuzz as hb
from fontTools.ttLib import TTFont, woff2
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.svgPathPen import SVGPathPen

from .features import DEFAULT_ON_TAGS
from .font_info import valid_tag

MAX_FONT_BYTES = 20 * 1024 * 1024
MAX_TEXT_CHARS = 10_000
SESSION_TTL_SECONDS = 60 * 60 * 2
MAX_SESSIONS = 32


class FontLoadError(ValueError):
    """Raised when uploaded bytes cannot be used as a font."""


@dataclass
class FontSession:
    session_id: str
    filename: str
    data: bytes  # always raw sfnt (TTF/OTF) bytes after normalization
    face: hb.Face
    hb_font: hb.Font
    tt_font: TTFont
    created_at: float
    last_used: float
    _outline_cache: dict[int, str] = field(default_factory=dict)

    def touch(self) -> None:
        self.last_used = time.time()

    def glyph_path(self, gid: int) -> str:
        cached = self._outline_cache.get(gid)
        if cached is not None:
            return cached
        path = _extract_path(self, gid)
        self._outline_cache[gid] = path
        return path


def _normalize_sfnt(data: bytes) -> bytes:
    """Return raw sfnt bytes, decompressing WOFF/WOFF2 containers first."""
    if len(data) >= 4 and data[:4] in (b"wOFF", b"wOF2"):
        try:
            if data[:4] == b"wOFF":
                font = TTFont(io.BytesIO(data))
            else:
                font = TTFont(io.BytesIO(data))  # fontTools picks woff2 flavor
            out = io.BytesIO()
            font.flavor = None
            font.save(out)
            return out.getvalue()
        except Exception as exc:  # pragma: no cover - depends on file
            raise FontLoadError(f"无法解压缩 WOFF 字体: {exc}") from exc
    return data


def build_session(data: bytes, filename: str) -> FontSession:
    if not data:
        raise FontLoadError("文件为空")
    if len(data) > MAX_FONT_BYTES:
        raise FontLoadError(f"字体文件过大（上限 {MAX_FONT_BYTES // 1024 // 1024}MB）")

    sfnt = _normalize_sfnt(data)

    try:
        face = hb.Face(sfnt)
        upem = face.upem
        if not upem or upem <= 0 or upem > 16384:
            raise FontLoadError(f"字体 unitsPerEm 异常: {upem}")
        hb_font = hb.Font(face)
        hb_font.scale = (upem, upem)
        tt = TTFont(io.BytesIO(sfnt), lazy=True)
        if "glyf" not in tt and "CFF " not in tt and "CFF2" not in tt:
            raise FontLoadError("字体中找不到 TrueType/CFF 轮廓表")
        cmap = tt.getBestCmap()
        if not cmap:
            raise FontLoadError("字体缺少可用的字符映射表 (cmap)")
        if tt["maxp"].numGlyphs <= 0:
            raise FontLoadError("字体不包含任何字形")
    except FontLoadError:
        raise
    except Exception as exc:
        raise FontLoadError(f"无法解析为 OpenType/TrueType 字体: {exc}") from exc

    now = time.time()
    return FontSession(
        session_id=secrets.token_urlsafe(16),
        filename=filename,
        data=sfnt,
        face=face,
        hb_font=hb_font,
        tt_font=tt,
        created_at=now,
        last_used=now,
    )


def _extract_path(session: FontSession, gid: int) -> str:
    """SVG path of one glyph in font units (y-up), composites decomposed."""
    try:
        pen = SVGPathPen(None)
        session.hb_font.draw_glyph_with_pen(gid, pen)
        commands = pen.getCommands()
        if commands:
            return commands
        raise ValueError("empty path from HarfBuzz")
    except Exception:
        # Fallback: decompose through fontTools (covers unusual table combos).
        glyph_set = session.tt_font.getGlyphSet()
        order = session.tt_font.getGlyphOrder()
        name = order[gid] if 0 <= gid < len(order) else f"gid{gid}"
        recorder = DecomposingRecordingPen(glyph_set)
        glyph_set[name].draw(recorder)
        pen = SVGPathPen(glyph_set)
        recorder.replay(pen)
        return pen.getCommands()


class SessionStore:
    """LRU + TTL in-memory store.  No filesystem persistence, no listing."""

    def __init__(self) -> None:
        self._sessions: "OrderedDict[str, FontSession]" = OrderedDict()

    def add(self, session: FontSession) -> None:
        self._evict_expired()
        self._sessions[session.session_id] = session
        while len(self._sessions) > MAX_SESSIONS:
            _, old = self._sessions.popitem(last=False)
            close_session(old)

    def get(self, session_id: str) -> FontSession | None:
        session = self._sessions.get(session_id)
        if session is None:
            return None
        if time.time() - session.last_used > SESSION_TTL_SECONDS:
            self._sessions.pop(session_id, None)
            close_session(session)
            return None
        self._sessions.move_to_end(session_id)
        session.touch()
        return session

    def drop(self, session_id: str) -> None:
        session = self._sessions.pop(session_id, None)
        if session is not None:
            close_session(session)

    def _evict_expired(self) -> None:
        now = time.time()
        expired = [
            sid
            for sid, s in self._sessions.items()
            if now - s.last_used > SESSION_TTL_SECONDS
        ]
        for sid in expired:
            close_session(self._sessions.pop(sid))

    def clear(self) -> None:
        for session in self._sessions.values():
            close_session(session)
        self._sessions.clear()


def close_session(session: FontSession) -> None:
    try:
        session.tt_font.close()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Shaping
# ---------------------------------------------------------------------------

_DIRECTIONS = {"ltr", "rtl", "ttb", "btt"}


def _build_feature_settings(
    tt: TTFont,
    script_tag: str,
    language_tag: str,
    overrides: dict[str, bool],
) -> tuple[dict[str, bool], list[dict[str, Any]]]:
    """Resolve final on/off state of every feature in the font.

    Returns the HarfBuzz feature dict and a serializable state list.  All
    font-provided tags are set explicitly so results are deterministic and
    match what the toggles display.
    """
    available_tags = _all_feature_tags(tt)
    applicable = _applicable_tags(tt, script_tag, language_tag)
    hb_features: dict[str, bool] = {}
    states: list[dict[str, Any]] = []
    for tag in sorted(available_tags):
        default_on = tag in DEFAULT_ON_TAGS and tag in applicable
        on = bool(overrides.get(tag, default_on))
        hb_features[tag] = on
        states.append(
            {
                "tag": tag,
                "on": on,
                "defaultOn": default_on,
                "applicable": tag in applicable,
            }
        )
    # Defensive: honor overrides for tags enumeration did not report.
    for tag, on in overrides.items():
        if tag not in hb_features:
            hb_features[tag] = bool(on)
    return hb_features, states


def _codepoint_to_utf16_map(text: str) -> list[int]:
    """utf16_start[i] = UTF-16 offset of codepoint i in text."""
    starts: list[int] = []
    offset = 0
    for ch in text:
        starts.append(offset)
        offset += 2 if ord(ch) > 0xFFFF else 1
    return starts


def _glyph_name(hb_font: hb.Font, tt: TTFont, gid: int) -> str:
    try:
        name = hb_font.get_glyph_name(gid)
        if name:
            return name
    except Exception:
        pass
    order = tt.getGlyphOrder()
    if 0 <= gid < len(order):
        return order[gid]
    return f"gid{gid}"


def shape_text(
    session: FontSession,
    text: str,
    direction: str = "auto",
    feature_overrides: dict[str, bool] | None = None,
    language: str | None = None,
    script: str | None = None,
) -> dict[str, Any]:
    """Run HarfBuzz once and return everything needed to draw the result.

    Coordinates are font design units (scale == unitsPerEm), y-up, origin at
    the initial pen position.  Cluster ranges are Python string (codepoint)
    offsets; UTF-16 offsets are included for the browser textarea.
    """
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError(f"文本过长（上限 {MAX_TEXT_CHARS} 个字符）")
    overrides = feature_overrides or {}

    buf = hb.Buffer()
    buf.add_str(text)
    guessed_dir = guessed_script = guessed_language = None
    buf.guess_segment_properties()
    guessed_dir = buf.direction
    guessed_script = buf.script
    guessed_language = buf.language
    if script:
        buf.script = script
    if language:
        buf.language = language
    effective_direction = direction if direction in _DIRECTIONS else guessed_dir
    buf.direction = effective_direction

    hb_features, feature_states = _build_feature_settings(
        session.tt_font, buf.script, buf.language, overrides
    )

    hb.shape(session.hb_font, buf, hb_features)

    upem = session.face.upem
    h_ext = session.hb_font.get_font_extents("ltr")
    ascender, descender = h_ext.ascender, h_ext.descender

    glyphs: list[dict[str, Any]] = []
    outlines: dict[str, str] = {}
    content_box: list[float] | None = None
    if not buf.glyph_infos:
        pad = upem * 0.04
        world = [-pad, descender - pad, pad, ascender + pad]
        view_box = [
            world[0],
            -world[3],
            world[2] - world[0],
            world[3] - world[1],
        ]
        return {
            "textLength": len(text),
            "utf16Length": 0,
            "direction": effective_direction,
            "requestedDirection": direction,
            "script": buf.script,
            "language": buf.language,
            "guessedDirection": guessed_dir,
            "guessedScript": guessed_script,
            "guessedLanguage": guessed_language,
            "upem": upem,
            "ascender": ascender,
            "descender": descender,
            "lineGap": h_ext.line_gap,
            "penX": 0,
            "penY": 0,
            "features": feature_states,
            "glyphs": glyphs,
            "outlines": outlines,
            "worldBox": world,
            "viewBox": view_box,
        }

    v_ext = session.hb_font.get_font_extents("ttb")
    v_asc, v_desc = v_ext.ascender, v_ext.descender

    n = len(text)
    utf16_starts = _codepoint_to_utf16_map(text)
    utf16_total = (
        utf16_starts[-1] + (2 if ord(text[-1]) > 0xFFFF else 1) if text else 0
    )

    # Partition of the input into cluster ranges (monotone cluster level
    # guarantees contiguous, non-overlapping codepoint ranges).
    unique_starts = sorted({max(0, min(n, info.cluster)) for info in buf.glyph_infos})
    cluster_end = {
        start: unique_starts[i + 1] if i + 1 < len(unique_starts) else n
        for i, start in enumerate(unique_starts)
    }

    glyphs: list[dict[str, Any]] = []
    cursor_x = cursor_y = 0
    ink_union: list[float] | None = None
    slot_union: list[float] | None = None
    horizontal = effective_direction in ("ltr", "rtl")

    def union(box: list[float], acc: list[float] | None) -> list[float]:
        if acc is None:
            return list(box)
        return [
            min(acc[0], box[0]),
            min(acc[1], box[1]),
            max(acc[2], box[2]),
            max(acc[3], box[3]),
        ]

    infos = buf.glyph_infos
    positions = buf.glyph_positions
    for index, (info, pos) in enumerate(zip(infos, positions)):
        gid = info.codepoint
        start = max(0, min(n, info.cluster))
        end = cluster_end.get(start, n)
        end = max(start, min(n, end))

        x = cursor_x + pos.x_offset
        y = cursor_y + pos.y_offset

        ext = session.hb_font.get_glyph_extents(gid)
        ink: list[float] | None = None
        if ext is not None and (ext.width != 0 or ext.height != 0):
            ink = [
                x + ext.x_bearing,
                y + ext.y_bearing + ext.height,
                x + ext.x_bearing + ext.width,
                y + ext.y_bearing,
            ]
            ink_union = union(ink, ink_union)

        if horizontal:
            slot = [
                min(cursor_x, cursor_x + pos.x_advance),
                descender,
                max(cursor_x, cursor_x + pos.x_advance),
                ascender,
            ]
        else:
            slot = [
                x - v_asc,
                min(cursor_y, cursor_y + pos.y_advance),
                x - v_desc,
                max(cursor_y, cursor_y + pos.y_advance),
            ]
        slot_union = union(slot, slot_union)

        glyphs.append(
            {
                "index": index,
                "gid": gid,
                "name": _glyph_name(session.hb_font, session.tt_font, gid),
                "clusterStart": start,
                "clusterEnd": end,
                "utf16Start": utf16_starts[start] if start < n else utf16_total,
                "utf16End": (
                    utf16_starts[end] if end < n else utf16_total
                ),
                "x": x,
                "y": y,
                "advanceX": pos.x_advance,
                "advanceY": pos.y_advance,
                "ink": ink,
                "slot": slot,
            }
        )

        cursor_x += pos.x_advance
        cursor_y += pos.y_advance

    # Attach outlines, deduplicated by glyph id.
    unique_gids = {g["gid"] for g in glyphs}
    outlines = {str(gid): session.glyph_path(gid) for gid in sorted(unique_gids)}

    content_box = ink_union if ink_union is not None else slot_union
    if content_box is None:  # empty text
        content_box = [0, descender, 0, ascender]

    pad = upem * 0.04
    world = [
        content_box[0] - pad,
        content_box[1] - pad,
        content_box[2] + pad,
        content_box[3] + pad,
    ]
    # Convert the y-up world box into screen-space viewBox [x, y, w, h].
    view_box = [world[0], -world[3], world[2] - world[0], world[3] - world[1]]

    return {
        "textLength": n,
        "utf16Length": utf16_total,
        "direction": effective_direction,
        "requestedDirection": direction,
        "script": buf.script,
        "language": buf.language,
        "guessedDirection": guessed_dir,
        "guessedScript": guessed_script,
        "guessedLanguage": guessed_language,
        "upem": upem,
        "ascender": ascender,
        "descender": descender,
        "lineGap": h_ext.line_gap,
        "penX": cursor_x,
        "penY": cursor_y,
        "features": feature_states,
        "glyphs": glyphs,
        "outlines": outlines,
        "worldBox": world,
        "viewBox": view_box,
    }


def _all_feature_tags(tt: TTFont) -> set[str]:
    tags: set[str] = set()
    for table_tag in ("GSUB", "GPOS"):
        if table_tag in tt:
            feature_list = tt[table_tag].table.FeatureList
            if feature_list is not None:
                tags.update(
                    rec.FeatureTag for rec in feature_list.FeatureRecord
                )
    # Space-padded junk tags (e.g. ' RQD') are internal markers, not features.
    return {t for t in tags if valid_tag(t)}


def _applicable_tags(tt: TTFont, script_tag: str, language_tag: str) -> set[str]:
    """Feature tags whose ScriptList coverage matches script/language.

    HarfBuzz reports ISO-style tags ("Latn", "en") while OpenType tables use
    four-character lowercase script tags ("latn") and padded uppercase
    language tags ("ENG "); both are normalized here.

    For each matching script record (including DFLT/dflt fallbacks) the
    requested language's LangSys is used when present, otherwise the script's
    DefaultLangSys.  Required feature indices are included alongside the
    regular feature index list.
    """
    applicable: set[str] = set()
    want_script = (script_tag or "dflt").lower().ljust(4)[:4]
    want_language: str | None = None
    if language_tag and language_tag not in ("c", "dflt"):
        want_language = language_tag.upper().ljust(4)[:4]

    for table_tag in ("GSUB", "GPOS"):
        if table_tag not in tt:
            continue
        table = tt[table_tag].table
        script_list = table.ScriptList
        feature_list = table.FeatureList
        if script_list is None or feature_list is None:
            continue

        for script_record in script_list.ScriptRecord:
            if script_record.ScriptTag.strip().lower() not in (
                want_script,
                "dflt",
            ):
                continue
            script = script_record.Script
            langsys = None
            if want_language:
                for lang_record in script.LangSysRecord:
                    if lang_record.LangSysTag.strip().upper() == want_language.strip():
                        langsys = lang_record.LangSys
                        break
            if langsys is None:
                langsys = script.DefaultLangSys
            if langsys is None:
                continue

            indices = list(langsys.FeatureIndex)
            if getattr(langsys, "ReqFeatureIndex", 0xFFFF) != 0xFFFF:
                indices.append(langsys.ReqFeatureIndex)
            for fi in indices:
                if 0 <= fi < len(feature_list.FeatureRecord):
                    tag = feature_list.FeatureRecord[fi].FeatureTag
                    if valid_tag(tag):
                        applicable.add(tag)
    return applicable
