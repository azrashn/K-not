"""Local neural text-to-speech (Piper). Optional and fully offline once the voice file is on disk.

Nothing here talks to the network: the voice is an ONNX file under `ai-service/models/tts` (installed by
`npm run tts:install`). Without it, `status()` says so and the browser falls back to its own voices.
"""

from __future__ import annotations

import hashlib
import io
import logging
import os
import threading
import wave
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

DEFAULT_VOICE = "tr_TR-dfki-medium"
MODELS_DIR = Path(__file__).resolve().parents[2] / "models" / "tts"
MAX_CHARS = 1200
CACHE_ITEMS = 48


class TtsUnavailable(Exception):
    """No usable voice (package or file missing, or the voice failed to load)."""


class TtsRejected(ValueError):
    """The text cannot be synthesized (empty or too long)."""


@dataclass(frozen=True)
class TtsConfig:
    model_path: Path
    enabled: bool = True

    @property
    def voice_name(self) -> str:
        return self.model_path.name.removesuffix(".onnx")


def config_from_env(env=None) -> TtsConfig:
    env = os.environ if env is None else env
    raw = (env.get("TTS_VOICE_PATH") or "").strip()
    path = Path(raw) if raw else MODELS_DIR / f"{DEFAULT_VOICE}.onnx"
    if not path.is_absolute():
        path = Path(__file__).resolve().parents[2] / path
    return TtsConfig(model_path=path, enabled=(env.get("TTS_ENABLED", "auto").strip().lower() not in {"0", "false", "no", "off"}))


def clean_text(text: str) -> str:
    out = " ".join(str(text or "").split())
    if not out:
        raise TtsRejected("empty text")
    if len(out) > MAX_CHARS:
        raise TtsRejected(f"text longer than {MAX_CHARS} characters")
    return out


def _load_piper(path: Path):
    try:
        from piper import PiperVoice
    except ImportError as exc:
        raise TtsUnavailable("piper-tts is not installed (run: npm run tts:install)") from exc
    return PiperVoice.load(str(path))


class SpeechEngine:
    """Lazy, thread-safe wrapper around one Piper voice with a small result cache."""

    def __init__(self, config: TtsConfig, loader=_load_piper):
        self.config = config
        self._loader = loader
        self._voice = None
        self._lock = threading.Lock()
        self._cache: OrderedDict[str, bytes] = OrderedDict()

    def status(self) -> dict:
        if not self.config.enabled:
            return {"available": False, "reason": "DISABLED", "voice": None}
        if not self.config.model_path.is_file():
            return {"available": False, "reason": "VOICE_MISSING", "voice": self.config.voice_name}
        try:
            import piper  # noqa: F401
        except ImportError:
            return {"available": False, "reason": "PIPER_MISSING", "voice": self.config.voice_name}
        return {"available": True, "reason": None, "voice": self.config.voice_name}

    def _ensure_voice(self):
        if self._voice is None:
            state = self.status()
            if not state["available"]:
                raise TtsUnavailable(state["reason"])
            try:
                self._voice = self._loader(self.config.model_path)
            except TtsUnavailable:
                raise
            except Exception as exc:  # corrupt/incompatible model file
                log.warning("tts voice failed to load: %s", type(exc).__name__)
                raise TtsUnavailable("VOICE_LOAD_FAILED") from exc
        return self._voice

    def synthesize(self, text: str) -> bytes:
        """WAV bytes (16-bit mono) for `text`."""
        text = clean_text(text)
        key = hashlib.sha256(text.encode("utf-8")).hexdigest()
        with self._lock:
            hit = self._cache.get(key)
            if hit is not None:
                self._cache.move_to_end(key)
                return hit
            voice = self._ensure_voice()
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as wav:
                voice.synthesize_wav(text, wav)
            data = buffer.getvalue()
            self._cache[key] = data
            while len(self._cache) > CACHE_ITEMS:
                self._cache.popitem(last=False)
            return data
