"""Piper synthesis: local, on the CPU. ``piper-tts`` is optional (requirements-tts.txt); without
it the TTS routes answer 503 and everything else keeps working.

A voice is two files: ``<name>.onnx`` (model, medium ~63 MB) and ``<name>.onnx.json``. They are
never in the repository: download them (README) or set TTS_AUTO_DOWNLOAD=true to fetch a
missing voice once from Hugging Face ``rhasspy/piper-voices``.
"""

from __future__ import annotations

import io
import logging
import threading
import wave
from pathlib import Path

from knot_rag.tts.cache import wav_duration_ms
from knot_rag.tts.settings import TtsSettings

log = logging.getLogger(__name__)


class TtsUnavailable(RuntimeError):
    """Piper is not installed or a voice file is missing."""


def piper_installed() -> bool:
    try:
        import piper  # noqa: F401
    except ImportError:
        return False
    return True


def voice_url(base_url: str, voice: str, suffix: str = ".onnx") -> str:
    """tr_TR-dfki-medium -> <base>/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx"""
    parts = voice.split("-")
    if len(parts) < 3 or "_" not in parts[0]:
        raise ValueError(f"Unexpected Piper voice name: {voice!r} (expected e.g. tr_TR-dfki-medium)")
    locale, name, quality = parts[0], "-".join(parts[1:-1]), parts[-1]
    return f"{base_url.rstrip('/')}/{locale.split('_')[0]}/{locale}/{name}/{quality}/{voice}{suffix}"


def voice_files_present(settings: TtsSettings, voice: str) -> bool:
    base = Path(settings.voices_dir) / f"{voice}.onnx"
    return base.is_file() and base.with_name(base.name + ".json").is_file()


class PiperSynthesizer:
    """Loads every voice once (thread-safe) and keeps it in memory."""

    def __init__(self, settings: TtsSettings) -> None:
        self.settings = settings
        self._voices: dict[str, object] = {}
        self._lock = threading.Lock()

    def _download(self, voice: str) -> Path:
        model = Path(self.settings.voices_dir) / f"{voice}.onnx"
        for path, suffix in ((model.with_name(model.name + ".json"), ".onnx.json"), (model, ".onnx")):
            if path.is_file():
                continue
            if not self.settings.auto_download:
                raise TtsUnavailable(f"Piper voice file missing: {path.name} (TTS_AUTO_DOWNLOAD is off)")
            import httpx

            path.parent.mkdir(parents=True, exist_ok=True)
            url = voice_url(self.settings.voice_base_url, voice, suffix)
            log.info("tts.voice_download", extra={"voice_file": path.name})
            tmp = path.with_name(path.name + ".part")
            with httpx.stream("GET", url, follow_redirects=True, timeout=120) as response:
                response.raise_for_status()
                with tmp.open("wb") as out:
                    for chunk in response.iter_bytes(1 << 20):
                        out.write(chunk)
            tmp.replace(path)
        return model

    def _voice(self, voice: str):
        with self._lock:
            if voice not in self._voices:
                try:
                    from piper import PiperVoice
                except ImportError as exc:
                    raise TtsUnavailable("piper-tts is not installed (pip install -r requirements-tts.txt)") from exc
                self._voices[voice] = PiperVoice.load(self._download(voice))
            return self._voices[voice]

    def synthesize(self, text: str, voice: str) -> tuple[bytes, int]:
        piper_voice = self._voice(voice)
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav:
            piper_voice.synthesize_wav(text, wav)  # type: ignore[attr-defined]
        data = buffer.getvalue()
        return data, wav_duration_ms(data)
