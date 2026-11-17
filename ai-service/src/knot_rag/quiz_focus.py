"""Question focus and difficulty for practice sets.

A focus says WHAT kind of understanding a question measures; a difficulty says how much reasoning
it requires. Both are instructions to the writer only: the facts still come from the sources, and
the quality gate still checks every question. Keeping them here lets the backend plan a balanced set
while the writer stays the single owner of the wording.
"""

from __future__ import annotations

import re

FOCUSES = ("definition", "relation", "difference", "application", "scenario", "code_output")
DIFFICULTIES = ("easy", "medium", "hard")

FOCUS_GUIDE = {
    "definition": (
        "Measure whether the learner knows what a concept IS or what a term means, stated in the source. "
        "The question must still not copy the sentence; ask about the meaning, not the exact words."
    ),
    "relation": (
        "Measure how two or more concepts from the source relate: what causes what, what depends on what, "
        "which property follows from which. The learner must combine the source fact with the stated relation."
    ),
    "difference": (
        "Measure whether the learner can separate two similar concepts from the source. Options should be "
        "plausible confusions of the same kind, and only one should match the stated property."
    ),
    "application": (
        "Give a short concrete situation and ask which concept, rule or step applies to it. "
        "The learner must apply the source fact to a case that is not stated in the source."
    ),
    "scenario": (
        "Describe a brief realistic case (2-3 sentences) and ask what the case shows or what should happen next, "
        "based on the source. The answer must follow from the source, not from general knowledge."
    ),
    "code_output": (
        "Show a SHORT code or pseudo-code fragment from the source's own examples or rules (max 6 lines) and ask "
        "what it prints, returns, or which line is wrong. Do not invent a program that the source does not describe; "
        "if the source has no code, do not ask this kind of question."
    ),
}

DIFFICULTY_GUIDE = {
    "easy": "Difficulty EASY: one fact, recalled and recognised directly. The distractors must still be plausible.",
    "medium": "Difficulty MEDIUM: the learner must relate or compare two facts from the source to choose the answer.",
    "hard": "Difficulty HARD: the learner must reason through a case; the correct answer cannot be found by matching words.",
}

# Focus names are server-owned enums; anything else is ignored rather than trusted.
CODE_HINT = re.compile(r"(\bclass\b|\bpublic\b|\bvoid\b|\breturn\b|\bfor\s*\(|\bif\s*\(|\{|\}|;\s*$|==|=>)", re.MULTILINE)


def focus_instruction(focus: str | None, difficulty: str | None) -> str:
    """The text added to the writer's system prompt. Empty when neither is requested."""
    parts = []
    if difficulty in DIFFICULTY_GUIDE:
        parts.append(DIFFICULTY_GUIDE[difficulty])
    if focus in FOCUS_GUIDE:
        parts.append(f"Question focus ({focus}): {FOCUS_GUIDE[focus]}")
    return " ".join(parts)


def looks_like_code(text: str) -> bool:
    """Cheap, conservative check used only to decide whether a code question is offered at all."""
    return len(CODE_HINT.findall(text or "")) >= 3
