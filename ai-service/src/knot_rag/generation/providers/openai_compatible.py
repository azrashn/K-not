"""Adapter for any OpenAI-compatible `/chat/completions` endpoint: OpenAI, Azure-style
gateways, OpenRouter, Groq, vLLM, LM Studio, or a free local Ollama (`/v1`). The vendor is
chosen purely by configuration (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`)."""

from __future__ import annotations

import httpx

from knot_rag.generation.providers.base import (
    LLMRequest,
    LLMResponse,
    ProviderAuthError,
    ProviderError,
    ProviderRateLimitError,
    ProviderResponseError,
    ProviderTimeoutError,
    ProviderUnavailableError,
)


class OpenAICompatibleProvider:
    def __init__(self, base_url: str, model: str, api_key: str = "", client: httpx.Client | None = None):
        if not base_url or not model:
            raise ValueError("OpenAI-compatible provider requires LLM_BASE_URL and LLM_MODEL")
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._model = model
        self._api_key = api_key
        self._client = client or httpx.Client()

    @property
    def name(self) -> str:
        return "openai_compatible"

    @property
    def model(self) -> str:
        return self._model

    def complete(self, request: LLMRequest) -> LLMResponse:
        body: dict = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.user},
            ],
            "temperature": request.temperature,
            "max_tokens": request.max_output_tokens,
        }
        if request.json_mode:
            body["response_format"] = {"type": "json_object"}
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        try:
            resp = self._client.post(self._url, json=body, headers=headers, timeout=request.timeout_seconds)
        except httpx.TimeoutException as exc:
            raise ProviderTimeoutError("provider timed out") from exc
        except httpx.TransportError as exc:
            raise ProviderUnavailableError("provider unreachable") from exc

        if resp.status_code in (401, 403):
            raise ProviderAuthError(f"provider rejected credentials ({resp.status_code})")
        if resp.status_code == 429:
            raise ProviderRateLimitError("provider rate limit")
        if resp.status_code >= 500:
            raise ProviderUnavailableError(f"provider error {resp.status_code}")
        if resp.status_code >= 400:
            raise ProviderError(f"provider rejected request ({resp.status_code})")
        try:
            data = resp.json()
            choice = data["choices"][0]
            text = choice["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ProviderResponseError("unexpected provider response shape") from exc
        finish = choice.get("finish_reason")
        if finish == "length":
            raise ProviderResponseError("provider output truncated (max tokens)")
        if not text.strip():
            raise ProviderResponseError("empty provider output")
        usage = data.get("usage") if isinstance(data, dict) else None
        usage = usage if isinstance(usage, dict) else {}
        return LLMResponse(
            text=text, finish_reason=finish,
            input_tokens=usage.get("prompt_tokens") if isinstance(usage.get("prompt_tokens"), int) else None,
            output_tokens=usage.get("completion_tokens") if isinstance(usage.get("completion_tokens"), int) else None,
        )
