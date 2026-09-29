"""Read descriptive font information from the actual parsed font.

Names come from the ``name`` table (not from the uploaded filename) and the
feature list is enumerated from the font's own GSUB/GPOS tables.
"""

from __future__ import annotations

import re
from typing import Any

from fontTools.ttLib import TTFont

from .features import DEFAULT_ON_TAGS, feature_label

# A valid OpenType tag is four printable ASCII characters, never containing
# a space (space is only legal as padding in fixed-width fields).  Some
# FontForge-produced fonts carry internal markers like ' RQD' here.
_TAG_RE = re.compile(r"^[!-~]{4}$")


def valid_tag(tag: str) -> bool:
    return bool(_TAG_RE.match(tag))

# nameID -> field name
_NAME_FIELDS = [
    (1, "familyName"),
    (2, "subfamilyName"),
    (4, "fullName"),
    (6, "postScriptName"),
    (16, "typographicFamily"),
    (17, "typographicSubfamily"),
    (0, "copyright"),
    (5, "version"),
    (9, "designer"),
    (13, "licenseDescription"),
]


def _read_name(tt: TTFont, name_id: int) -> str | None:
    name_table = tt.get("name")
    if name_table is None:
        return None
    # Prefer Windows Unicode English, then any Windows Unicode, then anything.
    candidates = []
    for record in name_table.names:
        if record.nameID != name_id:
            continue
        try:
            value = record.toUnicode()
        except UnicodeDecodeError:
            continue
        priority = (
            0
            if record.platformID == 3
            and record.platEncID in (1, 10)
            and record.langID == 0x409
            else 1
            if record.platformID == 3
            else 2
        )
        candidates.append((priority, value))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    return candidates[0][1]


def _feature_index_map(tt: TTFont) -> dict[tuple[str, str], list[dict[str, Any]]]:
    """{(GSUB/GPOS table, feature tag): [{script, language, required}]}."""
    result: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for table_tag in ("GSUB", "GPOS"):
        if table_tag not in tt:
            continue
        table = tt[table_tag].table
        if table.FeatureList is None or table.ScriptList is None:
            continue
        for script_record in table.ScriptList.ScriptRecord:
            script = script_record.Script
            entries: list[tuple[Any, str, bool]] = []
            if script.DefaultLangSys is not None:
                entries.append((script.DefaultLangSys, "default", False))
            for lang_record in script.LangSysRecord:
                entries.append((lang_record.LangSys, lang_record.LangSysTag, False))
            for langsys, lang_tag, _ in entries:
                indices = [
                    (fi, False) for fi in langsys.FeatureIndex
                ]
                req = getattr(langsys, "ReqFeatureIndex", 0xFFFF)
                if req != 0xFFFF:
                    indices.append((req, True))
                for fi, required in indices:
                    if not (0 <= fi < len(table.FeatureList.FeatureRecord)):
                        continue
                    tag = table.FeatureList.FeatureRecord[fi].FeatureTag
                    if not valid_tag(tag):
                        continue
                    result.setdefault((table_tag, tag), []).append(
                        {
                            "script": script_record.ScriptTag,
                            "language": lang_tag,
                            "required": required,
                        }
                    )
    return result


def font_info(tt: TTFont) -> dict[str, Any]:
    names = {}
    for name_id, field_name in _NAME_FIELDS:
        value = _read_name(tt, name_id)
        if value:
            names[field_name] = value

    head = tt["head"]
    maxp = tt["maxp"]
    os2 = tt.get("OS/2")

    coverage = _feature_index_map(tt)
    tags = sorted({tag for _, tag in coverage})
    features = []
    for tag in tags:
        scripts = {}
        required_anywhere = False
        for table_tag in ("GSUB", "GPOS"):
            for entry in coverage.get((table_tag, tag), []):
                scripts.setdefault(entry["script"], set()).add(entry["language"])
                required_anywhere = required_anywhere or entry["required"]
        features.append(
            {
                "tag": tag,
                "label": feature_label(tag),
                "table": (
                    "GSUB/GPOS"
                    if coverage.get(("GSUB", tag)) and coverage.get(("GPOS", tag))
                    else "GSUB"
                    if coverage.get(("GSUB", tag))
                    else "GPOS"
                ),
                "scripts": sorted(scripts),
                "languages": {
                    script: sorted(langs) for script, langs in scripts.items()
                },
                "required": required_anywhere,
                "defaultOn": tag in DEFAULT_ON_TAGS,
            }
        )

    tables = sorted(tt.keys())

    info: dict[str, Any] = {
        "names": names,
        "familyName": names.get("fullName")
        or names.get("typographicFamily")
        or names.get("familyName")
        or "未知字体",
        "upem": head.unitsPerEm,
        "numGlyphs": maxp.numGlyphs,
        "isFixedPitch": bool(tt["post"].isFixedPitch) if "post" in tt else False,
        "tables": tables,
        "features": features,
        "hasGlyphOutlines": "glyf" in tt,
        "hasCffOutlines": "CFF " in tt or "CFF2" in tt,
        "flavor": tt.flavor,
        "sfntVersion": tt.sfntVersion,
    }
    if os2 is not None:
        info["weightClass"] = os2.usWeightClass
        info["widthClass"] = os2.usWidthClass
        info["fsSelection"] = int(os2.fsSelection)
    fvar = tt.get("fvar")
    if fvar is not None:
        info["variable"] = True
        info["variationAxes"] = [
            {
                "tag": axis.axisTag,
                "name": _read_name(tt, axis.axisNameID),
                "min": axis.minValue,
                "max": axis.maxValue,
                "default": axis.defaultValue,
            }
            for axis in fvar.axes
        ]
    else:
        info["variable"] = False
    return info
