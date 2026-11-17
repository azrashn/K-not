"""Audio cache: the same text with the same voice is synthesized once, then served from disk.

The key is HMAC-SHA256(secret, voice + text): stable (the same text hits the cache) but not
computable without the secret, so an audio URL cannot be guessed from a known text. Two requests
for the same key wait for each other; a file is written under a temporary name and then moved,
so a half-written file is never served.
"""

from __future__ import annotations

import hashlib
import hmac
import io
import os
import re
import threading
import wave
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

KEY = re.compile(r"^[0-9a-f]{64}$")


class Synthesizer(Protocol):
    def synthesize(self, text: str, voice: str) -> tuple[bytes, int]:
        """WAV bytes and their length in ms."""
        ...


def wav_duration_ms(data: bytes) -> int:
    with wave.open(io.BytesIO(data), "rb") as wav:
        return round(wav.getnframes() * 1000 / wav.getframerate())


@dataclass(frozen=True)
class CachedAudio:
    key: str
    path: Path
    duration_ms: int
    cached: bool = True


class AudioCache:
    def __init__(self, cache_dir: Path | str, secret: str) -> None:
        if len(secret) < 16:
            raise ValueError("TTS cache secret must be at least 16 characters")
        self.dir = Path(cache_dir)
        self._secret = secret.encode("utf-8")
        self._locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)
        self._guard = threading.Lock()

    def key_for(self, text: str, voice: str) -> str:
        return hmac.new(self._secret, f"{voice}\n{text}".encode("utf-8"), hashlib.sha256).hexdigest()

    def path_for(self, key: str) -> Path:
        if not KEY.match(key):
            raise ValueError("invalid audio key")
        # First two characters as a sub folder: no single folder with tens of thousands of files.
        return self.dir / key[:2] / f"{key}.wav"

    def _lock_for(self, key: str) -> threading.Lock:
        with self._guard:
            return self._locks[key]

    def get(self, key: str) -> CachedAudio | None:
        if not KEY.match(key):
            return None
        path = self.path_for(key)
        if not path.is_file():
            return None
        try:
            return CachedAudio(key, path, wav_duration_ms(path.read_bytes()))
        except Exception:  # broken file: synthesize again
            path.unlink(missing_ok=True)
            return None

    def get_or_create(self, text: str, voice: str, synthesizer: Synthesizer) -> CachedAudio:
        key = self.key_for(text, voice)
        hit = self.get(key)
        if hit:
            return hit
        with self._lock_for(key):
            hit = self.get(key)
            if hit:
                return hit
            data, duration_ms = synthesizer.synthesize(text, voice)
            path = self.path_for(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.part")
            tmp.write_bytes(data)
            tmp.replace(path)
            return CachedAudio(key, path, duration_ms, cached=False)
