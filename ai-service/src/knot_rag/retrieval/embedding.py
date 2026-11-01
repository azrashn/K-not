"""Embedding backends.

The query embedder MUST be the same model WBS-2 used to index. The Chroma collection is
stamped with `embedding_model` / `embedding_dim` metadata and `ChromaChunkIndex` refuses to
query a collection built with a different model.
"""

from __future__ import annotations

import hashlib
import math
import threading
from typing import Protocol, Sequence

from knot_rag.errors import ConfigurationError
from knot_rag.text import fold


class Embedder(Protocol):
    @property
    def model_id(self) -> str: ...

    @property
    def dimension(self) -> int: ...

    def embed_query(self, text: str) -> list[float]: ...

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...


class HashingEmbedder:
    """Deterministic, dependency-free lexical embedder (word + char n-gram feature hashing).

    For tests, CI and offline development only. It captures surface overlap, not meaning,
    so it is NOT a substitute for the multilingual model in production. Retrieval metrics
    measured with it are a lower-bound baseline and must be labelled as such.
    """

    def __init__(self, dimension: int = 512, ngram_range: tuple[int, int] = (3, 5)):
        self._dim = dimension
        self._ngrams = ngram_range

    @property
    def model_id(self) -> str:
        return f"knot-hashing-v1-d{self._dim}"

    @property
    def dimension(self) -> int:
        return self._dim

    def _features(self, text: str) -> list[str]:
        t = fold(text)
        words = [w for w in "".join(c if c.isalnum() else " " for c in t).split() if w]
        feats = [f"w:{w}" for w in words]
        lo, hi = self._ngrams
        for w in words:
            padded = f"#{w}#"
            for n in range(lo, hi + 1):
                feats.extend(f"c{n}:{padded[i:i + n]}" for i in range(max(0, len(padded) - n + 1)))
        return feats

    def _embed(self, text: str) -> list[float]:
        vec = [0.0] * self._dim
        for f in self._features(text):
            h = hashlib.blake2b(f.encode("utf-8"), digest_size=8).digest()
            idx = int.from_bytes(h[:4], "little") % self._dim
            sign = 1.0 if h[4] & 1 else -1.0
            vec[idx] += sign * (2.0 if f.startswith("w:") else 1.0)
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]

    def embed_query(self, text: str) -> list[float]:
        return self._embed(text)

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return [self._embed(t) for t in texts]


class SentenceTransformerEmbedder:
    """Multilingual sentence-transformers model (default
    `paraphrase-multilingual-MiniLM-L12-v2`, 384-d, supports Turkish). Loaded lazily and
    once; thread-safe for concurrent requests. E5-style models need `query_prefix="query: "`
    and WBS-2 must then index with `"passage: "`."""

    def __init__(self, model_name: str, query_prefix: str = "", document_prefix: str = "", revision: str | None = None):
        self._name = model_name
        self._qp = query_prefix
        self._dp = document_prefix
        self._revision = revision or None
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    try:
                        from sentence_transformers import SentenceTransformer
                    except ImportError as exc:  # pragma: no cover - depends on optional extra
                        raise ConfigurationError(
                            "EMBEDDING_BACKEND=sentence_transformers requires `pip install knot-rag[embeddings]`."
                        ) from exc
                    self._model = SentenceTransformer(self._name, revision=self._revision)
        return self._model

    @property
    def model_id(self) -> str:
        return self._name

    @property
    def dimension(self) -> int:
        return int(self._load().get_sentence_embedding_dimension())

    def embed_query(self, text: str) -> list[float]:
        return self._load().encode(self._qp + text, normalize_embeddings=True).tolist()

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        return self._load().encode([self._dp + t for t in texts], normalize_embeddings=True).tolist()


def build_embedder(
    backend: str, model: str, query_prefix: str = "", document_prefix: str = "", revision: str | None = None,
    dimension: int = 512,
) -> Embedder:
    if backend == "hashing":
        return HashingEmbedder(dimension=dimension)
    if backend == "sentence_transformers":
        return SentenceTransformerEmbedder(model, query_prefix=query_prefix, document_prefix=document_prefix, revision=revision)
    raise ConfigurationError(f"Unknown EMBEDDING_BACKEND: {backend!r}")
