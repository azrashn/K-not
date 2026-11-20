import pytest

from knot_rag.config import RetrievalSettings
from knot_rag.errors import IndexNotReady, RetrievalUnavailable, ScopeViolation
from knot_rag.retrieval import RetrievalService
from knot_rag.schemas import AuthorizedScope, RetrievalParams
from tests.fakes import COURSE, SCOPE_DOCS, InMemoryIndex, scope


def svc(index, embedder, **kw):
    return RetrievalService(index, embedder, RetrievalSettings(**kw))


def test_returns_only_scoped_chunks(memory_index, embedder):
    res = svc(memory_index, embedder).retrieve("Kırmızı-siyah ağaçlarda yükseklik sınırı", AuthorizedScope(**scope()))
    assert res.hits
    for h in res.hits:
        assert h.chunk.document.course_id == COURSE
        assert h.chunk.document.document_id in SCOPE_DOCS
    assert not any(h.chunk.document.document_id == "doc-vy-notlar-mehmet" for h in res.hits)


def test_defence_in_depth_drops_records_a_buggy_index_leaks(corpus, embedder):
    leaky = InMemoryIndex(corpus, embedder, leak=True)
    res = svc(leaky, embedder, top_k=50).retrieve("LRU sayfa değiştirme", AuthorizedScope(**scope()))
    assert res.rejected_out_of_scope > 0
    assert all(h.chunk.document.document_id in SCOPE_DOCS for h in res.hits)


def test_index_not_ready_when_scope_has_no_indexed_documents(memory_index, embedder):
    with pytest.raises(IndexNotReady):
        svc(memory_index, embedder).retrieve("AVL?", AuthorizedScope(**scope(document_ids=["doc-henuz-islenmedi"])))


def test_document_from_another_course_is_a_scope_violation(memory_index, embedder):
    # A document id from another course combined with this course id must not match.
    with pytest.raises(ScopeViolation):
        svc(memory_index, embedder).retrieve("LRU", AuthorizedScope(**scope(document_ids=["doc-os-hafta5"])))


def test_empty_index(embedder):
    with pytest.raises(IndexNotReady):
        svc(InMemoryIndex([], embedder), embedder).retrieve("AVL?", AuthorizedScope(**scope()))


def test_index_unavailable_propagates(corpus, embedder):
    idx = InMemoryIndex(corpus, embedder, fail=RetrievalUnavailable())
    with pytest.raises(RetrievalUnavailable):
        svc(idx, embedder).retrieve("AVL?", AuthorizedScope(**scope()))


def test_top_k_and_min_score_parameters(memory_index, embedder):
    s = svc(memory_index, embedder, top_k=8)
    res = s.retrieve("AVL rotasyon", AuthorizedScope(**scope()), RetrievalParams(top_k=3))
    assert memory_index.searches[-1][1] == 3 and len(res.hits) == 3
    res = s.retrieve("AVL rotasyon", AuthorizedScope(**scope()), RetrievalParams(min_score=0.99))
    assert res.hits == [] and res.below_min_score > 0


def test_relevant_chunk_ranks_first(memory_index, embedder):
    res = svc(memory_index, embedder).retrieve("Zincirleme yönteminde anahtarlar nasıl tutulur?", AuthorizedScope(**scope()))
    assert res.hits[0].chunk.chunk_id == "doc-vy-hafta6:v1:003"
