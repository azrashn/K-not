import io
import wave

import pytest
from fastapi import FastAPI, Header, HTTPException
from fastapi.testclient import TestClient

from knot_rag.config import Settings
from knot_rag.api import create_app
from knot_rag.bootstrap import build_components
from knot_rag.tts.cache import AudioCache, wav_duration_ms
from knot_rag.tts.piper_voice import TtsUnavailable, voice_url
from knot_rag.tts.routes import install
from knot_rag.tts.settings import TtsSettings
from knot_rag.tts.speech import speakable

SECRET = "s" * 32


def wav(ms=500, rate=16000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\0\0" * int(rate * ms / 1000))
    return buf.getvalue()


class FakeVoice:
    def __init__(self):
        self.calls = []

    def synthesize(self, text, voice):
        self.calls.append((text, voice))
        data = wav()
        return data, wav_duration_ms(data)


class MissingVoice:
    def synthesize(self, text, voice):
        raise TtsUnavailable("Piper voice file missing: tr_TR-dfki-medium.onnx (TTS_AUTO_DOWNLOAD is off)")


def test_speakable_reads_symbols_as_words_and_drops_labels():
    assert speakable("y(0) = 1 [07:14]", "tr") == "y(0) eşittir 1"
    assert speakable("x^2 + 1 [2]", "en") == "x squared plus 1"
    assert speakable("n <= 3 ve/veya n-1", "tr") == "n küçük eşittir 3 ve/veya n-1"


def test_voice_url_layout():
    assert voice_url("https://h/base/", "tr_TR-dfki-medium") == "https://h/base/tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx"
    with pytest.raises(ValueError):
        voice_url("https://h", "bad")


def test_cache_synthesizes_once_and_keys_depend_on_the_secret(tmp_path):
    voice = FakeVoice()
    cache = AudioCache(tmp_path, SECRET)
    first = cache.get_or_create("merhaba", "tr_TR-dfki-medium", voice)
    again = cache.get_or_create("merhaba", "tr_TR-dfki-medium", voice)
    assert (first.cached, again.cached) == (False, True)
    assert first.key == again.key and first.duration_ms == 500
    assert len(voice.calls) == 1
    # another voice is another file; another secret gives another, uncomputable key
    assert cache.key_for("merhaba", "en_US-ryan-medium") != first.key
    assert AudioCache(tmp_path, "t" * 32).key_for("merhaba", "tr_TR-dfki-medium") != first.key
    assert not list(tmp_path.rglob("*.part"))


def test_cache_rejects_short_secret_and_bad_keys(tmp_path):
    with pytest.raises(ValueError):
        AudioCache(tmp_path, "short")
    cache = AudioCache(tmp_path, SECRET)
    assert cache.get("../../etc/passwd") is None
    assert cache.get("0" * 64) is None


def test_broken_cached_file_is_synthesized_again(tmp_path):
    voice = FakeVoice()
    cache = AudioCache(tmp_path, SECRET)
    audio = cache.get_or_create("bozuk", "v", voice)
    audio.path.write_bytes(b"not a wav")
    assert cache.get_or_create("bozuk", "v", voice).cached is False
    assert len(voice.calls) == 2


def client(tmp_path, synthesizer, secret=SECRET):
    def auth(authorization: str | None = Header(None)):
        if authorization != "Bearer token":
            raise HTTPException(401)

    app = FastAPI()
    install(app, auth, TtsSettings(cache_dir=tmp_path, voices_dir=tmp_path / "voices", key_secret=secret), synthesizer)
    return TestClient(app)


H = {"Authorization": "Bearer token"}


def test_speak_returns_a_key_and_the_same_text_comes_from_the_cache(tmp_path):
    voice = FakeVoice()
    c = client(tmp_path, voice)
    first = c.post("/api/v1/tts", headers=H, json={"text": "y(0) = 1", "lang": "tr"}).json()
    again = c.post("/api/v1/tts", headers=H, json={"text": "y(0) = 1", "lang": "tr"}).json()
    assert first["cached"] is False and again == {**first, "cached": True}
    assert voice.calls == [("y(0) eşittir 1", "tr_TR-dfki-medium")]
    audio = c.get(f"/api/v1/tts/audio/{first['key']}.wav", headers=H)
    assert audio.status_code == 200 and audio.headers["content-type"] == "audio/wav"
    assert audio.content[:4] == b"RIFF"
    c.post("/api/v1/tts", headers=H, json={"text": "y(0) = 1", "lang": "en"})
    assert voice.calls[-1][1] == "en_US-ryan-medium"


def test_speak_validation_auth_and_unavailable_voice(tmp_path):
    c = client(tmp_path, FakeVoice())
    assert c.post("/api/v1/tts", json={"text": "a"}).status_code == 401
    assert c.post("/api/v1/tts", headers=H, json={"text": "a", "lang": "de"}).status_code == 422
    assert c.post("/api/v1/tts", headers=H, json={"text": "a", "user_id": "x"}).status_code == 422
    assert c.post("/api/v1/tts", headers=H, json={"text": "[07:14]"}).status_code == 422
    assert c.post("/api/v1/tts", headers=H, json={"text": "a" * 4001}).status_code == 413
    assert c.get("/api/v1/tts/audio/" + "0" * 64 + ".wav", headers=H).status_code == 404
    assert c.get("/api/v1/tts/audio/nope.wav", headers=H).status_code == 404
    assert client(tmp_path, MissingVoice()).post("/api/v1/tts", headers=H, json={"text": "a"}).status_code == 503
    assert client(tmp_path, FakeVoice(), secret="").post("/api/v1/tts", headers=H, json={"text": "a"}).status_code == 503


def test_the_service_mounts_tts_behind_the_internal_token(monkeypatch):
    monkeypatch.delenv("TTS_KEY_SECRET", raising=False)
    app = create_app(build_components(Settings(internal_api_token="tts-test-token-0123", embedding_backend="hashing", chroma_mode="memory")))
    with TestClient(app) as c:
        assert c.post("/api/v1/tts", json={"text": "a"}).status_code == 401
        r = c.post("/api/v1/tts", headers={"Authorization": "Bearer tts-test-token-0123"}, json={"text": "a"})
        assert r.status_code == 503  # not configured: no secret, so no cache keys
        health = c.get("/api/v1/tts/health", headers={"Authorization": "Bearer tts-test-token-0123"}).json()
        assert health["configured"] is False and health["voices"]["tr"] == "tr_TR-dfki-medium"
