"""Internal TTS routes (internal token, called by the NestJS backend only):

- POST /api/v1/tts {text, lang: "tr"|"en"} → {key, duration_ms, cached}
- GET  /api/v1/tts/audio/{key}.wav       → the cached WAV (404 when unknown)

The browser never calls these; the backend turns ``key`` into a signed, expiring /api URL.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field

from knot_rag.tts.cache import KEY, AudioCache, Synthesizer
from knot_rag.tts.piper_voice import PiperSynthesizer, TtsUnavailable, piper_installed, voice_files_present
from knot_rag.tts.settings import TtsSettings
from knot_rag.tts.speech import speakable


class Speak(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=20000)
    lang: Literal["tr", "en"] = "tr"


def install(app, auth, settings: TtsSettings | None = None, synthesizer: Synthesizer | None = None) -> None:
    cfg = settings or TtsSettings()
    holder: dict[str, object] = {}

    def cache() -> AudioCache:
        if not cfg.configured:
            raise HTTPException(503, "TTS is not configured (TTS_KEY_SECRET).")
        if "cache" not in holder:
            holder["cache"] = AudioCache(cfg.cache_dir, cfg.key_secret)
        return holder["cache"]  # type: ignore[return-value]

    def synth() -> Synthesizer:
        if synthesizer is not None:
            return synthesizer
        if "synth" not in holder:
            holder["synth"] = PiperSynthesizer(cfg)  # Piper itself loads on the first sentence
        return holder["synth"]  # type: ignore[return-value]

    router = APIRouter(prefix="/api/v1/tts", dependencies=[Depends(auth)], tags=["tts"])

    # `def`, not `async def`: synthesis keeps a CPU busy, FastAPI runs it in its thread pool.
    @router.post("")
    def speak(body: Speak) -> dict:
        text = speakable(body.text, body.lang)
        if not text:
            raise HTTPException(422, "Nothing to read.")
        if len(text) > cfg.max_chars:
            raise HTTPException(413, f"Text longer than {cfg.max_chars} characters.")
        store = cache()
        try:
            audio = store.get_or_create(text, cfg.voice_for(body.lang), synth())
        except TtsUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc
        return {"key": audio.key, "duration_ms": audio.duration_ms, "cached": audio.cached}

    @router.get("/audio/{key}.wav")
    def audio(key: str):
        audio = cache().get(key) if KEY.match(key) else None
        if audio is None:
            raise HTTPException(404, "Audio not found.")
        return FileResponse(audio.path, media_type="audio/wav", headers={"X-Audio-Duration-Ms": str(audio.duration_ms)})

    @router.get("/health")
    def health() -> dict:
        return {
            "configured": cfg.configured,
            "piper_installed": synthesizer is not None or piper_installed(),
            "voices": {"tr": cfg.voice_tr, "en": cfg.voice_en},
            "voice_files_present": {lang: voice_files_present(cfg, cfg.voice_for(lang)) for lang in ("tr", "en")},
            "auto_download": cfg.auto_download,
        }

    app.include_router(router)
