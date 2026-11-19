"""The v2 bench itself: case selection, counting, speed fit and exit codes, with a scripted model."""

import importlib.util
import json
import re
from pathlib import Path

import pytest

from knot_rag.generation.providers.base import LLMResponse, ProviderUnavailableError

SPEC = importlib.util.spec_from_file_location("quiz_bench", Path(__file__).resolve().parents[2] / "evaluation" / "quiz_bench.py")
qb = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(qb)


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


class GoodModel:
    """Writes a valid question of the requested kind from the first source sentence. Each call advances the
    clock as a model with 2 s overhead, 50 prompt tok/s and 8 output tok/s would."""

    def __init__(self, clock, output_tokens=120, broken=False):
        self.clock, self.output_tokens, self.broken, self.calls = clock, output_tokens, broken, 0

    def complete(self, request):
        self.calls += 1
        fields = request.response_schema["properties"]["questions"]["items"]["properties"]
        count = request.response_schema["properties"]["questions"]["minItems"]
        text = json.loads(request.user)["sources"][0]["text"]
        # The engine numbers the source sentences ("[1] … [2] …") and expects the number back.
        numbered = re.match(r"\[(\d+)\] (.+?)(?= \[\d+\] |$)", text, re.S)
        quote = numbered.group(2) if numbered else re.match(r".+?[.!?](?=\s|$)", text, re.S).group(0)
        ref = {"quote_id": int(numbered.group(1))} if "quote_id" in fields and numbered else {"quote": quote}
        word = next(w for w in re.findall(r"\w+", quote)
                    if len(w) >= 5 and not w.isdigit()
                    and len(re.findall(r"(?<!\w)" + re.escape(w) + r"(?!\w)", quote)) == 1)
        explanation = "Kaynak cümle bu cevabı doğrudan destekler."
        if "expression" in fields:
            draft = {**ref, "question": "Bir araç 120 km yolu 2 saatte alıyor. Sonuç kaçtır?",
                     "expression": "120 / 2", "answer": "60", "explanation": explanation}
        elif "statement" in fields:
            draft = {**ref, "statement": quote, "is_true": True, "explanation": explanation}
        elif "options" in fields:
            answer = "Bambaşka bir şey" if self.broken else word
            draft = {**ref, "question": "Kaynakta anlatılan kavram hangisidir?", "answer": answer,
                     "options": [word, "Alfa yapısı", "Beta yapısı", "Gama yapısı"], "explanation": explanation}
        elif "answer" in fields and "question" in fields:
            draft = {**ref, "question": "Kaynakta anlatılan kavram nedir, kısaca yazınız?", "answer": word,
                     "explanation": explanation}
        elif "question" in fields:
            draft = {**ref, "question": "Kaynaktaki fikri kendi cümlelerinle açıklayınız.",
                     "explanation": explanation}
        else:
            draft = {**ref, "answer": word, "explanation": explanation}
        input_tokens = (len(request.system) + len(request.user)) // 3
        self.clock.now += 2 + input_tokens / 50 + self.output_tokens / 8
        return LLMResponse(text=json.dumps({"questions": [draft] * count}, ensure_ascii=False),
                           input_tokens=input_tokens, output_tokens=self.output_tokens)


class VariedModel(GoodModel):
    """Varies output length so the speed fit has independent inputs."""

    def complete(self, request):
        self.output_tokens = 60 + (self.calls * 37) % 150
        return super().complete(request)


def test_data_files_are_valid():
    text, calc = qb.load_cases()
    assert len(text) >= 10 and len(calc) >= 5
    assert all(c["text"].strip() for c in calc)


def test_selection_prefers_cases_labelled_with_the_kind():
    text, calc = qb.load_cases()
    picked = qb.select(text, calc, ["TF", "CLOZE", "CALC"], 3)
    tf = [c for label, c in picked if label == "TF"]
    assert [c["kind"] for c in tf[:2]] == ["TRUE_FALSE", "TRUE_FALSE"] and len(tf) == 3
    assert len([1 for label, _ in picked if label == "CLOZE"]) == 3  # no CLOZE cases: other texts are used
    assert [c["id"] for label, c in picked if label == "CALC"] == [c["id"] for c in calc[:3]]
    assert len(qb.select(text, calc, ["MC"], 0)) == len(text)


def test_full_run_with_a_good_model_passes_every_kind(tmp_path, capsys):
    clock = Clock()
    model = VariedModel(clock)
    out = tmp_path / "report.json"
    code = qb.main(["--cases", "2", "--out", str(out)], provider=model, clock=clock)
    assert code == 0
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["questions_requested"] == 12 and report["questions_passed"] == 12 and report["pass_rate"] == 1.0
    assert set(report["by_kind"]) == {"MC", "TF", "CLOZE", "SA", "OPEN", "CALC"}
    assert report["failure_codes"] == {} and report["first_try"] == 12
    assert len(report["calls"]) == model.calls == 12
    printed = capsys.readouterr().out
    assert "passed 12/12" in printed and "QUIZ_DECODE_TPS=" in printed


def test_speed_fit_recovers_the_model_speed():
    clock = Clock()
    meter = qb.Meter(VariedModel(clock), clock)
    for label, case in qb.select(*qb.load_cases(), ["MC", "OPEN", "CLOZE"], 0):
        qb.run_case(label, case, meter, questions=1, batch=1, budget=130, language="tr", clock=clock)
    fit = qb.fit_speed(meter.calls)
    assert fit and abs(fit["decode_tps"] - 8) < 0.5 and abs(fit["prefill_tps"] - 50) < 5
    assert abs(fit["overhead_seconds"] - 2) < 1


def test_speed_fit_needs_usable_calls():
    assert qb.fit_speed([]) is None
    no_usage = [{"input_tokens": None, "output_tokens": None, "seconds": 3, "error": None}] * 6
    assert qb.fit_speed(no_usage) is None


def test_batched_questions_share_one_call():
    clock = Clock()
    model = GoodModel(clock)
    meter = qb.Meter(model, clock)
    text, calc = qb.load_cases()
    row = qb.run_case("MC", text[0], meter, questions=3, batch=3, budget=240, language="tr", clock=clock)
    # Identical drafts: the first passes, the two copies are refused as repeats and repaired (still copies).
    assert row["requested"] == 3 and row["first_try"] == 1
    assert [f["code"] for f in row["failures"]] == ["DUPLICATE_STEM", "DUPLICATE_STEM"]
    assert meter.calls[0]["max_output_tokens"] > 3 * 200


def test_failures_are_counted_by_reason_and_lower_the_exit_code(capsys):
    clock = Clock()
    code = qb.main(["--kinds", "MC", "--cases", "2"], provider=GoodModel(clock, broken=True), clock=clock)
    assert code == 1
    printed = capsys.readouterr().out
    assert "ANSWER_NOT_IN_OPTIONS×2" in printed and "passed 0/2" in printed


def test_an_unreachable_model_is_reported_separately():
    class Down:
        def complete(self, request):
            raise ProviderUnavailableError("refused")

    clock = Clock()
    meter = qb.Meter(Down(), clock)
    text, _ = qb.load_cases()
    row = qb.run_case("OPEN", text[0], meter, questions=2, batch=1, budget=130, language="tr", clock=clock)
    assert row["unavailable"] and {f["code"] for f in row["failures"]} == {"MODEL_UNREACHABLE"}
    assert meter.calls[0]["error"] == "ProviderUnavailableError"
    assert qb.main(["--kinds", "OPEN", "--cases", "1"], provider=Down(), clock=clock) == 2


def test_without_a_configured_local_model_it_says_so(monkeypatch, capsys):
    for name in ("QUIZ_LLM_BASE_URL", "QUIZ_LLM_MODEL", "UNIFIED_LLM_BASE_URL", "UNIFIED_LLM_MODEL"):
        monkeypatch.delenv(name, raising=False)
    assert qb.main(["--cases", "1"]) == 2
    assert "No local quiz model" in capsys.readouterr().out


@pytest.mark.parametrize("args", [["--kinds", "MC,ESSAY"], ["--questions", "0"]])
def test_bad_arguments_are_refused(args):
    with pytest.raises(SystemExit):
        qb.main(args, provider=GoodModel(Clock()))


def test_percentile():
    assert qb.percentile([], 50) is None
    assert qb.percentile([5, 1, 3], 50) == 3 and qb.percentile([1, 2, 3, 4], 95) == 4
