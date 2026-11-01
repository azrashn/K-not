"""Offline grounding harness: deterministic, $0, and its safety invariants hold on a slice of
eval.v2. Numbers in docs/rag-evaluation.md come from the full CLI run, not from this test."""

import json

import pytest

from knot_rag.config import Settings
from knot_rag.evaluation import grounding as g
from tests.fakes import FIXTURES

pytestmark = pytest.mark.evaluation

CORPUS = str(FIXTURES / "corpus_v2.json")


@pytest.fixture(scope="module")
def cases():
    dataset = json.loads((FIXTURES / "eval_dataset_v2.json").read_text(encoding="utf-8"))
    keep = {"d01", "d02", "d03", "d08", "o01", "o02", "p01", "n05"}
    dataset["items"] = [i for i in dataset["items"] if i["id"] in keep]
    settings = Settings.from_env({"RAG_AUTH_DISABLED": "true", "EMBEDDING_BACKEND": "hashing"})
    corpus = json.loads((FIXTURES / "corpus_v2.json").read_text(encoding="utf-8"))
    return g.run(dataset, corpus, settings, CORPUS)


def by(cases, scenario):
    return [c for c in cases if c.scenario == scenario and not c.skipped]


def test_fabricated_evidence_ids_are_always_kopuk(cases):
    cs = by(cases, "fabricated_evidence_id")
    assert cs and all(c.claim_labels == ["KOPUK"] and c.outcome == "INSUFFICIENT_EVIDENCE" for c in cs)


@pytest.mark.parametrize("scenario", ["wrong_citation", "misleading_citation", "unsupported_addition",
                                      "fabricated_claim", "fabricated_quote", "overconfident_answer"])
def test_constructed_errors_are_never_siki_or_answered(cases, scenario):
    cs = by(cases, scenario)
    assert cs, scenario
    assert all("SIKI" not in c.claim_labels and c.outcome != "ANSWERED" for c in cs)


def test_decline_on_out_of_scope_is_a_correct_abstention(cases):
    cs = by(cases, "decline")
    assert cs and all(c.outcome == "INSUFFICIENT_EVIDENCE" for c in cs)


def test_faithful_control_is_mostly_siki(cases):
    labels = [lab for c in by(cases, "faithful") for lab in c.claim_labels]
    assert labels and labels.count("SIKI") / len(labels) >= 0.75


def test_summary_reports_denominators(cases):
    s = g.summarize(cases)
    r = s["fabricated_evidence_id"]["flagged_kopuk_rate"]
    assert r["value"] == 1.0 and r["numerator"] == r["denominator"] > 0
    assert s["faithful"]["false_alarm_rate"]["denominator"] == s["faithful"]["siki_rate"]["denominator"]


def test_harness_is_deterministic(cases):
    dataset = json.loads((FIXTURES / "eval_dataset_v2.json").read_text(encoding="utf-8"))
    dataset["items"] = [i for i in dataset["items"] if i["id"] in {"d01", "o01"}]
    settings = Settings.from_env({"RAG_AUTH_DISABLED": "true", "EMBEDDING_BACKEND": "hashing"})
    corpus = json.loads((FIXTURES / "corpus_v2.json").read_text(encoding="utf-8"))
    a = [(c.item_id, c.scenario, c.claim_labels, c.outcome) for c in g.run(dataset, corpus, settings, CORPUS)]
    b = [(c.item_id, c.scenario, c.claim_labels, c.outcome) for c in g.run(dataset, corpus, settings, CORPUS)]
    assert a == b


@pytest.mark.parametrize("fn,inp,out", [
    (g.change_number, "Fark en fazla 1 olabilir.", "Fark en fazla 2 olabilir."),
    (g.change_number, "Sayı yok.", None),
    (g.flip_negation, "Birleştirme sıralaması kararlıdır.", "Birleştirme sıralaması kararlı değildir."),
    (g.flip_negation, "Hızlı sıralama kararlı değildir.", "Hızlı sıralama kararlıdir."),
    (g.swap_entity, "AVL ağacı dengelidir.", "kırmızı-siyah ağacı dengelidir."),
])
def test_mutation_helpers(fn, inp, out):
    assert fn(inp) == out


def test_fake_quote_does_not_occur_in_the_sentence():
    s = "Dört temel rotasyon vardır: LL, RR, LR ve RL."
    assert g.fake_quote(s) not in s
