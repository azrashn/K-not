"""The study-file size limit is configurable and shared in spirit with the backend (STUDY_FILE_MAX_BYTES)."""

import pytest

from knot_rag import unified


def test_the_default_limit_is_twenty_mib(monkeypatch):
    monkeypatch.delenv("KNOWLEDGE_EXTRACT_MAX_BYTES", raising=False)
    assert unified._extract_limit() == 20 * 1024 * 1024


@pytest.mark.parametrize("value,expected", [("5242880", 5242880), ("", 20 * 1024 * 1024), ("abc", 20 * 1024 * 1024),
                                            ("10", 20 * 1024 * 1024), ("999999999999", 20 * 1024 * 1024)])
def test_the_limit_comes_from_the_environment_within_a_safe_range(monkeypatch, value, expected):
    monkeypatch.setenv("KNOWLEDGE_EXTRACT_MAX_BYTES", value)
    assert unified._extract_limit() == expected


def test_a_text_file_above_the_limit_is_refused_and_below_it_is_read(monkeypatch):
    monkeypatch.setattr(unified, "EXTRACT_MAX_BYTES", 2000)
    with pytest.raises(ValueError):
        unified.extract_file("TXT", b"a" * 2001)
    assert unified.extract_file("TXT", ("kuyruk " * 100).encode())[0]["text"].startswith("kuyruk")
