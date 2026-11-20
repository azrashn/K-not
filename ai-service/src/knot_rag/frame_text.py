"""Text read off video frames (slides shown on screen), kept apart from the transcript index.

Frames come from the video engine's scene keyframes. Their OCR text is stored as small JSON files
under STORAGE_ROOT/frame-text/<course>/<material>.json, stamped with the material version. It is
never added to the question-answering index: it only feeds page <-> video matching.
"""

from __future__ import annotations

import base64
import json
import os
import re
import threading
from pathlib import Path

from fastapi import HTTPException
from pydantic import Field

from knot_rag.schemas.common import Identifier, StrictModel

_SAFE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_engine = None
_engine_lock = threading.Lock()


class FrameIn(StrictModel):
    start_ms: int = Field(ge=0, le=604800000)
    end_ms: int = Field(ge=0, le=604800000)
    image_base64: str = Field(max_length=4_000_000)


class FrameText(StrictModel):
    course_id: Identifier
    material_id: str = Field(pattern=r"^video_[A-Za-z0-9_-]{1,80}$")
    version: str = Field(pattern=r"^[a-f0-9]{64}$")
    # The store is rebuilt from the first batch and published when `final` arrives.
    first: bool = True
    final: bool = True
    frames: list[FrameIn] = Field(max_length=12)


def _root() -> Path | None:
    root = os.environ.get("STORAGE_ROOT")
    return Path(root).resolve() / "frame-text" if root else None


def _path(course_id: str, material_id: str) -> Path | None:
    root = _root()
    if root is None or not _SAFE.match(course_id) or not _SAFE.match(material_id):
        return None
    return root / course_id / f"{material_id}.json"


def _ocr():
    """RapidOCR, created once. Library missing -> None (screen matching is then unavailable)."""
    global _engine
    with _engine_lock:
        if _engine is None:
            try:
                from rapidocr import RapidOCR

                _engine = RapidOCR()
            except Exception:  # not installed / models unavailable: degrade, do not crash
                _engine = False
        return _engine or None


def available() -> bool:
    return _ocr() is not None


def read_text(image: bytes, engine=None) -> str:
    """OCR one image. Low-confidence lines are dropped; whitespace collapsed."""
    engine = engine or _ocr()
    if engine is None:
        raise RuntimeError("OCR unavailable")
    import cv2
    import numpy as np

    frame = cv2.imdecode(np.frombuffer(image, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        return ""
    result = engine(frame)
    texts = list(getattr(result, "txts", None) or [])
    scores = list(getattr(result, "scores", None) or [1.0] * len(texts))
    kept = [t for t, s in zip(texts, scores) if float(s) >= 0.5]
    return re.sub(r"\s+", " ", " ".join(kept)).strip()


def save_batch(body: FrameText, engine=None) -> dict:
    target = _path(body.course_id, body.material_id)
    if target is None:
        raise HTTPException(503, "Frame text storage is not configured")
    frames = []
    for f in body.frames:
        try:
            raw = base64.b64decode(f.image_base64, validate=True)
        except ValueError as exc:
            raise HTTPException(422, "Invalid frame image") from exc
        try:
            text = read_text(raw, engine)
        except RuntimeError as exc:
            raise HTTPException(503, "OCR is not available") from exc
        frames.append({"start_ms": f.start_ms, "end_ms": max(f.end_ms, f.start_ms + 1), "text": text})
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(".partial")
    data = {"version": body.version, "frames": []}
    if not body.first and partial.exists():
        try:
            old = json.loads(partial.read_text(encoding="utf-8"))
            if old.get("version") == body.version:
                data = old
        except (OSError, ValueError):
            pass
    data["frames"].extend(frames)
    if body.final:
        data["frames"].sort(key=lambda f: f["start_ms"])
        target.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        partial.unlink(missing_ok=True)
    else:
        partial.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return {"stored": len(frames), "complete": body.final}


def load(course_id: str, material_id: str, version: str) -> list[dict] | None:
    """Complete frame texts for this exact material version, else None."""
    target = _path(course_id, material_id)
    if target is None or not target.exists():
        return None
    try:
        data = json.loads(target.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data.get("frames", []) if data.get("version") == version else None


def purge(course_id: str, material_id: str) -> None:
    target = _path(course_id, material_id)
    if target is None:
        return
    for p in (target, target.with_suffix(".partial")):
        p.unlink(missing_ok=True)
