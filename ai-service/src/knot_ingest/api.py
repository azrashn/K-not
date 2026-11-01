"""FastAPI router `/api/v1/ingestion/*` (api-contracts.md §8). Same internal auth as
`/api/v1/rag/*`; errors use the common envelope with `schema_version: "ingest.v1"`."""

from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Body, Depends, Path, Query, Request
from fastapi.responses import JSONResponse

from knot_ingest import INGEST_SCHEMA_VERSION
from knot_ingest.errors import IngestApiError
from knot_ingest.schemas import IngestErrorCode as E, ReconcileRequest, VerifyRequest
from knot_ingest.service import IngestionService

IDENTIFIER = r"^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,127}$"
COLLECTION = r"^[A-Za-z0-9][A-Za-z0-9._\-]{1,61}[A-Za-z0-9]$"


def error_response(request: Request, exc: IngestApiError) -> JSONResponse:
    rid = getattr(request.state, "request_id", None)
    body = {"schema_version": INGEST_SCHEMA_VERSION, "error": {
        "code": exc.code.value, "message": exc.message, "request_id": rid, "retryable": exc.retryable,
        "details": exc.details,
    }}
    return JSONResponse(status_code=exc.status, content=body, headers={"X-Request-ID": rid} if rid else None)


def _parse(model, payload: Any):
    from pydantic import ValidationError

    from knot_ingest.service import _validation_details

    try:
        return model.model_validate(payload)
    except ValidationError as exc:
        raise IngestApiError(422, E.VALIDATION_ERROR, "The request is invalid.", details=_validation_details(exc)) from None


def build_router(service: IngestionService, auth: Callable) -> APIRouter:
    router = APIRouter(prefix="/api/v1/ingestion", tags=["ingestion"], dependencies=[Depends(auth)])

    @router.post("/jobs", status_code=202, summary="Accept an ingestion job (202 queued, 200 duplicate).")
    def create_job(payload: Any = Body(None)) -> JSONResponse:
        status, accepted = service.accept(payload)
        return JSONResponse(status_code=status, content=accepted.model_dump(mode="json"))

    @router.delete("/documents/{document_id}/chunks", summary="Cancel a local job and delete the document's chunks.")
    def delete_chunks(
        document_id: str = Path(pattern=IDENTIFIER),
        collection: str = Query(pattern=COLLECTION),
    ) -> JSONResponse:
        return JSONResponse(content=service.delete_chunks(document_id, collection).model_dump(mode="json"))

    @router.post("/reconcile", summary="Delete chunks of documents that are not live.")
    def reconcile(payload: Any = Body(None)) -> JSONResponse:
        return JSONResponse(content=service.reconcile(_parse(ReconcileRequest, payload)).model_dump(mode="json"))

    @router.post("/verify", summary="Expected vs. found chunk counts and foreign job tags per document.")
    def verify(payload: Any = Body(None)) -> JSONResponse:
        return JSONResponse(content=service.verify(_parse(VerifyRequest, payload)).model_dump(mode="json"))

    return router
