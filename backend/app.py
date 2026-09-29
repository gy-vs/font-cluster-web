"""FastAPI application: font upload/info/shape endpoints + static frontend.

The API is the only way to reach the shaping engine; the bundled sample font
is fetched as bytes by the browser and posted back to /api/fonts, so it takes
exactly the same code path as a user-uploaded file.
"""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .sessions import SessionStore
from .shaping import FontLoadError, MAX_FONT_BYTES, ShapeRequest, shape_text

BASE_DIR = Path(__file__).resolve().parent.parent
SAMPLE_FONT = BASE_DIR / "sample" / "amiri-regular.ttf"
SAMPLE_LICENSE = BASE_DIR / "sample" / "OFL.txt"
DIST_DIR = BASE_DIR / "frontend" / "dist"

app = FastAPI(title="Shaping Inspector", version="0.1.0")
store = SessionStore()


@app.exception_handler(FontLoadError)
async def font_load_error_handler(_request, exc: FontLoadError):
    # 422 would suggest a validation problem; this is an unusable font file.
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/fonts")
async def upload_font(file: UploadFile = File(...)) -> dict:
    data = await file.read()
    try:
        session = store.add(data, file.filename or "uploaded-font")
    except FontLoadError:
        raise
    except Exception as exc:  # defensive: never leak 500s to the inspector UI
        raise HTTPException(status_code=400, detail=f"字体载入失败：{exc}") from exc
    return {
        "session_id": session.session_id,
        "filename": session.filename,
        "font": session.font.info,
    }


@app.get("/api/fonts/{session_id}")
async def font_info(session_id: str) -> dict:
    session = store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在或已过期，请重新上传字体。")
    return {
        "session_id": session.session_id,
        "filename": session.filename,
        "font": session.font.info,
    }


@app.post("/api/shape")
async def shape(req: ShapeRequest) -> dict:
    session = store.get(req.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="会话不存在或已过期，请重新上传字体。")
    try:
        return shape_text(session.font, req)
    except Exception as exc:  # keep the usable session alive; this request fails
        raise HTTPException(status_code=400, detail=f"排版计算失败：{exc}") from exc


@app.get("/sample/{name}")
async def sample_file(name: str):
    # Only the two whitelisted files; never serve arbitrary paths by name.
    allowed = {
        "amiri-regular.ttf": SAMPLE_FONT,
        "OFL.txt": SAMPLE_LICENSE,
    }
    path = allowed.get(name)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="样本文件不存在。")
    return FileResponse(
        path, media_type="font/sfnt" if name.endswith(".ttf") else "text/plain"
    )


# Built frontend (produced by `npm run build`) and API share one origin.
if DIST_DIR.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=str(DIST_DIR), html=True),
        name="frontend",
    )
