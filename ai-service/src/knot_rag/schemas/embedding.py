"""`EmbeddingConfiguration` (C-1, ADR-006): the complete description of how vectors in one
Chroma collection were produced. WBS-2 (documents) and WBS-3 (queries) must use an identical
configuration; the collection is stamped with it and both sides verify the stamp.

See docs/architecture/document-contract.md §4.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from pydantic import Field

from knot_rag.schemas.common import StrictModel

# Collection metadata keys. The first three predate C-1; the rest are the C-1 additions.
STAMP_MODEL = "embedding_model"
STAMP_DIM = "embedding_dim"
STAMP_SPACE = "hnsw:space"
STAMP_BACKEND = "embedding_backend"
STAMP_REVISION = "embedding_revision"
STAMP_QUERY_PREFIX = "embedding_query_prefix"
STAMP_DOCUMENT_PREFIX = "embedding_document_prefix"
STAMP_NORMALIZE = "embedding_normalize"
STAMP_FINGERPRINT = "embedding_fingerprint"
STAMP_INDEX_VERSION_ID = "index_version_id"

# What the existing embedders produce. Anything else cannot be honoured.
SUPPORTED_NORMALIZE = True
SUPPORTED_DISTANCE = "cosine"


class EmbeddingConfiguration(StrictModel):
    backend: str = Field(min_length=1, description="`sentence_transformers` (production) or `hashing` (tests only).")
    model: str = Field(min_length=1)
    revision: str | None = Field(default=None, description="Model commit hash; null = not pinned (PROVISIONAL).")
    dimension: int = Field(ge=1)
    query_prefix: str = ""
    document_prefix: str = ""
    normalize: bool = True
    distance: str = "cosine"

    @classmethod
    def from_settings(cls, settings: Any, dimension: int) -> "EmbeddingConfiguration":
        """The WBS-3 query-side configuration. `dimension` comes from the loaded model."""
        return cls(
            backend=settings.embedding_backend,
            model=settings.embedding_model,
            revision=settings.embedding_revision or None,
            dimension=dimension,
            query_prefix=settings.embedding_query_prefix,
            document_prefix=settings.embedding_document_prefix,
        )

    def fingerprint(self) -> str:
        payload = json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def unsupported_reason(self) -> str | None:
        """Why the existing embedders cannot produce this configuration, if they cannot."""
        if self.normalize is not SUPPORTED_NORMALIZE:
            return "Only normalized embeddings are supported."
        if self.distance != SUPPORTED_DISTANCE:
            return "Only the cosine distance is supported."
        return None

    def collection_stamp(self, model_id: str, index_version_id: str | None = None) -> dict[str, str | int | bool]:
        """Full collection metadata. `embedding_model` keeps its pre-C-1 meaning (the
        embedder's `model_id`) so legacy readers keep working."""
        stamp: dict[str, str | int | bool] = {
            STAMP_SPACE: self.distance,
            STAMP_MODEL: model_id,
            STAMP_DIM: self.dimension,
            STAMP_BACKEND: self.backend,
            STAMP_REVISION: self.revision or "",
            STAMP_QUERY_PREFIX: self.query_prefix,
            STAMP_DOCUMENT_PREFIX: self.document_prefix,
            STAMP_NORMALIZE: self.normalize,
            STAMP_FINGERPRINT: self.fingerprint(),
        }
        if index_version_id:
            stamp[STAMP_INDEX_VERSION_ID] = index_version_id
        return stamp


def stamp_differences(stamp: dict[str, Any], expected: dict[str, Any]) -> list[str]:
    """Names of the stamp keys whose values differ (for error details; never values of text)."""
    keys = [k for k in expected if k != STAMP_INDEX_VERSION_ID]
    return sorted(k for k in keys if stamp.get(k) != expected[k])
