"""API validation tests; hashing and model/subprocess doubles, NOT real AI evidence.
Real original PDF/PPTX rendering is exercised by test-product-local.cjs.
"""

import base64
from pathlib import Path
import pytest
from pypdf import PdfWriter
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from knot_rag.api import create_app
from knot_rag.bootstrap import build_components
from knot_rag.config import Settings
from knot_rag.generation.providers.base import LLMResponse
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
from knot_rag.visuals import Visual, render, purge, scope

AUTH = {"Authorization": "Bearer product-tests-token"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("UNIFIED_LLM_BASE_URL", raising=False)
    app = create_app(
        build_components(
            Settings(
                internal_api_token="product-tests-token",
                embedding_backend="hashing",
                chroma_mode="memory",
            )
        )
    )
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize("kind", ["CLOZE", "SHORT_ANSWER", "TRUE_FALSE", "OPEN"])
def test_quiz_types_have_exact_source_and_honest_assessment(client, kind, monkeypatch):
    text = "Chlorophyll absorbs sunlight during photosynthesis."
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "test-double")
    draft = {
        "question": (
            "Explain how light energy is absorbed in plants."
            if kind == "OPEN"
            else (
                "_____ absorbs sunlight during photosynthesis."
                if kind == "CLOZE"
                else (
                    "Chlorophyll absorbs sunlight."
                    if kind == "TRUE_FALSE"
                    else "Which pigment absorbs sunlight during photosynthesis?"
                )
            )
        ),
        "objective": "Understand the mechanism of light absorption.",
        "options": ["Doğru", "Yanlış"] if kind == "TRUE_FALSE" else [],
        "expected": (
            "" if kind == "OPEN" else "0" if kind == "TRUE_FALSE" else "Chlorophyll"
        ),
        "quote": text,
        "source_index": 1,
        "explanation": "The source explicitly describes how light is absorbed.",
        "option_feedback": (
            [
                "This statement agrees with the quoted source.",
                "This contradicts the quoted source.",
            ]
            if kind == "TRUE_FALSE"
            else []
        ),
    }

    def complete(self, request):
        import json

        return LLMResponse(
            text=json.dumps(
                {
                    "expected": draft["expected"],
                    "clear": True,
                    "topic_related": True,
                    "answer_supported": True,
                    "single_correct": True,
                    "distractors_valid": True,
                    "option_judgments": [
                        {
                            "index": i,
                            "correct": str(i) == draft["expected"],
                            "reason": "This option agrees or conflicts with the source statement.",
                        }
                        for i in range(len(draft["options"]))
                    ],
                }
                if "Independently solve" in request.system
                else draft
            )
        )

    monkeypatch.setattr(OpenAICompatibleProvider, "complete", complete)
    r = client.post(
        "/api/v1/knowledge/quiz",
        headers=AUTH,
        json={"question": "photosynthesis", "kind": kind, "evidence": [{"text": text}]},
    )
    assert r.status_code == 200
    q = r.json()
    assert (
        q["kind"] == kind
        and q["quote"] == text
        and q["experimental"] is True
        and q["quality"]["truth_verified"] is False
    )
    if kind in ("CLOZE", "SHORT_ANSWER"):
        assert q["expected"] in text
    if kind == "CLOZE":
        assert "_____" in q["question"]
    if kind == "OPEN":
        assert q["assessment"] == "REFLECTION_NOT_AUTOGRADED" and q["expected"] == ""


def test_no_paid_or_missing_quiz_model_and_auth(client):
    body = {
        "question": "Water",
        "kind": "MULTIPLE_CHOICE",
        "evidence": [{"text": "Water evaporates."}],
    }
    assert client.post("/api/v1/knowledge/quiz", json=body).status_code == 401
    assert (
        client.post("/api/v1/knowledge/quiz", json=body, headers=AUTH).status_code
        == 503
    )


@pytest.mark.parametrize(
    "text",
    [
        "[]",
        '{"question":"X?","options":["a","b","c","d"],"correct":0,"quote":"unrelated"}',
    ],
)
def test_unverifiable_model_quiz_cannot_be_presented_as_verified_ai(
    client, monkeypatch, text
):
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "test-double")
    monkeypatch.setattr(
        OpenAICompatibleProvider, "complete", lambda *args: LLMResponse(text=text)
    )
    result = client.post(
        "/api/v1/knowledge/quiz",
        headers=AUTH,
        json={
            "question": "Water",
            "kind": "MULTIPLE_CHOICE",
            "evidence": [
                {"text": "Chlorophyll absorbs sunlight during photosynthesis."}
            ],
        },
    )
    assert result.status_code == 422
    assert "question" not in result.json()


@pytest.mark.parametrize(
    "key",
    [
        "../original.pdf",
        "materials/../original.pdf",
        "C:/outside.pdf",
        "materials/id/original.exe",
    ],
)
def test_visual_rejects_path_traversal_before_process_start(key):
    with pytest.raises(ValidationError):
        Visual(
            course_id="c",
            material_id="file_id",
            version="a" * 64,
            storage_key=key,
            page=1,
        )


def test_render_page_bounds_cache_and_purge_only_own_scope(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("PDFTOPPM_PATH", "test-double-poppler")
    original = tmp_path / "documents/id/original.pdf"
    original.parent.mkdir(parents=True)
    pdf = PdfWriter()
    pdf.add_blank_page(width=500, height=700)
    with original.open("wb") as f:
        pdf.write(f)
    calls = []

    def run(args, timeout):
        calls.append(args)
        Path(args[-1] + ".png").write_bytes(b"\x89PNG\r\n\x1a\nfixture")

    monkeypatch.setattr("knot_rag.visuals.run", run)
    b = Visual(
        course_id="c",
        material_id="pdf_id",
        version="a" * 64,
        storage_key="documents/id/original.pdf",
        page=1,
    )
    assert render(b)["page_count"] == 1
    render(b)
    assert len(calls) == 1
    with pytest.raises(HTTPException) as e:
        render(b.model_copy(update={"page": 2}))
    assert e.value.status_code == 404 and len(calls) == 1
    another = scope("other", "pdf_id")
    another.mkdir(parents=True)
    (another / "keep.txt").write_text("keep")
    purge("c", "pdf_id")
    assert (
        not scope("c", "pdf_id").exists()
        and (another / "keep.txt").exists()
        and original.exists()
    )


def test_renderer_failure_returns_error_not_text_as_image(tmp_path, monkeypatch):
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path))
    monkeypatch.setenv("PDFTOPPM_PATH", "missing-renderer")
    p = tmp_path / "documents/id/original.pdf"
    p.parent.mkdir(parents=True)
    pdf = PdfWriter()
    pdf.add_blank_page(width=500, height=700)
    with p.open("wb") as f:
        pdf.write(f)

    def fail(*args):
        raise OSError("renderer missing")

    monkeypatch.setattr("knot_rag.visuals.run", fail)
    with pytest.raises(HTTPException) as e:
        render(
            Visual(
                course_id="c",
                material_id="pdf_id",
                version="a" * 64,
                storage_key="documents/id/original.pdf",
                page=1,
            )
        )
    assert e.value.status_code == 503
