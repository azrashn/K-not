"""TTS settings from the environment (see .env.example, "Board teacher voice")."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_VOICE_BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main"


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() not in ("0", "false", "no", "off")


def _int(name: str, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(os.environ.get(name, default))))
    except ValueError:
        return default


@dataclass(frozen=True)
class TtsSettings:
    voices_dir: Path = field(default_factory=lambda: Path(os.environ.get("TTS_VOICES_DIR", "./piper-voices")))
    cache_dir: Path = field(default_factory=lambda: Path(os.environ.get("TTS_CACHE_DIR", "./tts-cache")))
    voice_tr: str = field(default_factory=lambda: os.environ.get("TTS_VOICE_TR", "tr_TR-dfki-medium"))
    voice_en: str = field(default_factory=lambda: os.environ.get("TTS_VOICE_EN", "en_US-ryan-medium"))
    voice_base_url: str = field(default_factory=lambda: os.environ.get("TTS_VOICE_BASE_URL", DEFAULT_VOICE_BASE_URL))
    auto_download: bool = field(default_factory=lambda: _bool("TTS_AUTO_DOWNLOAD", False))
    max_chars: int = field(default_factory=lambda: _int("TTS_MAX_CHARS", 4000, 1, 20000))
    # Keys the cache: without it a key cannot be computed from a text (unguessable audio URLs).
    key_secret: str = field(default_factory=lambda: os.environ.get("TTS_KEY_SECRET", ""))

    def voice_for(self, lang: str) -> str:
        return self.voice_en if lang == "en" else self.voice_tr

    @property
    def configured(self) -> bool:
        return len(self.key_secret) >= 16
