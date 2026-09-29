"""HTTP API: font upload/sample, font info, and HarfBuzz shaping.

The same endpoints are used by the bundled page and by direct API callers.
Fonts live in the in-memory :class:`SessionStore`; they are never exposed by
their original filename and cannot be listed or downloaded.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .font_info import font_info
from .sessions import (
    MAX_FONT_BYTES,
    MAX_TEXT_CHARS,
    FontSession,
    FontLoadError,
    SessionStore,
    build_session,
    shape_text,
)

# Samples shipped with the project (see sample-fonts/LICENSE).  Only files
# named here can ever be served; they are shaped through the same /shape
# endpoint as uploaded fonts.
SAMPLE_DIR = Path(__file__).resolve().parent.parent.parent / "sample-fonts"
SAMPLES = {
    "DejaVuSans.ttf": {
        "path": SAMPLE_DIR / "DejaVuSans.ttf",
        "displayName": "DejaVu Sans",
        "license": "Bitstream Vera License / public-domain DejaVu changes "
        "(见 sample-fonts/LICENSE，允许再分发)",
    }
}

app = FastAPI(title="Font Shaping Inspector API", version="1.0.0")
store = SessionStore()


class ShapeRequest(BaseModel):
    text: str = Field("", description="要排版的原始文本（Unicode）")
    direction: Literal["auto", "ltr", "rtl", "ttb", "btt"] = "auto"
    script: str | None = Field(None, description="如 Latn/Arab；留空自动检测")
    language: str | None = Field(None, description="如 en/ara；留空自动检测")
    # tag -> true/false; tags absent here follow the font/HB defaults
    features: dict[str, bool] = Field(default_factory=dict)


def _session_or_404(session_id: str) -> FontSession:
    session = store.get(session_id)
    if session is None:
        raise HTTPException(
            status_code=404,
            detail="会话不存在或已过期，请重新上传字体。",
        )
    return session


def _session_payload(session: FontSession) -> dict[str, Any]:
    return {
        "sessionId": session.session_id,
        "filename": session.filename,
        "font": font_info(session.tt_font),
    }


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/samples")
def list_samples() -> dict[str, Any]:
    """List built-in sample fonts available to bootstrap the page."""
    items = []
    for key, meta in SAMPLES.items():
        if meta["path"].exists():
            items.append(
                {
                    "key": key,
                    "displayName": meta["displayName"],
                    "license": meta["license"],
                    "size": meta["path"].stat().st_size,
                }
            )
    return {"samples": items}


@app.post("/api/fonts")
async def upload_font(file: UploadFile = File(...)) -> JSONResponse:
    """Load one font file into a new isolated session.

    A failure here never touches previously opened sessions: the UI keeps
    the last valid session available.
    """
    # Read with a hard cap so an oversized file cannot exhaust memory.
    chunks: list[bytes] = []
    total = 0
    try:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > MAX_FONT_BYTES:
                raise FontLoadError(
                    f"字体文件过大（上限 {MAX_FONT_BYTES // 1024 // 1024}MB）"
                )
            chunks.append(chunk)
        data = b"".join(chunks)
        session = build_session(data, file.filename or "uploaded-font")
    except FontLoadError as exc:
        return JSONResponse(
            status_code=400,
            content={"error": str(exc), "filename": file.filename},
        )
    finally:
        await file.close()

    store.add(session)
    return JSONResponse(_session_payload(session))


@app.post("/api/samples/{key}/load")
def load_sample(key: str) -> dict[str, Any]:
    """Load a built-in sample through the same parsing path as an upload."""
    meta = SAMPLES.get(key)
    if meta is None or not meta["path"].exists():
        raise HTTPException(status_code=404, detail="未知样本字体")
    try:
        session = build_session(meta["path"].read_bytes(), key)
    except FontLoadError as exc:  # pragma: no cover - bundled font is valid
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    payload = _session_payload(session)
    payload["sample"] = {"key": key, "license": meta["license"]}
    store.add(session)
    return payload


@app.get("/api/fonts/{session_id}")
def get_font(session_id: str) -> dict[str, Any]:
    session = _session_or_404(session_id)
    return _session_payload(session)


@app.post("/api/fonts/{session_id}/shape")
def shape(session_id: str, request: ShapeRequest) -> dict[str, Any]:
    session = _session_or_404(session_id)
    if len(request.text) > MAX_TEXT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"文本过长（上限 {MAX_TEXT_CHARS} 个字符）",
        )
    # Only accept well-formed 4-byte feature tags.
    overrides: dict[str, bool] = {}
    for tag, value in request.features.items():
        if isinstance(tag, str) and 1 <= len(tag) <= 4:
            overrides[tag.ljust(4)[:4]] = bool(value)
    script = request.script.strip() or None if request.script else None
    language = request.language.strip() or None if request.language else None
    try:
        result = shape_text(
            session,
            request.text,
            direction=request.direction,
            feature_overrides=overrides,
            language=language,
            script=script,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "sessionId": session_id,
        "text": request.text,
        **result,
    }


# ---------------------------------------------------------------------------
# Static frontend (production).  Vite dev server proxies /api during dev.
# ---------------------------------------------------------------------------

DIST_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if DIST_DIR.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=str(DIST_DIR), html=True),
        name="frontend",
    )
