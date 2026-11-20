"""External-call and spend policy for LLM providers.

Default: no request leaves the server and the budget is $0. A provider endpoint that is not a
loopback address (i.e. a third-party API that would receive course evidence and may bill) is
only built when ALL of these are configured explicitly:

  LLM_ALLOW_EXTERNAL=true        transmission of evidence to that provider is approved
  LLM_BUDGET_USD > 0             hard spending cap for this process
  LLM_PRICE_INPUT_PER_MTOK / LLM_PRICE_OUTPUT_PER_MTOK   prices used to account spend

Otherwise construction fails with `ExternalCallsNotApproved` (service start-up and the
evaluation runner stop before any request). An approved provider is wrapped in
`BudgetGuardProvider`, which refuses a call whose worst-case cost would exceed the remaining
budget, so the cap holds even if the provider reports no token usage.
"""

from __future__ import annotations

import ipaddress
import threading
from urllib.parse import urlsplit

from knot_rag.config import LLMSettings
from knot_rag.errors import ConfigurationError
from knot_rag.generation.providers.base import LLMProvider, LLMRequest, LLMResponse, ProviderError

# Conservative (over-)estimate of tokens per character for pre-flight cost checks: Turkish text
# tokenises densely, so count 1 token per 2 characters rather than the ~3–4 typical for English.
_CHARS_PER_TOKEN_ESTIMATE = 2.0


class ExternalCallsNotApproved(ConfigurationError):
    pass


class ProviderBudgetExceeded(ProviderError):
    """The call was not made: it could exceed the approved budget. Never retried."""


def is_local_endpoint(base_url: str) -> bool:
    host = urlsplit(base_url).hostname or ""
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def check_external_approval(settings: LLMSettings) -> None:
    missing = []
    if not settings.allow_external:
        missing.append("LLM_ALLOW_EXTERNAL=true")
    if settings.budget_usd <= 0:
        missing.append("LLM_BUDGET_USD > 0")
    if settings.price_input_per_mtok is None or settings.price_output_per_mtok is None:
        missing.append("LLM_PRICE_INPUT_PER_MTOK and LLM_PRICE_OUTPUT_PER_MTOK")
    if missing:
        raise ExternalCallsNotApproved(
            "External LLM calls are not approved (default budget is $0). Required: " + ", ".join(missing) + "."
        )


class BudgetGuardProvider:
    def __init__(self, inner: LLMProvider, budget_usd: float, price_input_per_mtok: float, price_output_per_mtok: float):
        self._inner = inner
        self._budget = budget_usd
        self._pin = price_input_per_mtok
        self._pout = price_output_per_mtok
        self._spent = 0.0
        self._lock = threading.Lock()

    @property
    def name(self) -> str:
        return self._inner.name

    @property
    def model(self) -> str:
        return self._inner.model

    @property
    def spent_usd(self) -> float:
        return self._spent

    def _cost(self, input_tokens: float, output_tokens: float) -> float:
        return (input_tokens * self._pin + output_tokens * self._pout) / 1_000_000

    def worst_case_cost(self, request: LLMRequest) -> float:
        chars = len(request.system) + len(request.user)
        return self._cost(chars / _CHARS_PER_TOKEN_ESTIMATE, request.max_output_tokens)

    def complete(self, request: LLMRequest) -> LLMResponse:
        worst = self.worst_case_cost(request)
        with self._lock:
            if self._spent + worst > self._budget:
                raise ProviderBudgetExceeded(
                    f"budget cap reached: spent ${self._spent:.4f} of ${self._budget:.2f}, next call up to ${worst:.4f}"
                )
            self._spent += worst  # reserve the worst case; settled below
        try:
            resp = self._inner.complete(request)
        except ProviderError:
            # A failed request may still have been billed; keep the reservation.
            raise
        if resp.input_tokens is not None and resp.output_tokens is not None:
            with self._lock:
                self._spent += self._cost(resp.input_tokens, resp.output_tokens) - worst
        return resp
