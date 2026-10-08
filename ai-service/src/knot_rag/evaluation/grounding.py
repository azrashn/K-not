"""Offline grounding-validation harness (no LLM, no network, $0).

What it measures: how the WBS-3 validation layer (citation mapping, support rules, conflict
check, outcome logic) labels model outputs whose correctness is KNOWN BY CONSTRUCTION. A
deterministic scripted "model" answers each locked evaluation question in a controlled way:

  faithful                 a sentence copied from a gold passage, cited to it (control)
  wrong_citation           the same claim and quote, cited to a different passage
  misleading_citation      the gold claim, cited to another passage with a verbatim quote from it
  number_changed           a number in the claim altered (quote unchanged)
  negation_flipped         the claim's polarity inverted (quote unchanged)
  entity_swapped           a domain term replaced by another (AVL → kırmızı-siyah, sol → sağ…)
  unsupported_addition     the gold claim plus an unsupported clause
  fabricated_claim         an off-corpus statement cited to the gold passage with a real quote
  fabricated_quote         the gold claim with a quote that does not occur in the passage
  fabricated_evidence_id   the gold claim cited to an evidence id that was never shown
  overconfident_answer     (out-of-scope questions) a general-knowledge claim stated as answered
  irrelevant_quote         (out-of-scope questions) a true sentence from the top passage
  decline                  (out-of-scope questions) the model abstains (control)
  oracle                   gold sentences with the dataset's expected status (outcome control)

These numbers describe the VALIDATION LAYER under synthetic perturbations. They are not a
model's hallucination rate and not answer accuracy: a real LLM makes other, subtler errors
(paraphrase, partial truths, translation) that this harness cannot produce. Retrieval misses
(gold passage not in context) are reported separately and excluded from the denominators.

    python -m knot_rag.evaluation.grounding --corpus tests/fixtures/corpus_v2.json \\
        --dataset tests/fixtures/eval_dataset_v2.json --out report.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Callable

from knot_rag.config import Settings
from knot_rag.errors import RagError
from knot_rag.evaluation.runner import expected_outcome, offline_components
from knot_rag.generation.providers import ScriptedProvider
from knot_rag.generation.providers.base import LLMRequest
from knot_rag.schemas import AnswerRequest, AuthorizedScope
from knot_rag.text import content_tokens, has_negation, numbers

HARNESS_VERSION = "grounding-offline.v1"

FAULTS_ANSWERABLE = [
    "wrong_citation", "misleading_citation", "number_changed", "negation_flipped", "entity_swapped",
    "unsupported_addition", "fabricated_claim", "fabricated_quote", "fabricated_evidence_id",
]
FAULTS_OUT_OF_SCOPE = ["overconfident_answer", "irrelevant_quote"]
CONTROLS = ["faithful", "oracle", "decline"]

# Statements that are not in the corpus (general CS knowledge or false). Fixed for reproducibility.
FABRICATED = [
    "Bu yapı ilk olarak 1972 yılında Rudolf Bayer tarafından tanımlanmıştır.",
    "Bu işlem her durumda sabit bellek kullanır ve paralel olarak çalıştırılabilir.",
    "Veritabanı sistemleri bu yapıyı varsayılan indeks olarak kullanır.",
    "Bu yöntem grafik işlemcilerde on kat daha hızlı çalışır.",
]
ADDITIONS = [
    " ve bu yaklaşım veritabanı indekslerinde varsayılan olarak kullanılır.",
    " ve bu yöntem dağıtık sistemlerde tercih edilen standarttır.",
]
# Ordered (pattern, replacement) pairs; the first that matches the claim is applied.
ENTITY_SWAPS = [
    (r"\bAVL\b", "kırmızı-siyah"), (r"\bkırmızı-siyah\b", "AVL"), (r"\bsol(?=\w*)", "sağ"), (r"\bsağ(?=\w*)", "sol"),
    (r"\ben fazla\b", "en az"), (r"\ben az\b", "en fazla"), (r"\bLL\b", "RR"), (r"\bRR\b", "LL"),
    (r"\bekleme\b", "silme"), (r"\bsilme\b", "ekleme"), (r"\bmin-heap\b", "max-heap"), (r"\bmax-heap\b", "min-heap"),
    (r"\bkök\b", "yaprak"), (r"\byaprak\b", "kök"), (r"\bkararlı\b", "yerinde"), (r"\bO\(n log n\)", "O(n²)"),
    (r"\bO\(log n\)", "O(n)"), (r"\bO\(n\)", "O(log n)"),
]
_COPULA = re.compile(r"(\w+?)(dır|dir|dur|dür|tır|tir|tur|tür)([.!]?)$")
_NEG_COPULA = re.compile(r"\s+değil(dir)?([.!]?)$")
_BLOCK = re.compile(r'<evidence id="(E\d+)"[^>]*>\n(.*?)\n</evidence>', re.DOTALL)
_SENT = re.compile(r"(?<=[.!?;])\s+")
_QUESTION = re.compile(r"<question>\n(.*?)\n</question>", re.DOTALL)


def sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT.split(text.strip()) if len(s.strip()) >= 12]


def best_sentence(text: str, question: str) -> str | None:
    q = set(content_tokens(question))
    ranked = sorted(sentences(text), key=lambda s: -len(q & set(content_tokens(s))))
    return ranked[0] if ranked else None


def change_number(claim: str) -> str | None:
    nums = sorted(numbers(claim), key=len, reverse=True)
    if not nums:
        return None
    n = nums[0]
    try:
        new = str(int(float(n)) + 1) if "." not in n else str(float(n) + 1)
    except ValueError:
        return None
    return re.sub(rf"(?<![\d.]){re.escape(n)}(?![\d.])", new, claim, count=1)


def flip_negation(claim: str) -> str | None:
    if has_negation(claim):
        m = _NEG_COPULA.search(claim)
        return claim[: m.start()] + "dir" + (m.group(2) or "") if m else None
    m = _COPULA.search(claim)
    return claim[: m.start()] + m.group(1) + " değildir" + m.group(3) if m else None


def swap_entity(claim: str) -> str | None:
    for pat, repl in ENTITY_SWAPS:
        new, k = re.subn(pat, repl, claim, count=1)
        if k:
            return new
    return None


def fake_quote(sentence: str) -> str:
    words = sentence.rstrip(".!?").split()
    return " ".join(reversed(words[: max(4, len(words) // 2)]))


@dataclass
class Block:
    evidence_id: str
    text: str
    chunk_id: str | None


@dataclass
class Case:
    item_id: str
    category: str
    language: str
    scenario: str
    expected_outcome: list[str]
    claim_labels: list[str] = field(default_factory=list)
    claim_texts: list[str] = field(default_factory=list)
    explanations: list[str | None] = field(default_factory=list)
    outcome: str | None = None
    skipped: str | None = None


def _payload(claims: list[dict], status: str = "answered", missing: list[str] | None = None) -> str:
    return json.dumps({"status": status, "claims": claims, "missing": missing or []}, ensure_ascii=False)


def _claim(text: str, eid: str, quote: str | None) -> dict:
    return {"text": text, "evidence_ids": [eid], "quote": quote, "support": "full"}


def build_response(scenario: str, question: str, blocks: list[Block], gold: set[str], item: dict, k: int) -> str | None:
    """The scripted model's output for one scenario, or None when the scenario does not apply."""
    gold_blocks = [b for b in blocks if b.chunk_id in gold]
    other = [b for b in blocks if b.chunk_id not in gold]
    if scenario == "decline":
        return _payload([], "insufficient", ["Kaynaklarda bu soru için bilgi yok."])
    if scenario in FAULTS_OUT_OF_SCOPE:
        if not blocks:
            return None
        top = blocks[0]
        if scenario == "overconfident_answer":
            sent = best_sentence(top.text, question) or top.text[:120]
            return _payload([_claim(FABRICATED[k % len(FABRICATED)], top.evidence_id, sent)])
        sent = best_sentence(top.text, question)
        return _payload([_claim(sent, top.evidence_id, sent)]) if sent else None
    if not gold_blocks:
        return None
    g = gold_blocks[0]
    sent = best_sentence(g.text, question)
    if not sent:
        return None
    if scenario == "faithful":
        return _payload([_claim(sent, g.evidence_id, sent)])
    if scenario == "oracle":
        claims = [_claim(s, b.evidence_id, s) for b in gold_blocks if (s := best_sentence(b.text, question))]
        exp = expected_outcome(item)
        if "ANSWERED" in exp:
            return _payload(claims)
        return _payload(claims, "partial", ["Sorunun bir kısmı kaynaklarda yok."])
    if scenario == "wrong_citation":
        tgt = next((b for b in other if sent not in b.text), None)
        return _payload([_claim(sent, tgt.evidence_id, sent)]) if tgt else None
    if scenario == "misleading_citation":
        tgt = next((b for b in other if sentences(b.text)), None)
        return _payload([_claim(sent, tgt.evidence_id, sentences(tgt.text)[0])]) if tgt else None
    if scenario == "number_changed":
        new = change_number(sent)
        return _payload([_claim(new, g.evidence_id, sent)]) if new and new != sent else None
    if scenario == "negation_flipped":
        new = flip_negation(sent)
        return _payload([_claim(new, g.evidence_id, sent)]) if new else None
    if scenario == "entity_swapped":
        new = swap_entity(sent)
        return _payload([_claim(new, g.evidence_id, sent)]) if new and new != sent else None
    if scenario == "unsupported_addition":
        return _payload([_claim(sent.rstrip(".!?") + ADDITIONS[k % len(ADDITIONS)], g.evidence_id, sent)])
    if scenario == "fabricated_claim":
        return _payload([_claim(FABRICATED[k % len(FABRICATED)], g.evidence_id, sent)])
    if scenario == "fabricated_quote":
        return _payload([_claim(sent, g.evidence_id, fake_quote(sent))])
    if scenario == "fabricated_evidence_id":
        return _payload([_claim(sent, "E99", sent)])
    raise ValueError(f"unknown scenario {scenario}")


def _chunk_lookup(corpus: dict) -> Callable[[str], str | None]:
    by_text = {c["text"].strip(): c["chunk_id"] for c in corpus["chunks"]}

    def find(body: str) -> str | None:
        body = body.replace("&lt;", "<").strip()
        if body in by_text:
            return by_text[body]
        head = body[:120]
        return next((cid for t, cid in by_text.items() if t.startswith(head)), None)

    return find


def scenarios_for(item: dict) -> list[str]:
    exp = expected_outcome(item)
    if exp == ["INSUFFICIENT_EVIDENCE"]:
        return ["decline", *FAULTS_OUT_OF_SCOPE]
    return ["faithful", "oracle", *FAULTS_ANSWERABLE]


def run(dataset: dict, corpus: dict, settings: Settings, corpus_path: str) -> list[Case]:
    find = _chunk_lookup(corpus)
    state: dict[str, Any] = {}

    def model(req: LLMRequest) -> str:
        blocks = [Block(eid, body, find(body)) for eid, body in _BLOCK.findall(req.user)]
        qm = _QUESTION.search(req.user)
        state["blocks"] = blocks
        out = build_response(state["scenario"], qm.group(1) if qm else "", blocks, state["gold"], state["item"], state["k"])
        if out is None:
            state["skipped"] = "scenario_not_applicable" if any(b.chunk_id in state["gold"] for b in blocks) or not state["gold"] \
                else "gold_not_in_context"
            return _payload([], "insufficient", ["skipped"])
        return out

    comps = offline_components(settings, corpus_path, provider=ScriptedProvider([model], name="scripted_perturbation", model=HARNESS_VERSION))
    cases: list[Case] = []
    for k, item in enumerate(dataset["items"]):
        scope = AuthorizedScope(user_id=dataset["user_id"], course_id=dataset["course_id"],
                                document_ids=item.get("scope_docs", dataset["default_scope"]))
        for sc in scenarios_for(item):
            state.update(scenario=sc, gold=set(item.get("expected_chunk_ids", [])), item=item, k=k, skipped=None)
            case = Case(item["id"], item["category"], item.get("language", "unlabelled"), sc, expected_outcome(item))
            try:
                ans = comps.rag.answer(AnswerRequest(question=item["question"], scope=scope), f"g-{item['id']}-{sc}")
            except RagError as exc:
                case.outcome = f"ERROR:{exc.code.value}"
                cases.append(case)
                continue
            if state["skipped"]:
                case.skipped = state["skipped"]
            elif ans.outcome.value == "INSUFFICIENT_EVIDENCE" and not ans.claims and sc != "decline":
                # No evidence reached the model (retrieval floor): nothing was generated.
                case.skipped = "no_evidence_retrieved"
            else:
                case.outcome = ans.outcome.value
                case.claim_labels = [c.support_label for c in ans.claims]
                case.claim_texts = [c.claim_text for c in ans.claims]
                case.explanations = [c.support_explanation for c in ans.claims]
            cases.append(case)
    return cases


def _rate(num: int, den: int) -> dict:
    return {"value": round(num / den, 4) if den else None, "numerator": num, "denominator": den}


def summarize(cases: list[Case]) -> dict:
    by_sc: dict[str, list[Case]] = defaultdict(list)
    for c in cases:
        by_sc[c.scenario].append(c)
    out: dict[str, Any] = {}
    for sc, cs in by_sc.items():
        done = [c for c in cs if not c.skipped and not (c.outcome or "").startswith("ERROR")]
        claims = [lab for c in done for lab in c.claim_labels]
        labels = Counter(claims)
        entry: dict[str, Any] = {
            "cases": len(cs),
            "evaluated": len(done),
            "skipped": dict(Counter(c.skipped for c in cs if c.skipped)),
            "errors": sum(1 for c in cs if (c.outcome or "").startswith("ERROR")),
            "claim_labels": dict(labels),
            "outcomes": dict(Counter(c.outcome for c in done)),
        }
        if sc in FAULTS_ANSWERABLE or sc in FAULTS_OUT_OF_SCOPE:
            # Every claim in these scenarios is wrong by construction.
            entry["incorrect_siki_rate"] = _rate(labels["SIKI"], len(claims))
            entry["flagged_kopuk_rate"] = _rate(labels["KOPUK"], len(claims))
            entry["answered_rate"] = _rate(sum(1 for c in done if c.outcome == "ANSWERED"), len(done))
        if sc == "faithful":
            entry["siki_rate"] = _rate(labels["SIKI"], len(claims))
            entry["false_alarm_rate"] = _rate(len(claims) - labels["SIKI"], len(claims))
        if sc in ("oracle", "decline"):
            entry["outcome_accuracy"] = _rate(sum(1 for c in done if c.outcome in c.expected_outcome), len(done))
        if sc == "oracle":
            answerable = [c for c in done if "INSUFFICIENT_EVIDENCE" not in c.expected_outcome]
            entry["unnecessary_refusal_rate"] = _rate(sum(1 for c in answerable if c.outcome == "INSUFFICIENT_EVIDENCE"), len(answerable))
            partial = [c for c in done if c.expected_outcome == ["PARTIALLY_ANSWERED"]]
            entry["overclaim_on_partial_rate"] = _rate(sum(1 for c in partial if c.outcome == "ANSWERED"), len(partial))
        if sc == "decline":
            entry["correct_abstention_rate"] = _rate(sum(1 for c in done if c.outcome == "INSUFFICIENT_EVIDENCE"), len(done))
        out[sc] = entry
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--embedding", choices=["hashing", "env"], default="hashing",
                    help="hashing (default, offline) or the locally configured embedding model.")
    ap.add_argument("--out")
    args = ap.parse_args(argv)

    import os

    env = dict(os.environ)
    env.setdefault("RAG_AUTH_DISABLED", "true")
    settings = Settings.from_env(env)
    if args.embedding == "hashing":
        settings = replace(settings, embedding_backend="hashing")
    dataset = json.loads(Path(args.dataset).read_text(encoding="utf-8"))
    corpus = json.loads(Path(args.corpus).read_text(encoding="utf-8"))
    cases = run(dataset, corpus, settings, args.corpus)
    languages = sorted({c.language for c in cases})
    report = {
        "harness": HARNESS_VERSION,
        "dataset": dataset.get("version"),
        "items": len(dataset["items"]),
        "embedding_backend": settings.embedding_backend,
        "generator": "scripted perturbations (no LLM)",
        "interpretation": "Validation-layer behaviour on synthetic, known-by-construction errors; "
                          "not a model hallucination rate and not answer accuracy.",
        "by_scenario": summarize(cases),
        "by_language": {lang: summarize([c for c in cases if c.language == lang]) for lang in languages} if len(languages) > 1 else None,
        "per_case": [c.__dict__ for c in cases],
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
    sys.stdout.write(json.dumps(report["by_scenario"], ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
