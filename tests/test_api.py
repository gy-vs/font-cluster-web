"""End-to-end tests against the ASGI API (upload -> shape -> mapping)."""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

from backend.app.main import SAMPLES, app

client = TestClient(app)

SAMPLE = SAMPLES["DejaVuSans.ttf"]["path"]


def _upload(path: str = str(SAMPLE)) -> str:
    with open(path, "rb") as fh:
        response = client.post(
            "/api/fonts",
            files={"file": ("My Font.ttf", fh, "font/sfnt")},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["filename"] == "My Font.ttf"
    assert body["font"]["familyName"] == "DejaVu Sans"
    assert body["font"]["numGlyphs"] > 0
    assert "upem" in body["font"]
    tags = {f["tag"] for f in body["font"]["features"]}
    assert {"liga", "kern", "ccmp"}.issubset(tags)
    return body["sessionId"]


def test_health_and_samples() -> None:
    assert client.get("/api/health").json() == {"status": "ok"}
    samples = client.get("/api/samples").json()["samples"]
    assert any(item["key"] == "DejaVuSans.ttf" for item in samples)


def test_sample_loads_via_same_parse_path() -> None:
    response = client.post("/api/samples/DejaVuSans.ttf/load")
    assert response.status_code == 200
    body = response.json()
    assert body["font"]["familyName"] == "DejaVu Sans"
    assert body["sample"]["key"] == "DejaVuSans.ttf"


def test_upload_rejects_garbage_and_keeps_old_session() -> None:
    session_id = _upload()
    bad = client.post(
        "/api/fonts",
        files={"file": ("evil.ttf", io.BytesIO(b"not a font"), "font/sfnt")},
    )
    assert bad.status_code == 400
    assert bad.json()["error"]
    # The previously opened session must still shape correctly.
    ok = client.post(
        f"/api/fonts/{session_id}/shape", json={"text": "ABC"}
    )
    assert ok.status_code == 200
    assert len(ok.json()["glyphs"]) == 3


def test_unknown_session_404_and_unguessable() -> None:
    assert client.get("/api/fonts/nope").status_code == 404
    assert (
        client.post("/api/fonts/nope/shape", json={"text": "x"}).status_code
        == 404
    )
    # Original filename is not a session identifier.
    assert client.get("/api/fonts/My%20Font.ttf").status_code == 404


def test_shape_basic_mapping_and_outlines() -> None:
    sid = _upload()
    response = client.post(
        f"/api/fonts/{sid}/shape", json={"text": "ABC"}
    )
    assert response.status_code == 200
    result = response.json()
    assert result["direction"] == "ltr"
    assert result["script"] == "Latn"
    glyphs = result["glyphs"]
    assert [g["clusterStart"] for g in glyphs] == [0, 1, 2]
    assert [g["clusterEnd"] for g in glyphs] == [1, 2, 3]
    assert [g["utf16Start"] for g in glyphs] == [0, 1, 2]
    for glyph in glyphs:
        assert glyph["ink"]
        assert str(glyph["gid"]) in result["outlines"]
        assert result["outlines"][str(glyph["gid"])]
        assert glyph["name"]
    # Monotone increasing x positions in visual order.
    xs = [g["x"] for g in glyphs]
    assert xs == sorted(xs)


def test_ligature_clusters_one_glyph_to_many_chars() -> None:
    sid = _upload()
    on = client.post(f"/api/fonts/{sid}/shape", json={"text": "ffi"}).json()
    assert [(g["name"], g["clusterStart"], g["clusterEnd"]) for g in on["glyphs"]] == [
        ("uniFB03", 0, 3)
    ]
    off = client.post(
        f"/api/fonts/{sid}/shape",
        json={"text": "ffi", "features": {"liga": False}},
    ).json()
    assert [g["name"] for g in off["glyphs"]] == ["f", "f", "i"]
    # Feature state echoes the request.
    liga = next(f for f in off["features"] if f["tag"] == "liga")
    assert liga["on"] is False


def test_rtl_visual_order_and_clusters() -> None:
    sid = _upload()
    result = client.post(
        f"/api/fonts/{sid}/shape", json={"text": "أب"}
    ).json()
    assert result["direction"] == "rtl"
    # Output is visual order: clusters run 1.. then 0.., x positions increase.
    assert [g["clusterStart"] for g in result["glyphs"]] == [1, 0]
    assert [g["x"] for g in result["glyphs"]] == sorted(
        g["x"] for g in result["glyphs"]
    )


def test_multibyte_utf16_mapping() -> None:
    sid = _upload()
    result = client.post(
        f"/api/fonts/{sid}/shape", json={"text": "é😃Z"}
    ).json()
    pairs = [
        (g["clusterStart"], g["clusterEnd"], g["utf16Start"], g["utf16End"])
        for g in result["glyphs"]
    ]
    assert pairs == [(0, 1, 0, 1), (1, 2, 1, 3), (2, 3, 3, 4)]
    assert result["textLength"] == 3
    assert result["utf16Length"] == 4


def test_direction_override() -> None:
    sid = _upload()
    result = client.post(
        f"/api/fonts/{sid}/shape",
        json={"text": "ABC", "direction": "ttb"},
    ).json()
    assert result["direction"] == "ttb"
    assert all(g["advanceY"] != 0 for g in result["glyphs"])


def test_empty_text_does_not_crash() -> None:
    sid = _upload()
    result = client.post(
        f"/api/fonts/{sid}/shape", json={"text": ""}
    ).json()
    assert result["glyphs"] == []
    assert len(result["viewBox"]) == 4


def test_text_too_long() -> None:
    sid = _upload()
    response = client.post(
        f"/api/fonts/{sid}/shape", json={"text": "A" * 10_001}
    )
    assert response.status_code == 400


def test_empty_upload_rejected() -> None:
    response = client.post(
        "/api/fonts",
        files={"file": ("x.ttf", io.BytesIO(b""), "font/sfnt")},
    )
    assert response.status_code == 400


def test_sessions_are_isolated_and_not_listable() -> None:
    sid_a = _upload()
    sid_b = _upload()
    assert sid_a != sid_b
    # There is no endpoint to enumerate sessions or download the raw font.
    for path in (
        "/api/fonts",
        f"/api/fonts/{sid_a}/raw",
        f"/api/fonts/{sid_a}/DejaVuSans.ttf",
    ):
        assert client.get(path).status_code in (404, 405)
