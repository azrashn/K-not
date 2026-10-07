from __future__ import annotations

import uuid

import pytest

from knot_rag.bootstrap import build_components
from knot_rag.config import LLMSettings, RetrievalSettings, Settings, SupportSettings
from knot_rag.retrieval.embedding import HashingEmbedder
from tests.fakes import InMemoryIndex, load_corpus

TOKEN = "test-internal-token"


@pytest.fixture(scope="session")
def corpus():
    return load_corpus()


@pytest.fixture(scope="session")
def embedder():
    return HashingEmbedder()


@pytest.fixture
def settings():
    return Settings(
        internal_api_token=TOKEN,
        chroma_mode="memory",
        embedding_backend="hashing",
        retrieval=RetrievalSettings(),
        support=SupportSettings(),
        llm=LLMSettings(provider="mock", max_attempts=2, timeout_seconds=2),
    )


@pytest.fixture
def memory_index(corpus, embedder):
    return InMemoryIndex(corpus, embedder)


@pytest.fixture
def make_components(settings, embedder, memory_index):
    def _make(provider=None, index=None, settings_override=None):
        return build_components(
            settings_override or settings, index=index or memory_index, embedder=embedder, provider=provider
        )

    return _make


@pytest.fixture
def chroma_client():
    import chromadb

    return chromadb.EphemeralClient()


@pytest.fixture
def collection_name():
    # EphemeralClient state is process-wide; isolate each test with a unique collection.
    return f"test_{uuid.uuid4().hex[:12]}"
