import pytest

from tests.ingest.support import make_harness


@pytest.fixture
def harness(tmp_path, chroma_client, collection_name, settings, embedder):
    h = make_harness(tmp_path, chroma_client, collection_name, settings, embedder)
    yield h
    h.service.worker.shutdown(0)
