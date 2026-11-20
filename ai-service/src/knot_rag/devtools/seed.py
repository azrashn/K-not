"""Load a corpus JSON (list of `IndexedChunk`) into the configured Chroma collection.

For local development and demos only; real indexing is WBS-2's responsibility. Uses the
same writer contract (`ChromaChunkWriter`) WBS-2 is expected to follow.

    CHROMA_MODE=persistent EMBEDDING_BACKEND=hashing python -m knot_rag.devtools.seed tests/fixtures/corpus.json
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from knot_rag.config import Settings
from knot_rag.retrieval.chroma_index import ChromaChunkWriter, build_chroma_client
from knot_rag.retrieval.embedding import build_embedder
from knot_rag.schemas import EmbeddingConfiguration, IndexedChunk


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print(__doc__)
        return 2
    env = dict(os.environ)
    env.setdefault("RAG_AUTH_DISABLED", "true")  # the seed tool does not serve HTTP
    s = Settings.from_env(env)
    data = json.loads(Path(argv[0]).read_text(encoding="utf-8"))
    chunks = [IndexedChunk.model_validate(c) for c in data["chunks"]]
    embedder = build_embedder(s.embedding_backend, s.embedding_model, s.embedding_query_prefix, s.embedding_document_prefix, s.embedding_revision)
    client = build_chroma_client(s.chroma_mode, s.chroma_host, s.chroma_port, s.chroma_path)
    config = EmbeddingConfiguration.from_settings(s, embedder.dimension)
    n = ChromaChunkWriter(client, s.chroma_collection, embedder, configuration=config).upsert(chunks)
    print(f"Upserted {n} chunks into '{s.chroma_collection}' using {embedder.model_id}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
