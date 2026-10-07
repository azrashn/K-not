"""Structured grounded generation with schema validation and bounded retries."""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from knot_rag.config import LLMSettings
from knot_rag.errors import GenerationFailed, ProviderTimeout
from knot_rag.generation.prompts import PROMPT_VERSION, REPAIR_NOTE, SYSTEM_PROMPT, build_user_prompt
from knot_rag.generation.providers.base import (
    LLMProvider,
    LLMRequest,
    ProviderAuthError,
    ProviderError,
    ProviderResponseError,
    ProviderTimeoutError,
)
from knot_rag.schemas.retrieval import RetrievedEvidence

log = logging.getLogger(__name__)


class ModelClaim(BaseModel):
    model_config = ConfigDict(extra="ignore")

    text: str = Field(min_length=1, max_length=1000)
    evidence_ids: list[str] = Field(default_factory=list, max_length=10)
    quote: str | None = Field(default=None, max_length=1000)
    support: Literal["full", "partial"] = "full"


class ModelAnswer(BaseModel):
    """What the model is allowed to return. Anything else is a generation failure."""

    model_config = ConfigDict(extra="ignore")

    status: Literal["answered", "partial", "insufficient"]
    claims: list[ModelClaim] = Field(default_factory=list, max_length=12)
    missing: list[str] = Field(default_factory=list, max_length=10)


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def parse_json_object(text: str) -> dict:
    """Extract one JSON object from model output; tolerate code fences and surrounding prose."""
    raw = _FENCE.sub("", text.strip())
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("no JSON object in model output")
    data = json.loads(raw[start:end + 1])
    if not isinstance(data, dict):
        raise ValueError("model output is not a JSON object")
    return data


def parse_model_answer(text: str) -> ModelAnswer:
    """Strict parse into the answer schema."""
    answer = ModelAnswer.model_validate(parse_json_object(text))
    answer.missing = [m.strip()[:500] for m in answer.missing if isinstance(m, str) and m.strip()]
    return answer


@dataclass(frozen=True)
class GenerationOutput:
    answer: ModelAnswer
    provider: str
    model: str
    attempts: int
    latency_ms: int
    prompt_version: str = PROMPT_VERSION


class GroundedGenerator:
    def __init__(self, provider: LLMProvider, settings: LLMSettings):
        self._p = provider
        self._s = settings

    @property
    def provider(self) -> LLMProvider:
        return self._p

    def generate(self, question: str, course_id: str, evidence: list[RetrievedEvidence]) -> GenerationOutput:
        user = build_user_prompt(question, course_id, evidence)
        started = time.monotonic()
        last_error: Exception | None = None
        needs_repair = False
        for attempt in range(1, self._s.max_attempts + 1):
            req = LLMRequest(
                system=SYSTEM_PROMPT,
                user=user + REPAIR_NOTE if needs_repair else user,
                temperature=self._s.temperature,
                max_output_tokens=self._s.max_output_tokens,
                json_mode=self._s.json_mode,
                timeout_seconds=self._s.timeout_seconds,
            )
            try:
                resp = self._p.complete(req)
                answer = parse_model_answer(resp.text)
            except ProviderTimeoutError as exc:
                # Not retried: a second attempt would double the user's wait.
                raise ProviderTimeout() from exc
            except ProviderAuthError as exc:
                log.error("rag.provider.auth_failed", extra={"provider": self._p.name})
                raise GenerationFailed(details={"reason": "provider_auth"}, retryable=False) from exc
            except (ProviderResponseError, ValueError, ValidationError) as exc:
                last_error = exc
                needs_repair = not isinstance(exc, ProviderResponseError)
                log.warning("rag.generation.invalid_output", extra={"attempt": attempt, "error_type": type(exc).__name__})
                continue
            except ProviderError as exc:
                last_error = exc
                log.warning("rag.provider.error", extra={"attempt": attempt, "error_type": type(exc).__name__})
                if not exc.retryable:
                    break
                continue
            return GenerationOutput(
                answer=answer,
                provider=self._p.name,
                model=self._p.model,
                attempts=attempt,
                latency_ms=int((time.monotonic() - started) * 1000),
            )
        raise GenerationFailed(details={"reason": type(last_error).__name__ if last_error else "unknown"})
