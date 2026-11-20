from knot_rag.config import LLMSettings
from knot_rag.errors import ConfigurationError
from knot_rag.generation.providers.base import (
    LLMProvider,
    LLMRequest,
    LLMResponse,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitError,
    ProviderResponseError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)
from knot_rag.generation.providers.mock import ExtractiveBaselineProvider, ScriptedProvider
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.generation.providers.policy import (
    BudgetGuardProvider,
    ExternalCallsNotApproved,
    ProviderBudgetExceeded,
    check_external_approval,
    is_local_endpoint,
)


def build_provider(settings: LLMSettings) -> LLMProvider:
    if settings.provider == "openai_compatible":
        local = is_local_endpoint(settings.base_url)
        if not local:
            check_external_approval(settings)  # before anything is constructed or sent
        try:
            provider: LLMProvider = OpenAICompatibleProvider(settings.base_url, settings.model, settings.api_key)
        except ValueError as exc:
            raise ConfigurationError(str(exc)) from exc
        if local:
            return provider
        return BudgetGuardProvider(
            provider, settings.budget_usd, settings.price_input_per_mtok, settings.price_output_per_mtok  # type: ignore[arg-type]
        )
    if settings.provider in ("extractive", "extractive_baseline", "mock"):
        return ExtractiveBaselineProvider()
    raise ConfigurationError(f"Unknown LLM_PROVIDER: {settings.provider!r}")


__all__ = [
    "BudgetGuardProvider", "ExternalCallsNotApproved", "ProviderBudgetExceeded",
    "check_external_approval", "is_local_endpoint",
    "ExtractiveBaselineProvider", "LLMProvider", "LLMRequest", "LLMResponse",
    "OpenAICompatibleProvider", "ProviderAuthError", "ProviderError", "ProviderRateLimitError",
    "ProviderResponseError", "ProviderTimeoutError", "ProviderUnavailableError",
    "ScriptedProvider", "build_provider",
]
