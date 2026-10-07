"""Query validation and preparation. The original question is always kept unchanged."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

from knot_rag.errors import RequestValidationFailed
from knot_rag.schemas.retrieval import MAX_QUESTION_CHARS
from knot_rag.text import normalize_text

_HAS_WORD = re.compile(r"\w", re.UNICODE)


class QueryRewriter(Protocol):
    """Optional hook (e.g. abbreviation expansion). Not enabled by default: adopt only if
    the evaluation set shows a measurable retrieval gain."""

    def rewrite(self, normalized_question: str) -> str: ...


@dataclass(frozen=True)
class PreparedQuery:
    original: str
    normalized: str
    retrieval_query: str


class QueryProcessor:
    def __init__(self, rewriter: QueryRewriter | None = None, max_chars: int = MAX_QUESTION_CHARS):
        self._rewriter = rewriter
        self._max_chars = max_chars

    def prepare(self, question: str) -> PreparedQuery:
        if not isinstance(question, str):
            raise RequestValidationFailed("Question must be a string.")
        normalized = normalize_text(question)
        if not normalized:
            raise RequestValidationFailed("Question is empty.", details={"field": "question"})
        if not _HAS_WORD.search(normalized):
            raise RequestValidationFailed("Question contains no words.", details={"field": "question"})
        if len(normalized) > self._max_chars:
            raise RequestValidationFailed(
                f"Question exceeds {self._max_chars} characters.", details={"field": "question"}
            )
        retrieval_query = normalized
        if self._rewriter is not None:
            rewritten = normalize_text(self._rewriter.rewrite(normalized))
            retrieval_query = rewritten or normalized
        return PreparedQuery(original=question, normalized=normalized, retrieval_query=retrieval_query)
