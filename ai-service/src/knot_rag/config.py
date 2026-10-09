"""Environment-based configuration. Read once at startup and passed down explicitly
(no module-level mutable settings)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Mapping

from knot_rag.errors import ConfigurationError


def _bool(v: str | None, default: bool) -> bool:
    if v is None or v == "":
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


def _opt_float(v: str | None) -> float | None:
    return None if v is None or v.strip() == "" else float(v)


@dataclass(frozen=True)
class RetrievalSettings:
    top_k: int = 8
    max_evidence: int = 6
    min_score: float | None = None  # Uncalibrated until measured; see docs/rag-evaluation.md
    max_context_tokens: int = 3000
    max_chunks_per_document: int = 4
    chars_per_token: float = 3.0  # Conservative for Turkish; used only for budgeting.
    # Hybrid retrieval: a lexical channel (exact question terms, IDF-weighted) fused with the
    # dense ranking by reciprocal rank fusion. Dense-only missed "git status" (rank 10–16 of 45).
    lexical_channel: bool = True
    lexical_pool: int = 50  # max candidates fetched per question term


@dataclass(frozen=True)
class SupportSettings:
    coverage_supported: float = 0.6
    coverage_partial: float = 0.3
    # Claim↔question relevance gate for SUPPORTED (calibrated on eval.v1, see rag-evaluation.md).
    question_relevance_min: float = 0.34
    relative_relevance_min: float = 0.6
    # Rule S8: claim content terms allowed to be absent from the cited evidence before SIKI is
    # withheld. 0 = every content term of a SIKI claim must occur in its sources (stem match).
    max_unsupported_terms: int = 0
    # Answer is ANSWERED only if cited evidence covers this share of the question's key terms.
    question_coverage_answered: float = 0.6
    # When true, SUPPORTED requires a semantic judge verdict; heuristic-only becomes PARTIALLY_SUPPORTED.
    require_semantic_confirmation: bool = False
    judge: str = "none"  # none | llm


@dataclass(frozen=True)
class LLMSettings:
    provider: str = "mock"
    model: str = ""
    base_url: str = ""
    api_key: str = field(default="", repr=False)
    timeout_seconds: float = 30.0
    temperature: float = 0.0
    max_output_tokens: int = 1200
    json_mode: bool = True
    max_attempts: int = 2
    # Spend/transmission policy (default: nothing leaves the server, $0). Calls to a non-loopback
    # endpoint need LLM_ALLOW_EXTERNAL=true, a budget > 0 and both prices; see providers/policy.py.
    allow_external: bool = False
    budget_usd: float = 0.0
    price_input_per_mtok: float | None = None
    price_output_per_mtok: float | None = None


@dataclass(frozen=True)
class Settings:
    internal_api_token: str = field(default="", repr=False)
    auth_disabled: bool = False
    chroma_mode: str = "http"  # http | persistent | memory
    chroma_host: str = "localhost"
    chroma_port: int = 8000
    chroma_path: str = "./.chroma"
    chroma_collection: str = "knot_chunks_v1"
    embedding_backend: str = "sentence_transformers"  # sentence_transformers | hashing
    embedding_model: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    embedding_query_prefix: str = ""
    embedding_document_prefix: str = ""  # used by the reference writer / seed tool (WBS-2 side)
    embedding_revision: str = ""  # pin a model commit for reproducibility; empty = latest
    log_questions: bool = False
    retrieval: RetrievalSettings = field(default_factory=RetrievalSettings)
    support: SupportSettings = field(default_factory=SupportSettings)
    llm: LLMSettings = field(default_factory=LLMSettings)

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        e = os.environ if env is None else env
        g = e.get
        try:
            s = cls(
                internal_api_token=g("RAG_INTERNAL_API_TOKEN", ""),
                auth_disabled=_bool(g("RAG_AUTH_DISABLED"), False),
                chroma_mode=g("CHROMA_MODE", "http"),
                chroma_host=g("CHROMA_HOST", "localhost"),
                chroma_port=int(g("CHROMA_PORT", "8000")),
                chroma_path=g("CHROMA_PATH", "./.chroma"),
                chroma_collection=g("CHROMA_COLLECTION", "knot_chunks_v1"),
                embedding_backend=g("EMBEDDING_BACKEND", "sentence_transformers"),
                embedding_model=g("EMBEDDING_MODEL", cls.embedding_model),
                embedding_query_prefix=g("EMBEDDING_QUERY_PREFIX", ""),
                embedding_document_prefix=g("EMBEDDING_DOCUMENT_PREFIX", ""),
                embedding_revision=g("EMBEDDING_REVISION", ""),
                log_questions=_bool(g("RAG_LOG_QUESTIONS"), False),
                retrieval=RetrievalSettings(
                    top_k=int(g("RAG_TOP_K", "8")),
                    max_evidence=int(g("RAG_MAX_EVIDENCE", "6")),
                    min_score=_opt_float(g("RAG_MIN_SCORE")),
                    max_context_tokens=int(g("RAG_MAX_CONTEXT_TOKENS", "3000")),
                    max_chunks_per_document=int(g("RAG_MAX_CHUNKS_PER_DOCUMENT", "4")),
                    chars_per_token=float(g("RAG_CHARS_PER_TOKEN", "3.0")),
                    lexical_channel=_bool(g("RAG_LEXICAL_CHANNEL"), True),
                    lexical_pool=int(g("RAG_LEXICAL_POOL", "50")),
                ),
                support=SupportSettings(
                    coverage_supported=float(g("SUPPORT_COVERAGE_SUPPORTED", "0.6")),
                    coverage_partial=float(g("SUPPORT_COVERAGE_PARTIAL", "0.3")),
                    question_relevance_min=float(g("SUPPORT_QUESTION_RELEVANCE_MIN", "0.34")),
                    relative_relevance_min=float(g("SUPPORT_RELATIVE_RELEVANCE_MIN", "0.6")),
                    max_unsupported_terms=int(g("SUPPORT_MAX_UNSUPPORTED_TERMS", "0")),
                    question_coverage_answered=float(g("RAG_QUESTION_COVERAGE_ANSWERED", "0.6")),
                    require_semantic_confirmation=_bool(g("SUPPORT_REQUIRE_SEMANTIC_CONFIRMATION"), False),
                    judge=g("SUPPORT_JUDGE", "none"),
                ),
                llm=LLMSettings(
                    provider=g("LLM_PROVIDER", "mock"),
                    model=g("LLM_MODEL", ""),
                    base_url=g("LLM_BASE_URL", ""),
                    api_key=g("LLM_API_KEY", ""),
                    timeout_seconds=float(g("LLM_TIMEOUT_SECONDS", "30")),
                    temperature=float(g("LLM_TEMPERATURE", "0")),
                    max_output_tokens=int(g("LLM_MAX_OUTPUT_TOKENS", "1200")),
                    json_mode=_bool(g("LLM_JSON_MODE"), True),
                    max_attempts=int(g("LLM_MAX_ATTEMPTS", "2")),
                    allow_external=_bool(g("LLM_ALLOW_EXTERNAL"), False),
                    budget_usd=float(g("LLM_BUDGET_USD", "0")),
                    price_input_per_mtok=_opt_float(g("LLM_PRICE_INPUT_PER_MTOK")),
                    price_output_per_mtok=_opt_float(g("LLM_PRICE_OUTPUT_PER_MTOK")),
                ),
            )
        except ValueError as exc:
            raise ConfigurationError(f"Invalid numeric configuration value: {exc}") from exc
        s.validate()
        return s

    def validate(self) -> None:
        if not self.auth_disabled and not self.internal_api_token:
            raise ConfigurationError("RAG_INTERNAL_API_TOKEN is required (or set RAG_AUTH_DISABLED=true for local dev).")
        if self.chroma_mode not in {"http", "persistent", "memory"}:
            raise ConfigurationError("CHROMA_MODE must be http, persistent or memory.")
        r = self.retrieval
        if not (1 <= r.max_evidence <= r.top_k <= 50):
            raise ConfigurationError("Require 1 <= RAG_MAX_EVIDENCE <= RAG_TOP_K <= 50.")
        if not (0 <= self.support.coverage_partial <= self.support.coverage_supported <= 1):
            raise ConfigurationError("Require 0 <= SUPPORT_COVERAGE_PARTIAL <= SUPPORT_COVERAGE_SUPPORTED <= 1.")
        sp = self.support
        for name in ("question_relevance_min", "relative_relevance_min", "question_coverage_answered"):
            if not 0 <= getattr(sp, name) <= 1:
                raise ConfigurationError(f"support.{name} must be within [0, 1].")
        if sp.max_unsupported_terms < 0:
            raise ConfigurationError("SUPPORT_MAX_UNSUPPORTED_TERMS must be >= 0.")
        if sp.judge not in {"none", "llm"}:
            raise ConfigurationError("SUPPORT_JUDGE must be none or llm.")
        if self.llm.max_attempts < 1:
            raise ConfigurationError("LLM_MAX_ATTEMPTS must be >= 1.")
        if self.llm.budget_usd < 0:
            raise ConfigurationError("LLM_BUDGET_USD must be >= 0.")
