"""In-memory, unguessable per-check sessions holding uploaded fonts.

A session id is the *only* handle to an uploaded font: there is no endpoint
that maps a client-supplied file name to stored bytes, so sessions can never
read each other's fonts. Entries live in process memory and disappear on
restart.
"""
from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass

from .shaping import FontLoadError, LoadedFont, load_font

SESSION_TTL_SECONDS = 60 * 60 * 6  # idle timeout
MAX_SESSIONS = 64


@dataclass
class Session:
    session_id: str
    font: LoadedFont
    filename: str
    created_at: float
    last_used: float


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    def add(self, data: bytes, filename: str) -> Session:
        # Parse fully before registering anything, so a rejected upload can
        # never displace an existing valid session.
        font = load_font(data)
        now = time.time()
        with self._lock:
            self._sessions = {
                sid: s
                for sid, s in self._sessions.items()
                if now - s.last_used < SESSION_TTL_SECONDS
            }
            if len(self._sessions) >= MAX_SESSIONS:
                oldest = min(self._sessions.values(), key=lambda s: s.last_used)
                self._sessions.pop(oldest.session_id, None)
            session_id = secrets.token_urlsafe(18)
            while session_id in self._sessions:
                session_id = secrets.token_urlsafe(18)
            session = Session(
                session_id=session_id,
                font=font,
                filename=filename,
                created_at=now,
                last_used=now,
            )
            self._sessions[session_id] = session
            return session

    def get(self, session_id: str) -> Session | None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                return None
            now = time.time()
            if now - session.last_used >= SESSION_TTL_SECONDS:
                self._sessions.pop(session_id, None)
                return None
            session.last_used = now
            return session


__all__ = ["Session", "SessionStore", "FontLoadError", "LoadedFont"]
