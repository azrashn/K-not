import pytest

from knot_ingest.config import IngestSettings
from knot_rag.errors import ConfigurationError


def test_disabled_by_default_and_needs_nothing():
    s = IngestSettings.from_env({})
    assert s.enabled is False and s.supported_indexing_versions == ("c1",) and s.max_pages == 400


def test_enabled_requires_storage_url_and_token(tmp_path):
    base = {"INGEST_ENABLED": "true", "STORAGE_ROOT": str(tmp_path), "NESTJS_INTERNAL_URL": "http://nest:3000",
            "INGEST_CALLBACK_TOKEN": "secret"}
    s = IngestSettings.from_env(base)
    assert s.enabled and "secret" not in repr(s)
    for missing in ("STORAGE_ROOT", "NESTJS_INTERNAL_URL", "INGEST_CALLBACK_TOKEN"):
        with pytest.raises(ConfigurationError):
            IngestSettings.from_env({k: v for k, v in base.items() if k != missing})
    with pytest.raises(ConfigurationError):
        IngestSettings.from_env({**base, "STORAGE_ROOT": str(tmp_path / "absent")})
    with pytest.raises(ConfigurationError):
        IngestSettings.from_env({**base, "INGEST_SUPPORTED_INDEXING_VERSIONS": "c1,c2"})
    with pytest.raises(ConfigurationError):
        IngestSettings.from_env({**base, "INGEST_MAX_PAGES": "many"})
