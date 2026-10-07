import pytest

from knot_rag.config import Settings
from knot_rag.errors import ConfigurationError


def test_token_required_unless_explicitly_disabled():
    with pytest.raises(ConfigurationError):
        Settings.from_env({})
    assert Settings.from_env({"RAG_AUTH_DISABLED": "true"}).auth_disabled


def test_reads_values_and_hides_secrets_from_repr():
    s = Settings.from_env({"RAG_INTERNAL_API_TOKEN": "t0p", "LLM_API_KEY": "sk-secret", "RAG_TOP_K": "12", "RAG_MIN_SCORE": "0.3"})
    assert s.retrieval.top_k == 12 and s.retrieval.min_score == 0.3
    assert "sk-secret" not in repr(s) and "t0p" not in repr(s)


@pytest.mark.parametrize("env", [
    {"RAG_TOP_K": "abc"},
    {"RAG_TOP_K": "2", "RAG_MAX_EVIDENCE": "5"},
    {"CHROMA_MODE": "cloud"},
    {"SUPPORT_COVERAGE_PARTIAL": "0.9", "SUPPORT_COVERAGE_SUPPORTED": "0.5"},
    {"LLM_MAX_ATTEMPTS": "0"},
])
def test_invalid_configuration(env):
    with pytest.raises(ConfigurationError):
        Settings.from_env({"RAG_INTERNAL_API_TOKEN": "t", **env})
