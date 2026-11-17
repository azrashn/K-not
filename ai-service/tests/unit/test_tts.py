import wave
from pathlib import Path

import pytest

from knot_rag.tts import SpeechEngine, TtsConfig, TtsRejected, TtsUnavailable, clean_text, config_from_env


class FakeVoice:
    def __init__(self):
        self.calls = 0

    def synthesize_wav(self, text, wav):
        self.calls += 1
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(22050)
        wav.writeframes(b"\x00\x00" * 2205)  # 0.1 s of silence


def engine(tmp_path, voice=None, *, create_file=True, enabled=True):
    model = tmp_path / "tr_TR-test-medium.onnx"
    if create_file:
        model.write_bytes(b"onnx")
    fake = voice or FakeVoice()
    return SpeechEngine(TtsConfig(model, enabled), loader=lambda path: fake), fake


def test_clean_text_collapses_whitespace_and_rejects_empty_or_huge():
    assert clean_text("  Merhaba \n  dünya ") == "Merhaba dünya"
    with pytest.raises(TtsRejected):
        clean_text("   ")
    with pytest.raises(TtsRejected):
        clean_text("a" * 1201)


def test_config_defaults_to_the_models_folder_and_honours_overrides(tmp_path):
    default = config_from_env({})
    assert default.model_path.name == "tr_TR-dfki-medium.onnx"
    assert default.model_path.parent.name == "tts"
    custom = config_from_env({"TTS_VOICE_PATH": str(tmp_path / "x.onnx"), "TTS_ENABLED": "off"})
    assert custom.model_path == tmp_path / "x.onnx" and custom.enabled is False


def test_status_explains_why_the_voice_is_not_available(tmp_path):
    assert engine(tmp_path, create_file=False)[0].status()["reason"] == "VOICE_MISSING"
    assert engine(tmp_path, enabled=False)[0].status()["reason"] == "DISABLED"


def test_synthesize_returns_a_wav_and_caches_repeated_text(tmp_path):
    eng, fake = engine(tmp_path)
    if not eng.status()["available"]:
        pytest.skip("piper-tts is not installed here")
    first = eng.synthesize("Merhaba dünya.")
    with wave.open(__import__("io").BytesIO(first)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate()) == (1, 2, 22050)
    assert eng.synthesize("Merhaba   dünya.") == first
    assert fake.calls == 1


def test_missing_voice_raises_unavailable_not_a_crash(tmp_path):
    eng, _ = engine(tmp_path, create_file=False)
    with pytest.raises(TtsUnavailable):
        eng.synthesize("Merhaba")


def test_a_voice_that_fails_to_load_is_reported_as_unavailable(tmp_path):
    model = tmp_path / "bad.onnx"
    model.write_bytes(b"not an onnx file")

    def boom(path):
        raise RuntimeError("invalid model")

    eng = SpeechEngine(TtsConfig(model), loader=boom)
    if not eng.status()["available"]:
        pytest.skip("piper-tts is not installed here")
    with pytest.raises(TtsUnavailable):
        eng.synthesize("Merhaba")
