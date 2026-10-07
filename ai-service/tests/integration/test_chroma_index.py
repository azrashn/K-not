import pytest

from knot_rag.errors import ConfigurationError, IndexNotReady, RetrievalUnavailable
from knot_rag.retrieval import HashingEmbedder, SearchScope
from knot_rag.retrieval.chroma_index import ChromaChunkIndex, ChromaChunkWriter
from tests.fakes import COURSE, SCOPE_DOCS

pytestmark = pytest.mark.integration


@pytest.fixture
def seeded(chroma_client, collection_name, corpus, embedder):
    ChromaChunkWriter(chroma_client, collection_name, embedder).upsert(corpus)
    return ChromaChunkIndex(chroma_client, collection_name, embedder)


SCOPE = SearchScope(COURSE, tuple(SCOPE_DOCS))


def test_collection_is_stamped_and_compatible(seeded, embedder, corpus):
    info = seeded.info()
    assert info.embedding_model == embedder.model_id and info.embedding_dim == embedder.dimension
    assert info.chunk_count == len(corpus)


def test_scoped_search_never_crosses_course_or_user(seeded, embedder):
    # Questions aimed squarely at out-of-scope content.
    for q in ["LRU sayfa değiştirme algoritması", "Mehmet'in özel notu kırmızı-siyah yükseklik 2·log(n+1)", "SİSTEM TALİMATI E99"]:
        hits = seeded.search(embedder.embed_query(q), SCOPE, 25)
        assert hits, q
        for h in hits:
            assert h.chunk.document.course_id == COURSE
            assert h.chunk.document.document_id in SCOPE_DOCS


def test_scores_are_similarities_and_metadata_round_trips(seeded, embedder):
    hits = seeded.search(embedder.embed_query("Zincirleme aynı indekse düşen anahtarlar bağlı liste"), SCOPE, 5)
    assert hits[0].chunk.chunk_id == "doc-vy-hafta6:v1:003"
    assert hits[0].chunk.location.page_start == 12
    assert [h.rank for h in hits] == list(range(1, len(hits) + 1))
    assert all(-1.0 <= h.score <= 1.0 for h in hits)
    assert hits[0].score >= hits[-1].score


def test_multi_page_and_missing_page_metadata(seeded):
    multi, exam = seeded.get_chunks(["doc-vy-notlar:v1:003", "doc-vy-sinav-2024:v1:001"], SCOPE)
    assert (multi.location.page_start, multi.location.page_end) == (2, 3)
    assert multi.location.char_start is not None
    assert exam.location.page_start is None


def test_get_chunks_enforces_scope(seeded):
    assert seeded.get_chunks(["doc-os-hafta5:v1:001", "doc-vy-notlar-mehmet:v1:001"], SCOPE) == []


def test_count_in_scope(seeded):
    assert seeded.count_in_scope(SCOPE) == 1
    assert seeded.count_in_scope(SearchScope(COURSE, ("doc-yok",))) == 0
    assert seeded.count_in_scope(SearchScope("baska-ders", tuple(SCOPE_DOCS))) == 0


def test_documents_indexed_elsewhere(seeded):
    assert seeded.documents_indexed_elsewhere(SearchScope(COURSE, ("doc-os-hafta5",)))
    assert not seeded.documents_indexed_elsewhere(SCOPE)
    assert not seeded.documents_indexed_elsewhere(SearchScope(COURSE, ("doc-yok",)))


def test_missing_collection_is_index_not_ready(chroma_client, embedder):
    with pytest.raises(IndexNotReady):
        ChromaChunkIndex(chroma_client, "never_created", embedder).info()


def test_empty_collection(chroma_client, collection_name, embedder):
    ChromaChunkWriter(chroma_client, collection_name, embedder).ensure_collection()
    idx = ChromaChunkIndex(chroma_client, collection_name, embedder)
    assert idx.info().chunk_count == 0
    assert idx.count_in_scope(SCOPE) == 0


def test_refuses_index_built_with_another_embedding_model(chroma_client, collection_name, corpus):
    ChromaChunkWriter(chroma_client, collection_name, HashingEmbedder(dimension=256)).upsert(corpus[:3])
    with pytest.raises(ConfigurationError):
        ChromaChunkIndex(chroma_client, collection_name, HashingEmbedder(dimension=512)).info()
    with pytest.raises(ConfigurationError):
        ChromaChunkWriter(chroma_client, collection_name, HashingEmbedder(dimension=512)).upsert(corpus[:1])


def test_unreachable_chroma_server_is_retrieval_unavailable(embedder):
    from knot_rag.retrieval.chroma_index import build_chroma_client

    idx = ChromaChunkIndex(lambda: build_chroma_client("http", "127.0.0.1", 1, ""), "x", embedder)
    for call in (idx.info, lambda: idx.count_in_scope(SCOPE)):
        with pytest.raises(RetrievalUnavailable):
            call()


def test_delete_document_removes_its_chunks(chroma_client, collection_name, corpus, embedder):
    w = ChromaChunkWriter(chroma_client, collection_name, embedder)
    w.upsert(corpus)
    w.delete_document("doc-vy-hafta6")
    idx = ChromaChunkIndex(chroma_client, collection_name, embedder)
    assert idx.count_in_scope(SearchScope(COURSE, ("doc-vy-hafta6",))) == 0


def test_recovers_after_collection_is_recreated(chroma_client, collection_name, corpus, embedder):
    w = ChromaChunkWriter(chroma_client, collection_name, embedder)
    w.upsert(corpus)
    idx = ChromaChunkIndex(chroma_client, collection_name, embedder)
    assert idx.count_in_scope(SCOPE) == 1
    chroma_client.delete_collection(collection_name)
    w.upsert(corpus)  # WBS-2 rebuilds the index
    try:
        idx.count_in_scope(SCOPE)
    except RetrievalUnavailable:
        pass  # first call after the swap may fail on the stale handle …
    assert idx.count_in_scope(SCOPE) == 1  # … but the adapter recovers without a restart
