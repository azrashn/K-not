"""Measure the v2 quiz engine (quiz_engine.py) against the real local model.

How many questions were requested, how many passed (first try / after the one repair), and why the
rest failed (failure code counts), with time per request and the model's measured speed.

Run from ai-service with the model you plan to use (QUIZ_LLM_* or UNIFIED_LLM_*, local only):

    python evaluation/quiz_bench.py                                  # 3 cases of every kind, 1 question each
    python evaluation/quiz_bench.py --kinds MC,CALC --cases 0        # every case of these kinds
    python evaluation/quiz_bench.py --questions 3 --batch 1 --out b1.json
    python evaluation/quiz_bench.py --questions 3 --batch 3 --out b3.json   # compare batching

Kinds: MC, TF, CLOZE, SA, OPEN, CALC. Text cases come from data/quiz_acceptance_set.json (cases labelled
with the kind first, then the others as source text); CALC cases from data/quiz_bench_calculation.json.
The time budget per request and the start-or-skip estimate use QUIZ_DECODE_TPS / QUIZ_PREFILL_TPS like
production; the report suggests values for them from the measured calls.

Nothing is stored and no application data is touched. Exit code: 0 pass rate >= --min-pass,
1 below it, 2 the model never answered.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

DATA = Path(__file__).with_name("data")
ACCEPTANCE = DATA / "quiz_acceptance_set.json"
CALCULATION = DATA / "quiz_bench_calculation.json"
KINDS = {
    "MC": ("MULTIPLE_CHOICE", None),
    "TF": ("TRUE_FALSE", None),
    "CLOZE": ("CLOZE", None),
    "SA": ("SHORT_ANSWER", None),
    "OPEN": ("OPEN", None),
    "CALC": ("SHORT_ANSWER", "CALCULATION"),
}
SINGLE_BUDGET, BATCH_BUDGET = 130.0, 240.0  # the backend's POST /quizzes and exam budgets


def load_cases(acceptance=ACCEPTANCE, calculation=CALCULATION):
    text = json.loads(Path(acceptance).read_text(encoding="utf-8"))["cases"]
    calc = json.loads(Path(calculation).read_text(encoding="utf-8"))["cases"]
    ids = [c["id"] for c in text + calc]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate case id")
    for c in text + calc:
        if not c["text"].strip() or not c["topic"].strip():
            raise ValueError(f"invalid case {c['id']}")
    return text, calc


def select(text_cases, calc_cases, kinds, per_kind):
    """[(label, case)]: per kind, cases labelled with that kind first, then the rest. per_kind 0 = all."""
    plan = []
    for label in kinds:
        if label == "CALC":
            pool = list(calc_cases)
        else:
            kind = KINDS[label][0]
            pool = [c for c in text_cases if c.get("kind") == kind] + [c for c in text_cases if c.get("kind") != kind]
        plan += [(label, c) for c in (pool if per_kind == 0 else pool[:per_kind])]
    return plan


class Meter:
    """Wraps a provider and records every call: seconds, tokens, prompt size and how it ended."""

    def __init__(self, inner, clock=time.monotonic):
        self.inner, self.clock, self.calls = inner, clock, []

    def complete(self, request):
        started = self.clock()
        row = {"prompt_chars": len(request.system) + len(request.user), "max_output_tokens": request.max_output_tokens,
               "input_tokens": None, "output_tokens": None, "error": None}
        try:
            response = self.inner.complete(request)
            row["input_tokens"], row["output_tokens"] = response.input_tokens, response.output_tokens
            return response
        except Exception as exc:
            row["error"] = type(exc).__name__
            raise
        finally:
            row["seconds"] = round(self.clock() - started, 2)
            self.calls.append(row)


def run_case(label, case, provider, *, questions, batch, budget, language, clock=time.monotonic):
    from fastapi import HTTPException
    from knot_rag import quiz_engine as qe

    kind, variant = KINDS[label]
    item = {"kind": kind, **({"variant": variant} if variant else {})}
    req = qe.QuizRequest(topic=case["topic"], evidence=[{"text": case["text"]}], items=[item] * questions,
                         language=language, budget_seconds=budget)
    started = clock()
    row = {"id": case["id"], "kind": label, "topic": case["topic"], "requested": questions,
           "first_try": 0, "repaired": 0, "failures": [], "unavailable": False}
    try:
        out = qe.generate(req, provider, max_batch=batch, clock=clock)
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": str(exc.detail)}
        row["unavailable"] = exc.status_code == 503
        code = detail.get("code", f"HTTP_{exc.status_code}")
        row["failures"] = [{"code": code, "attempts": 0} for _ in range(questions)]
    else:
        for q in out["questions"]:
            if q["quote"] not in case["text"]:  # the engine guarantees this; the bench double-checks
                row["failures"].append({"code": "BENCH_QUOTE_MISMATCH", "attempts": q["quality"]["attempts"]})
            elif q["quality"]["attempts"] == 1:
                row["first_try"] += 1
            else:
                row["repaired"] += 1
        row["failures"] += [{"code": f["code"], "attempts": f["attempts"]} for f in out["failures"]]
    row["passed"] = row["first_try"] + row["repaired"]
    row["seconds"] = round(clock() - started, 1)
    return row


def fit_speed(calls):
    """Least squares: seconds = overhead + input_tokens/prefill_tps + output_tokens/decode_tps.
    None when there are too few usable calls or the fit is not physical (non-positive rates)."""
    rows = [(1.0, c["input_tokens"], c["output_tokens"], c["seconds"]) for c in calls
            if not c["error"] and c["input_tokens"] and c["output_tokens"] and c["seconds"] > 0]
    if len(rows) < 4:
        return None
    # normal equations A^T A x = A^T y, solved by Gaussian elimination (3x3)
    m = [[sum(r[i] * r[j] for r in rows) for j in range(3)] + [sum(r[i] * r[3] for r in rows)] for i in range(3)]
    for col in range(3):
        pivot = max(range(col, 3), key=lambda r: abs(m[r][col]))
        if abs(m[pivot][col]) < 1e-12:
            return None
        m[col], m[pivot] = m[pivot], m[col]
        for r in range(3):
            if r != col:
                f = m[r][col] / m[col][col]
                m[r] = [a - f * b for a, b in zip(m[r], m[col])]
    overhead, per_in, per_out = (m[i][3] / m[i][i] for i in range(3))
    if per_in <= 0 or per_out <= 0:
        return None
    return {"overhead_seconds": round(overhead, 1), "prefill_tps": round(1 / per_in, 1),
            "decode_tps": round(1 / per_out, 1), "calls_used": len(rows)}


def percentile(values, p):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, round(p / 100 * (len(ordered) - 1))))]


def summarize(rows, calls):
    usable = [r for r in rows if not r["unavailable"]]
    requested = sum(r["requested"] for r in usable)
    passed = sum(r["passed"] for r in usable)
    by_kind = {}
    for label in dict.fromkeys(r["kind"] for r in rows):
        mine = [r for r in usable if r["kind"] == label]
        by_kind[label] = {
            "requested": sum(r["requested"] for r in mine),
            "first_try": sum(r["first_try"] for r in mine),
            "repaired": sum(r["repaired"] for r in mine),
            "failed": sum(len(r["failures"]) for r in mine),
            "failure_codes": dict(Counter(f["code"] for r in mine for f in r["failures"]).most_common()),
            "seconds_p50": percentile([r["seconds"] for r in mine], 50),
        }
    seconds = [r["seconds"] for r in usable]
    ok_calls = [c for c in calls if not c["error"]]
    out_tokens = sum(c["output_tokens"] or 0 for c in ok_calls)
    return {
        "requests": len(rows),
        "unavailable_requests": len(rows) - len(usable),
        "questions_requested": requested,
        "questions_passed": passed,
        "first_try": sum(r["first_try"] for r in usable),
        "repaired": sum(r["repaired"] for r in usable),
        "pass_rate": round(passed / requested, 2) if requested else None,
        "failure_codes": dict(Counter(f["code"] for r in usable for f in r["failures"]).most_common()),
        "by_kind": by_kind,
        "seconds_per_request": {"p50": percentile(seconds, 50), "p95": percentile(seconds, 95),
                                "max": max(seconds) if seconds else None},
        "model_calls": {"total": len(calls), "errors": dict(Counter(c["error"] for c in calls if c["error"])),
                        "output_tokens_per_second_overall":
                            round(out_tokens / sum(c["seconds"] for c in ok_calls), 1) if ok_calls and out_tokens else None,
                        "token_usage_reported": any(c["output_tokens"] for c in ok_calls)},
        "speed_fit": fit_speed(calls),
        "rows": rows,
    }


def print_report(report, settings):
    print(f"\nquiz engine v2 bench: questions/request={settings['questions']} batch={settings['batch']} "
          f"budget={settings['budget']}s decode_tps={settings['decode_tps']} prefill_tps={settings['prefill_tps']}")
    print(f"{'kind':<6} {'asked':>5} {'1st':>4} {'fix':>4} {'fail':>5} {'p50 s':>7}  reasons")
    for label, k in report["by_kind"].items():
        reasons = ", ".join(f"{c}×{n}" for c, n in k["failure_codes"].items()) or "-"
        print(f"{label:<6} {k['requested']:>5} {k['first_try']:>4} {k['repaired']:>4} {k['failed']:>5} "
              f"{(k['seconds_p50'] if k['seconds_p50'] is not None else '-'):>7}  {reasons}")
    s = report["seconds_per_request"]
    print(f"\npassed {report['questions_passed']}/{report['questions_requested']} (rate {report['pass_rate']}; "
          f"first try {report['first_try']}, after repair {report['repaired']}); "
          f"unavailable requests {report['unavailable_requests']}")
    print(f"seconds per request p50 {s['p50']} p95 {s['p95']} max {s['max']}; model calls {report['model_calls']['total']}"
          + (f", errors {report['model_calls']['errors']}" if report["model_calls"]["errors"] else ""))
    fit = report["speed_fit"]
    if fit:
        print(f"measured speed: prefill ≈ {fit['prefill_tps']} tok/s, decode ≈ {fit['decode_tps']} tok/s, "
              f"overhead ≈ {fit['overhead_seconds']} s ({fit['calls_used']} calls) → "
              f"QUIZ_PREFILL_TPS={fit['prefill_tps']} QUIZ_DECODE_TPS={fit['decode_tps']}")
    elif not report["model_calls"]["token_usage_reported"]:
        print("measured speed: the model server did not report token usage")
    else:
        print("measured speed: not enough varied calls for a fit (run more cases)")


def local_provider():
    import os
    import httpx
    from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
    from knot_rag.generation.providers.policy import is_local_endpoint

    url = os.environ.get("QUIZ_LLM_BASE_URL") or os.environ.get("UNIFIED_LLM_BASE_URL", "")
    model = os.environ.get("QUIZ_LLM_MODEL") or os.environ.get("UNIFIED_LLM_MODEL", "")
    if not url or not model or not is_local_endpoint(url):
        return None
    return OpenAICompatibleProvider(url, model, client=httpx.Client())


def main(argv=None, provider=None, clock=time.monotonic):
    from knot_rag import quiz_engine as qe

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--kinds", default="MC,TF,CLOZE,SA,OPEN,CALC")
    parser.add_argument("--cases", type=int, default=3, help="cases per kind; 0 = all")
    parser.add_argument("--questions", type=int, default=1, help="questions asked per request (1-12)")
    parser.add_argument("--batch", type=int, default=None, help="questions per model call (default QUIZ_MAX_BATCH)")
    parser.add_argument("--budget", type=float, default=None, help="seconds per request (default 130, or 240 when --questions > 1)")
    parser.add_argument("--language", default="tr", choices=["tr", "en"])
    parser.add_argument("--min-pass", type=float, default=0.6)
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    kinds = [k.strip().upper() for k in args.kinds.split(",") if k.strip()]
    unknown = [k for k in kinds if k not in KINDS]
    if unknown or not 1 <= args.questions <= 12:
        parser.error(f"unknown kinds {unknown}; known: {', '.join(KINDS)}" if unknown else "--questions must be 1-12")
    batch = max(1, min(qe.MAX_BATCH, args.batch or qe.batch_size()))
    budget = args.budget or (SINGLE_BUDGET if args.questions == 1 else BATCH_BUDGET)
    provider = provider or local_provider()
    if provider is None:
        print("No local quiz model: set QUIZ_LLM_BASE_URL/QUIZ_LLM_MODEL or UNIFIED_LLM_BASE_URL/UNIFIED_LLM_MODEL "
              "to a loopback OpenAI-compatible endpoint.")
        return 2
    meter = Meter(provider, clock)
    text_cases, calc_cases = load_cases()
    rows = []
    for label, case in select(text_cases, calc_cases, kinds, args.cases):
        row = run_case(label, case, meter, questions=args.questions, batch=batch, budget=budget,
                       language=args.language, clock=clock)
        codes = ",".join(f["code"] for f in row["failures"]) or "-"
        print(f"{label:<6} {case['id']:<24} passed {row['passed']}/{row['requested']} {row['seconds']:>6}s  {codes}",
              flush=True)
        rows.append(row)
    speed = qe.Speed.from_env()
    settings = {"questions": args.questions, "batch": batch, "budget": budget, "language": args.language,
                "decode_tps": speed.decode_tps, "prefill_tps": speed.prefill_tps, "kinds": kinds, "cases": args.cases}
    report = {"settings": settings, **summarize(rows, meter.calls), "calls": meter.calls}
    print_report(report, settings)
    if args.out:
        Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if report["unavailable_requests"] == report["requests"]:
        print("The local model did not answer.")
        return 2
    return 0 if (report["pass_rate"] or 0) >= args.min_pass else 1


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    sys.exit(main())
