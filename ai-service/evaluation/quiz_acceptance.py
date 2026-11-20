"""Measure how often the quiz pipeline accepts a source that clearly states its fact.

Run it against the local model you plan to use (needs UNIFIED_LLM_BASE_URL / UNIFIED_LLM_MODEL):

    python evaluation/quiz_acceptance.py [--language tr] [--min-accept 0.7] [--out report.json]

Every case in evaluation/data/quiz_acceptance_set.json states its fact explicitly, so a rejection is
a pipeline miss worth reading, not a bad source. The command prints one line per case with the
rejection reason and exits with 1 when the accepted share is below --min-accept.
"""

import argparse
import json
import sys
import time
from pathlib import Path

DATA = Path(__file__).with_name("data") / "quiz_acceptance_set.json"
KINDS = {"MULTIPLE_CHOICE", "TRUE_FALSE", "CLOZE", "SHORT_ANSWER", "OPEN"}


def load_cases(path=DATA):
    cases = json.loads(Path(path).read_text(encoding="utf-8"))["cases"]
    ids = [c["id"] for c in cases]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate case id")
    for c in cases:
        if c["kind"] not in KINDS or not c["text"].strip() or not c["topic"].strip():
            raise ValueError(f"invalid case {c['id']}")
    return cases


def classify(run_quiz, case, language):
    """ACCEPTED | REJECTED (pipeline refused a stated fact) | UNAVAILABLE (model not reachable)."""
    started = time.monotonic()
    try:
        result = run_quiz(case, language)
        ok = isinstance(result, dict) and result.get("question") and result.get("quote") and result["quote"] in case["text"]
        outcome, reason = ("ACCEPTED", "") if ok else ("REJECTED", "quote is not from the source")
    except Exception as exc:  # HTTPException from the pipeline, or provider errors
        status = getattr(exc, "status_code", None)
        detail = str(getattr(exc, "detail", exc))[:160]
        outcome = "UNAVAILABLE" if status == 503 else "REJECTED"
        reason = detail
    return {"id": case["id"], "kind": case["kind"], "topic": case["topic"], "outcome": outcome,
            "reason": reason, "seconds": round(time.monotonic() - started, 1)}


def evaluate(cases, run_quiz, language="tr"):
    rows = [classify(run_quiz, c, language) for c in cases]
    usable = [r for r in rows if r["outcome"] != "UNAVAILABLE"]
    accepted = sum(1 for r in usable if r["outcome"] == "ACCEPTED")
    return {
        "cases": len(rows),
        "accepted": accepted,
        "rejected": len(usable) - accepted,
        "unavailable": len(rows) - len(usable),
        "accept_rate": round(accepted / len(usable), 2) if usable else None,
        "rows": rows,
    }


def real_quiz(case, language):
    from knot_rag.quiz_quality import quiz
    from knot_rag.unified import QuizDraft

    return quiz(QuizDraft(question=case["topic"], kind=case["kind"], evidence=[{"text": case["text"]}], language=language))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--language", default="tr", choices=["tr", "en"])
    parser.add_argument("--min-accept", type=float, default=0.7)
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    report = evaluate(load_cases(), real_quiz, args.language)
    for r in report["rows"]:
        print(f"{r['outcome']:<11} {r['id']:<20} {r['kind']:<16} {r['seconds']:>5}s  {r['reason']}")
    print(f"\naccepted {report['accepted']}/{report['cases'] - report['unavailable']}"
          f" (rate {report['accept_rate']}), unavailable {report['unavailable']}")
    if args.out:
        Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if report["unavailable"] == report["cases"]:
        print("The local model did not answer; set UNIFIED_LLM_BASE_URL and UNIFIED_LLM_MODEL.")
        return 2
    return 0 if (report["accept_rate"] or 0) >= args.min_accept else 1


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    sys.exit(main())
