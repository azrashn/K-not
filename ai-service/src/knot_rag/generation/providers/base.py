"""Provider-independent LLM interface and error classification."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class LLMRequest:
    system: str
    user: str
    temperature: float = 0.0
    max_output_tokens: int = 1200
    json_mode: bool = True
    timeout_seconds: float = 30.0


@dataclass(frozen=True)
class LLMResponse:
    text: str
    finish_reason: str | None = None
    # Token usage as reported by the provider (None when unknown); used for spend accounting.
    input_tokens: int | None = None
    output_tokens: int | None = None


class ProviderError(Exception):
    """Base for provider failures. `retryable` says whether a new attempt could help."""

    retryable = False


class ProviderTimeoutError(ProviderError):
    retryable = True


class ProviderUnavailableError(ProviderError):
    retryable = True


class ProviderRateLimitError(ProviderError):
    retryable = True


class ProviderAuthError(ProviderError):
    pass


class ProviderResponseError(ProviderError):
    """The provider answered, but not with usable content (empty, refused, truncated)."""


class LLMProvider(Protocol):
    @property
    def name(self) -> str: ...

    @property
    def model(self) -> str: ...

    def complete(self, request: LLMRequest) -> LLMResponse: ...
