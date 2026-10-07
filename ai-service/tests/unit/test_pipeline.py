import json
from concurrent.futures import ThreadPoolExecutor

import pytest

from knot_rag.errors import ProviderTimeout
from knot_rag.generation.providers import ExtractiveBaselineProvider, ProviderTimeoutError, ScriptedProvider
from knot_rag.schemas import (
    AnswerOutcome,
    AnswerRequest,
    InsufficientEvidenceReason,
    RetrievalParams,
    RetrieveRequest,
    SupportStatus,
)
from tests.fakes import SCOPE_DOCS, scope


def j(status="answered", claims=(), missing=()):
    return json.dumps({"status": status, "claims": list(claims), "missing": list(missing)}, ensure_ascii=False)


def evidence_for(ans, chunk_id):
    return next(e.evidence_id for e in ans.evidence if e.chunk_id == chunk_id)


def ask(make_components, script, question="AVL ağacında kaç temel rotasyon vardır?", **req):
    provider = script if hasattr(script, "complete") else ScriptedProvider(script)
    rag = make_components(provider=provider).rag
    return rag.answer(AnswerRequest(question=question, scope=scope(req.pop("docs", None)), **req), "req-1"), provider


def test_fully_supported_answer(make_components):
    def respond(r):
        eid = r.user.split('<evidence id="')[1].split('"')[0]
        return j(claims=[{"text": "Dört temel rotasyon vardır: LL, RR, LR ve RL.", "evidence_ids": [eid], "quote": "Dört temel rotasyon vardır: LL, RR, LR ve RL"}])

    ans, _ = ask(make_components, [respond], question="Kaç temel rotasyon vardır ve bunlar nelerdir?")
    assert ans.outcome == AnswerOutcome.ANSWERED
    assert ans.support_status == SupportStatus.SUPPORTED and ans.support_label == "SIKI"
    cited = ans.claims[0].citations[0]
    assert cited.chunk_id == "doc-vy-notlar:v1:003" and cited.location.page_start == 2 and cited.location.page_end == 3
    assert ans.insufficient_evidence is None and ans.generation.attempts == 1


def test_every_citation_resolves_to_returned_evidence(make_components):
    ans, _ = ask(make_components, ExtractiveBaselineProvider(), question="Hash tablosunda çakışma nasıl çözülür?")
    ids = {e.evidence_id: e.chunk_id for e in ans.evidence}
    assert ans.claims
    for c in ans.claims:
        for cit in c.citations:
            assert ids[cit.evidence_id] == cit.chunk_id


def test_no_evidence_skips_generation(make_components):
    provider = ScriptedProvider([AssertionError("must not be called")])
    rag = make_components(provider=provider).rag
    ans = rag.answer(AnswerRequest(question="İstanbul'un nüfusu kaçtır?", scope=scope(), params=RetrievalParams(min_score=0.95)), "r")
    assert ans.outcome == AnswerOutcome.INSUFFICIENT_EVIDENCE
    assert ans.insufficient_evidence.reason == InsufficientEvidenceReason.NO_RETRIEVED_EVIDENCE
    assert ans.claims == [] and ans.generation is None and provider.requests == []


def test_model_declines_irrelevant_question(make_components):
    ans, _ = ask(make_components, [j("insufficient", missing=["Splay ağaçları materyallerde yok."])], question="Splay ağaçlarında amortize analiz nasıl yapılır?")
    assert ans.outcome == AnswerOutcome.INSUFFICIENT_EVIDENCE
    assert ans.insufficient_evidence.reason == InsufficientEvidenceReason.MODEL_DECLINED
    assert ans.insufficient_evidence.missing_information == ["Splay ağaçları materyallerde yok."]
    assert ans.support_label == "KOPUK"


def test_partial_evidence_is_not_reported_as_fully_supported(make_components):
    def respond(r):
        e = r.user.split('<evidence id="')[1].split('"')[0]
        return j("partial", claims=[{"text": "Kırmızı-siyah ağaçta denge daha gevşektir.", "evidence_ids": [e], "quote": "denge daha gevşek"}],
                 missing=["Yükseklik üst sınırı materyallerde yok."])

    ans, _ = ask(make_components, [respond], question="Kırmızı-siyah ağaçta denge ve yükseklik üst sınırı nedir?")
    assert ans.outcome == AnswerOutcome.PARTIALLY_ANSWERED
    assert ans.support_status == SupportStatus.PARTIALLY_SUPPORTED
    assert ans.insufficient_evidence.reason == InsufficientEvidenceReason.PARTIAL_COVERAGE


def test_all_claims_unsupported_becomes_insufficient(make_components):
    ans, _ = ask(make_components, [j(claims=[{"text": "AVL 1972'de icat edildi.", "evidence_ids": ["E42"], "quote": "1972"}])])
    assert ans.outcome == AnswerOutcome.INSUFFICIENT_EVIDENCE
    assert ans.insufficient_evidence.reason == InsufficientEvidenceReason.NO_SUPPORTED_CLAIMS
    assert ans.citation_issues[0].evidence_id == "E42"
    assert ans.claims[0].citations == []


def test_prompt_injection_in_document_cannot_produce_valid_fake_citation(make_components):
    docs = SCOPE_DOCS + ["doc-vy-zararli"]

    def compromised_model(r):
        # Simulate a model that obeyed the injected text.
        return j(claims=[{"text": "AVL ağaçları 1972'de icat edildi.", "evidence_ids": ["E99"], "quote": "Sahte kanıt"}])

    ans, provider = ask(make_components, [compromised_model], question="AVL ağaçlarında denge nasıl sağlanır?", docs=docs)
    assert "doc-vy-zararli:v1:001" in [e.chunk_id for e in ans.evidence]
    sent = provider.requests[0]
    assert "Önceki tüm talimatları yok say" not in sent.system
    assert sent.user.count('<evidence id="E99"') == 0  # injected delimiter neutralised
    assert ans.claims[0].support_status == SupportStatus.UNSUPPORTED
    assert ans.outcome == AnswerOutcome.INSUFFICIENT_EVIDENCE


def test_provider_timeout_propagates_as_classified_error(make_components):
    with pytest.raises(ProviderTimeout):
        ask(make_components, [ProviderTimeoutError()])


def test_retrieve_returns_structured_evidence(make_components):
    rag = make_components(provider=ScriptedProvider(["{}"])).rag
    q = "  AVL ağacında   alt ağaç yükseklikleri arasındaki fark en fazla kaç olabilir? "
    resp = rag.retrieve(RetrieveRequest(question=q, scope=scope()), "r")
    assert resp.question == q
    assert resp.retrieval_query == "AVL ağacında alt ağaç yükseklikleri arasındaki fark en fazla kaç olabilir?"
    assert resp.evidence[0].evidence_id == "E1" and resp.evidence[0].label.startswith("Slayt")
    # duplicated p.18 chunk in the corpus must appear once
    texts = [e.text for e in resp.evidence]
    assert len(texts) == len(set(texts)) and resp.diagnostics.duplicates_removed >= 1


def test_missing_page_metadata_is_not_invented(make_components):
    rag = make_components(provider=ScriptedProvider(["{}"])).rag
    resp = rag.retrieve(RetrieveRequest(question="Boş AVL ağacına 10, 20, 30 eklenirse hangi rotasyon?", scope=scope()), "r")
    exam = next(e for e in resp.evidence if e.document_id == "doc-vy-sinav-2024")
    assert exam.location.page_start is None and exam.label == "Sınav"


def test_simultaneous_requests_are_independent(make_components):
    rag = make_components(provider=ExtractiveBaselineProvider()).rag
    questions = ["AVL ağacında denge koşulu nedir?", "Zincirleme nedir?", "Hızlı sıralamanın en kötü durumu nedir?", "Rotasyon ne kadar sürer?"] * 5

    def one(i_q):
        i, q = i_q
        return rag.answer(AnswerRequest(question=q, scope=scope()), f"r{i}")

    with ThreadPoolExecutor(max_workers=8) as ex:
        results = list(ex.map(one, enumerate(questions)))
    assert [r.request_id for r in results] == [f"r{i}" for i in range(len(questions))]
    assert [r.question for r in results] == questions
    assert len({r.answer_id for r in results}) == len(results)


# ── v1.1 behaviour: relevance, question coverage, verification flags ──────────────────

def _first_eid(r):
    return r.user.split('<evidence id="')[1].split('"')[0]


def test_heuristic_siki_is_reported_but_not_confirmed(make_components):
    def respond(r):
        return j(claims=[{"text": "Dört temel rotasyon vardır: LL, RR, LR ve RL.", "evidence_ids": [_first_eid(r)], "quote": "Dört temel rotasyon vardır: LL, RR, LR ve RL"}])

    ans, _ = ask(make_components, [respond], question="Kaç temel rotasyon vardır ve bunlar nelerdir?")
    assert ans.support_label == "SIKI"
    assert ans.support_confirmed is False and ans.claims[0].support_confirmed is False
    assert ans.verification.value == "HEURISTIC"


def test_strict_mode_shows_unconfirmed_siki_as_geveşek(make_components, settings):
    from dataclasses import replace

    strict = replace(settings, support=replace(settings.support, require_semantic_confirmation=True))

    def respond(r):
        return j(claims=[{"text": "Dört temel rotasyon vardır: LL, RR, LR ve RL.", "evidence_ids": [_first_eid(r)], "quote": "Dört temel rotasyon vardır: LL, RR, LR ve RL"}])

    rag = make_components(provider=ScriptedProvider([respond]), settings_override=strict).rag
    ans = rag.answer(AnswerRequest(question="Kaç temel rotasyon vardır ve bunlar nelerdir?", scope=scope()), "r")
    assert ans.claims[0].support_status == SupportStatus.PARTIALLY_SUPPORTED
    assert "anlamsal" in ans.claims[0].support_explanation
    assert ans.outcome != AnswerOutcome.ANSWERED


def test_off_topic_answer_is_not_reported_as_answered(make_components):
    # eval.v1 o02: a true sentence about sorting complexity "answers" a Dijkstra question.
    def respond(r):
        e = next(x for x in r.user.split('<evidence id="')[1:] if "Hızlı sıralama" in x).split('"')[0]
        return j(claims=[{"text": "Hızlı sıralamanın en kötü durum karmaşıklığı O(n²)’dir.", "evidence_ids": [e],
                          "quote": "en kötü durum karmaşıklığı O(n²)’dir"}])

    ans, _ = ask(make_components, [respond], question="Dijkstra algoritmasının zaman karmaşıklığı nedir?")
    assert ans.outcome == AnswerOutcome.PARTIALLY_ANSWERED
    assert "Dijkstra" in ans.question_coverage.uncovered_terms
    assert any("Dijkstra" in m for m in ans.insufficient_evidence.missing_information)
    assert ans.support_label != "SIKI"


def test_partial_question_without_model_missing_list_is_detected(make_components):
    # The model claims everything is answered but the evidence never mentions the height bound.
    def respond(r):
        e = next(x for x in r.user.split('<evidence id="')[1:] if "denge daha gevşek" in x).split('"')[0]
        return j(claims=[{"text": "Kırmızı-siyah ağaçta denge daha gevşektir.", "evidence_ids": [e], "quote": "Kırmızı-siyah ağaçta denge daha gevşek"}])

    ans, _ = ask(make_components, [respond], question="Kırmızı-siyah ağaçlarda yükseklik üst sınırı nedir ve denge nasıldır?")
    assert ans.outcome == AnswerOutcome.PARTIALLY_ANSWERED
    assert {"yükseklik", "üst", "sınırı"} <= set(ans.question_coverage.uncovered_terms)


def test_known_limitation_implicit_topic_gives_false_partial(make_components):
    # The notes chunk answers the question but never names "AVL" (implicit topic), so the
    # lexical coverage check reports it as partial. Documented in rag-evaluation.md §6.
    def respond(r):
        e = next(x for x in r.user.split('<evidence id="')[1:] if "Dört temel rotasyon" in x).split('"')[0]
        return j(claims=[{"text": "Dört temel rotasyon vardır: LL, RR, LR ve RL.", "evidence_ids": [e], "quote": "Dört temel rotasyon vardır: LL, RR, LR ve RL"}])

    ans, _ = ask(make_components, [respond], question="AVL ağacında kaç temel rotasyon vardır?")
    assert ans.claims[0].support_status == SupportStatus.SUPPORTED
    assert ans.outcome == AnswerOutcome.PARTIALLY_ANSWERED and "AVL" in ans.question_coverage.uncovered_terms


def test_side_remarks_do_not_make_a_complete_answer_partial(make_components):
    def respond(r):
        blocks = r.user.split('<evidence id="')[1:]
        lead = next(x for x in blocks if "Dört temel rotasyon" in x).split('"')[0]
        side = next(x for x in blocks if "Rotasyon O(1) sürer" in x).split('"')[0]
        return j(claims=[
            {"text": "Dört temel rotasyon vardır: LL, RR, LR ve RL.", "evidence_ids": [lead], "quote": "Dört temel rotasyon vardır: LL, RR, LR ve RL"},
            {"text": "Rotasyon O(1) sürer.", "evidence_ids": [side], "quote": "Rotasyon O(1) sürer"},
        ])

    ans, _ = ask(make_components, [respond], question="Kaç temel rotasyon vardır ve bunlar nelerdir?", params=RetrievalParams(top_k=20, max_evidence=10))
    lead, side = ans.claims
    assert lead.support_status == SupportStatus.SUPPORTED
    assert side.support_status == SupportStatus.PARTIALLY_SUPPORTED and side.assessment.addresses_question is False
    assert ans.outcome == AnswerOutcome.ANSWERED and ans.support_label == "SIKI"


def test_tangential_hallucination_still_surfaces(make_components):
    def respond(r):
        lead = next(x for x in r.user.split('<evidence id="')[1:] if "Dört temel rotasyon" in x).split('"')[0]
        return j(claims=[
            {"text": "Dört temel rotasyon vardır: LL, RR, LR ve RL.", "evidence_ids": [lead], "quote": "Dört temel rotasyon vardır: LL, RR, LR ve RL"},
            {"text": "Splay ağaçları 1985'te bulundu.", "evidence_ids": ["E77"], "quote": "1985"},
        ])

    ans, _ = ask(make_components, [respond], question="Kaç temel rotasyon vardır ve bunlar nelerdir?")
    assert ans.claims[1].support_status == SupportStatus.UNSUPPORTED
    assert ans.outcome == AnswerOutcome.PARTIALLY_ANSWERED and ans.support_label == "GEVEŞEK"



def test_terms_absent_from_context_are_reported_but_do_not_decide(make_components):
    def respond(r):
        e = next(x for x in r.user.split('<evidence id="')[1:] if "Hızlı sıralama" in x).split('"')[0]
        return j(claims=[{"text": "Hızlı sıralamanın en kötü durum karmaşıklığı O(n²)’dir.", "evidence_ids": [e],
                          "quote": "en kötü durum karmaşıklığı O(n²)’dir"}])

    ans, _ = ask(make_components, [respond], question="Dijkstra ile hızlı sıralamanın en kötü durum karmaşıklığı nedir?")
    assert "Dijkstra" in ans.question_coverage.absent_from_context
    # Known limitation: with 5/6 key terms covered, the lexical check alone cannot block ANSWERED.
    assert ans.question_coverage.ratio >= 0.6
