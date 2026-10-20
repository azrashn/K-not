"""Extractive quiz generator (`extractive-v1`). NOT an LLM: nothing is paraphrased or invented.

Every question is built from one sentence of a selected document. The sentence itself is the
source quote (a verbatim substring of the chunk text, re-verified before use):

* multiple choice = cloze: one key term of the sentence is blanked; the three distractors are
  terms of the same kind taken from *other* sentences of the selected materials;
* true/false = the verbatim sentence (true) or the sentence with its key term swapped for a
  distractor (false). A false statement is kept only if it occurs nowhere in the materials.

Candidates that cannot be made unambiguous or verifiable are dropped and counted.
"""

from __future__ import annotations

import hashlib
import logging
import random
import re
import unicodedata
from dataclasses import dataclass

from knot_rag.errors import IndexNotReady, ScopeViolation
from knot_rag.retrieval.index import ChunkIndex, SearchScope
from knot_rag.schemas.documents import IndexedChunk
from knot_rag.schemas.quiz import (
    Difficulty,
    QuestionType,
    QuizQuestion,
    QuizRejections,
    QuizRequest,
    QuizResponse,
    QuizSource,
)

log = logging.getLogger(__name__)

MAX_CHUNKS = 2000
MIN_SENTENCE, MAX_SENTENCE = 40, 220
MIN_WORD = 6
N_DISTRACTORS = 3
BLANK = "_____"

_WORD = re.compile(r"[^\W\d_]+(?:[-'’][^\W\d_]+)*", re.UNICODE)
_NUMBER = re.compile(r"(?<![\w.,])\d+(?![\w])")
_BOUNDARY = re.compile(r"(?<=[.!?])\s+|\n+")
_STOP = set(
    "bunların şunların onların böylece ancak fakat çünkü ayrıca örneğin yani gibi kadar sonra önce "
    "olarak olduğu olduğunu olması olmayan olan olur olabilir ederek etmek eden yapılır yapılan için "
    "içinde arasında üzerinde bütün birlikte herhangi hiçbir bazen genellikle".split()
)


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", s)).casefold().strip()


@dataclass(frozen=True)
class Term:
    text: str
    start: int  # offset inside the sentence
    kind: str  # "num" | "word"

    @property
    def key(self) -> str:
        return norm(self.text)

    @property
    def end(self) -> int:
        return self.start + len(self.text)


@dataclass
class Candidate:
    chunk: IndexedChunk
    sentence: str
    offset: int  # sentence start inside chunk.text
    terms: list[Term]


def split_sentences(text: str) -> list[tuple[int, str]]:
    """(offset, sentence) pairs; every sentence is `text[offset:offset+len(sentence)]`."""
    out: list[tuple[int, str]] = []
    pos = 0
    for m in [*_BOUNDARY.finditer(text), None]:
        end = m.start() if m else len(text)
        seg = text[pos:end]
        lead = len(seg) - len(seg.lstrip())
        seg = seg.strip()
        if seg:
            out.append((pos + lead, seg))
        if m:
            pos = m.end()
    return out


def extract_terms(sentence: str) -> list[Term]:
    terms: list[Term] = []
    first = True
    for m in _WORD.finditer(sentence):
        w = m.group()
        if first:  # sentence-initial capitalisation says nothing about the term
            first = False
            continue
        if len(w) >= MIN_WORD and norm(w) not in _STOP:
            terms.append(Term(w, m.start(), "word"))
    for m in _NUMBER.finditer(sentence):
        terms.append(Term(m.group(), m.start(), "num"))
    return sorted(terms, key=lambda t: t.start)


def _stem(t: str) -> str:
    return norm(t)[:5]


def _seed(request_id: str | None) -> int:
    return int(hashlib.sha256((request_id or "knot-quiz").encode()).hexdigest()[:12], 16)


class QuizGenerator:
    def __init__(self, index: ChunkIndex):
        self._index = index

    def generate(self, req: QuizRequest, request_id: str) -> QuizResponse:
        scope = SearchScope(course_id=req.scope.course_id, document_ids=tuple(req.scope.document_ids))
        raw = self._index.list_chunks(scope, MAX_CHUNKS)
        rej = QuizRejections()
        chunks: list[IndexedChunk] = []
        for c in raw:
            if scope.contains(c):
                chunks.append(c)
            else:
                rej.out_of_scope += 1
        if not chunks:
            if self._index.documents_indexed_elsewhere(scope):
                raise ScopeViolation("The authorized documents do not belong to the requested course.")
            raise IndexNotReady("None of the authorized documents has indexed content yet.")

        rng = random.Random(_seed(request_id))
        p = req.params
        corpus_norm = [norm(c.text) for c in chunks]
        candidates = self._candidates(chunks, p.difficulty, rng)
        pool = self._pool(candidates)

        questions: list[QuizQuestion] = []
        seen_prompts: set[str] = set()
        seen_quotes: set[str] = set()
        types = p.question_types
        tf_made = 0
        for cand in candidates:
            if len(questions) >= p.count:
                break
            qtype = types[len(questions) % len(types)]
            quote_key = norm(cand.sentence)
            if quote_key in seen_quotes:
                rej.duplicate += 1
                continue
            if cand.sentence != cand.chunk.text[cand.offset:cand.offset + len(cand.sentence)]:
                rej.unsupported += 1
                continue
            q = self._build(cand, qtype, tf_made % 2 == 1, p.difficulty, pool, corpus_norm, rej, rng)
            if q is None:
                continue
            pk = norm(q.prompt)
            if pk in seen_prompts:
                rej.duplicate += 1
                continue
            seen_prompts.add(pk)
            seen_quotes.add(quote_key)
            if q.type == QuestionType.TRUE_FALSE:
                tf_made += 1
            questions.append(q)

        warnings: list[str] = []
        if not questions:
            warnings.append("Seçilen materyallerden güvenilir bir soru üretilemedi. Daha fazla metin içeren materyaller seçmeyi dene.")
        elif len(questions) < p.count:
            warnings.append(
                f"İstenen {p.count} sorunun yalnızca {len(questions)} tanesi kaynaklarla doğrulanabilir biçimde üretilebildi."
            )
        log.info("quiz.generated", extra={"request_id": request_id, "requested": p.count, "produced": len(questions),
                                          "rejected": rej.model_dump()})
        return QuizResponse(request_id=request_id, requested=p.count, produced=len(questions), warnings=warnings,
                            rejected=rej, questions=questions)

    # ── candidates ──────────────────────────────────────────────────────────────
    def _candidates(self, chunks: list[IndexedChunk], difficulty: Difficulty, rng: random.Random) -> list[Candidate]:
        per_chunk: list[list[Candidate]] = []
        for c in chunks:
            items = []
            for off, s in split_sentences(c.text):
                if not (MIN_SENTENCE <= len(s) <= MAX_SENTENCE) or len(s.split()) < 6 or "?" in s:
                    continue
                terms = extract_terms(s)
                if terms:
                    items.append(Candidate(c, s, off, terms))
            rng.shuffle(items)
            # easy prefers short sentences, hard prefers long ones; medium keeps the shuffled order
            if difficulty == Difficulty.EASY:
                items.sort(key=lambda x: len(x.sentence))
            elif difficulty == Difficulty.HARD:
                items.sort(key=lambda x: -len(x.sentence))
            per_chunk.append(items)
        order = list(range(len(per_chunk)))
        rng.shuffle(order)
        # Round robin: one sentence per chunk per round spreads questions over pages and documents.
        out: list[Candidate] = []
        for r in range(max((len(x) for x in per_chunk), default=0)):
            for i in order:
                if r < len(per_chunk[i]):
                    out.append(per_chunk[i][r])
        return out

    @staticmethod
    def _pool(candidates: list[Candidate]) -> dict[str, list[tuple[str, str]]]:
        """kind -> [(term, chunk_id)] over every sentence of the selected materials."""
        pool: dict[str, list[tuple[str, str]]] = {"num": [], "word": []}
        seen: set[tuple[str, str]] = set()
        for c in candidates:
            for t in c.terms:
                k = (t.kind, t.key)
                if k not in seen:
                    seen.add(k)
                    pool[t.kind].append((t.text, c.chunk.chunk_id))
        return pool

    # ── question construction ───────────────────────────────────────────────────
    def _build(self, cand, qtype, make_false, difficulty, pool, corpus_norm, rej, rng) -> QuizQuestion | None:
        sentence_norm = norm(cand.sentence)
        chunk_norm = norm(cand.chunk.text)
        # Key term occurs exactly once in the sentence (else the blank is ambiguous).
        usable = []
        for t in cand.terms:
            if sentence_norm.count(t.key) > 1:
                continue
            freq = sum(c.count(t.key) for c in corpus_norm)
            usable.append((freq, -len(t.text), t.start, t))
        if not usable:
            rej.ambiguous += 1
            return None
        usable.sort(key=lambda x: (x[0], x[1], x[2]))
        # harder questions blank a more frequent (more central) term; easier ones a rarer term
        key = usable[-1][3] if difficulty == Difficulty.HARD else usable[0][3]
        distractors = self._distractors(key, cand, sentence_norm, chunk_norm, pool, difficulty, rng)
        if distractors is None:
            rej.ambiguous += 1
            return None

        s = cand.sentence
        start = cand.chunk.location.char_start
        source = QuizSource(
            chunk_id=cand.chunk.chunk_id, document_id=cand.chunk.document.document_id,
            page_start=cand.chunk.location.page_start, page_end=cand.chunk.location.page_end, quote=s,
            char_start=None if start is None else start + cand.offset,
            char_end=None if start is None else start + cand.offset + len(s),
        )
        topic = (cand.chunk.location.section_title or cand.chunk.document.title)[:200]
        quoted = f"Kaynakta şöyle geçiyor: “{s}”"

        if qtype == QuestionType.MULTIPLE_CHOICE:
            options = [key.text] + distractors
            rng.shuffle(options)
            if len({norm(o) for o in options}) != len(options):
                rej.ambiguous += 1
                return None
            stem = s[:key.start] + BLANK + s[key.end:]
            return QuizQuestion(
                type=qtype, prompt=f"Aşağıdaki boşluğa hangisi gelmelidir?\n\n{stem}", options=options,
                correct_index=options.index(key.text), explanation=f"Doğru yanıt: {key.text}. {quoted}",
                topic=topic, difficulty=difficulty, source=source,
            )

        options = ["Doğru", "Yanlış"]
        if not make_false:
            return QuizQuestion(
                type=qtype, prompt=f"Aşağıdaki ifade doğru mu?\n\n{s}", options=options, correct_index=0,
                explanation=f"İfade doğru. {quoted}", topic=topic, difficulty=difficulty, source=source,
            )
        fake = s[:key.start] + distractors[0] + s[key.end:]
        fake_norm = norm(fake)
        if fake_norm == sentence_norm or any(fake_norm in c for c in corpus_norm):
            rej.ambiguous += 1  # the altered statement exists in the materials, so it might be true
            return None
        return QuizQuestion(
            type=qtype, prompt=f"Aşağıdaki ifade doğru mu?\n\n{fake}", options=options, correct_index=1,
            explanation=f"İfade yanlış: “{distractors[0]}” yerine “{key.text}” olmalı. {quoted}",
            topic=topic, difficulty=difficulty, source=source,
        )

    def _distractors(self, key: Term, cand: Candidate, sentence_norm: str, chunk_norm: str,
                     pool, difficulty: Difficulty, rng: random.Random) -> list[str] | None:
        stems = {_stem(key.text) if key.kind == "word" else key.key}
        scored = []
        for text, chunk_id in pool[key.kind]:
            n = norm(text)
            if n == key.key or n in sentence_norm or n in chunk_norm:
                continue
            if key.kind == "word" and _stem(text) in stems:
                continue
            same_suffix = n[-2:] == key.key[-2:]
            gap = abs(len(text) - len(key.text))
            if difficulty == Difficulty.HARD:
                score = (not same_suffix, gap, rng.random())
            elif difficulty == Difficulty.EASY:
                score = (chunk_id == cand.chunk.chunk_id, -gap, rng.random())
            else:
                score = (not same_suffix, rng.random())
            scored.append((score, text))
        scored.sort(key=lambda x: x[0])
        chosen: list[str] = []
        for _, text in scored:
            st = _stem(text) if key.kind == "word" else norm(text)
            if st in stems:
                continue
            stems.add(st)
            chosen.append(text[:1].upper() + text[1:] if key.kind == "word" and key.text[:1].isupper() else text)
            if len(chosen) == N_DISTRACTORS:
                return chosen
        return None
