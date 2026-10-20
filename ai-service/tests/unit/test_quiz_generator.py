import pytest
from fastapi.testclient import TestClient

from knot_rag.api import create_app
from knot_rag.errors import IndexNotReady, ScopeViolation
from knot_rag.quiz.generator import norm, split_sentences
from knot_rag.schemas.quiz import QuizRequest
from tests.conftest import TOKEN
from tests.fakes import COURSE, SCOPE_DOCS, USER, scope

AUTH = {"Authorization": f"Bearer {TOKEN}"}


def params(count=10, types=("multiple_choice", "true_false"), difficulty="medium"):
    return {"count": count, "question_types": list(types), "difficulty": difficulty}


def req(docs=None, request_id="r-1", **kw):
    return QuizRequest.model_validate({"request_id": request_id, "scope": scope(docs), "params": params(**kw)})


@pytest.fixture
def gen(make_components):
    return make_components().quiz


def chunk_texts(corpus):
    return {c.chunk_id: c.text for c in corpus}


def test_split_sentences_offsets():
    text = "Birinci cümle burada biter. İkinci cümle\nüçüncü satır."
    for off, s in split_sentences(text):
        assert text[off:off + len(s)] == s


def test_every_question_is_grounded_in_its_chunk(gen, corpus):
    res = gen.generate(req(count=15), "r-1")
    assert res.produced == len(res.questions) > 0
    assert res.generator == "extractive-v1" and res.llm_used is False
    texts = chunk_texts(corpus)
    in_scope = {c.chunk_id for c in corpus if c.document.document_id in SCOPE_DOCS and c.document.course_id == COURSE}
    for q in res.questions:
        assert q.source.chunk_id in in_scope
        assert q.source.quote in texts[q.source.chunk_id]
        assert q.explanation and q.topic


def test_options_and_correct_index_are_valid(gen):
    res = gen.generate(req(count=15), "r-1")
    kinds = {q.type.value for q in res.questions}
    assert kinds == {"multiple_choice", "true_false"}
    for q in res.questions:
        assert 0 <= q.correct_index < len(q.options)
        assert len({norm(o) for o in q.options}) == len(q.options)
        if q.type.value == "true_false":
            assert q.options == ["Doğru", "Yanlış"]
        else:
            assert len(q.options) == 4 and "_____" in q.prompt
            assert q.options[q.correct_index] in q.explanation
            assert q.options[q.correct_index] in q.source.quote
            assert q.prompt.startswith("Aşağıdaki boşluğa hangisi gelmelidir?")


def test_no_duplicate_prompts_or_quotes(gen):
    res = gen.generate(req(count=15), "r-1")
    assert len({norm(q.prompt) for q in res.questions}) == len(res.questions)
    assert len({norm(q.source.quote) for q in res.questions}) == len(res.questions)


def test_false_statements_do_not_occur_in_materials(gen, corpus):
    res = gen.generate(req(count=15, types=("true_false",)), "r-1")
    corpus_norm = [norm(c.text) for c in corpus]
    falses = [q for q in res.questions if q.correct_index == 1]
    trues = [q for q in res.questions if q.correct_index == 0]
    assert falses and trues
    for q in falses:
        statement = q.prompt.split("\n\n", 1)[1]
        assert not any(norm(statement) in c for c in corpus_norm)
        assert statement != q.source.quote
    for q in trues:
        assert q.prompt.split("\n\n", 1)[1] == q.source.quote


def test_scope_is_enforced(gen, corpus):
    only = ["doc-vy-hafta6"]
    res = gen.generate(req(docs=only, count=15), "r-1")
    assert res.questions and {q.source.document_id for q in res.questions} == set(only)


def test_leaking_index_is_counted_out_of_scope(make_components, corpus, embedder):
    from tests.fakes import InMemoryIndex
    comps = make_components(index=InMemoryIndex(corpus, embedder, leak=True))
    res = comps.quiz.generate(req(docs=["doc-vy-hafta6"], count=15), "r-1")
    assert res.rejected.out_of_scope > 0
    assert {q.source.document_id for q in res.questions} == {"doc-vy-hafta6"}


def test_no_indexed_content_raises(gen):
    with pytest.raises(IndexNotReady):
        gen.generate(req(docs=["doc-missing"]), "r-1")


def test_documents_of_another_course_are_a_scope_violation(gen):
    r = QuizRequest.model_validate({"scope": scope(["doc-vy-hafta6"], course_id="baska-ders"), "params": params()})
    with pytest.raises(ScopeViolation):
        gen.generate(r, "r-1")


def test_shortfall_warns_in_turkish(gen):
    res = gen.generate(req(docs=["doc-vy-hafta6"], count=15), "r-1")
    assert res.produced < 15
    assert res.warnings and "yalnızca" in res.warnings[0]


def test_deterministic_for_same_request_id(gen):
    a = gen.generate(req(request_id="same"), "same").model_dump()
    b = gen.generate(req(request_id="same"), "same").model_dump()
    assert a == b
    c = gen.generate(req(request_id="other"), "other").model_dump()
    assert [q["prompt"] for q in c["questions"]] != [q["prompt"] for q in a["questions"]]


def test_difficulty_changes_selection(gen):
    easy = gen.generate(req(count=5, difficulty="easy", types=("multiple_choice",)), "r-1")
    hard = gen.generate(req(count=5, difficulty="hard", types=("multiple_choice",)), "r-1")
    mean = lambda r: sum(len(q.source.quote) for q in r.questions) / len(r.questions)
    assert mean(easy) < mean(hard)
    assert {q.difficulty.value for q in easy.questions} == {"easy"}


# ── endpoint ─────────────────────────────────────────────────────────────────
@pytest.fixture
def client(make_components):
    return TestClient(create_app(make_components()), raise_server_exceptions=False)


def body(**kw):
    return {"scope": scope(), "params": params(**kw)}


def test_endpoint_requires_internal_auth(client):
    assert client.post("/api/v1/quiz/generate", json=body()).status_code == 401


def test_endpoint_returns_contract(client):
    r = client.post("/api/v1/quiz/generate", json=body(count=5), headers=AUTH)
    assert r.status_code == 200
    d = r.json()
    assert set(d) >= {"schema_version", "request_id", "generator", "llm_used", "requested", "produced", "warnings", "rejected", "questions"}
    assert set(d["rejected"]) == {"unsupported", "duplicate", "ambiguous", "out_of_scope"}
    q = d["questions"][0]
    assert set(q) == {"type", "prompt", "options", "correct_index", "explanation", "topic", "difficulty", "source"}
    assert {"chunk_id", "document_id", "page_start", "page_end", "quote"} <= set(q["source"])


@pytest.mark.parametrize("bad", [
    {"count": 0}, {"count": 16}, {"types": ()}, {"difficulty": "extreme"},
])
def test_endpoint_validates_params(client, bad):
    kw = {"count": 5}
    if "types" in bad:
        p = params(count=5, types=())
    else:
        p = params(**{**kw, **bad})
    r = client.post("/api/v1/quiz/generate", json={"scope": scope(), "params": p}, headers=AUTH)
    assert r.status_code == 422


def test_endpoint_unindexed_scope_is_409(client):
    r = client.post("/api/v1/quiz/generate", json={"scope": scope(["doc-missing"]), "params": params()}, headers=AUTH)
    assert r.status_code == 409 and r.json()["error"]["code"] == "INDEX_NOT_READY"


def test_chroma_list_chunks_matches_memory(chroma_client, collection_name, corpus, embedder):
    from knot_rag.retrieval.chroma_index import ChromaChunkIndex, ChromaChunkWriter
    from knot_rag.retrieval.index import SearchScope
    ChromaChunkWriter(chroma_client, collection_name, embedder).upsert(corpus)
    idx = ChromaChunkIndex(chroma_client, collection_name, embedder)
    sc = SearchScope(COURSE, ("doc-vy-hafta6",))
    got = idx.list_chunks(sc, 100)
    assert got and all(sc.contains(c) for c in got)
    assert {c.chunk_id for c in got} == {c.chunk_id for c in corpus if sc.contains(c)}
    assert len(idx.list_chunks(sc, 1)) == 1
