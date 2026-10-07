"""ChromaDB adapter: scoped reads (WBS-3) and the reference writer for the WBS-2 contract.

Collection layout (contract with WBS-2):
  * one collection per embedding model + chunking scheme, default `knot_chunks_v1`;
  * collection metadata: `hnsw:space="cosine"`, `embedding_model`, `embedding_dim`;
  * record id == `chunk_id`; document == chunk text (UTF-8, NFC); metadata keys from
    `knot_rag.schemas.documents` (`course_id`, `document_id`, `page_start`, ...).
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Sequence

from knot_rag.errors import ConfigurationError, IndexNotReady, RagError, RetrievalUnavailable
from knot_rag.retrieval.embedding import Embedder
from knot_rag.retrieval.index import ChunkHit, IndexInfo, SearchScope
from knot_rag.schemas.documents import META_COURSE_ID, META_DOCUMENT_ID, IndexedChunk

log = logging.getLogger(__name__)

COLLECTION_META_MODEL = "embedding_model"
COLLECTION_META_DIM = "embedding_dim"


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

    def __init__(self, client: Any | Callable[[], Any], collection_name: str, embedder: Embedder):
        self._client_or_factory = client
        self._client = None if callable(client) and not hasattr(client, "list_collections") else client
        self._name = collection_name
        self._embedder = embedder
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


class ChromaChunkWriter:
    """Reference implementation of the WBS-2 write contract. Used by fixtures, the dev seed
    script and integration tests; WBS-2 may call it directly or reproduce its behaviour."""

    def __init__(self, client: Any, collection_name: str, embedder: Embedder):
        self._client = client
        self._name = collection_name
        self._embedder = embedder

    def ensure_collection(self):
        return self._client.get_or_create_collection(
            self._name,
            metadata={
                "hnsw:space": "cosine",
                COLLECTION_META_MODEL: self._embedder.model_id,
                COLLECTION_META_DIM: self._embedder.dimension,
            },
            embedding_function=None,
        )

    def upsert(self, chunks: Sequence[IndexedChunk], batch_size: int = 128) -> int:
        col = self.ensure_collection()
        meta = col.metadata or {}
        if meta.get(COLLECTION_META_MODEL) not in (None, self._embedder.model_id):
            raise ConfigurationError("Refusing to write embeddings from a different model into this collection.")
        for i in range(0, len(chunks), batch_size):
            batch = list(chunks[i:i + batch_size])
            col.upsert(
                ids=[c.chunk_id for c in batch],
                documents=[c.text for c in batch],
                metadatas=[c.to_chroma_metadata() for c in batch],
                embeddings=self._embedder.embed_documents([c.text for c in batch]),
            )
        return len(chunks)

    def delete_document(self, document_id: str) -> None:
        self.ensure_collection().delete(where={META_DOCUMENT_ID: {"$eq": document_id}})


def build_chroma_client(mode: str, host: str, port: int, path: str):
    import chromadb

    if mode == "http":
        return chromadb.HttpClient(host=host, port=port)
    if mode == "persistent":
        return chromadb.PersistentClient(path=path)
    if mode == "memory":
        return chromadb.EphemeralClient()
    raise ConfigurationError(f"Unknown CHROMA_MODE: {mode!r}")
