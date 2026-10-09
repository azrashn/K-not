"""Answer-quality regressions (feature/rag-answer-quality). The corpus is SYNTHETIC: slide text
written for these tests in the layout PDF extraction produces (title line, page number, list
items, wrapped sentences). It reproduces the reported failures without any user document:

  * "Git status nedir ne işe yarar?" answered with a generic "Git is a distributed …" slide;
  * "Merhaba" answered with a PDF sentence containing "Merhaba", rated SIKI;
  * slide titles / page numbers glued into claims.

The dense ranking of the fake index is FORCED to bury the "git status" chunk, as e5-small did
(rank 10–16 of 45), so the lexical channel is what brings it back.
"""

import json

import pytest

from knot_rag.bootstrap import build_components
from knot_rag.config import LLMSettings, RetrievalSettings, Settings, SupportSettings
from knot_rag.generation.providers import ExtractiveBaselineProvider, ScriptedProvider
from knot_rag.query.intent import Intent, classify
from knot_rag.retrieval.embedding import HashingEmbedder
from knot_rag.retrieval.index import ChunkHit
from knot_rag.schemas import AnswerRequest, IndexedChunk
from knot_rag.text import segments
from tests.fakes import InMemoryIndex

COURSE, OTHER = "web", "other-course"


def chunk(doc, n, text, page, course=COURSE, title="Git Slaytları", dtype="slide"):
    return IndexedChunk.model_validate({
        "chunk_id": f"{doc}:c1:{n:03d}", "text": text,
        "document": {"document_id": doc, "course_id": course, "title": title, "document_type": dtype, "indexing_version": "c1"},
        "location": {"page_start": page, "page_end": page, "char_start": 0, "char_end": len(text)},
    })


SLIDES = [
    chunk("git", 1, "Web Programming with Python and Git\n• Course Instructor\nAnkara University\n1", 1),
    chunk("git", 2, "Git and GitHub\n11\nGit, is a distributed version control system, or DVCS,meaning users anywhere in\n"
                    "the world can have a copy of your project on their computer.", 11),
    chunk("git", 3, "Categories of Version Control Systems\n15\nDistributed: the distributed model - each user has the entire\n"
                    "repository on their computer. It means you can work offline.", 15),
    chunk("git", 4, "Create a GitHub Account\n23", 23),
    chunk("git", 5, "Create a Repository\n26\nKey Terms/Commands\n1.Repo: the shorthand version of the term,\nrepository\n"
                    "2.git init : create brand new repos\n3.git clone: clone or copy an existing repo\n"
                    "4.git status: check the status of a repo", 26),
    chunk("git", 6, "Defining Version Control\n21\nCommit: Git thinks of its data like a set of snapshots of a mini filesystem.", 21),
    chunk("hello", 1, "Merhaba, bu bir test pdf’idir.", 1, title="test", dtype="notes"),
    # Another course: must never be retrieved or cited for a "web" scope.
    chunk("secret", 1, "git status shows staged and unstaged changes in the working tree.", 3, course=OTHER, title="Other course"),
]
SCOPE = {"user_id": "u", "course_id": COURSE, "document_ids": ["git", "hello"]}


class BuriedStatusIndex(InMemoryIndex):
    """Dense search that never ranks the "git status" chunk in the top k (as e5-small did)."""

    def search(self, query_embedding, scope, k):
        hits = [h for h in super().search(query_embedding, scope, len(SLIDES)) if "git status" not in h.chunk.text]
        return [ChunkHit(chunk=h.chunk, score=h.score, rank=i) for i, h in enumerate(hits[:k], start=1)]


def components(provider=None, lexical=True):
    s = Settings(internal_api_token="t", chroma_mode="memory", embedding_backend="hashing",
                 retrieval=RetrievalSettings(top_k=4, max_evidence=4, lexical_channel=lexical),
                 support=SupportSettings(), llm=LLMSettings(provider="extractive"))
    emb = HashingEmbedder()
    return build_components(s, index=BuriedStatusIndex(SLIDES, emb), embedder=emb, provider=provider or ExtractiveBaselineProvider())


def ask(question, **kw):
    return components(**kw).rag.answer(AnswerRequest(question=question, scope=SCOPE), "r")


# ── Case 1: git status ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("q", ["Git status nedir ne işe yarar?", "What does git status do?", "git status komutu ne yapar?"])
def test_git_status_is_answered_from_the_status_line_only(q):
    a = ask(q)
    assert a.outcome.value == "ANSWERED" and a.support_label == "SIKI"
    (c,) = a.claims
    assert c.claim_text == "git status: check the status of a repo"
    (cit,) = c.citations
    assert cit.chunk_id == "git:c1:005" and cit.label == "Slayt · s.26" and cit.quote_verified
    text = SLIDES[4].text
    assert text[cit.highlight.chunk_char_start:cit.highlight.chunk_char_end] == "git status: check the status of a repo"


def test_without_the_lexical_channel_the_status_chunk_is_not_retrieved():
    # Reproduces the reported retrieval failure; the channel is what fixes it.
    a = ask("Git status nedir ne işe yarar?", lexical=False)
    assert "git:c1:005" not in [e.chunk_id for e in a.evidence]
    assert not any(c.support_label == "SIKI" for c in a.claims)


def test_retrieval_never_crosses_the_course_even_through_the_lexical_channel():
    a = ask("What does git status do?")
    assert all(e.course_id == COURSE for e in a.evidence)
    assert a.retrieval.rejected_out_of_scope == 0


def test_generic_git_statement_is_never_siki_for_a_git_status_question():
    # An LLM-style answer that cites the generic slide must not be rated SIKI.
    def respond(r):
        eid = next(b.split('"')[0] for b in r.user.split('<evidence id="')[1:] if "distributed" in b)
        s = "Git, is a distributed version control system, or DVCS,meaning users anywhere in"
        return json.dumps({"status": "answered", "claims": [{"text": s, "evidence_ids": [eid], "quote": s}], "missing": []})

    a = ask("Git status nedir ne işe yarar?", provider=ScriptedProvider([respond]))
    (c,) = a.claims
    assert c.support_label != "SIKI" and "genel terimlerini" in c.support_explanation
    assert a.outcome.value != "ANSWERED"


# ── Case 2: greetings ─────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("q,intent", [("Merhaba", Intent.GREETING), ("selam hocam!", Intent.GREETING), ("Teşekkürler", Intent.THANKS),
                                      ("thank you so much", Intent.THANKS), ("How are you", Intent.GREETING), ("ok", Intent.ACKNOWLEDGEMENT)])
def test_greetings_are_not_questions(q, intent):
    assert classify(q) == intent


@pytest.mark.parametrize("q", ["Merhaba, git status nedir?", "Git status nedir?", "AVL", "so", "Merhaba arkadaşlar git clone ne yapar"])
def test_any_other_word_keeps_it_an_academic_question(q):
    assert classify(q) == Intent.ACADEMIC


def test_greeting_gets_a_reply_without_retrieval_or_claims():
    comps = components()
    a = comps.rag.answer(AnswerRequest(question="Merhaba", scope=SCOPE), "r")
    assert a.outcome.value == "INSUFFICIENT_EVIDENCE" and a.claims == [] and a.evidence == []
    assert a.insufficient_evidence.reason.value == "NOT_A_QUESTION" and "Merhaba" in a.insufficient_evidence.message
    assert comps.index.searches == []  # the documents were not searched at all


def test_greeting_plus_question_is_answered_normally():
    a = ask("Merhaba, git status nedir?")
    assert [c.claim_text for c in a.claims] == ["git status: check the status of a repo"]


# ── Case 3: titles, unanswerable, partial, mixed language ────────────────────────────────

def test_slide_titles_and_page_numbers_are_never_claims():
    for q in ["Git and GitHub nedir?", "What is Git?", "Create a GitHub Account"]:
        for c in ask(q).claims:
            assert c.claim_text not in {"Git and GitHub", "Create a GitHub Account", "Create a Repository"}
            assert not c.claim_text.split()[0].isdigit()


@pytest.mark.parametrize("q", ["Dijkstra algoritması nedir?", "Python'da liste nasıl sıralanır?", "TCP üçlü el sıkışması nasıl çalışır?"])
def test_unanswerable_questions_abstain(q):
    a = ask(q)
    assert a.outcome.value == "INSUFFICIENT_EVIDENCE" and a.claims == []


def test_partially_answerable_question_is_partial_and_names_what_is_missing():
    a = ask("git status, git push ve git merge ne işe yarar?")
    assert a.outcome.value == "PARTIALLY_ANSWERED"
    assert [c.claim_text for c in a.claims] == ["git status: check the status of a repo"]
    assert any("push" in m and "merge" in m for m in a.insufficient_evidence.missing_information)


def test_known_limitation_one_missing_term_of_three_still_counts_as_answered():
    # Documented limitation: completeness is lexical coverage ≥ 0.6, so one missing term out of
    # three ("architecture") does not make the answer partial. A stricter rule ("any absent
    # term") was measured and rejected: it refused/partialised English questions over Turkish
    # material wholesale (challenge.v1 answered-on-answerable 13/28 → 4/28).
    a = ask("What is Git's distributed architecture?")
    assert a.outcome.value == "ANSWERED"
    assert a.question_coverage.uncovered_terms == ["architecture"]


def test_turkish_question_without_shared_terms_is_never_siki():
    # "dağıtık" / "mimari" never occur in the English slides: the extractive baseline cannot
    # translate, so it must not present anything as SIKI.
    a = ask("Git'in dağıtık mimarisi nedir?")
    assert a.outcome.value != "ANSWERED" and all(c.support_label != "SIKI" for c in a.claims)


def test_title_claim_from_a_model_is_not_siki():
    def respond(r):
        eid = next(b.split('"')[0] for b in r.user.split('<evidence id="')[1:] if "Git and GitHub" in b)
        return json.dumps({"status": "answered", "claims": [{"text": "Git and GitHub", "evidence_ids": [eid], "quote": "Git and GitHub"}]})

    (c,) = ask("Git and GitHub", provider=ScriptedProvider([respond])).claims
    assert c.support_label != "SIKI" and "başlık" in c.support_explanation


# ── Segmentation ──────────────────────────────────────────────────────────────────────────

def test_segments_are_exact_substrings_without_titles_numbers_or_list_markers():
    text = SLIDES[4].text
    segs = segments(text)
    assert "git status: check the status of a repo" in segs and "git init : create brand new repos" in segs
    assert all(s in text for s in segs)
    assert not any(s.startswith(("Create a Repository", "Key Terms", "26", "4.")) for s in segs)


def test_wrapped_sentence_is_rejoined_and_title_with_colon_dropped():
    t = "AVL Ağaçları: Denge Koşulu\nAVL ağacı, her düğümde farkın en fazla 1 olduğu\nikili arama ağacıdır. Dört rotasyon vardır."
    assert segments(t) == ["AVL ağacı, her düğümde farkın en fazla 1 olduğu\nikili arama ağacıdır.", "Dört rotasyon vardır."]


def test_long_segment_is_cut_to_a_verbatim_prefix():
    t = "Bu cümle " + "çok uzun bir açıklama " * 30 + "burada biter."
    (s,) = segments(t)
    assert len(s) <= 300 and t.startswith(s)
