"""Question coverage: which key terms of the question occur in the evidence that backs the
answer. A lexical signal for *partially answered* questions, used only to stop an answer
from being reported as ANSWERED — never on its own to refuse an answer (mixed-language
questions legitimately score low; see docs/rag-evaluation.md)."""

from __future__ import annotations

from knot_rag.schemas.answer import QuestionCoverage
from knot_rag.text import question_key_terms, stem, stem_in, stem_set


def _stems(texts: list[str]) -> set[str]:
    out: set[str] = set()
    for t in texts:
        out |= stem_set(t)
    return out


def question_coverage(question: str, evidence_texts: list[str], context_texts: list[str] | None = None) -> QuestionCoverage:
    terms = question_key_terms(question)
    ev = _stems(evidence_texts)
    uncovered = [raw for raw, tok in terms if not stem_in(stem(tok), ev)]
    ratio = 1.0 if not terms else round((len(terms) - len(uncovered)) / len(terms), 4)
    absent: list[str] = []
    if context_texts is not None:
        ctx = _stems(context_texts) | ev
        absent = [raw for raw, tok in terms if not stem_in(stem(tok), ctx)]
    return QuestionCoverage(
        key_terms=[raw for raw, _ in terms], uncovered_terms=uncovered, ratio=ratio, absent_from_context=absent
    )
