"""K-not WBS-2: document ingestion (PDF → page text → chunks → embeddings → ChromaDB).

Runs inside the WBS-3 deployable (ADR-009) and reuses its contract code
(`knot_rag.schemas.documents`, `knot_rag.schemas.embedding`, `ChromaChunkWriter`).
Contracts: docs/architecture/document-contract.md (`ingest.v1`, `pages.v1`).
"""

INGEST_SCHEMA_VERSION = "ingest.v1"
PAGES_SCHEMA_VERSION = "pages.v1"

__all__ = ["INGEST_SCHEMA_VERSION", "PAGES_SCHEMA_VERSION"]
