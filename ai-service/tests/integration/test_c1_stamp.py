"""C-1 (ADR-006): full collection stamp, reader verification, legacy compatibility, /ready."""

import json
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from knot_rag.api.app import create_app
from knot_rag.bootstrap import build_components
from knot_rag.errors import ConfigurationError
from knot_rag.retrieval import HashingEmbedder, SearchScope
from knot_rag.retrieval.chroma_index import ChromaChunkIndex, ChromaChunkWriter
from knot_rag.schemas.embedding import EmbeddingConfiguration
from tests.conftest import TOKEN
from tests.fakes import COURSE, SCOPE_DOCS

pytestmark = pytest.mark.integration

DOCUMENTED = EmbeddingConfiguration(
    backend="sentence_transformers",
    model="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    revision=None,
    dimension=384,
)
DOCUMENTED_FP = "sha256:f3ae3de1c6d6c43153e3327422e854970be26ed1328438b7e5bdaedff113f44d"
SCOPE = SearchScope(COURSE, tuple(SCOPE_DOCS))


def hashing_config(**changes) -> EmbeddingConfiguration:
    base = EmbeddingConfiguration(backend="hashing", model="knot-hashing-v1", dimension=512)
    return base.model_copy(update=changes)


def test_fingerprint_equals_documented_example():
    assert DOCUMENTED.fingerprint() == DOCUMENTED_FP


def test_fingerprint_is_stable_across_processes():
    code = (
        "from knot_rag.schemas.embedding import EmbeddingConfiguration as E;"
        "print(E(backend='sentence_transformers',model='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',"
        "dimension=384).fingerprint())"
    )
    src = str(Path(__file__).resolve().parents[2] / "src")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True,
                         env={"PYTHONPATH": src, "PYTHONHASHSEED": "random"})
    assert out.stdout.strip() == DOCUMENTED_FP


def test_documented_contract_example_parses_and_fingerprints():
    doc = Path(__file__).resolve().parents[3] / "docs/architecture/document-contract.md"
    text = doc.read_text(encoding="utf-8")
    block = text.split("<!-- contract: EmbeddingConfiguration -->", 1)[1].split("```json", 1)[1].split("```", 1)[0]
    assert EmbeddingConfiguration.model_validate(json.loads(block)).fingerprint() == DOCUMENTED_FP


@pytest.mark.parametrize(
    "change",
    [{"revision": "abc123"}, {"query_prefix": "query: "}, {"document_prefix": "passage: "}, {"normalize": False},
     {"backend": "sentence_transformers"}, {"model": "other"}],
)
def test_every_field_changes_the_fingerprint(change):
    assert hashing_config(**change).fingerprint() != hashing_config().fingerprint()


def test_stamp_round_trip(chroma_client, collection_name, corpus, embedder):
    cfg = hashing_config()
    ChromaChunkWriter(chroma_client, collection_name, embedder, configuration=cfg, index_version_id="iv-1").upsert(corpus)
    meta = chroma_client.get_collection(collection_name).metadata
    assert meta == {**cfg.collection_stamp(embedder.model_id, "iv-1")}
    assert meta["embedding_revision"] == "" and meta["embedding_normalize"] is True
    assert meta["embedding_model"] == embedder.model_id and meta["embedding_dim"] == 512
    info = ChromaChunkIndex(chroma_client, collection_name, embedder, configuration=cfg).info()
    assert info.embedding_fingerprint == cfg.fingerprint() and info.index_version_id == "iv-1"
    assert info.chunk_count == len(corpus)


@pytest.mark.parametrize(
    "drift", [{"revision": "abc123"}, {"query_prefix": "query: "}, {"document_prefix": "passage: "}, {"normalize": False}]
)
def test_reader_rejects_configuration_drift(chroma_client, collection_name, corpus, embedder, drift):
    ChromaChunkWriter(chroma_client, collection_name, embedder, configuration=hashing_config()).upsert(corpus[:2])
    reader = ChromaChunkIndex(chroma_client, collection_name, embedder, configuration=hashing_config(**drift))
    with pytest.raises(ConfigurationError) as err:
        reader.info()
    assert err.value.details["mismatched_keys"]  # names the drifting stamp keys
    with pytest.raises(ConfigurationError):
        reader.search(embedder.embed_query("AVL"), SCOPE, 3)


@pytest.mark.parametrize("drift", [{"revision": "abc123"}, {"document_prefix": "passage: "}])
def test_writer_refuses_a_collection_with_another_stamp(chroma_client, collection_name, corpus, embedder, drift):
    ChromaChunkWriter(chroma_client, collection_name, embedder, configuration=hashing_config()).upsert(corpus[:2])
    other = ChromaChunkWriter(chroma_client, collection_name, embedder, configuration=hashing_config(**drift))
    with pytest.raises(ConfigurationError):
        other.upsert(corpus[2:3])
    assert chroma_client.get_collection(collection_name).count() == 2  # nothing written


def test_writer_refuses_dimension_that_differs_from_the_model(chroma_client, collection_name, corpus):
    writer = ChromaChunkWriter(chroma_client, collection_name, HashingEmbedder(256), configuration=hashing_config())
    with pytest.raises(ConfigurationError):
        writer.upsert(corpus[:1])


def test_configured_writer_refuses_a_legacy_collection(chroma_client, collection_name, corpus, embedder):
    ChromaChunkWriter(chroma_client, collection_name, embedder).upsert(corpus[:1])  # pre-C-1 stamp
    with pytest.raises(ConfigurationError):
        ChromaChunkWriter(chroma_client, collection_name, embedder, configuration=hashing_config()).upsert(corpus[1:2])


def test_legacy_collection_is_still_readable(chroma_client, collection_name, corpus, embedder, caplog):
    ChromaChunkWriter(chroma_client, collection_name, embedder).upsert(corpus)
    assert "embedding_fingerprint" not in chroma_client.get_collection(collection_name).metadata
    reader = ChromaChunkIndex(chroma_client, collection_name, embedder, configuration=hashing_config(revision="x"))
    with caplog.at_level("WARNING"):
        info = reader.info()
    assert info.chunk_count == len(corpus) and info.embedding_fingerprint is None
    assert any(r.getMessage() == "rag.index.legacy_stamp" for r in caplog.records)
    assert reader.search(embedder.embed_query("AVL denge"), SCOPE, 3)
    # The legacy model/dimension check still applies.
    with pytest.raises(ConfigurationError):
        ChromaChunkIndex(chroma_client, collection_name, HashingEmbedder(256)).info()


def test_upsert_with_precomputed_embeddings_does_not_embed(chroma_client, collection_name, corpus, embedder):
    class NoEmbed(HashingEmbedder):
        def embed_documents(self, texts):
            raise AssertionError("must not embed")

    vectors = embedder.embed_documents([c.text for c in corpus[:3]])
    w = ChromaChunkWriter(chroma_client, collection_name, NoEmbed(), configuration=hashing_config())
    assert w.upsert(corpus[:3], embeddings=vectors) == 3
    with pytest.raises(ValueError):
        w.upsert(corpus[:3], embeddings=vectors[:1])
    with pytest.raises(ConfigurationError):
        w.upsert(corpus[:1], embeddings=[[0.1] * 7])


def test_count_and_delete_helpers_respect_job_tags(chroma_client, collection_name, corpus, embedder):
    doc = corpus[0].document.document_id
    own = [c.model_copy(update={"extra": {"job_id": "job-a"}}) for c in corpus if c.document.document_id == doc]
    w = ChromaChunkWriter(chroma_client, collection_name, embedder, configuration=hashing_config())
    w.upsert(own)
    foreign = own[0].model_copy(update={"chunk_id": f"{doc}:v1:999", "extra": {"job_id": "job-b"}})
    w.upsert([foreign])
    assert w.count(doc) == len(own) + 1
    assert w.count(doc, exclude_job_id="job-a") == 1
    assert w.delete_document(doc, exclude_job_id="job-a") == 1
    assert w.count(doc) == len(own) and w.count(doc, exclude_job_id="job-a") == 0
    assert w.delete_document(doc) == len(own) and w.count(doc) == 0
    assert w.delete_document(doc) == 0  # idempotent
    assert ChromaChunkWriter(chroma_client, "never_created_c1", embedder).delete_document(doc) == 0


def _client(settings, chroma_client, embedder):
    comps = build_components(settings, embedder=embedder, chroma_client=chroma_client)
    return TestClient(create_app(comps)), comps


def test_bootstrap_reader_verifies_the_full_stamp(settings, chroma_client, collection_name, corpus, embedder):
    s = replace(settings, chroma_collection=collection_name)
    cfg = EmbeddingConfiguration.from_settings(s, embedder.dimension)
    ChromaChunkWriter(chroma_client, collection_name, embedder, configuration=cfg, index_version_id="iv-9").upsert(corpus)
    c, _ = _client(s, chroma_client, embedder)
    r = c.get("/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["index"] == {"collection": collection_name, "embedding_fingerprint": cfg.fingerprint(),
                             "index_version_id": "iv-9", "stamp": "full"}
    assert body["checks"]["embedding_model"] == embedder.model_id  # existing field unchanged

    drifted = replace(s, embedding_revision="pinned-other")
    c2, _ = _client(drifted, chroma_client, embedder)
    r2 = c2.get("/ready")
    assert r2.status_code == 503 and r2.json()["checks"]["index"] == "INTERNAL_ERROR"
    hdr = {"Authorization": f"Bearer {TOKEN}"}
    q = {"question": "AVL ağacı nedir?", "scope": {"user_id": "u", "course_id": COURSE, "document_ids": SCOPE_DOCS}}
    assert c2.post("/api/v1/rag/retrieve", json=q, headers=hdr).status_code == 500


def test_ready_reports_legacy_stamp(settings, chroma_client, collection_name, corpus, embedder):
    s = replace(settings, chroma_collection=collection_name)
    ChromaChunkWriter(chroma_client, collection_name, embedder).upsert(corpus)
    c, comps = _client(s, chroma_client, embedder)
    body = c.get("/ready").json()
    assert body["index"]["stamp"] == "legacy" and body["index"]["index_version_id"] is None
    assert body["index"]["embedding_fingerprint"] == comps.embedding_configuration().fingerprint()
