"""Real Chroma + deterministic hashing tests. No generative model is simulated as AI."""

import base64
import hashlib
import io
import zipfile

import chromadb
import pytest
from fastapi.testclient import TestClient
from knot_rag.bootstrap import build_components
from knot_rag.config import Settings
from knot_rag.api import create_app
from knot_rag.generation.providers.base import LLMRequest
from knot_rag.generation.providers.base import LLMResponse
from knot_rag.generation.providers.openai_compatible import OpenAICompatibleProvider
import httpx
import json
from knot_rag.unified import (
    UnifiedIndex,
    Material,
    Manifest,
    Projection,
    Segment,
    Search,
    extract_file,
    suspected_conflicts,
)


def pptx(
    slides=(
        "Evaporation converts liquid water to gas.",
        "Condensation turns water vapour into liquid.",
    )
):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr(
            "ppt/presentation.xml",
            '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>'
            + "".join(
                f'<p:sldId id="{i+255}" r:id="r{i}"/>'
                for i in range(1, len(slides) + 1)
            )
            + "</p:sldIdLst></p:presentation>",
        )
        # Deliberately reverse physical file numbering: logical slide order matters.
        z.writestr(
            "ppt/_rels/presentation.xml.rels",
            "<Relationships>"
            + "".join(
                f'<Relationship Id="r{i}" Target="slides/slide{len(slides)+1-i}.xml"/>'
                for i in range(1, len(slides) + 1)
            )
            + "</Relationships>",
        )
        for i, text in enumerate(slides, 1):
            z.writestr(
                f"ppt/slides/slide{len(slides)+1-i}.xml",
                f'<s xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>{text}</a:t></s>',
            )
    return buf.getvalue()


def material(mid, kind="PDF", version="a"):
    return Material(id=mid, kind=kind, title=mid, version=version * 64)


def put(index, mid, text, *, course="course-a", kind="PDF", version="a", loc=None):
    m = material(mid, kind, version)
    sid = hashlib.sha256((course + mid + version).encode()).hexdigest()
    s = Segment(id=sid, text=text, location=loc or {"kind": "page", "page": 2})
    index.upsert(Projection(course_id=course, material=m, segments=[s]))
    return m


@pytest.fixture
def index():
    components = build_components(Settings(embedding_backend="hashing"))
    return UnifiedIndex(components, chromadb.EphemeralClient())


def test_pptx_preserves_logical_slide_order_and_locations():
    out = extract_file("PPTX", pptx())
    assert out[0]["location"]["slide"] == 1
    assert "Evaporation" in out[0]["text"]
    assert out[1]["location"]["slide"] == 2
    assert "Condensation" in out[1]["text"]


@pytest.mark.parametrize("content", [b"not a zip", b"PK\x03\x04corrupt", b""])
def test_invalid_presentations_rejected(content):
    with pytest.raises((ValueError, zipfile.BadZipFile)):
        extract_file("PPTX", content)


def test_zip_entities_and_expansion_rejected():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("huge", b"a" * (21 * 1024 * 1024))
    with pytest.raises(ValueError):
        extract_file("PPTX", buf.getvalue())
    assert (
        extract_file("TXT", "Biyoloji: hücre zarının görevi.".encode())[0]["location"][
            "kind"
        ]
        == "text"
    )
    with pytest.raises(ValueError):
        extract_file("TXT", b"\xff\xff")


def test_unified_physics_evidence_across_three_materials(index):
    a = put(index, "pdf_notes", "Evaporation converts liquid water into vapour.")
    b = put(
        index,
        "file_slides",
        "Evaporation example: water changes to vapour when heated.",
        kind="PPTX",
        loc={"kind": "slide", "slide": 3},
    )
    c = put(
        index,
        "video_lesson",
        "Evaporation is the change from liquid water to vapour.",
        kind="VIDEO",
        loc={"kind": "video", "start_ms": 30000, "end_ms": 40000},
    )
    result = index.search(
        Search(
            course_id="course-a",
            materials=[a, b, c],
            question="What is evaporation of water?",
        )
    )
    assert {e["kind"] for e in result["evidence"]} == {"PDF", "PPTX", "VIDEO"}
    assert result["associations"] and all(
        a["estimated"] for a in result["associations"]
    )


def test_subject_independence_and_course_isolation(index):
    a = put(
        index,
        "pdf_botany",
        "Chlorophyll absorbs sunlight for photosynthesis.",
        course="biology",
    )
    b = put(
        index,
        "file_foreign",
        "Chlorophyll absorbs sunlight.",
        course="other",
        kind="TXT",
        loc={"kind": "text"},
    )
    result = index.search(
        Search(
            course_id="biology",
            materials=[a, b],
            question="What absorbs sunlight in photosynthesis?",
        )
    )
    assert result["evidence"] and {e["material_id"] for e in result["evidence"]} == {
        a.id
    }
    assert not index.search(
        Search(
            course_id="biology",
            materials=[a],
            question="Quaternion Hamiltonian spacecraft guidance",
        )
    )["evidence"]


def test_versions_incremental_state_delete_and_stale_manifest(index):
    a = put(index, "pdf_lifecycle", "Pressure varies with depth in water.")
    assert (
        index.state(Manifest(course_id="course-a", materials=[a]))["versions"][a.id]
        == a.version
    )
    b = put(index, "pdf_lifecycle", "Pressure increases with depth.", version="b")
    assert not index.search(
        Search(course_id="course-a", materials=[a], question="Pressure depth")
    )["evidence"]
    assert index.search(
        Search(course_id="course-a", materials=[b], question="Pressure depth")
    )["evidence"]
    index.delete("course-a", b.id)
    assert not index.search(
        Search(course_id="course-a", materials=[b], question="Pressure depth")
    )["evidence"]
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as late:
        put(index, "pdf_lifecycle", "Late stale publisher must fail.", version="c")
    assert late.value.status_code == 409


def test_active_video_context_uses_real_span_or_abstains(index):
    a = put(
        index,
        "video_current",
        "Water changes to vapour.",
        kind="VIDEO",
        loc={"kind": "video", "start_ms": 30000, "end_ms": 40000},
    )
    result = index.search(
        Search(
            course_id="course-a",
            materials=[a],
            question="Burada ne anlatılıyor?",
            active_material_id=a.id,
            current_time_ms=35000,
        )
    )
    assert result["evidence"][0]["location"]["start_ms"] == 30000
    assert not index.search(
        Search(
            course_id="course-a",
            materials=[a],
            question="Burada ne anlatılıyor?",
            active_material_id=a.id,
            current_time_ms=1000,
        )
    )["evidence"]


def test_selected_page_context_is_bound_to_authorized_material_version(index):
    a = put(index, "pdf_selected", "Pressure changes with depth in water.")
    b = put(index, "pdf_other", "Evaporation converts liquid water to vapour.")
    sid = hashlib.sha256(("course-a" + a.id + "a").encode()).hexdigest()
    query = dict(
        course_id="course-a",
        materials=[a, b],
        question="Bu bölümü adım adım açıkla",
        active_material_id=a.id,
        active_source_id=sid,
    )
    r = index.search(Search(**query))
    assert r["evidence"][0]["id"] == sid
    assert not index.search(Search(**{**query, "active_material_id": b.id}))["evidence"]


def test_viewport_reference_does_not_depend_on_exact_phrase_or_text_overlap(index):
    a = put(index, "pdf_diagram", "Graph drawing with labels A B C D.")
    sid = hashlib.sha256(("course-a" + a.id + "a").encode()).hexdigest()
    ctx = {
        "id": sid,
        "material_id": a.id,
        "kind": a.kind,
        "version": a.version,
        "title": a.title,
        "text": "Graph drawing with labels A B C D.",
        "location": {"kind": "page", "page": 4},
    }
    for question in [
        "Alttaki örnekte BFS ve DFS sırası ne olur?",
        "Yukarıdaki bağlantıları yorumla",
        "İşaretlediğim kısımda ne var?",
    ]:
        r = index.search(
            Search(
                course_id="course-a",
                materials=[a],
                question=question,
                active_material_id=a.id,
                context_evidence=[ctx],
            )
        )
        assert (
            r["evidence"][0]["location"]["page"] == 4
            and r["debug"]["context_state"] == "VIEWPORT"
        )
    foreign = {**ctx, "material_id": "pdf_not_authorized"}
    assert not index.search(
        Search(
            course_id="course-a",
            materials=[a],
            question="Alttaki örnek?",
            context_evidence=[foreign],
        )
    )["evidence"]


def test_possible_conflict_is_not_a_truth_verdict():
    a = {
        "id": "a",
        "material_id": "x",
        "text": "Metals conduct electricity under normal conditions.",
    }
    b = {
        "id": "b",
        "material_id": "y",
        "text": "Metals do not conduct electricity under normal conditions.",
    }
    flags = suspected_conflicts([a, b])
    assert flags and flags[0]["confirmed"] is False
    assert not suspected_conflicts(
        [a, {**b, "text": "Metals carry electrical current in circuits."}]
    )


def test_dense_similarity_alone_cannot_turn_missing_topic_into_evidence(
    index, monkeypatch
):
    text = "Integration by substitution changes the integration variable."
    a = put(index, "pdf_math", text)
    vector = index.c.embedder.embed_documents([text])[0]
    monkeypatch.setattr(index.c.embedder, "embed_query", lambda _: vector)
    result = index.search(
        Search(
            course_id="course-a",
            materials=[a],
            question="Kloroplast içinde klorofil fotosentez sırasında ne yapar?",
        )
    )
    assert result["evidence"] == []


def test_internal_auth_extract_and_honest_no_model_mode(monkeypatch):
    monkeypatch.delenv("UNIFIED_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("UNIFIED_LLM_MODEL", raising=False)
    app = create_app(
        build_components(
            Settings(
                internal_api_token="unified-test-token",
                embedding_backend="hashing",
                chroma_mode="memory",
            )
        )
    )
    with TestClient(app) as c:
        body = {
            "kind": "TXT",
            "content": base64.b64encode(b"Physics source text").decode(),
        }
        assert c.post("/api/v1/knowledge/extract", json=body).status_code == 401
        auth = {"Authorization": "Bearer unified-test-token"}
        result = c.post("/api/v1/knowledge/extract", json=body, headers=auth)
        assert (
            result.status_code == 200
            and result.json()["segments"][0]["text"] == "Physics source text"
        )
        evidence = [
            {"text": "Water evaporates.", "kind": "PDF", "location": {"page": 1}}
        ]
        reply = c.post(
            "/api/v1/knowledge/explain",
            headers=auth,
            json={"question": "What happens?", "evidence": evidence},
        ).json()
        assert reply["status"] == "SOURCE_EXCERPTS" and reply["llm_used"] is False


def test_local_sampling_options_are_opt_in_and_provider_output_is_complete():
    observed = []

    def transport(request):
        observed.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": "Explanation [1]"}, "finish_reason": "stop"}
                ]
            },
        )

    with httpx.Client(transport=httpx.MockTransport(transport)) as client:
        provider = OpenAICompatibleProvider(
            "http://127.0.0.1:11436/v1", "test-model", client=client
        )
        provider.complete(LLMRequest(system="System", user="User"))
        assert "presence_penalty" not in observed[0] and observed[0]["temperature"] == 0
        provider.complete(
            LLMRequest(
                system="System",
                user="User",
                temperature=0.7,
                top_p=0.9,
                presence_penalty=1.2,
                frequency_penalty=0.3,
            )
        )
        assert (
            observed[1]["presence_penalty"] == 1.2
            and observed[1]["frequency_penalty"] == 0.3
        )


@pytest.mark.parametrize(
    "text,status",
    [
        (
            '{"claims":[{"text":"Water changes to vapour.","sources":[1]}]}',
            "GENERATED_UNVERIFIED",
        ),
        (
            '{"claims":[{"text":"Foreign reference.","sources":[9]}]}',
            "INVALID_CITATIONS",
        ),
        ("This is not JSON", "INVALID_CITATIONS"),
    ],
)
def test_structured_generation_validates_each_source_before_rendering(
    monkeypatch, text, status
):
    monkeypatch.setenv("UNIFIED_LLM_BASE_URL", "http://127.0.0.1:11436/v1")
    monkeypatch.setenv("UNIFIED_LLM_MODEL", "test-model")
    seen = []

    def complete(self, request):
        seen.append(request)
        return LLMResponse(text=text)

    monkeypatch.setattr(OpenAICompatibleProvider, "complete", complete)
    app = create_app(
        build_components(
            Settings(
                internal_api_token="unified-test-token",
                embedding_backend="hashing",
                chroma_mode="memory",
            )
        )
    )
    with TestClient(app) as c:
        result = c.post(
            "/api/v1/knowledge/explain",
            headers={"Authorization": "Bearer unified-test-token"},
            json={
                "question": "What changes?",
                "evidence": [
                    {
                        "id": "a" * 64,
                        "text": "Water changes to vapour.",
                        "kind": "PDF",
                        "location": {"page": 1},
                    }
                ],
            },
        )
        assert result.status_code == 200
        assert result.json()["status"] == status and result.json()["llm_used"] is True
        assert "[9]" not in result.json()["answer"]
        assert seen[0].json_mode and "untrusted_sources" in seen[0].user
