"""Text to speech for the board teacher: local Piper voices, a keyed disk cache, internal routes."""

from knot_rag.tts.cache import AudioCache, CachedAudio
from knot_rag.tts.settings import TtsSettings
from knot_rag.tts.speech import speakable

__all__ = ["AudioCache", "CachedAudio", "TtsSettings", "speakable"]
