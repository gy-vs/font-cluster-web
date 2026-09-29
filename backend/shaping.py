"""Shaping engine: the single place where an uploaded font is parsed and shaped.

Both manual uploads and the bundled sample font pass through :func:`load_font`
and :class:`ShapeRequest` handling; the browser never shapes text itself.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Any

import uharfbuzz as hb
from bidi import algorithm as bidi
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.svgPathPen import SVGPathPen
from pydantic import BaseModel

# User-facing features HarfBuzz turns on for a generic run.
DEFAULT_ON_FEATURES = {"liga", "clig", "calt", "rlig"}

MAX_FONT_BYTES = 25 * 1024 * 1024


class FontLoadError(ValueError):
    """User-facing failure while parsing an uploaded font."""


# --------------------------------------------------------------------------- #
# Font loading / metadata
# --------------------------------------------------------------------------- #


def _pick_name(namerecords, name_id: int) -> str | None:
    best: str | None = None
    for rec in namerecords:
        if rec.nameID != name_id:
            continue
        try:
            value = rec.toUnicode()
        except Exception:
            continue
        if not value:
            continue
        value = value.strip()
        if not value:
            continue
        # Prefer Windows Unicode English, then fall back to the first readable.
        if rec.platformID == 3 and (rec.langID & 0x3FF) == 0x09:
            return value
        if best is None:
            best = value
    return best


def _feature_records(table: Any) -> list[dict[str, Any]]:
    if table is None or table.table is None or table.table.FeatureList is None:
        return []
    by_tag: dict[str, dict[str, Any]] = {}
    for fr in table.table.FeatureList.FeatureRecord:
        tag = fr.FeatureTag
        if tag not in by_tag:
            by_tag[tag] = {
                "tag": tag,
                "default_on": tag in DEFAULT_ON_FEATURES,
                "lookups": len(fr.Feature.LookupListIndex),
            }
    return sorted(by_tag.values(), key=lambda r: r["tag"])


@dataclass
class LoadedFont:
    data: bytes
    face: hb.Face
    tt: TTFont
    glyph_set: Any
    info: dict[str, Any]
    # (gid, variation-signature) -> SVG path / extents
    _path_cache: dict[tuple[int, str], str] = field(default_factory=dict)
    _extent_cache: dict[tuple[int, str], tuple[float, float, float, float] | None] = (
        field(default_factory=dict)
    )

    def new_hb_font(self, variations: dict[str, float] | None) -> hb.Font:
        font = hb.Font(self.face)
        upem = self.face.upem or 1000
        font.scale = (upem, upem)
        if variations:
            font.set_variations(variations)
        return font

    @staticmethod
    def var_sig(variations: dict[str, float] | None) -> str:
        if not variations:
            return ""
        return ",".join(f"{k}={variations[k]:g}" for k in sorted(variations))

    def glyph_path(self, hb_font: hb.Font, gid: int, sig: str) -> str:
        key = (gid, sig)
        cached = self._path_cache.get(key)
        if cached is not None:
            return cached
        rp = RecordingPen()
        # HarfBuzz already applies variation coordinates and decomposes
        # component glyphs, so the pen output matches the shaped metrics.
        hb_font.draw_glyph_with_pen(gid, rp)
        pen = SVGPathPen(self.glyph_set)
        rp.replay(pen)
        d = pen.getCommands()
        self._path_cache[key] = d
        return d

    def glyph_extent(
        self, hb_font: hb.Font, gid: int, sig: str
    ) -> tuple[float, float, float, float] | None:
        key = (gid, sig)
        if key in self._extent_cache:
            return self._extent_cache[key]
        ext = hb_font.get_glyph_extents(gid)
        if ext is None or (ext.width == 0 and ext.height == 0):
            result = None
        else:
            # HarfBuzz: bearing is the top-left corner; height is negative.
            result = (
                float(ext.x_bearing),
                float(ext.y_bearing + ext.height),
                float(ext.x_bearing + ext.width),
                float(ext.y_bearing),
            )
        self._extent_cache[key] = result
        return result


def _normalize_sfnt(tt: TTFont, original: bytes) -> tuple[bytes, str | None]:
    """Return (raw sfnt bytes HarfBuzz can consume, source container flavor).

    HarfBuzz does not accept WOFF/WOFF2 containers, so fontTools — which
    already decompressed the upload — re-emits plain sfnt. For uncompressed
    uploads we keep the original bytes untouched.
    """
    if getattr(tt.reader, "flavor", None) in ("woff", "woff2"):
        source_flavor = tt.reader.flavor
        buf = io.BytesIO()
        tt.flavor = None
        # Re-reading/saving must not mutate bboxes; save the decompressed tables.
        tt.save(buf, reorderTables=False)
        return buf.getvalue(), source_flavor
    return original, None


def load_font(data: bytes) -> LoadedFont:
    if not data or len(data) < 12:
        raise FontLoadError("文件为空或过小，不是有效的字体文件。")
    if len(data) > MAX_FONT_BYTES:
        raise FontLoadError("字体文件超过 25 MB 的限制。")

    # fontTools first: it transparently handles TTF, OTF, TTC, WOFF and WOFF2
    # and reports precise parse failures.
    try:
        tt = TTFont(io.BytesIO(data), lazy=True, recalcBBoxes=False)
    except Exception as exc:
        raise FontLoadError(f"fontTools 无法读取该字体：{exc}") from exc

    raw_sfnt = getattr(tt.reader, "sfntVersion", b"")
    raw_flavor = getattr(tt.reader, "flavor", None)
    sfnt_bytes, _container = _normalize_sfnt(tt, data)

    try:
        face = hb.Face(hb.Blob(sfnt_bytes))
        if face.glyph_count == 0:
            raise FontLoadError("该文件不包含任何字形，无法用于排版检查。")
    except FontLoadError:
        raise
    except Exception as exc:
        raise FontLoadError(f"无法按 OpenType/TrueType 解析该文件：{exc}") from exc

    name = tt["name"]
    family = _pick_name(name.names, 16) or _pick_name(name.names, 1) or "(未知字体族)"
    subfamily = _pick_name(name.names, 17) or _pick_name(name.names, 2) or ""
    full = (
        _pick_name(name.names, 4)
        or " ".join(p for p in (family, subfamily) if p)
    )

    # A lazy sfnt reader may hand back the 4-byte tag as str instead of bytes.
    raw_tag = getattr(tt.reader, "sfntVersion", b"")
    if isinstance(raw_tag, str):
        raw_tag = raw_tag.encode("latin-1")
    kind = {
        b"\x00\x01\x00\x00": "TrueType",
        b"true": "TrueType",
        b"OTTO": "CFF/OpenType",
        b"ttcf": "TrueType Collection",
        b"typ1": "PostScript Type 1",
    }.get(raw_tag, "sfnt 字体")
    if raw_flavor:
        kind += f" ({raw_flavor.upper()})"

    info = {
        "family": family,
        "subfamily": subfamily,
        "full_name": full,
        "postscript_name": _pick_name(name.names, 6),
        "version": _pick_name(name.names, 5),
        "copyright": _pick_name(name.names, 0),
        "kind": kind,
        "upem": face.upem,
        "glyph_count": face.glyph_count,
        "mapped_codepoints": len(face.unicodes),
        "features": {
            "GSUB": _feature_records(tt["GSUB"]) if "GSUB" in tt else [],
            "GPOS": _feature_records(tt["GPOS"]) if "GPOS" in tt else [],
        },
        "axes": [
            {
                "tag": a.axisTag,
                "name": _pick_name(name.names, a.axisNameID) or a.axisTag,
                "min": a.minValue,
                "default": a.defaultValue,
                "max": a.maxValue,
            }
            for a in (tt["fvar"].axes if "fvar" in tt else [])
        ],
    }

    return LoadedFont(
        data=data,
        face=face,
        tt=tt,
        glyph_set=tt.getGlyphSet(),
        info=info,
    )


# --------------------------------------------------------------------------- #
# Shaping
# --------------------------------------------------------------------------- #


class ShapeRequest(BaseModel):
    session_id: str
    text: str = ""
    # "auto" | "ltr" | "rtl" | "ttb"
    direction: str = "auto"
    # tag -> enabled?; tags left out use HarfBuzz defaults
    features: dict[str, bool] | None = None
    # fvar tag -> design-space value
    variations: dict[str, float] | None = None
    # only used to return the px scale; all geometry stays in font units
    font_size: float = 64.0
    include_paths: bool = True


def _feature_overrides(overrides: dict[str, bool] | None) -> dict[str, bool]:
    feats = {tag: True for tag in DEFAULT_ON_FEATURES}
    if overrides:
        for raw_tag, value in overrides.items():
            tag = raw_tag.strip()
            if not tag:
                continue
            tag = (tag + "    ")[:4]
            if all(32 <= ord(c) < 127 for c in tag):
                feats[tag] = bool(value)
    return feats


def _line_levels(line: str, forced: str | None) -> list[int]:
    """Full UAX #9 stages (via python-bidi), giving a resolved level per code point."""
    storage = bidi.get_empty_storage()
    if forced is None:
        storage["base_level"] = bidi.get_base_level(line)
    else:
        storage["base_level"] = bidi.PARAGRAPH_LEVELS[forced]
    storage["base_dir"] = ("L", "R")[storage["base_level"]]

    bidi.get_embedding_levels(line, storage)
    bidi.explicit_embed_and_overrides(storage, False)
    bidi.resolve_weak_types(storage, False)
    bidi.resolve_neutral_types(storage, False)
    bidi.resolve_implicit_levels(storage, False)
    return [c["level"] for c in storage["chars"]]


def _visual_order(levels: list[int]) -> list[int]:
    """UAX #9 L2: indices into `levels` in left-to-right visual order."""
    order = list(range(len(levels)))
    for level in range(max(levels, default=0), 0, -1):
        i = 0
        while i < len(order):
            if levels[order[i]] < level:
                i += 1
                continue
            j = i
            while j < len(order) and levels[order[j]] >= level:
                j += 1
            order[i:j] = reversed(order[i:j])
            i = j
    return order


def _cluster_ends(clusters: list[int], run_len: int) -> list[int]:
    """End offset (exclusive, local to the run substring) for each glyph.

    HarfBuzz reports one cluster value per glyph, equal to the index of the
    first input code point the glyph represents; ligatures merge clusters.
    A glyph's range reaches the next *larger* cluster value (monotone ordering
    is guaranteed by the default grapheme cluster level) or end of run.
    """
    ends: list[int] = []
    for i, cl in enumerate(clusters):
        nxt = run_len
        for other in clusters:
            if cl < other < nxt:
                nxt = other
        ends.append(nxt)
    return ends


def _shape_run(
    loaded: LoadedFont,
    hb_font: hb.Font,
    var_sig: str,
    sub: str,
    run_start: int,
    direction: str,
    features: dict[str, bool],
    include_paths: bool,
) -> list[dict[str, Any]]:
    buf = hb.Buffer()
    buf.add_str(sub)
    buf.direction = direction
    buf.guess_segment_properties()
    hb.shape(hb_font, buf, features)

    infos = buf.glyph_infos
    positions = buf.glyph_positions
    clusters = [int(info.cluster) for info in infos]
    ends = _cluster_ends(clusters, len(sub))

    pen_x = 0.0
    pen_y = 0.0
    glyphs: list[dict[str, Any]] = []
    for info, pos, local_end in zip(infos, positions, ends):
        gid = int(info.codepoint)
        x = pen_x + float(pos.x_offset)
        y = pen_y + float(pos.y_offset)
        pen_x += float(pos.x_advance)
        pen_y += float(pos.y_advance)

        bbox: list[float] | None = None
        ext = loaded.glyph_extent(hb_font, gid, var_sig)
        if ext is not None:
            x0, y0, x1, y1 = ext
            bbox = [
                round(x + x0, 1), round(y + y0, 1),
                round(x + x1, 1), round(y + y1, 1),
            ]

        glyph = {
            "gid": gid,
            "name": hb_font.glyph_to_string(gid),
            "start": run_start + int(info.cluster),
            "end": run_start + local_end,
            "x": round(x, 1),
            "y": round(y, 1),
            "x_advance": round(float(pos.x_advance), 1),
            "y_advance": round(float(pos.y_advance), 1),
            "bbox": bbox,
        }
        if include_paths:
            glyph["d"] = loaded.glyph_path(hb_font, gid, var_sig)
        glyphs.append(glyph)
    return glyphs


def shape_text(loaded: LoadedFont, req: ShapeRequest) -> dict[str, Any]:
    text = req.text
    direction = (req.direction or "auto").lower()
    if direction not in ("auto", "ltr", "rtl", "ttb"):
        direction = "auto"
    features = _feature_overrides(req.features)

    variations = {
        tag: float(value) for tag, value in (req.variations or {}).items()
    }
    var_sig = LoadedFont.var_sig(variations)
    hb_font = loaded.new_hb_font(variations)

    ext_dir = "ttb" if direction == "ttb" else "ltr"
    font_ext = hb_font.get_font_extents(ext_dir)
    ascender = int(font_ext.ascender)
    descender = int(font_ext.descender)
    line_gap = int(getattr(font_ext, "line_gap", 0))
    line_height = ascender - descender + line_gap

    # Horizontal runs: one hb.Font per request means concurrent shape calls
    # never see each other's variation state.
    out_lines: list[dict[str, Any]] = []
    text_cursor = 0
    max_width = 0
    max_depth = 0

    for line_index, line in enumerate(text.split("\n")):
        runs: list[dict[str, Any]] = []

        if direction == "ttb":
            if line:
                glyphs = _shape_run(
                    loaded, hb_font, var_sig, line, 0, "ttb",
                    features, req.include_paths,
                )
                depth_units = int(
                    round(sum((-g["y_advance"]) for g in glyphs))
                )
                runs.append(
                    {
                        "start": 0, "end": len(line), "direction": "ttb",
                        "level": 0, "width": 0, "advance": depth_units,
                        "glyphs": glyphs,
                    }
                )
                x_cursor = float(depth_units)
        else:
            forced_dir = None if direction == "auto" else direction[0].upper()
            levels = _line_levels(line, forced_dir)
            # Maximal runs of identical resolved level, in logical order.
            logical_runs: list[tuple[int, int, int]] = []
            i = 0
            while i < len(line):
                j = i + 1
                while j < len(line) and levels[j] == levels[i]:
                    j += 1
                logical_runs.append((i, j, levels[i]))
                i = j

            shaped: dict[tuple[int, int], list[dict[str, Any]]] = {}
            for rs, re_, level in logical_runs:
                run_dir = "rtl" if level % 2 else "ltr"
                shaped[(rs, re_)] = _shape_run(
                    loaded, hb_font, var_sig, line[rs:re_], rs, run_dir,
                    features, req.include_paths,
                )

            # Lay the runs out along the visual order given by UAX #9 L2.
            visual_indices = _visual_order(levels)
            x_cursor = 0.0
            placed: set[tuple[int, int]] = set()
            for vis_idx in visual_indices:
                run = next(
                    (r for r in logical_runs if r[0] <= vis_idx < r[1]), None
                )
                if run is None or run in placed:
                    continue
                placed.add(run)
                rs, re_, level = run
                glyphs = shaped[(rs, re_)]
                width = 0.0
                for g in glyphs:
                    g["x"] = round(g["x"] + x_cursor, 1)
                    if g["bbox"] is not None:
                        x0, y0, x1, y1 = g["bbox"]
                        g["bbox"] = [
                            round(x0 + x_cursor, 1), y0,
                            round(x1 + x_cursor, 1), y1,
                        ]
                    width = max(width, g["x"] + g["x_advance"])
                runs.append(
                    {
                        "start": rs,
                        "end": re_,
                        "direction": "rtl" if level % 2 else "ltr",
                        "level": level,
                        "width": int(round(width)),
                        "glyphs": glyphs,
                    }
                )
                x_cursor += width

        line_width = int(x_cursor) if direction != "ttb" else line_height
        baseline = ascender + line_index * line_height
        line_glyphs: list[dict[str, Any]] = []
        runs_meta: list[dict[str, Any]] = []
        depth = line_height if direction != "ttb" else int(x_cursor)
        for run in runs:
            glyphs = run.pop("glyphs")
            for g in glyphs:
                g["line"] = line_index
                g["start"] += text_cursor  # global text offsets across lines
                g["end"] += text_cursor
                line_glyphs.append(g)
            runs_meta.append(
                {
                    "start": run["start"] + text_cursor,
                    "end": run["end"] + text_cursor,
                    "direction": run["direction"],
                    "level": run.get("level", 0),
                    "width": run["width"],
                }
            )
        out_lines.append(
            {
                "index": line_index,
                "text_start": text_cursor,
                "text_end": text_cursor + len(line),
                "baseline": baseline,
                "width": line_width,
                "runs": runs_meta,
                "glyphs": line_glyphs,
            }
        )
        max_width = max(max_width, line_width)
        max_depth = max(max_depth, depth)
        text_cursor += len(line) + 1  # '\n'

    total_height = len(out_lines) * line_height or line_height
    if direction == "ttb":
        total_height = max_depth or line_height

    upem = loaded.info["upem"]
    return {
        "upem": upem,
        "font_size": req.font_size,
        "scale": req.font_size / upem,
        "direction": direction,
        "ascender": ascender,
        "descender": descender,
        "line_gap": line_gap,
        "line_height": line_height,
        "width": max_width,
        "height": int(total_height),
        "text_length": len(text),
        "features_applied": features,
        "lines": out_lines,
    }
