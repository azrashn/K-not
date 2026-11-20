"""Blind human labelling of answer claims, and the claim-level metrics computed from it.

The perturbation harness (grounding.py) measures the validation layer on constructed errors.
Real hallucination metrics need a human judgement of real answers. This module:

  export  answers every dataset question with the configured pipeline and writes
          * a labelling SHEET (JSONL) with the question, each claim, and each citation's quote and
            full passage — WITHOUT the system's SIKI/GEVEŞEK/KOPUK label (blind labelling), and
          * a KEY (JSONL) with the system labels, kept apart from the labeller.
  score   joins a filled-in sheet with the key and reports, each with numerator/denominator:
            supported_claim_rate, unsupported_claim_rate, citation_precision,
            incorrect_siki_rate, overly_strict_rate, answer_completeness, and the
            system-vs-human confusion matrix with Cohen's kappa.

A metric whose denominator is 0 is reported as null ("unmeasured"). Labels written by the
system's developer, or by the model that produced the answers, are not independent.

    python -m knot_rag.evaluation.claim_labels export --corpus tests/fixtures/corpus_v2.json \\
        --dataset tests/fixtures/eval_dataset_v2.json --sheet sheet.jsonl --key key.jsonl
    python -m knot_rag.evaluation.claim_labels score --sheet sheet.labelled.jsonl --key key.jsonl
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import replace
from pathlib import Path
from typing import Any, Iterable

from knot_rag.config import Settings
from knot_rag.errors import RagError
from knot_rag.schemas import AnswerRequest, AuthorizedScope

SHEET_VERSION = "claim-labels.v1"
HUMAN_SUPPORT = ("SUPPORTED", "PARTIALLY_SUPPORTED", "UNSUPPORTED")
_SYSTEM_TO_HUMAN = {"SIKI": "SUPPORTED", "GEVEŞEK": "PARTIALLY_SUPPORTED", "KOPUK": "UNSUPPORTED"}

INSTRUCTIONS = (
    "For each claim decide from the cited passages ONLY (no outside knowledge): SUPPORTED = the "
    "passages state everything the claim says; PARTIALLY_SUPPORTED = part is stated, part is missing "
    "or different; UNSUPPORTED = not stated or contradicted. For each citation set true if that "
    "passage is a correct source for the claim. For each answer set complete=true if the claims "
    "together answer the question as far as the course material allows."
)


def export_rows(components, dataset: dict) -> tuple[list[dict], list[dict]]:
    sheet: list[dict] = [{"kind": "header", "sheet": SHEET_VERSION, "dataset": dataset.get("version"),
                          "generator": f"{components.provider.name}:{components.provider.model}",
                          "instructions": INSTRUCTIONS}]
    key: list[dict] = []
    for item in dataset["items"]:
        scope = AuthorizedScope(user_id=dataset["user_id"], course_id=dataset["course_id"],
                                document_ids=item.get("scope_docs", dataset["default_scope"]))
        try:
            ans = components.rag.answer(AnswerRequest(question=item["question"], scope=scope), f"label-{item['id']}")
        except RagError as exc:
            key.append({"kind": "answer", "item_id": item["id"], "outcome": f"ERROR:{exc.code.value}"})
            continue
        evidence = {e.evidence_id: e for e in ans.evidence}
        sheet.append({"kind": "answer", "item_id": item["id"], "question": item["question"],
                      "language": item.get("language"), "claims": [c.claim_text for c in ans.claims],
                      "human": {"complete": None, "notes": ""}})
        key.append({"kind": "answer", "item_id": item["id"], "outcome": ans.outcome.value,
                    "support_label": ans.support_label})
        for c in ans.claims:
            cites = []
            for i, ct in enumerate(c.citations, start=1):
                ev = evidence.get(ct.evidence_id)
                cites.append({"citation_id": f"{c.claim_id}-{i}", "label": ct.label, "quote": ct.quote,
                              "passage": ev.text if ev else None})
            sheet.append({"kind": "claim", "item_id": item["id"], "claim_id": c.claim_id, "question": item["question"],
                          "claim_text": c.claim_text, "citations": cites,
                          "human": {"support": None, "citations_correct": {x["citation_id"]: None for x in cites}, "notes": ""}})
            key.append({"kind": "claim", "item_id": item["id"], "claim_id": c.claim_id, "support_label": c.support_label})
    return sheet, key


def _rate(num: int, den: int) -> dict:
    return {"value": round(num / den, 4) if den else None, "numerator": num, "denominator": den}


def cohen_kappa(pairs: list[tuple[str, str]], classes: Iterable[str]) -> float | None:
    n = len(pairs)
    if n == 0:
        return None
    classes = list(classes)
    po = sum(1 for a, b in pairs if a == b) / n
    ca, cb = Counter(a for a, _ in pairs), Counter(b for _, b in pairs)
    pe = sum(ca[k] * cb[k] for k in classes) / (n * n)
    return round((po - pe) / (1 - pe), 4) if pe < 1 else None


def score(sheet: list[dict], key: list[dict]) -> dict[str, Any]:
    sys_claim = {(k["item_id"], k["claim_id"]): k["support_label"] for k in key if k["kind"] == "claim"}
    claims = [r for r in sheet if r.get("kind") == "claim" and r["human"].get("support") in HUMAN_SUPPORT]
    invalid = [r for r in sheet if r.get("kind") == "claim" and r["human"].get("support") not in (None, *HUMAN_SUPPORT)]
    human = Counter(r["human"]["support"] for r in claims)
    cites = [v for r in sheet if r.get("kind") == "claim" for v in r["human"].get("citations_correct", {}).values() if isinstance(v, bool)]
    answers = [r for r in sheet if r.get("kind") == "answer" and isinstance(r["human"].get("complete"), bool)]

    pairs = [(_SYSTEM_TO_HUMAN[sys_claim[(r["item_id"], r["claim_id"])]], r["human"]["support"])
             for r in claims if (r["item_id"], r["claim_id"]) in sys_claim]
    siki = [h for s, h in pairs if s == "SUPPORTED"]
    human_supported = [s for s, h in pairs if h == "SUPPORTED"]
    confusion = Counter(f"{s}->{h}" for s, h in pairs)
    return {
        "labelled_claims": len(claims),
        "unlabelled_claims": sum(1 for r in sheet if r.get("kind") == "claim" and r["human"].get("support") is None),
        "invalid_labels": len(invalid),
        "supported_claim_rate": _rate(human["SUPPORTED"], len(claims)),
        "partially_supported_claim_rate": _rate(human["PARTIALLY_SUPPORTED"], len(claims)),
        "unsupported_claim_rate": _rate(human["UNSUPPORTED"], len(claims)),
        "citation_precision": _rate(sum(cites), len(cites)),
        "incorrect_siki_rate": _rate(sum(1 for h in siki if h != "SUPPORTED"), len(siki)),
        "overly_strict_rate": _rate(sum(1 for s in human_supported if s == "UNSUPPORTED"), len(human_supported)),
        "answer_completeness": _rate(sum(1 for r in answers if r["human"]["complete"]), len(answers)),
        "system_vs_human": {"pairs": len(pairs), "confusion": dict(confusion),
                            "agreement": _rate(sum(1 for s, h in pairs if s == h), len(pairs)),
                            "cohen_kappa": cohen_kappa(pairs, HUMAN_SUPPORT)},
        "definitions": {
            "supported_claim_rate": "claims a human labelled SUPPORTED / labelled claims",
            "unsupported_claim_rate": "claims a human labelled UNSUPPORTED / labelled claims",
            "citation_precision": "citations a human marked correct / labelled citations",
            "incorrect_siki_rate": "SIKI claims a human did NOT label SUPPORTED / labelled SIKI claims",
            "overly_strict_rate": "claims a human labelled SUPPORTED but the system rated KOPUK / human-SUPPORTED claims",
            "answer_completeness": "answers a human marked complete / labelled answers",
        },
    }


def _read_jsonl(path: str) -> list[dict]:
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def _write_jsonl(path: str, rows: list[dict]) -> None:
    Path(path).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    ex = sub.add_parser("export")
    ex.add_argument("--dataset", required=True)
    ex.add_argument("--corpus", required=True)
    ex.add_argument("--embedding", choices=["hashing", "env"], default="hashing")
    ex.add_argument("--provider", choices=["extractive", "env"], default="extractive",
                    help="env = LLM_* settings; external endpoints are refused unless approved with a budget.")
    ex.add_argument("--sheet", required=True)
    ex.add_argument("--key", required=True)
    sc = sub.add_parser("score")
    sc.add_argument("--sheet", required=True)
    sc.add_argument("--key", required=True)
    args = ap.parse_args(argv)

    if args.cmd == "score":
        sys.stdout.write(json.dumps(score(_read_jsonl(args.sheet), _read_jsonl(args.key)), ensure_ascii=False, indent=2) + "\n")
        return 0

    import os

    from knot_rag.evaluation.runner import offline_components

    env = dict(os.environ)
    env.setdefault("RAG_AUTH_DISABLED", "true")
    settings = Settings.from_env(env)
    if args.embedding == "hashing":
        settings = replace(settings, embedding_backend="hashing")
    if args.provider == "extractive":
        settings = replace(settings, llm=replace(settings.llm, provider="extractive"))
    comps = offline_components(settings, args.corpus)
    sheet, key = export_rows(comps, json.loads(Path(args.dataset).read_text(encoding="utf-8")))
    _write_jsonl(args.sheet, sheet)
    _write_jsonl(args.key, key)
    sys.stdout.write(f"{sum(1 for r in sheet if r['kind'] == 'claim')} claims to label -> {args.sheet}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
