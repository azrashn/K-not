r"""Opt-in real Ollama before/after evaluation. Raw educational text stays ignored.

Run from ai-service: .venv\Scripts\python.exe ..\scripts\evaluate-quiz-quality.py
No paid endpoint, mock output, model download, or application data mutation.
"""

import importlib.util
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ai-service/src"))
from fastapi import HTTPException
from knot_rag.quiz_quality import quiz
from knot_rag.unified import QuizDraft
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider

OUT = ROOT / "data/quiz-evaluation"
OUT.mkdir(parents=True, exist_ok=True)
CASES = [
    {"id": "turkish-algorithms", "question": "BFS ve DFS arasındaki fark",
     "text": "BFS (genişlik öncelikli arama), düğümleri başlangıç düğümüne uzaklıklarına göre katman katman ziyaret eder. BFS, sırada bekleyen düğümleri tutmak için kuyruk kullanır. DFS (derinlik öncelikli arama), bir dal boyunca olabildiğince ilerler ve sonra geri döner. DFS, yığın veya özyineleme kullanır. Ağırlıksız bir grafta BFS, başlangıç düğümünden en az kenar sayısına sahip yolları bulur."},
    {"id": "turkish-biology", "question": "Fotosentezde klorofilin görevi",
     "text": "Fotosentez sırasında klorofil ışık enerjisini soğurur. Bitki, karbon dioksit ve suyu kullanarak glikoz üretir ve oksijen açığa çıkarır. Klorofil, yaprakların yeşil görünmesini sağlayan pigmenttir. Işık enerjisinin yakalanması fotosentezin başlaması için gereklidir."},
    {"id": "unsupported-topic", "question": "Fotosentezde klorofilin görevi",
     "text": "BFS, bekleyen düğümler için kuyruk kullanır. DFS, yığın veya özyineleme kullanır. Bu iki yöntem bir grafın düğümlerini ziyaret eder."},
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="qwen3-vl:2b-instruct")
    parser.add_argument("--only-current", action="store_true")
    parser.add_argument("--kind", default="MULTIPLE_CHOICE", choices=['MULTIPLE_CHOICE','TRUE_FALSE','CLOZE','SHORT_ANSWER','OPEN'])
    parser.add_argument("--case", choices=[c['id'] for c in CASES])
    args = parser.parse_args()
    os.environ["UNIFIED_LLM_BASE_URL"] = "http://127.0.0.1:11436/v1"
    os.environ["UNIFIED_LLM_MODEL"] = args.model
    os.environ["QUIZ_LLM_BASE_URL"] = os.environ["UNIFIED_LLM_BASE_URL"]
    os.environ["QUIZ_LLM_MODEL"] = args.model
    baseline_source = subprocess.check_output([
        "git", "show", "3b8241f:ai-service/src/knot_rag/quiz_quality.py"
    ], cwd=ROOT, text=True, encoding="utf-8")
    baseline_path = OUT / "baseline_quiz_quality.py"
    baseline_path.write_text(baseline_source, encoding="utf-8")
    spec = importlib.util.spec_from_file_location("baseline_quiz_quality", baseline_path)
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
    original = OpenAICompatibleProvider.complete
    report = {"baseline_commit": "3b8241f", "model": os.environ["UNIFIED_LLM_MODEL"], "runs": []}
    # Preserve every run, including rejected drafts, instead of overwriting failures.
    target = OUT / ("before-after-" + args.model.replace(":", "-") + "-" + str(time.time_ns()) + ".json")
    for label, generate in ([("planned", quiz)] if args.only_current else [("baseline", baseline.quiz), ("planned", quiz)]):
        for case in CASES:
            if args.case and case['id']!=args.case:continue
            calls = []

            def capture(self, request):
                response = original(self, request)
                calls.append({"stage": "plan" if request.system.startswith("Plan one") else
                              "review" if request.system.startswith("Independently solve") else
                              "feedback" if request.system.startswith("Audit and rewrite") else
                              "distractors" if request.system.startswith("Audit distractors") else
                              "term" if request.system.startswith("Select ONE") else "write",
                              "response": response.text})
                return response

            OpenAICompatibleProvider.complete = capture
            started = time.monotonic()
            run = {"pipeline": label, "case": case["id"], "kind":args.kind, "expected_abstention": case["id"] == "unsupported-topic"}
            try:
                result = generate(QuizDraft(question=case["question"], language="tr", kind=args.kind, evidence=[{"text": case["text"]}]))
                run.update(status=200, result=result, exact_quote=result["quote"] in case["text"])
            except HTTPException as error:
                run.update(status=error.status_code, detail=error.detail)
            finally:
                OpenAICompatibleProvider.complete = original
                run.update(seconds=round(time.monotonic() - started, 2), calls=calls)
                report["runs"].append(run)
                target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
                print(json.dumps({k: run[k] for k in ("pipeline", "case", "status", "seconds")}), flush=True)


if __name__ == "__main__":
    main()
