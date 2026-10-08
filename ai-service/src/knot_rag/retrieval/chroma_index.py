"""ChromaDB adapter: scoped reads (WBS-3) and the reference writer for the WBS-2 contract.

Collection layout (contract with WBS-2):
  * one collection per embedding configuration (`IndexVersion`), default `knot_chunks_v1`;
  * collection metadata ("stamp"): `hnsw:space="cosine"`, `embedding_model`, `embedding_dim`
    and, since C-1 (ADR-006), the full `EmbeddingConfiguration` plus its fingerprint and the
    optional `index_version_id`. Collections without a fingerprint are "legacy" stamps;
  * record id == `chunk_id`; document == chunk text (UTF-8, NFC); metadata keys from
    `knot_rag.schemas.documents` (`course_id`, `document_id`, `page_start`, ...).
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Sequence, Union

from knot_rag.errors import ConfigurationError, IndexNotReady, RagError, RetrievalUnavailable
from knot_rag.retrieval.embedding import Embedder
from knot_rag.retrieval.index import ChunkHit, IndexInfo, SearchScope
from knot_rag.schemas.documents import META_COURSE_ID, META_DOCUMENT_ID, META_EXTRA_PREFIX, IndexedChunk
from knot_rag.schemas.embedding import (
    STAMP_DIM,
    STAMP_FINGERPRINT,
    STAMP_INDEX_VERSION_ID,
    STAMP_MODEL,
    EmbeddingConfiguration,
    stamp_differences,
)

log = logging.getLogger(__name__)

COLLECTION_META_MODEL = STAMP_MODEL
COLLECTION_META_DIM = STAMP_DIM
META_JOB_ID = f"{META_EXTRA_PREFIX}job_id"

# A configuration, or a zero-argument factory for it (resolved lazily, because computing the
# fingerprint needs the model's dimension and the model is loaded lazily).
ConfigurationSource = Union[EmbeddingConfiguration, Callable[[], EmbeddingConfiguration], None]


def _resolve(source: ConfigurationSource) -> EmbeddingConfiguration | None:
    return source() if callable(source) else source


def scope_filter(scope: SearchScope) -> dict[str, Any]:
    return {
        "$and": [
            {META_COURSE_ID: {"$eq": scope.course_id}},
            {META_DOCUMENT_ID: {"$in": list(scope.document_ids)}},
        ]
    }


class ChromaChunkIndex:
    """Read-side adapter. Never creates collections: a missing collection means WBS-2 has
    not indexed anything yet (INDEX_NOT_READY), not that we should build our own.

    `client` may be a Chroma client or a zero-argument factory. A factory is connected lazily,
    so the service starts (and reports `/ready` = 503) while ChromaDB is still down.
    """

    def __init__(
        self,
        client: Any | Callable[[], Any],
        collection_name: str,
        embedder: Embedder,
        configuration: ConfigurationSource = None,
    ):
        self._client_or_factory = client
        self._client = None if callable(client) and not hasattr(client, "list_collections") else client
        self._name = collection_name
        self._embedder = embedder
        self._configuration = configuration
        self._collection = None
        self._space = "l2"

    def _get_client(self):
        if self._client is None:
            try:
                self._client = self._client_or_factory()
            except Exception as exc:
                raise RetrievalUnavailable() from exc
        return self._client

    def _get_collection(self):
        if self._collection is not None:
            return self._collection
        client = self._get_client()
        try:
            names = {getattr(c, "name", c) for c in client.list_collections()}
        except Exception as exc:
            raise RetrievalUnavailable() from exc
        if self._name not in names:
            raise IndexNotReady(f"Collection '{self._name}' does not exist yet.")
        try:
            col = client.get_collection(self._name)
        except Exception as exc:
            raise RetrievalUnavailable() from exc
        self._check_compatibility(col.metadata or {})
        self._collection = col
        return col

    def _unavailable(self, exc: Exception) -> RetrievalUnavailable:
        # Drop cached handles: the collection may have been recreated by WBS-2.
        self._collection = None
        log.warning("rag.index.call_failed", extra={"collection": self._name, "error_type": type(exc).__name__})
        return RetrievalUnavailable()

    def _check_compatibility(self, meta: dict[str, Any]) -> None:
        config = _resolve(self._configuration)
        if config is not None and meta.get(STAMP_FINGERPRINT) is not None:
            # C-1: the full configuration must match, not only model and dimension.
            if meta[STAMP_FINGERPRINT] != config.fingerprint():
                raise ConfigurationError(
                    "Query embedding configuration does not match the index.",
                    details={
                        "collection": self._name,
                        "mismatched_keys": stamp_differences(meta, config.collection_stamp(self._embedder.model_id)),
                        "index_fingerprint": meta[STAMP_FINGERPRINT],
                        "query_fingerprint": config.fingerprint(),
                    },
                )
        elif meta.get(COLLECTION_META_MODEL) is not None:
            log.warning("rag.index.legacy_stamp", extra={"collection": self._name})
        self._check_model_and_dimension(meta)

    def _check_model_and_dimension(self, meta: dict[str, Any]) -> None:
        model = meta.get(COLLECTION_META_MODEL)
        dim = meta.get(COLLECTION_META_DIM)
        if model is None:
            log.warning("rag.index.unstamped_collection", extra={"collection": self._name})
        elif model != self._embedder.model_id:
            raise ConfigurationError(
                "Query embedding model does not match the index.",
                details={"index_model": model, "query_model": self._embedder.model_id},
            )
        if dim is not None and int(dim) != self._embedder.dimension:
            raise ConfigurationError(
                "Query embedding dimension does not match the index.",
                details={"index_dim": dim, "query_dim": self._embedder.dimension},
            )
        space = meta.get("hnsw:space", "l2")
        self._space = space

    def info(self) -> IndexInfo:
        col = self._get_collection()
        try:
            count = col.count()
        except Exception as exc:
            raise self._unavailable(exc) from exc
        meta = col.metadata or {}
        return IndexInfo(
            collection=self._name,
            embedding_model=meta.get(COLLECTION_META_MODEL),
            embedding_dim=meta.get(COLLECTION_META_DIM),
            chunk_count=count,
            embedding_fingerprint=meta.get(STAMP_FINGERPRINT),
            index_version_id=meta.get(STAMP_INDEX_VERSION_ID),
        )

    def count_in_scope(self, scope: SearchScope) -> int:
        col = self._get_collection()
        try:
            res = col.get(where=scope_filter(scope), limit=1, include=[])
        except Exception as exc:
            raise self._unavailable(exc) from exc
        return len(res.get("ids") or [])

    def documents_indexed_elsewhere(self, scope: SearchScope) -> bool:
        col = self._get_collection()
        where = {"$and": [
            {META_DOCUMENT_ID: {"$in": list(scope.document_ids)}},
            {META_COURSE_ID: {"$ne": scope.course_id}},
        ]}
        try:
            res = col.get(where=where, limit=1, include=[])
        except Exception as exc:
            raise self._unavailable(exc) from exc
        return bool(res.get("ids"))

    def _score(self, distance: float | None) -> float | None:
        if distance is None:
            return None
        if self._space in ("cosine", "ip"):
            return round(1.0 - float(distance), 6)
        return None  # L2 distances are not comparable to a similarity scale.

    def search(self, query_embedding: list[float], scope: SearchScope, k: int) -> list[ChunkHit]:
        col = self._get_collection()
        if len(query_embedding) != self._embedder.dimension:
            raise ConfigurationError("Query embedding has an unexpected dimension.")
        try:
            res = col.query(
                query_embeddings=[query_embedding],
                n_results=k,
                where=scope_filter(scope),
                include=["documents", "metadatas", "distances"],
            )
        except RagError:
            raise
        except Exception as exc:
            raise self._unavailable(exc) from exc
        ids = (res.get("ids") or [[]])[0]
        docs = (res.get("documents") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        dists = (res.get("distances") or [[None] * len(ids)])[0]
        hits: list[ChunkHit] = []
        for rank, (cid, text, meta, dist) in enumerate(zip(ids, docs, metas, dists), start=1):
            try:
                chunk = IndexedChunk.from_chroma(cid, text or "", meta or {})
            except Exception:
                log.warning("rag.index.malformed_record", extra={"chunk_id": cid})
                continue
            hits.append(ChunkHit(chunk=chunk, score=self._score(dist), rank=rank))
        return hits

    def get_chunks(self, chunk_ids: list[str], scope: SearchScope) -> list[IndexedChunk]:
        if not chunk_ids:
            return []
        col = self._get_collection()
        try:
            res = col.get(ids=list(chunk_ids), where=scope_filter(scope), include=["documents", "metadatas"])
        except Exception as exc:
            raise self._unavailable(exc) from exc
        chunks = [
            IndexedChunk.from_chroma(cid, text or "", meta or {})
            for cid, text, meta in zip(res.get("ids") or [], res.get("documents") or [], res.get("metadatas") or [])
        ]
        return [c for c in chunks if scope.contains(c)]


def _document_where(document_id: str) -> dict[str, Any]:
    return {META_DOCUMENT_ID: {"$eq": document_id}}


def document_chunk_job_ids(collection: Any, document_id: str) -> dict[str, str | None]:
    """`chunk_id → x_job_id` (None if untagged) for one document. Read-only; no text."""
    res = collection.get(where=_document_where(document_id), include=["metadatas"])
    return {cid: (meta or {}).get(META_JOB_ID) for cid, meta in zip(res.get("ids") or [], res.get("metadatas") or [])}


def count_document_chunks(collection: Any, document_id: str, exclude_job_id: str | None = None) -> int:
    """Chunks of a document; with `exclude_job_id`, only those NOT written by that job
    (untagged chunks count as foreign)."""
    tags = document_chunk_job_ids(collection, document_id)
    if exclude_job_id is None:
        return len(tags)
    return sum(1 for job in tags.values() if job != exclude_job_id)


def delete_document_chunks(collection: Any, document_id: str, exclude_job_id: str | None = None) -> int:
    """Delete a document's chunks (with `exclude_job_id`: only the foreign ones). Returns
    the number deleted. Idempotent."""
    tags = document_chunk_job_ids(collection, document_id)
    ids = [cid for cid, job in tags.items() if exclude_job_id is None or job != exclude_job_id]
    if ids:
        collection.delete(ids=ids)
    return len(ids)


class ChromaChunkWriter:
    """Write path (owned by WBS-2, ADR-007). Also used by fixtures, the dev seed script and
    the evaluation harness.

    With a `configuration` (C-1), new collections get the full stamp and writes into a
    collection stamped with any other configuration — or with a legacy, fingerprint-less
    stamp — are refused. Without one, the pre-C-1 behaviour (model + dimension) applies.
    """

    def __init__(
        self,
        client: Any,
        collection_name: str,
        embedder: Embedder,
        configuration: EmbeddingConfiguration | None = None,
        index_version_id: str | None = None,
    ):
        self._client = client
        self._name = collection_name
        self._embedder = embedder
        self._config = configuration
        self._index_version_id = index_version_id

    @property
    def collection_name(self) -> str:
        return self._name

    def expected_stamp(self) -> dict[str, Any]:
        if self._config is None:
            return {
                "hnsw:space": "cosine",
                COLLECTION_META_MODEL: self._embedder.model_id,
                COLLECTION_META_DIM: self._embedder.dimension,
            }
        if self._config.dimension != self._embedder.dimension:
            raise ConfigurationError(
                "The embedding model dimension does not match the configuration.",
                details={"configured": self._config.dimension, "model": self._embedder.dimension},
            )
        return self._config.collection_stamp(self._embedder.model_id, self._index_version_id)

    def check_stamp(self, meta: dict[str, Any]) -> None:
        """Raise `ConfigurationError` unless this writer may write into a collection with
        this metadata."""
        if self._config is None:
            if meta.get(COLLECTION_META_MODEL) not in (None, self._embedder.model_id):
                raise ConfigurationError("Refusing to write embeddings from a different model into this collection.")
            if meta.get(COLLECTION_META_DIM) not in (None, self._embedder.dimension):
                raise ConfigurationError("Refusing to write embeddings of a different dimension into this collection.")
            return
        expected = self.expected_stamp()
        if meta.get(STAMP_FINGERPRINT) != expected[STAMP_FINGERPRINT]:
            raise ConfigurationError(
                "The collection is stamped with a different embedding configuration.",
                details={
                    "collection": self._name,
                    "mismatched_keys": stamp_differences(meta, expected),
                    "collection_fingerprint": meta.get(STAMP_FINGERPRINT),
                    "expected_fingerprint": expected[STAMP_FINGERPRINT],
                },
            )
        stamped_iv = meta.get(STAMP_INDEX_VERSION_ID)
        if self._index_version_id and stamped_iv and stamped_iv != self._index_version_id:
            raise ConfigurationError(
                "The collection belongs to a different index version.",
                details={"collection": self._name, "index_version_id": stamped_iv},
            )

    def existing_collection(self):
        """The collection if it exists (stamp verified), else None. Never creates."""
        names = {getattr(c, "name", c) for c in self._client.list_collections()}
        if self._name not in names:
            return None
        col = self._client.get_collection(self._name)
        self.check_stamp(col.metadata or {})
        return col

    def ensure_collection(self):
        col = self.existing_collection()
        if col is not None:
            return col
        return self._client.get_or_create_collection(self._name, metadata=self.expected_stamp(), embedding_function=None)

    def upsert(
        self,
        chunks: Sequence[IndexedChunk],
        embeddings: Sequence[Sequence[float]] | None = None,
        batch_size: int = 128,
    ) -> int:
        """Write chunks. With `embeddings` (one vector per chunk, precomputed by the caller's
        EMBEDDING stage) nothing is embedded here; otherwise the writer embeds."""
        if embeddings is not None and len(embeddings) != len(chunks):
            raise ValueError("embeddings must contain exactly one vector per chunk")
        col = self.ensure_collection()
        dim = self._embedder.dimension
        for i in range(0, len(chunks), batch_size):
            batch = list(chunks[i:i + batch_size])
            if embeddings is None:
                vectors = self._embedder.embed_documents([c.text for c in batch])
            else:
                vectors = [list(v) for v in embeddings[i:i + batch_size]]
            if any(len(v) != dim for v in vectors):
                raise ConfigurationError("An embedding has an unexpected dimension.")
            col.upsert(
                ids=[c.chunk_id for c in batch],
                documents=[c.text for c in batch],
                metadatas=[c.to_chroma_metadata() for c in batch],
                embeddings=vectors,
            )
        return len(chunks)

    def count(self, document_id: str, exclude_job_id: str | None = None) -> int:
        col = self.existing_collection()
        return 0 if col is None else count_document_chunks(col, document_id, exclude_job_id)

    def delete_document(self, document_id: str, exclude_job_id: str | None = None) -> int:
        """Delete the document's chunks (only the ones not written by `exclude_job_id`, if
        given). Returns the number deleted; a missing collection deletes nothing."""
        col = self.existing_collection()
        return 0 if col is None else delete_document_chunks(col, document_id, exclude_job_id)


def build_chroma_client(mode: str, host: str, port: int, path: str):
    import chromadb

    if mode == "http":
        return chromadb.HttpClient(host=host, port=port)
    if mode == "persistent":
        return chromadb.PersistentClient(path=path)
    if mode == "memory":
        return chromadb.EphemeralClient()
    raise ConfigurationError(f"Unknown CHROMA_MODE: {mode!r}")
