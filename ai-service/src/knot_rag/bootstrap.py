"""Composition root: the only place that turns configuration into concrete objects."""

from __future__ import annotations

from dataclasses import dataclass

from knot_rag.config import Settings
from knot_rag.context.builder import ContextBuilder
from knot_rag.evidence.mapper import EvidenceMapper
from knot_rag.evidence.judge import LLMJudgeSupportAssessor
from knot_rag.evidence.support import HeuristicSupportAssessor, SupportAssessor
from knot_rag.generation.generator import GroundedGenerator
from knot_rag.generation.providers import LLMProvider, build_provider
from knot_rag.pipeline import RagService
from knot_rag.retrieval.chroma_index import ChromaChunkIndex, build_chroma_client
from knot_rag.retrieval.embedding import Embedder, build_embedder
from knot_rag.retrieval.index import ChunkIndex
from knot_rag.retrieval.service import RetrievalService


@dataclass
class Components:
    settings: Settings
    index: ChunkIndex
    embedder: Embedder
    provider: LLMProvider
    rag: RagService


def build_components(
    settings: Settings,
    *,
    index: ChunkIndex | None = None,
    embedder: Embedder | None = None,
    provider: LLMProvider | None = None,
    chroma_client=None,
    judge_provider: LLMProvider | None = None,
) -> Components:
    embedder = embedder or build_embedder(
        settings.embedding_backend, settings.embedding_model, settings.embedding_query_prefix,
        settings.embedding_document_prefix, settings.embedding_revision,
    )
    if index is None:
        client = chroma_client or (
            lambda: build_chroma_client(settings.chroma_mode, settings.chroma_host, settings.chroma_port, settings.chroma_path)
        )
        index = ChromaChunkIndex(client, settings.chroma_collection, embedder)
    provider = provider or build_provider(settings.llm)
    assessor: SupportAssessor = HeuristicSupportAssessor(settings.support)
    if settings.support.judge == "llm":
        assessor = LLMJudgeSupportAssessor(assessor, judge_provider or provider, settings.llm)
    rag = RagService(
        retrieval=RetrievalService(index, embedder, settings.retrieval),
        context_builder=ContextBuilder(settings.retrieval),
        generator=GroundedGenerator(provider, settings.llm),
        mapper=EvidenceMapper(),
        assessor=assessor,
        log_questions=settings.log_questions,
        support_settings=settings.support,
    )
    return Components(settings=settings, index=index, embedder=embedder, provider=provider, rag=rag)
