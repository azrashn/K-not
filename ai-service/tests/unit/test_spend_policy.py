"""Default-deny policy for external LLM calls and the hard budget cap (no network is used)."""

from dataclasses import replace

import pytest

from knot_rag.config import LLMSettings, Settings
from knot_rag.errors import ConfigurationError, GenerationFailed
from knot_rag.generation.generator import GroundedGenerator
from knot_rag.generation.providers import (
    BudgetGuardProvider,
    ExternalCallsNotApproved,
    OpenAICompatibleProvider,
    ProviderBudgetExceeded,
    ScriptedProvider,
    build_provider,
    is_local_endpoint,
)
from knot_rag.generation.providers.base import LLMRequest, LLMResponse

EXTERNAL = LLMSettings(provider="openai_compatible", base_url="https://api.example.com/v1", model="m", api_key="k")
OK = '{"status": "insufficient", "claims": [], "missing": ["x"]}'


def test_default_settings_are_zero_budget_and_no_external_calls():
    s = Settings.from_env({"RAG_AUTH_DISABLED": "true"})
    assert s.llm.allow_external is False and s.llm.budget_usd == 0.0
    assert s.llm.provider == "mock"


@pytest.mark.parametrize("override", [
    {},  # nothing approved
    {"allow_external": True},  # no budget
    {"allow_external": True, "budget_usd": 5.0},  # no prices
    {"budget_usd": 5.0, "price_input_per_mtok": 1.0, "price_output_per_mtok": 1.0},  # transmission not approved
])
def test_external_endpoint_is_refused_before_construction(override):
    with pytest.raises(ExternalCallsNotApproved):
        build_provider(replace(EXTERNAL, **override))


def test_refusal_names_every_missing_approval():
    with pytest.raises(ExternalCallsNotApproved) as e:
        build_provider(EXTERNAL)
    msg = str(e.value)
    assert "LLM_ALLOW_EXTERNAL=true" in msg and "LLM_BUDGET_USD > 0" in msg and "LLM_PRICE_INPUT_PER_MTOK" in msg


def test_refused_provider_stops_service_start_up():
    s = Settings.from_env({"RAG_AUTH_DISABLED": "true", "LLM_PROVIDER": "openai_compatible",
                           "LLM_BASE_URL": "https://api.example.com/v1", "LLM_MODEL": "m"})
    from knot_rag.bootstrap import build_components

    with pytest.raises(ConfigurationError):
        build_components(s, index=object(), embedder=object())


@pytest.mark.parametrize("url,local", [
    ("http://localhost:11434/v1", True), ("http://127.0.0.1:8080/v1", True), ("http://[::1]:8000/v1", True),
    ("https://api.example.com/v1", False), ("http://10.0.0.5/v1", False), ("http://localhost.evil.com/v1", False),
])
def test_only_loopback_counts_as_local(url, local):
    assert is_local_endpoint(url) is local


def test_local_endpoint_needs_no_budget_and_is_not_wrapped():
    p = build_provider(replace(EXTERNAL, base_url="http://127.0.0.1:11434/v1"))
    assert isinstance(p, OpenAICompatibleProvider)


def test_approved_external_provider_is_budget_guarded():
    p = build_provider(replace(EXTERNAL, allow_external=True, budget_usd=1.0, price_input_per_mtok=2.0, price_output_per_mtok=10.0))
    assert isinstance(p, BudgetGuardProvider) and p.spent_usd == 0.0


def req(chars=2000, out=1000):
    return LLMRequest(system="s" * 0, user="x" * chars, max_output_tokens=out)


def test_budget_guard_blocks_a_call_whose_worst_case_exceeds_the_cap():
    inner = ScriptedProvider([AssertionError("must not be called")])
    g = BudgetGuardProvider(inner, budget_usd=0.01, price_input_per_mtok=2.0, price_output_per_mtok=10.0)
    # worst case: 2000/2=1000 input tokens * $2 + 1000 output * $10 = $0.012 > $0.01
    with pytest.raises(ProviderBudgetExceeded):
        g.complete(req())
    assert inner.requests == [] and g.spent_usd == 0.0


def test_budget_guard_settles_to_reported_usage_and_stops_at_the_cap():
    class Reporting:
        name, model = "x", "y"

        def complete(self, r):
            return LLMResponse(text=OK, input_tokens=1000, output_tokens=100)  # $0.002 + $0.001

    g = BudgetGuardProvider(Reporting(), budget_usd=0.02, price_input_per_mtok=2.0, price_output_per_mtok=10.0)
    for _ in range(3):
        g.complete(req())
    assert g.spent_usd == pytest.approx(0.009)
    # worst case per call is $0.012: the fourth would allow 0.009+0.012 > 0.02
    with pytest.raises(ProviderBudgetExceeded):
        g.complete(req())


def test_unknown_usage_is_charged_at_worst_case():
    g = BudgetGuardProvider(ScriptedProvider([OK]), budget_usd=1.0, price_input_per_mtok=2.0, price_output_per_mtok=10.0)
    g.complete(req())
    assert g.spent_usd == pytest.approx(0.012)


def test_budget_exhaustion_is_a_safe_generation_failure_not_a_retry_loop():
    inner = ScriptedProvider([AssertionError("must not be called")])
    g = BudgetGuardProvider(inner, budget_usd=0.0001, price_input_per_mtok=2.0, price_output_per_mtok=10.0)
    gen = GroundedGenerator(g, LLMSettings(max_attempts=3))
    with pytest.raises(GenerationFailed) as e:
        gen.generate("soru", "c", [])
    assert e.value.details == {"reason": "ProviderBudgetExceeded"} and inner.requests == []


def test_judge_cannot_be_the_generator():
    s = Settings.from_env({"RAG_AUTH_DISABLED": "true", "SUPPORT_JUDGE": "llm"})
    from knot_rag.bootstrap import build_components

    with pytest.raises(ConfigurationError, match="cannot verify its own claims"):
        build_components(s, index=object(), embedder=object(), provider=ScriptedProvider([OK]))


def test_evaluation_runner_defaults_to_the_offline_provider(monkeypatch):
    import argparse

    from knot_rag.evaluation import runner

    seen = {}
    parse = argparse.ArgumentParser.parse_args

    def stop_after_parsing(self, argv=None, namespace=None):
        seen.update(vars(parse(self, ["--dataset", "d.json"])))
        raise SystemExit(0)

    monkeypatch.setattr(argparse.ArgumentParser, "parse_args", stop_after_parsing)
    with pytest.raises(SystemExit):
        runner.main([])
    assert seen["provider"] == "extractive"
