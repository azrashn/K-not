"""Quiz generation contract (POST /api/v1/quiz/generate)."""

from __future__ import annotations

from enum import Enum

from pydantic import Field, field_validator

from knot_rag import SCHEMA_VERSION
from knot_rag.schemas.common import StrictModel
from knot_rag.schemas.retrieval import AuthorizedScope

MAX_QUIZ_QUESTIONS = 15


class QuestionType(str, Enum):
    MULTIPLE_CHOICE = "multiple_choice"
    TRUE_FALSE = "true_false"


class Difficulty(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class QuizParams(StrictModel):
    count: int = Field(ge=1, le=MAX_QUIZ_QUESTIONS)
    question_types: list[QuestionType] = Field(min_length=1, max_length=2)
    difficulty: Difficulty = Difficulty.MEDIUM

    @field_validator("question_types")
    @classmethod
    def _dedupe(cls, v: list[QuestionType]) -> list[QuestionType]:
        return list(dict.fromkeys(v))


class QuizRequest(StrictModel):
    schema_version: str = SCHEMA_VERSION
    request_id: str | None = Field(default=None, max_length=128)
    scope: AuthorizedScope
    params: QuizParams


class QuizSource(StrictModel):
    chunk_id: str
    document_id: str
    page_start: int | None = None
    page_end: int | None = None
    quote: str = Field(description="Verbatim substring of the source chunk text.")
    char_start: int | None = Field(default=None, description="Document offset of the quote, only when the chunk offset is known.")
    char_end: int | None = None


class QuizQuestion(StrictModel):
    type: QuestionType
    prompt: str
    options: list[str]
    correct_index: int = Field(ge=0)
    explanation: str
    topic: str
    difficulty: Difficulty
    source: QuizSource


class QuizRejections(StrictModel):
    unsupported: int = 0
    duplicate: int = 0
    ambiguous: int = 0
    out_of_scope: int = 0


class QuizResponse(StrictModel):
    schema_version: str = SCHEMA_VERSION
    request_id: str
    generator: str = "extractive-v1"
    llm_used: bool = False
    requested: int
    produced: int
    warnings: list[str] = Field(default_factory=list)
    rejected: QuizRejections = Field(default_factory=QuizRejections)
    questions: list[QuizQuestion]
