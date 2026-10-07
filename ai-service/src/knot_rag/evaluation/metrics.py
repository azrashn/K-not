"""Metric definitions. Each metric states its numerator and denominator explicitly and
returns None (not 0) when its denominator is empty, so "unmeasured" is never shown as 0%."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ItemResult:
    item_id: str
    category: str
    expected: list[str]
    acceptable: list[str]
    require_all: bool
    candidate_ids: list[str]  # top-k candidates before context selection
    candidate_scores: list[float | None]
    context_ids: list[str]  # evidence actually given to the generator
    out_of_scope_hits: int
    outcome: str | None = None  # None when generation was not run
    answer_support: str | None = None
    claim_statuses: list[str] = field(default_factory=list)
    cited_chunk_ids: list[str] = field(default_factory=list)
    fabricated_citations: int = 0

    @property
    def in_scope(self) -> bool:
        return bool(self.expected)


@dataclass
class Metric:
    value: float | None
    numerator: int
    denominator: int
    definition: str

    def as_dict(self) -> dict[str, Any]:
        return {"value": None if self.value is None else round(self.value, 4), "numerator": self.numerator,
                "denominator": self.denominator, "definition": self.definition}


def _m(num: int, den: int, definition: str) -> Metric:
    return Metric(num / den if den else None, num, den, definition)


def retrieval_success(items: list[ItemResult], *, field_name: str = "candidate_ids") -> Metric:
    pool = [i for i in items if i.in_scope]
    ok = sum(1 for i in pool if set(i.expected) & set(getattr(i, field_name)))
    where = "top-k candidates" if field_name == "candidate_ids" else "selected context"
    return _m(ok, len(pool), f"in-scope questions with >=1 gold passage in the {where} / in-scope questions")


def multi_passage_recall(items: list[ItemResult]) -> Metric:
    pool = [i for i in items if i.require_all]
    ok = sum(1 for i in pool if set(i.expected) <= set(i.context_ids))
    return _m(ok, len(pool), "multi-passage questions with ALL gold passages in context / multi-passage questions")


def scope_leakage(items: list[ItemResult]) -> Metric:
    leaked = sum(i.out_of_scope_hits for i in items)
    total = sum(len(i.candidate_ids) + i.out_of_scope_hits for i in items)
    return _m(leaked, total, "retrieved records outside the authorized scope / all retrieved records (must be 0)")


def _answered(items):
    return [i for i in items if i.outcome is not None]


def source_supported_answer_rate(items: list[ItemResult]) -> Metric:
    pool = [i for i in _answered(items) if i.in_scope and i.outcome != "INSUFFICIENT_EVIDENCE"]
    ok = sum(1 for i in pool if i.answer_support == "SUPPORTED")
    return _m(ok, len(pool), "in-scope answers judged SUPPORTED / in-scope answers that were not abstentions")


def unsupported_claim_rate(items: list[ItemResult]) -> Metric:
    statuses = [s for i in _answered(items) for s in i.claim_statuses]
    bad = sum(1 for s in statuses if s == "UNSUPPORTED")
    return _m(bad, len(statuses), "claims judged UNSUPPORTED / all generated claims")


def citation_integrity(items: list[ItemResult]) -> Metric:
    valid = sum(len(i.cited_chunk_ids) for i in _answered(items))
    fab = sum(i.fabricated_citations for i in _answered(items))
    return _m(valid, valid + fab, "citations resolving to retrieved evidence / all citations the model proposed")


def citation_correctness(items: list[ItemResult]) -> Metric:
    pool = [i for i in _answered(items) if i.in_scope]
    total = sum(len(i.cited_chunk_ids) for i in pool)
    ok = sum(1 for i in pool for c in i.cited_chunk_ids if c in set(i.expected) | set(i.acceptable))
    return _m(ok, total, "valid citations pointing to a gold-relevant passage / valid citations (in-scope questions)")


def abstention_rate(items: list[ItemResult]) -> Metric:
    pool = [i for i in _answered(items) if not i.in_scope]
    ok = sum(1 for i in pool if i.outcome == "INSUFFICIENT_EVIDENCE")
    return _m(ok, len(pool), "out-of-scope questions answered with INSUFFICIENT_EVIDENCE / out-of-scope questions")


def threshold_sweep(items: list[ItemResult], thresholds: list[float]) -> list[dict[str, Any]]:
    """For each min_score: retrieval success (gold passage survives the floor) on in-scope
    items, and retrieval-level rejection (nothing survives) on out-of-scope items."""
    rows = []
    for t in thresholds:
        ins = [i for i in items if i.in_scope]
        outs = [i for i in items if not i.in_scope]
        kept = lambda i: {c for c, s in zip(i.candidate_ids, i.candidate_scores) if s is not None and s >= t}  # noqa: E731
        succ = sum(1 for i in ins if set(i.expected) & kept(i))
        rej = sum(1 for i in outs if not kept(i))
        rows.append({
            "min_score": t,
            "retrieval_success": round(succ / len(ins), 4) if ins else None,
            "out_of_scope_rejected": round(rej / len(outs), 4) if outs else None,
        })
    return rows


TARGETS = {
    "retrieval_success": (">=", 0.75),
    "source_supported_answer_rate": (">=", 0.80),
    "unsupported_claim_rate": ("<=", 0.20),
}


def summarize(items: list[ItemResult], thresholds: list[float] | None = None) -> dict[str, Any]:
    metrics = {
        "retrieval_success": retrieval_success(items),
        "retrieval_success_in_context": retrieval_success(items, field_name="context_ids"),
        "multi_passage_recall": multi_passage_recall(items),
        "scope_leakage": scope_leakage(items),
        "source_supported_answer_rate": source_supported_answer_rate(items),
        "unsupported_claim_rate": unsupported_claim_rate(items),
        "citation_integrity": citation_integrity(items),
        "citation_correctness": citation_correctness(items),
        "out_of_scope_abstention": abstention_rate(items),
    }
    out: dict[str, Any] = {k: v.as_dict() for k, v in metrics.items()}
    for name, (op, target) in TARGETS.items():
        v = metrics[name].value
        out[name]["target"] = f"{op} {target}"
        out[name]["meets_target"] = None if v is None else (v >= target if op == ">=" else v <= target)
    if thresholds:
        out["threshold_sweep"] = threshold_sweep(items, thresholds)
    return out
