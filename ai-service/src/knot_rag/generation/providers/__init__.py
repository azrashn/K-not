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


def build_provider(settings: LLMSettings) -> LLMProvider:
    if settings.provider == "openai_compatible":
        try:
            return OpenAICompatibleProvider(settings.base_url, settings.model, settings.api_key)
        except ValueError as exc:
            raise ConfigurationError(str(exc)) from exc
    if settings.provider in ("extractive", "extractive_baseline", "mock"):
        return ExtractiveBaselineProvider()
    raise ConfigurationError(f"Unknown LLM_PROVIDER: {settings.provider!r}")


__all__ = [
    "ExtractiveBaselineProvider", "LLMProvider", "LLMRequest", "LLMResponse",
    "OpenAICompatibleProvider", "ProviderAuthError", "ProviderError", "ProviderRateLimitError",
    "ProviderResponseError", "ProviderTimeoutError", "ProviderUnavailableError",
    "ScriptedProvider", "build_provider",
]
