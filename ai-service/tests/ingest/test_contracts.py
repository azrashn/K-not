"""T1: the ingest.v1 / pages.v1 examples in docs/architecture parse with the WBS-2 models, and
the shared examples agree with each other (offsets, fingerprint, chunk ids)."""

import json
import re
from pathlib import Path

import pytest

from knot_ingest.chunking import chunk_id
from knot_ingest.schemas import (
    IngestionEvent,
    IngestionJobRequest,
    JobAccepted,
    PageArtifact,
    ReconcileRequest,
    VerifyRequest,
)
from knot_rag.schemas.documents import IndexedChunk

DOCS = Path(__file__).resolve().parents[3] / "docs" / "architecture"


def examples(name: str) -> list[dict]:
    text = (DOCS / "document-contract.md").read_text(encoding="utf-8")
    pattern = re.compile(rf"<!-- contract: {name} -->\s*```json\n(.*?)```", re.DOTALL)
    return [json.loads(m) for m in pattern.findall(text)]


def test_job_request_example_parses():
    (req,) = examples("IngestionJobRequest")
    model = IngestionJobRequest.model_validate(req)
    assert model.index.embedding.fingerprint() == model.index.embedding_fingerprint
    assert model.document.page_count is None and model.kind.value == "INITIAL"


def test_event_examples_parse():
    succeeded, failed = examples("IngestionEvent")
    s = IngestionEvent.model_validate(succeeded)
    f = IngestionEvent.model_validate(failed)
    assert s.result.chunk_count == 2 and s.result.pages_artifact_key == "documents/cm2k8x1q0000108l4h7r2c9ab/pages.c1.json"
    assert f.error.code == "NO_TEXT_LAYER" and f.error.retryable is False
    # Our serialization keeps the documented timestamp format.
    assert s.model_dump(mode="json")["emitted_at"] == "2026-10-07T21:14:03Z"


def test_page_artifact_example_parses_and_matches_the_chunk_example():
    (art,) = examples("PageArtifact")
    artifact = PageArtifact.model_validate(art)
    (chunk,) = examples("IndexedChunk")
    c = IndexedChunk.model_validate(chunk)
    text = artifact.document_text()
    assert c.text == text[c.location.char_start:c.location.char_end]
    assert c.chunk_id == chunk_id(c.document.document_id, c.document.indexing_version, 2)


def test_api_examples_parse():
    text = (DOCS / "api-contracts.md").read_text(encoding="utf-8")
    accepted = json.loads(re.search(r"`202 (\{.*?\})`", text).group(1).replace('"…"', '"job-1"'))
    JobAccepted.model_validate(accepted)
    ReconcileRequest.model_validate(json.loads(re.search(r'(\{ "collection": "knot_chunks_v1".*?\})\n', text).group(1)))
    VerifyRequest.model_validate(json.loads(re.search(r'(\{ "collection": "knot_chunks_v2".*?\] \})', text).group(1)))


@pytest.mark.parametrize("mutate", [
    lambda a: a["pages"][1].update(char_start=39),
    lambda a: a.update(page_count=4),
    lambda a: a["pages"][2].update(page=4),
    lambda a: a.update(separator="\n"),
])
def test_page_artifact_invariants_are_enforced(mutate):
    (art,) = examples("PageArtifact")
    mutate(art)
    with pytest.raises(ValueError):
        PageArtifact.model_validate(art)


def test_succeeded_requires_a_complete_result():
    succeeded, _ = examples("IngestionEvent")
    succeeded["result"].pop("pages_artifact_key")
    with pytest.raises(ValueError):
        IngestionEvent.model_validate(succeeded)


def test_job_request_rejects_unknown_fields_and_bad_checksums():
    (req,) = examples("IngestionJobRequest")
    with pytest.raises(ValueError):
        IngestionJobRequest.model_validate({**req, "unexpected": 1})
    bad = json.loads(json.dumps(req))
    bad["source"]["sha256"] = "XYZ"
    with pytest.raises(ValueError):
        IngestionJobRequest.model_validate(bad)
