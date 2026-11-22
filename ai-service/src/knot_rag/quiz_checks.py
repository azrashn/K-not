"""Deterministic checks for model-written quiz questions (QUIZ_ENGINE=v2).

Pure functions: no model call, no I/O. A draft either becomes a publishable question or raises
QuizCheckError with a stable code; the code is what logs, API responses and the bench count.
The model never proves its own answer here: quotes must occur in the source, answers must be
among the options or in the quote, and calculations are recomputed.
"""

from __future__ import annotations

import ast
import hashlib
import math
import operator
import random
import re

from knot_rag import quiz_false as qf
from knot_rag import quiz_truth as qt
from knot_rag.text import content_tokens, fold

# ── failure codes (stable strings; also used by quiz_engine and the backend) ─────────────────
TIMEOUT = "TIMEOUT"
MODEL_UNREACHABLE = "MODEL_UNREACHABLE"
INVALID_JSON = "INVALID_JSON"
SCHEMA_MISMATCH = "SCHEMA_MISMATCH"
QUOTE_NOT_FOUND = "QUOTE_NOT_FOUND"
ANSWER_NOT_IN_OPTIONS = "ANSWER_NOT_IN_OPTIONS"
DUPLICATE_OPTIONS = "DUPLICATE_OPTIONS"
ANSWER_LEAKED = "ANSWER_LEAKED"
ANSWER_NOT_IN_SOURCE = "ANSWER_NOT_IN_SOURCE"
BAD_FORMAT = "BAD_FORMAT"
CALC_MISMATCH = "CALC_MISMATCH"
CALC_DATA_MISSING = "CALC_DATA_MISSING"
DUPLICATE_STEM = "DUPLICATE_STEM"
BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED"
TRUNCATED = "TRUNCATED"  # the output hit the token limit (finish_reason "length")
NOT_SELF_CONTAINED = "NOT_SELF_CONTAINED"  # the stem leans on a sentence the student does not see
DUPLICATE_QUOTE = "DUPLICATE_QUOTE"  # the source sentence already carries another question of the set
KEY_NOT_SUPPORTED = "KEY_NOT_SUPPORTED"  # the marked answer is not what the chosen sentence says
WRONG_LANGUAGE = "WRONG_LANGUAGE"  # the stem is written in another language than the quiz's

FAILURE_CODES = (
    TIMEOUT, MODEL_UNREACHABLE, INVALID_JSON, SCHEMA_MISMATCH, QUOTE_NOT_FOUND,
    ANSWER_NOT_IN_OPTIONS, DUPLICATE_OPTIONS, ANSWER_LEAKED, ANSWER_NOT_IN_SOURCE, BAD_FORMAT,
    CALC_MISMATCH, CALC_DATA_MISSING, DUPLICATE_STEM, BUDGET_EXHAUSTED, TRUNCATED, NOT_SELF_CONTAINED,
    DUPLICATE_QUOTE, KEY_NOT_SUPPORTED, WRONG_LANGUAGE,
)
EXPLANATION_MAX = 200

# Server corrections of an otherwise valid draft. Internal: quiz_engine logs and removes them.
CORRECTIONS_KEY = "_corrections"
COPIED_FALSE_TO_TRUE = "copied_false_to_true"
TRUE_COPY_EXPLANATION = {
    "tr": "İfade, kaynaktaki cümleyle birebir aynıdır; bu yüzden doğrudur.",
    "en": "The statement is the source sentence word for word, so it is true.",
}

KINDS = ("MULTIPLE_CHOICE", "TRUE_FALSE", "CLOZE", "SHORT_ANSWER", "OPEN")
CALCULATION = "CALCULATION"

CLOZE_PREFIX = {"tr": "Kaynakta kullanılan kavramla tamamla:", "en": "Complete with the term used in the source:"}
TRUE_FALSE_OPTIONS = {"tr": ["Doğru", "Yanlış"], "en": ["True", "False"]}


class QuizCheckError(ValueError):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code
        self.detail = detail


# ── text helpers ────────────────────────────────────────────────────────────────────────────
def canonical(s: str) -> str:
    # Operators carry meaning: x+y, x-y and x/y are different answers.
    return re.sub(r"\s*([+*/=<>−-])\s*", r"\1", fold(s)).rstrip(".!?;,")


def _contains_word(container: str, part: str) -> bool:
    return bool(re.search(r"(?<!\w)" + re.escape(part) + r"(?!\w)", container))


def _root(token: str) -> str:
    """Crude Turkish-friendly stem: a prefix that survives suffixes and consonant softening
    (kuyruk → kuyruğu, ağaç → ağacı). Numbers and short tokens stay whole."""
    if token.isdigit() or len(token) <= 3:
        return token
    return token[: max(3, min(5, len(token) - 1))]


def shares_root(answer: str, quote: str) -> bool:
    """At least one meaningful word of the answer has its root in the quote."""
    quote_tokens = content_tokens(quote)
    for token in content_tokens(answer):
        root = _root(token)
        exact = token.isdigit() or len(token) <= 3
        if any(q == token if exact else q.startswith(root) for q in quote_tokens):
            return True
    return False


def _text(draft: dict, key: str, low: int, high: int) -> str:
    value = draft.get(key)
    if not isinstance(value, str):
        raise QuizCheckError(SCHEMA_MISMATCH, f"{key} must be a string")
    value = value.strip()
    if not low <= len(value) <= high:
        raise QuizCheckError(BAD_FORMAT, f"{key} length {len(value)} outside {low}-{high}")
    return value


# ── source quote ────────────────────────────────────────────────────────────────────────────
def find_quote(quote: str, evidence: list[dict]) -> tuple[int, str]:
    """(1-based source index, exact source substring). Only whitespace may differ; every other
    character, digit and operator must be in the source as written."""
    quote = quote.strip().strip("\"'“”‘’«»").strip()
    if len(quote) < 8:
        raise QuizCheckError(BAD_FORMAT, "quote is too short")
    pattern = re.compile(r"\s+".join(re.escape(t) for t in quote.split()))
    for index, item in enumerate(evidence, 1):
        source = item.get("text") if isinstance(item, dict) else None
        if not isinstance(source, str):
            continue
        if quote in source:
            return index, quote
        match = pattern.search(source)
        if match:
            return index, match.group(0)
    raise QuizCheckError(QUOTE_NOT_FOUND, quote[:120])


def _quote(draft: dict, evidence: list[dict]) -> tuple[int, str]:
    return find_quote(_text(draft, "quote", 1, 600), evidence)


_SOURCE_NUMBER = re.compile(r"\[\s*\d{1,3}\s*\]")


def _without_source_numbers(text: str) -> str:
    """The model sees its sentences as "[3] …" and sometimes answers "Kaynak [3] buna doğrudan işaret eder."
    The student never sees those numbers, so a sentence that cites one is dropped; a stray mark is cut."""
    if not _SOURCE_NUMBER.search(text):
        return text
    sentences = re.split(r"(?<=[.!?…])\s+", text)
    kept = [s for s in sentences if not _SOURCE_NUMBER.search(s)]
    return " ".join(kept) if kept else ""


def short_explanation(text: str, limit: int = EXPLANATION_MAX) -> str:
    """One sentence, at most `limit` characters: the first sentence, cut at a word if still too long.
    A longer explanation is shortened here rather than costing the question."""
    text = _without_source_numbers(re.sub(r"\s+", " ", text).strip())
    end = re.search(r"[.!?…](?=\s|$)", text)
    # A very short first "sentence" ("Doğru.") is not an explanation on its own; keep reading then.
    sentence = text[: end.end()] if end and end.end() >= 20 else text
    if len(sentence) <= limit:
        return sentence
    cut = sentence[: limit - 1]
    space = cut.rfind(" ")
    return (cut[:space] if space > limit // 2 else cut).rstrip(" ,;:") + "…"


def _explanation(draft: dict) -> str:
    return short_explanation(_text(draft, "explanation", 10, 700))


def _objective(draft: dict) -> str | None:
    value = draft.get("objective")
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    return _text(draft, "objective", 4, 300)


def _no_options(draft: dict) -> None:
    if draft.get("options") not in (None, []):
        raise QuizCheckError(BAD_FORMAT, "this kind has no options")


# ── per kind ────────────────────────────────────────────────────────────────────────────────
# ── multiple choice: the correct option must not stand out, the question asks one thing ──────────
LONGEST_RATIO = 1.5       # the correct option may not be this many times the longest wrong one …
LONGEST_MIN_GAP = 15      # … while also this many characters longer (short options like years are fine)
_QUESTION_WORD = (r"(?:hangi\w*|ne|neyi|neye|neden|nerede|nereye|nereden|ne\s+zaman|kim|kimin|kimi|kime|"
                  r"kimden|kimler\w*|kaç|kaçta|kaçıncı|nasıl|"
                  r"which|what|when|who|whom|whose|where|why|how)")
# Two questions joined into one: "hangi dönemde ve hangi kuruluşta", "ne zaman ve kim tarafından".
_DOUBLE_QUESTION = re.compile(rf"(?<!\w){_QUESTION_WORD}(?!\w).*?(?<!\w)(?:ve|and)\s+{_QUESTION_WORD}(?!\w)")


def check_option_balance(question: str, correct: str, wrong: list[str], relaxed: bool = False) -> None:
    """BAD_FORMAT when the question asks two things, when the correct option is clearly the longest, or
    when only the correct option holds a number (a year, an amount): a student could guess it unread."""
    if _DOUBLE_QUESTION.search(_lower_tr(question)):
        raise QuizCheckError(BAD_FORMAT, "the question asks two things at once; ask exactly one")
    if relaxed:
        return  # a later try: the student asked for a number of questions; length and number cues are let through
    longest_wrong = max(len(o) for o in wrong)
    if len(correct) > LONGEST_RATIO * longest_wrong and len(correct) - longest_wrong >= LONGEST_MIN_GAP:
        raise QuizCheckError(BAD_FORMAT, "the correct option is clearly the longest; make the options alike")
    has_digit = re.compile(r"\d")
    if has_digit.search(correct) and sum(1 for o in wrong if not has_digit.search(o)) >= 2:
        raise QuizCheckError(BAD_FORMAT, "only the correct option holds a number or year; "
                                         "wrong options must be the same type of answer")


# A letter label the model writes before an option ("a) javac", "A) javac", "a. javac", "A - javac",
# "(a) javac"). The server shuffles the options, so a kept label would read "a) …, c) …, b) …".
# "a)", "(a)" and "a." need no space ("a)javac"); "A -" needs one on both sides, so "C-dili" stays.
_OPTION_LABEL = re.compile(r"^\s*(?:\(\s*([a-eA-E])\s*\)|([a-eA-E])\s*[).]|([a-eA-E])\s+[-–—:]\s)\s*")
# An answer that is only a label: "b", "B)", "(b)", "b.".
_LABEL_ONLY = re.compile(r"^\s*\(?\s*([a-eA-E])\s*[).]?\s*$")


def _label(text: str) -> tuple[str | None, str]:
    """(label letter in lower case or None, text without the label)."""
    match = _OPTION_LABEL.match(text)
    if not match or not text[match.end():].strip():
        return None, text.strip()
    letter = next(g for g in match.groups() if g)
    return letter.lower(), text[match.end():].strip()


def strip_option_labels(options: list[str], answer: str) -> tuple[list[str], str]:
    """Options and answer without letter labels. Labels are removed only when every option carries one
    (a real option may start with "A." or "C -"); the answer then loses its label too, and an answer that
    is only a letter ("b)") becomes the option that carried that letter."""
    labelled = [_label(o) for o in options]
    if not options or any(letter is None for letter, _ in labelled):
        return [o.strip() for o in options], answer.strip()
    clean = [text for _, text in labelled]
    only = _LABEL_ONLY.match(answer)
    if only:
        letters = [letter for letter, _ in labelled]
        wanted = only.group(1).lower()
        return clean, clean[letters.index(wanted)] if letters.count(wanted) == 1 else answer.strip()
    return clean, _label(answer)[1]


CLOSE_OPTION = 0.75   # share of the shorter side's words that the answer and one option have in common
CLOSE_MARGIN = 0.2    # and that option must beat every other one by this much


def closest_option(answer: str, options: list[str]) -> int | None:
    """The index of the one option the answer clearly means (the model wrote it with another ending or a
    word dropped), or None. Without a clear winner the answer stays "not among the options"."""
    wanted = {t for t in content_tokens(answer)}
    if not wanted:
        return None
    scores = []
    for option in options:
        have = {t for t in content_tokens(option)}
        shared = len(wanted & have)
        # the share of the shorter side that the other has: an answer that is a part of an option, or an
        # option that is a part of the answer; at least two words, so one common word proves nothing
        scores.append(shared / min(len(wanted), len(have)) if shared >= 2 else 0.0)
    best = max(scores)
    if best < CLOSE_OPTION:
        return None
    ranked = sorted(scores, reverse=True)
    return scores.index(best) if len(ranked) < 2 or best - ranked[1] >= CLOSE_MARGIN else None


def check_option_support(correct: str, wrong: list[str], quote: str) -> None:
    """KEY_NOT_SUPPORTED when the sentence contradicts the option marked correct, or when a wrong option is
    stated by the sentence just as well (two right answers)."""
    key = qt.fit(correct, quote)
    if key.conflicts:
        raise QuizCheckError(KEY_NOT_SUPPORTED, "the option marked correct contradicts the sentence ("
                             + key.describe() + ")")
    for option in wrong:
        other = qt.fit(option, quote)
        if other.states and other.coverage >= key.coverage and other.coverage >= qt.SUPPORT_MIN:
            raise QuizCheckError(KEY_NOT_SUPPORTED, "a wrong option is stated by the sentence as well as the "
                                 f"correct one: {option[:80]}")


# An option the model cut out of a sentence: it starts in the middle ("g, float, double …", "ve boolean …") or
# stops on a word that needs another ("… değerleri ve"), or holds a made-up word like "3-than".
_OPTION_FRAGMENT_START = re.compile(r"^(?:[a-zçğıöşü]{1,2}[,;]\s|(?:ve|veya|ile|ancak|fakat|ama|and|or|but)\s)")
_OPTION_DANGLING_END = frozenset("ve veya ya yada ile ancak gibi için de da ki bir and or the of to".split())
_OPTION_GARBLE = re.compile(r"(?<![\w-])\d+-[^\W\d_]{2,}(?![\w-])")


# When every option is a whole statement, the stem must say which kind to pick: "…hangisi doğrudur?", "…hangisi
# yanlıştır?", "…hangisi değildir?". "String veri tipi hakkında ne söylenir?" leaves the student guessing.
_TRUTH_CUE = re.compile(
    r"(?<!\w)(?:doğru|doğrudur|yanlış|yanlıştır|geçerli|geçersiz|hatalı|değildir|değil|true|false|correct|"
    r"incorrect|not)(?!\w)"
)
STATEMENT_OPTION_WORDS = 4  # an option this long is a statement, not a term or a number


TRUTH_STEM = {"tr": "{topic} ile ilgili aşağıdakilerden hangisi doğrudur?",
              "en": "Which of the following is true about {topic}?"}


def with_truth_cue(question: str, options: list[str], topic: str, language: str = "tr") -> tuple[str, bool]:
    """(question, changed). When every option is a whole statement the question must say which kind to pick; a
    stem that does not ("String veri tipi hakkında ne söylenir?") is replaced by one that does, with the quiz's
    topic as its subject. A marked key is the TRUE statement, so the cue is always "doğrudur". Stems with a cue
    and questions over short options (a term, a year) stay as they are."""
    statements = [o for o in options if len(content_tokens(o)) >= STATEMENT_OPTION_WORDS]
    if len(statements) < 3 or _TRUTH_CUE.search(_lower_tr(question)):
        return question, False
    subject = re.sub(r"\s+", " ", topic).strip().rstrip("?.!") or ("bu konu" if language == "tr" else "this topic")
    return TRUTH_STEM.get(language, TRUTH_STEM["tr"]).format(topic=subject), True


def check_options_are_whole(options: list[str], evidence: list[dict]) -> None:
    """BAD_FORMAT when an option looks cut or garbled. Every option must be a complete phrase."""
    source = " ".join(str(e.get("text", "")) for e in evidence if isinstance(e, dict))
    for number, option in enumerate(options, 1):
        text = option.strip()
        words = re.findall(r"[^\W_]+", _lower_tr(text))
        if _OPTION_FRAGMENT_START.match(_lower_tr(text)) or (len(words) >= 3 and words[-1] in _OPTION_DANGLING_END):
            raise QuizCheckError(BAD_FORMAT, f"option {number} looks cut out of a sentence; "
                                 "write each option as a complete phrase")
        for junk in _OPTION_GARBLE.findall(text):
            if junk not in source:
                raise QuizCheckError(BAD_FORMAT, f"option {number} holds a garbled word ({junk})")


_SENTENCE_BREAK = re.compile(r"(?<=[.!?…])\s+|\n\s*\n|\n(?=[ \t]*(?:[•▪●◦■*]|[-–]\s))")
FACT_MIN_WORDS = 4      # shorter options (a term, a year) cannot be judged against a sentence
FACT_COVERAGE = 0.85    # an option this much inside one source sentence is that sentence's fact


def evidence_sentences(evidence: list[dict]) -> list[str]:
    out = []
    for item in evidence:
        text = item.get("text") if isinstance(item, dict) else None
        if isinstance(text, str):
            out += [re.sub(r"\s+", " ", piece).strip() for piece in _SENTENCE_BREAK.split(text)]
    return [s for s in out if len(s) >= 15]


def check_wrong_options_are_not_facts(wrong: list[str], evidence: list[dict]) -> None:
    """KEY_NOT_SUPPORTED when a wrong option is a sentence the source itself says ("Bytecode, JVM tarafından
    çalıştırılır" beside the right answer "JRE ... JVM'yi içerir"): it is true, so the question has two right
    answers. Only options of a few words are judged this way."""
    sentences = evidence_sentences(evidence)
    for option in wrong:
        if len(content_tokens(option)) < FACT_MIN_WORDS:
            continue
        for sentence in sentences:
            fit = qt.fit(option, sentence)
            if fit.states and fit.coverage >= FACT_COVERAGE and fit.shared >= FACT_MIN_WORDS:
                raise QuizCheckError(KEY_NOT_SUPPORTED, "a wrong option is a true sentence of the source: "
                                     + option[:80])


def check_multiple_choice(draft: dict, evidence: list[dict], seed: str | None = None, relaxed: bool = False) -> dict:
    question = _text(draft, "question", 10, 600)
    options = draft.get("options")
    if not isinstance(options, list) or any(not isinstance(o, str) for o in options):
        raise QuizCheckError(SCHEMA_MISMATCH, "options must be a list of strings")
    raw_answer = draft.get("answer")
    options, answer_text = strip_option_labels(options, raw_answer if isinstance(raw_answer, str) else "")
    if isinstance(raw_answer, str):
        draft = {**draft, "answer": answer_text}
    if len(options) != 4 or any(not 1 <= len(o) <= 180 for o in options):
        raise QuizCheckError(BAD_FORMAT, "exactly four options of 1-180 characters required")
    keys = [canonical(o) for o in options]
    if len(set(keys)) != 4 or not all(keys):
        raise QuizCheckError(DUPLICATE_OPTIONS, " | ".join(options))
    if max(map(len, options)) > 4 * max(4, min(map(len, options))):
        raise QuizCheckError(BAD_FORMAT, "option lengths are conspicuously unbalanced")
    answer = _text(draft, "answer", 1, 180)
    hits = [i for i, k in enumerate(keys) if k == canonical(answer)]
    if len(hits) != 1:
        close = closest_option(answer, options)
        if close is None:
            raise QuizCheckError(ANSWER_NOT_IN_OPTIONS, answer[:120])
        hits = [close]
    correct = options[hits[0]]
    check_option_balance(question, correct, [o for i, o in enumerate(options) if i != hits[0]], relaxed)
    if len(keys[hits[0]]) >= 4 and _contains_word(canonical(question), keys[hits[0]]):
        raise QuizCheckError(ANSWER_LEAKED, correct[:120])
    source_index, quote = _quote(draft, evidence)
    if not shares_root(correct, quote):
        raise QuizCheckError(ANSWER_NOT_IN_SOURCE, correct[:120])
    check_options_are_whole(options, evidence)
    wrong_options = [o for i, o in enumerate(options) if i != hits[0]]
    check_option_support(correct, wrong_options, quote)
    check_wrong_options_are_not_facts(wrong_options, evidence)
    explanation = _explanation(draft)
    # Small models favour one letter; the server decides the position, reproducibly.
    order = list(range(4))
    random.Random(seed if seed is not None else hashlib.sha256(question.encode()).hexdigest()).shuffle(order)
    shuffled = [options[i] for i in order]
    return {
        "kind": "MULTIPLE_CHOICE", "question": question, "options": shuffled,
        "expected": str(order.index(hits[0])), "quote": quote, "source_index": source_index,
        "explanation": explanation, "objective": _objective(draft),
    }


CHOICE_STEMS = {
    "tr": ["{topic} ile ilgili aşağıdakilerden hangisi doğrudur?",
           "Kaynağa göre {topic} için aşağıdakilerden hangisi doğrudur?",
           "{topic} konusunda aşağıdaki ifadelerden hangisi doğrudur?"],
    "en": ["Which of the following is true about {topic}?", "According to the source, which statement about "
           "{topic} is true?", "Which of these statements on {topic} is correct?"],
}
CHOICE_EXPLANATION = {"tr": "Kaynağa göre doğru ifade şudur: {true}", "en": "According to the source, the true statement is: {true}"}
OPTION_MAX = 180


def build_choice(result: dict, topic: str, language: str, evidence: list[dict]) -> dict | None:
    """The multiple-choice question made from a TRUE true/false result: the true statement and three false
    ones (quiz_false.false_variants) as options, asked as "{topic} ile ilgili aşağıdakilerden hangisi
    doğrudur?". The server writes every option, so each wrong one is false by construction and the right one
    is the sentence's own statement; no model writes options. None when three different false options cannot
    be made (the caller then fails the question)."""
    if result.get("kind") != "TRUE_FALSE" or result.get("expected") != "0":
        return None
    true, quote = result["question"], result["quote"]
    wrong = qf.false_variants(true, quote, evidence_sentences(evidence))
    options = [true] + wrong
    if len(wrong) < 3 or any(len(o) > OPTION_MAX for o in options) or len({canonical(o) for o in options}) != 4:
        return None
    order = list(range(4))
    random.Random(hashlib.sha256(true.encode()).hexdigest()).shuffle(order)
    shuffled = [options[i] for i in order]
    subject = re.sub(r"\s+", " ", topic).strip().rstrip("?.!") or ("bu konu" if language == "tr" else "this topic")
    templates = CHOICE_STEMS.get(language, CHOICE_STEMS["tr"])
    # The same few stems come back for every built question; the options carry the content. One is picked per
    # statement so a quiz does not read as one question repeated.
    question = templates[hashlib.sha256(true.encode()).digest()[0] % len(templates)].format(topic=subject)
    explanation = short_explanation(CHOICE_EXPLANATION.get(language, CHOICE_EXPLANATION["tr"]).format(true=true))
    return {
        "kind": "MULTIPLE_CHOICE", "question": question, "options": shuffled, "expected": str(order.index(0)),
        "quote": quote, "source_index": result["source_index"], "explanation": explanation,
        "objective": result.get("objective"), "constructed_choice": True,
    }


FALSE_EXPLANATION = {"tr": "Kaynağa göre doğrusu şöyledir: {true}", "en": "According to the source: {true}"}


def make_false(result: dict, language: str = "tr") -> dict | None:
    """The true/false question `result` (a TRUE statement) with its statement made false by the server: an
    opposite word, a changed number or a negation, kept only when the sentence no longer states it. The
    explanation is written here too, quoting the true statement, so it always matches the key. None when no
    change is possible (the question then stays true)."""
    if result.get("kind") != "TRUE_FALSE" or result.get("expected") != "0":
        return None
    original, quote = result["question"], result["quote"]
    for candidate, how in qf.candidates(original, quote):
        fit = qt.fit(candidate, quote)
        if fit.shared < qt.RELATED_MIN_SHARED or (fit.states and not fit.new_terms):
            continue
        if canonical(candidate) == canonical(original) or canonical(candidate) in canonical(quote):
            continue
        explanation = short_explanation(FALSE_EXPLANATION.get(language, FALSE_EXPLANATION["tr"]).format(true=original))
        return {**result, "question": candidate, "expected": "1", "explanation": explanation, "constructed_false": how}
    return None


def check_statement_key(statement: str, is_true: bool, quote: str) -> None:
    """KEY_NOT_SUPPORTED when the key does not follow from the chosen sentence. A true statement must be
    what the sentence says (nearly all its words, nothing flipped); a false one is the sentence with a fact
    changed: still built from it, and different from it in a way that shows (a new term, a flipped word, a
    number, a negation). A "false" statement the sentence still states is true, so it is refused."""
    fit = qt.fit(statement, quote)
    if is_true:
        if not fit.states:
            raise QuizCheckError(KEY_NOT_SUPPORTED, "marked true, but the sentence does not state it ("
                                 + fit.describe() + ")")
        return
    if fit.shared < qt.RELATED_MIN_SHARED:
        raise QuizCheckError(KEY_NOT_SUPPORTED, "marked false, but the statement is not about the chosen "
                             "sentence; change one fact of that sentence")
    if fit.states and not fit.new_terms:
        raise QuizCheckError(KEY_NOT_SUPPORTED, "marked false, but the sentence still states it; change one "
                             "fact of the sentence")


def check_true_false(draft: dict, evidence: list[dict], language: str = "tr", want_true: bool | None = None) -> dict:
    statement = _text(draft, "statement", 10, 400)
    is_true = draft.get("is_true")
    if type(is_true) is not bool:
        raise QuizCheckError(SCHEMA_MISMATCH, "is_true must be a boolean")
    source_index, quote = _quote(draft, evidence)
    corrections = []
    explanation = _explanation(draft)
    if not is_true and canonical(statement) == canonical(quote):
        # The whole source sentence, word for word: it is true whatever the model said. The model's
        # explanation argued "false", so the server writes one that matches the key.
        is_true = True
        corrections.append(COPIED_FALSE_TO_TRUE)
        explanation = TRUE_COPY_EXPLANATION[language]
    elif not is_true and canonical(statement) in canonical(quote):
        # Only part of the sentence: cutting words can change the meaning, so neither key is safe.
        raise QuizCheckError(BAD_FORMAT, "a false statement cannot be copied from the source")
    check_self_contained(statement)  # the form comes before the truth of the key
    if want_true is not None and is_true != want_true:
        raise QuizCheckError(BAD_FORMAT, "a " + ("TRUE" if want_true else "FALSE") + " statement was asked for; "
                             + ("restate the sentence without a new claim" if want_true
                                else "change exactly one fact of the sentence"))
    check_statement_key(statement, is_true, quote)
    result = {
        "kind": "TRUE_FALSE", "question": statement, "options": list(TRUE_FALSE_OPTIONS[language]),
        "expected": "0" if is_true else "1", "quote": quote, "source_index": source_index,
        "explanation": explanation, "objective": _objective(draft),
    }
    if corrections:
        result[CORRECTIONS_KEY] = corrections
    return result


def check_cloze(draft: dict, evidence: list[dict], language: str = "tr") -> dict:
    """The model picks the term; the server writes the blank, so the format cannot be wrong."""
    _no_options(draft)
    source_index, quote = _quote(draft, evidence)
    answer = _text(draft, "answer", 1, 80)
    if not content_tokens(answer):
        raise QuizCheckError(BAD_FORMAT, "the blank must hide a meaningful term")
    if len(answer) > 0.6 * len(quote):
        raise QuizCheckError(BAD_FORMAT, "the blank hides most of the sentence")
    # Case-insensitive: a small model often writes "Transport" where the source has "transport". The key
    # then uses the source's own spelling.
    found = list(re.finditer(r"(?<!\w)" + re.escape(answer) + r"(?!\w)", quote, re.IGNORECASE))
    if not found:
        raise QuizCheckError(ANSWER_NOT_IN_SOURCE, answer[:120])
    if len(found) > 1:
        raise QuizCheckError(BAD_FORMAT, "the term occurs more than once in the quote")
    m = found[0]
    question = CLOZE_PREFIX[language] + "\n" + quote[: m.start()] + "_____" + quote[m.end():]
    return {
        "kind": "CLOZE", "question": question, "options": [], "expected": m.group(0), "quote": quote,
        "source_index": source_index, "explanation": _explanation(draft), "objective": _objective(draft),
    }


def check_short_answer(draft: dict, evidence: list[dict]) -> dict:
    _no_options(draft)
    question = _text(draft, "question", 10, 600)
    answer = _text(draft, "answer", 1, 180)
    source_index, quote = _quote(draft, evidence)
    if canonical(answer) not in canonical(quote):
        raise QuizCheckError(ANSWER_NOT_IN_SOURCE, answer[:120])
    if len(canonical(answer)) >= 4 and _contains_word(canonical(question), canonical(answer)):
        raise QuizCheckError(ANSWER_LEAKED, answer[:120])
    return {
        "kind": "SHORT_ANSWER", "question": question, "options": [], "expected": answer, "quote": quote,
        "source_index": source_index, "explanation": _explanation(draft), "objective": _objective(draft),
    }


def _lower_tr(text: str) -> str:
    return text.replace("I", "ı").replace("İ", "i").lower()


# An instruction in the imperative: açıklayınız, yazın, karşılaştırınız, örnek veriniz, explain …
_DIRECTIVE = re.compile(
    r"(?<!\w)(?:açıkla|yaz|karşılaştır|tartış|değerlendir|belirt|tanımla|örnekle|göster|yorumla|özetle|"
    r"listele|sırala|anlat|incele|tasarla|öner|ver|çiz|gerekçelendir|ilişkilendir|açıklayarak|kanıtla)"
    r"(?:ınız|iniz|unuz|ünüz|yınız|yiniz|yunuz|yünüz|ın|in|un|ün|yın|yin)(?!\w)"
    r"|(?<!\w)(?:explain|describe|compare|discuss|justify|outline|summari[sz]e|evaluate|why|how)(?!\w)"
)


def is_question_or_instruction(text: str) -> bool:
    """Ends with a question mark, or gives an instruction (Açıklayınız, Karşılaştırınız …)."""
    stripped = text.strip().rstrip("\"'”’)» ")
    return stripped.endswith(("?", "？")) or bool(_DIRECTIVE.search(_lower_tr(text)))


def check_open(draft: dict, evidence: list[dict]) -> dict:
    _no_options(draft)
    if isinstance(draft.get("answer"), str) and draft["answer"].strip():
        raise QuizCheckError(BAD_FORMAT, "open questions have no answer key")
    question = _text(draft, "question", 10, 600)
    if not is_question_or_instruction(question):
        raise QuizCheckError(BAD_FORMAT, "an open question must end with ? or give an instruction "
                                         "such as Açıklayınız; this is a plain statement")
    source_index, quote = _quote(draft, evidence)
    return {
        "kind": "OPEN", "question": question, "options": [], "expected": "", "quote": quote,
        "source_index": source_index, "explanation": _explanation(draft), "objective": _objective(draft),
    }


# ── calculation ─────────────────────────────────────────────────────────────────────────────
_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.Pow: operator.pow, ast.Mod: operator.mod,
}
_UNARY = {ast.USub: operator.neg, ast.UAdd: operator.pos}
_NUMBER = re.compile(r"(?<![\w.,])\d+(?:[.,]\d+)?(?![\w])")
# Turkish: "1.000" and "25.000.000" group thousands with dots (exactly three digits per group);
# the comma is the decimal mark ("3,5" = 3.5, "12.345,6" = 12345.6). A dot that is not followed
# by exactly three-digit groups ("1.5") stays a decimal point.
_TR_THOUSANDS = r"\d{1,3}(?:\.\d{3})+(?:,\d+)?"
_NUMBER_TR = re.compile(r"(?<![\w.,])(?:" + _TR_THOUSANDS + r"(?![\w]|[.,]\d)|\d+(?:[.,]\d+)?(?![\w]))")
# Constants a worked solution may introduce without the question stating them (halves, percent).
_FREE_CONSTANTS = {0.0, 1.0, 2.0, 100.0}


def _to_float(token: str, language: str) -> float:
    if language == "tr" and re.fullmatch(_TR_THOUSANDS, token):
        token = token.replace(".", "")
    return float(token.replace(",", "."))


def _normalize_expression(expression: str, language: str = "en") -> str:
    s = expression.replace("×", "*").replace("·", "*").replace("÷", "/").replace("−", "-").replace("^", "**")
    if language == "tr":
        s = _NUMBER_TR.sub(lambda m: repr(_to_float(m.group(0), "tr")), s)
    return re.sub(r"(?<=\d),(?=\d)", ".", s)


def safe_eval(expression: str, language: str = "en") -> float:
    """Arithmetic only: numbers, + - * / % ** and parentheses. Names, calls and attributes are
    rejected; exponents and magnitudes are bounded so a draft cannot stall the service."""
    if not isinstance(expression, str) or not 1 <= len(expression) <= 160:
        raise QuizCheckError(BAD_FORMAT, "expression must be 1-160 characters")
    try:
        tree = ast.parse(_normalize_expression(expression, language), mode="eval")
    except SyntaxError as exc:
        raise QuizCheckError(BAD_FORMAT, "expression is not arithmetic") from exc

    def walk(node):
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return float(node.value)
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
            return _UNARY[type(node.op)](walk(node.operand))
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            left, right = walk(node.left), walk(node.right)
            if isinstance(node.op, ast.Pow) and (abs(right) > 10 or abs(left) > 1e6):
                raise QuizCheckError(BAD_FORMAT, "exponent out of range")
            try:
                value = _OPS[type(node.op)](left, right)
            except ZeroDivisionError as exc:
                raise QuizCheckError(BAD_FORMAT, "division by zero") from exc
            if isinstance(value, complex) or not math.isfinite(value) or abs(value) > 1e15:
                raise QuizCheckError(BAD_FORMAT, "result out of range")
            return value
        raise QuizCheckError(BAD_FORMAT, "only numbers and arithmetic operators are allowed")

    return walk(tree)


def _number_tokens(text: str, language: str) -> list[str]:
    return (_NUMBER_TR if language == "tr" else _NUMBER).findall(text)


def _numbers(text: str, language: str = "en") -> list[float]:
    return [_to_float(n, language) for n in _number_tokens(text, language)]


def _decimals(token: str, language: str) -> int:
    mark = "," if language == "tr" and re.fullmatch(_TR_THOUSANDS, token) else "[.,]"
    parts = re.split(mark, token)
    return len(parts[-1]) if len(parts) > 1 else 0


def _format_number(value: float, language: str = "en") -> str:
    """Expected answers are written the way a student of that language types them."""
    rounded = round(value, 6)
    text = str(int(rounded)) if rounded == int(rounded) else f"{rounded:f}".rstrip("0")
    return text.replace(".", ",") if language == "tr" else text


def check_calculation(draft: dict, evidence: list[dict], language: str = "tr") -> dict:
    """SHORT_ANSWER + variant CALCULATION: the server recomputes the answer from the expression,
    and every number the expression uses must be given in the question."""
    _no_options(draft)
    question = _text(draft, "question", 10, 600)
    expression = _text(draft, "expression", 1, 160)
    answer_text = _text(draft, "answer", 1, 60)
    value = safe_eval(expression, language)
    given = _numbers(question, language)
    missing = [n for n in _numbers(expression, language)
               if n not in _FREE_CONSTANTS and not any(math.isclose(n, g) for g in given)]
    if missing:
        raise QuizCheckError(CALC_DATA_MISSING, ", ".join(_format_number(n, language) for n in missing))
    stated = _numbers(answer_text, language)
    if len(stated) != 1:
        raise QuizCheckError(BAD_FORMAT, "answer must state exactly one number")
    # A rounded answer is right when it matches the exact result to the decimals it states.
    decimals = _decimals(_number_tokens(answer_text, language)[0], language)
    tolerance = 0.5 * 10 ** -decimals + 1e-9 if decimals else 1e-9 * max(1.0, abs(value))
    if abs(stated[0] - value) > tolerance:
        raise QuizCheckError(CALC_MISMATCH, f"{answer_text} != {_format_number(value, language)}")
    source_index, quote = _quote(draft, evidence)
    return {
        "kind": "SHORT_ANSWER", "variant": CALCULATION, "question": question, "options": [],
        "expected": _format_number(stated[0], language), "quote": quote, "source_index": source_index,
        "explanation": _explanation(draft), "objective": _objective(draft),
        "solution_expression": expression,
    }


# ── Turkish roots (the backend's exam-style.ts rule, plus verbs) ───────────────────────────────
# Words are compared after fold() (ı → i), so the suffixes are folded too. Two words share a root when
# their sets of possible stems meet: bellek / belleği, sürecinde / sürecinin.
_NOUN_SUFFIXES = sorted({fold(s) for s in (
    "lerinin larının lerini larını lerine larına lerden lardan lerin ların lerde larda leri ları sinin sının "
    "sunun sünün inin ının unun ünün sini sını sunu sünü sine sına suna süne ler lar nin nın nun nün den dan "
    "ten tan yla yle nde nda de da te ta in ın un ün si sı su sü yi yı yu yü ye ya la le i ı u ü e a"
).split()}, key=len, reverse=True)
# Verb endings: infinitive, "let's", present, past, future, ability, necessity, polite imperative.
_VERB_SUFFIXES = sorted({fold(s) for s in (
    "abilir ebilir abilmek ebilmek acak ecek malı meli mak mek alım elim ıyor iyor uyor üyor mış miş muş "
    "müş ınız iniz unuz ünüz dı di du dü tı ti tu tü"
).split()}, key=len, reverse=True)
ROOT_MIN = 4       # a noun stem shorter than this is not compared (dizi / dizin stay apart)
VERB_ROOT_MIN = 2  # aç-alım / aç-mak: allowed only when BOTH words end in a verb ending
_SOFTENED = {"ğ": "k", "c": "ç", "b": "p", "d": "t"}


def _stems(word: str, suffixes: list[str], minimum: int) -> set[str]:
    out = set()
    for suffix in suffixes:
        if word.endswith(suffix) and len(word) - len(suffix) >= minimum:
            stem = word[: -len(suffix)]
            out.add(stem)
            if stem[-1] in _SOFTENED:
                out.add(stem[:-1] + _SOFTENED[stem[-1]])
    return out


def _is_verb(word: str) -> bool:
    return any(word.endswith(s) and len(word) - len(s) >= VERB_ROOT_MIN for s in _VERB_SUFFIXES)


def same_root(a: str, b: str) -> bool:
    """True when two words are inflections of one word (case and ı/i ignored)."""
    a, b = fold(a), fold(b)
    if a == b:
        return True
    forms_a = {a} | _stems(a, _NOUN_SUFFIXES, ROOT_MIN)
    forms_b = {b} | _stems(b, _NOUN_SUFFIXES, ROOT_MIN)
    if forms_a & forms_b:
        return True
    if _is_verb(a) and _is_verb(b):
        return bool(_stems(a, _VERB_SUFFIXES, VERB_ROOT_MIN) & _stems(b, _VERB_SUFFIXES, VERB_ROOT_MIN))
    return False


# ── repeat avoidance (the backend's repeat guard uses the same rule) ─────────────────────────────
_STEM_STOP = frozenset(fold(w) for w in
                       "ve ile bir bu için olan olarak gibi the and of is are a an to in ne nedir hangi".split())


def _stem_words(text: str) -> list[str]:
    cleaned = re.sub(r"[^\w\s]", " ", fold(text))
    return list(dict.fromkeys(w for w in cleaned.split() if len(w) > 2 and w not in _STEM_STOP))


def is_duplicate_stem(stem: str, existing: list[str]) -> bool:
    """Most content words shared with an earlier stem, a word counting as shared when the other stem
    has a word of the same root (order, punctuation and Turkish suffixes ignored)."""
    mine = _stem_words(stem)
    if not mine:
        return False
    for other in existing:
        theirs = _stem_words(other)
        if not theirs:
            continue
        shared = sum(1 for w in mine if any(same_root(w, t) for t in theirs))
        union = len(mine) + len(theirs) - shared
        if shared / min(len(mine), len(theirs)) >= 0.7 or shared / union >= 0.5:
            return True
    return False


def is_used_quote(quote: str, used: list[str] | None) -> bool:
    """The sentence is one an earlier question of the same exam or quiz already rests on."""
    key = canonical(quote)
    return bool(key) and any(canonical(u) == key for u in used or [])


# ── self-contained stems ────────────────────────────────────────────────────────────────────
# Openings that point back to a sentence the student never sees ("Bu yöntem…", "Ardından…").
# "O" counts only as a word ("O, …" / "O yapı"), so "O(n log n)" is fine.
_DANGLING_OPENING = re.compile(
    r"^(?:bu|şu|o|bunlar|şunlar|onlar|bunun|şunun|onun|bunu|şunu|onu|buna|şuna|ona|bundan|ondan|bunda|onda|"
    r"burada|orada|böyle|şöyle|öyle|daha\s+sonra|sonra|ardından|böylece|dolayısıyla|ayrıca|bununla|"
    r"this|that|these|those|it|they|then|thus|therefore|afterwards)(?=[\s,;:.!?]|$)"
)


def check_self_contained(text: str) -> None:
    """NOT_SELF_CONTAINED when the stem starts by pointing at an earlier sentence."""
    start = re.sub(r"^[\s\"'“‘«(\[]+", "", text)
    match = _DANGLING_OPENING.match(_lower_tr(start))
    if match:
        raise QuizCheckError(NOT_SELF_CONTAINED, f"starts with \"{start[: match.end()]}\"")


LANGUAGE_NAME = {"tr": "Turkish", "en": "English"}


def check_language(text: str, language: str) -> None:
    """WRONG_LANGUAGE when the stem is plainly in the other language ("What action does the sender
    perform…" in a Turkish quiz). Source terms and names inside a sentence do not count; too little text
    to tell is accepted."""
    guessed = qt.guess_language(text)
    if guessed and guessed != language:
        raise QuizCheckError(WRONG_LANGUAGE, f"the question must be written in {LANGUAGE_NAME.get(language, language)}")


# ── dispatcher ──────────────────────────────────────────────────────────────────────────────
def check_question(kind: str, draft, evidence: list[dict], *, variant: str | None = None,
                   language: str = "tr", seed: str | None = None,
                   existing_stems: list[str] | None = None, used_quotes: list[str] | None = None,
                   want_true: bool | None = None, relaxed: bool = False) -> dict:
    if not isinstance(draft, dict):
        raise QuizCheckError(SCHEMA_MISMATCH, "question must be a JSON object")
    if kind not in KINDS:
        raise QuizCheckError(SCHEMA_MISMATCH, f"unknown kind {kind}")
    if variant == CALCULATION:
        if kind != "SHORT_ANSWER":
            raise QuizCheckError(SCHEMA_MISMATCH, "calculation is a SHORT_ANSWER variant")
        result = check_calculation(draft, evidence, language)
    elif variant is not None:
        raise QuizCheckError(SCHEMA_MISMATCH, f"unknown variant {variant}")
    elif kind == "MULTIPLE_CHOICE":
        result = check_multiple_choice(draft, evidence, seed, relaxed)
    elif kind == "TRUE_FALSE":
        result = check_true_false(draft, evidence, language, want_true)
    elif kind == "CLOZE":
        result = check_cloze(draft, evidence, language)
    elif kind == "SHORT_ANSWER":
        result = check_short_answer(draft, evidence)
    else:
        result = check_open(draft, evidence)
    if kind != "CLOZE":  # a cloze stem is the source sentence itself, written by the server
        check_self_contained(result["question"])
        check_language(result["question"], language)
    if existing_stems and is_duplicate_stem(result["question"], existing_stems):
        raise QuizCheckError(DUPLICATE_STEM, result["question"][:120])
    if not relaxed and is_used_quote(result["quote"], used_quotes):
        raise QuizCheckError(DUPLICATE_QUOTE, "the chosen sentence is already used by another question")
    return result
