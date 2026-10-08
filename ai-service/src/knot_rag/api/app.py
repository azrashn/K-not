"""Internal FastAPI service. Called only by the NestJS backend, never by browsers."""

from __future__ import annotations

import hmac
import logging
import re
import uuid
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from knot_rag import SCHEMA_VERSION
from knot_rag.bootstrap import Components
from knot_rag.errors import RagError, Unauthorized
from knot_rag.schemas.answer import AnswerRequest, GroundedAnswer
from knot_rag.schemas.common import ErrorBody, ErrorCode, ErrorResponse
from knot_rag.schemas.retrieval import RetrieveRequest, RetrieveResponse

log = logging.getLogger(__name__)

MAX_BODY_BYTES = 256 * 1024
_REQUEST_ID = re.compile(r"^[A-Za-z0-9_.:\-]{1,128}$")
_ERR = {"model": ErrorResponse}


def _request_id(request: Request) -> str:
    rid = getattr(request.state, "request_id", None)
    return rid or str(uuid.uuid4())


def _error(status: int, code: ErrorCode, message: str, request_id: str, retryable=False, details=None) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=code, message=message, request_id=request_id, retryable=retryable, details=details))
    return JSONResponse(status_code=status, content=body.model_dump(mode="json"), headers={"X-Request-ID": request_id})


def create_app(components: Components) -> FastAPI:
    settings = components.settings
    app = FastAPI(
        title="K-not RAG Service (WBS-3)",
        version=SCHEMA_VERSION,
        description=(
            "Internal grounded-answer API for the K-not NestJS backend. Every request must carry "
            "the internal service token; scope (course + authorized documents) is decided by NestJS."
        ),
    )
    app.state.components = components

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        header_id = request.headers.get("x-request-id", "")
        request.state.request_id = header_id if _REQUEST_ID.match(header_id) else str(uuid.uuid4())
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
            return _error(413, ErrorCode.VALIDATION_ERROR, "Request body too large.", request.state.request_id)
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    @app.exception_handler(RagError)
    async def rag_error(request: Request, exc: RagError):
        rid = _request_id(request)
        level = logging.ERROR if exc.http_status >= 500 else logging.INFO
        log.log(level, "rag.request_failed", extra={"request_id": rid, "code": exc.code.value, "error_type": type(exc).__name__})
        return _error(exc.http_status, exc.code, exc.message, rid, exc.retryable, exc.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        # Report locations and messages only; never echo the submitted input back.
        details = {"errors": [{"loc": [str(p) for p in e.get("loc", ())], "msg": e.get("msg", "")} for e in exc.errors()][:20]}
        return _error(422, ErrorCode.VALIDATION_ERROR, "The request is invalid.", _request_id(request), details=details)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        rid = _request_id(request)
        log.exception("rag.unhandled_error", extra={"request_id": rid})
        return _error(500, ErrorCode.INTERNAL_ERROR, "Internal error.", rid)

    def require_internal_auth(
        authorization: Annotated[str | None, Header()] = None,
        x_internal_token: Annotated[str | None, Header()] = None,
    ) -> None:
        if settings.auth_disabled:
            return
        token = x_internal_token or ""
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        if not token or not hmac.compare_digest(token.encode(), settings.internal_api_token.encode()):
            raise Unauthorized()

    def resolve_request_id(request: Request, body_id: str | None) -> str:
        if body_id and _REQUEST_ID.match(body_id):
            request.state.request_id = body_id
        return request.state.request_id

    @app.get("/health", tags=["ops"], summary="Liveness: the process is up.")
    def health() -> dict:
        return {"status": "ok", "schema_version": SCHEMA_VERSION}

    @app.get("/ready", tags=["ops"], summary="Readiness: index reachable and compatible, provider configured.")
    def ready():
        checks: dict[str, str] = {}
        ok = True
        info = None
        try:
            info = components.index.info()
            checks["index"] = f"ok ({info.chunk_count} chunks)"
        except RagError as exc:
            ok = False
            checks["index"] = exc.code.value
        except Exception:  # pragma: no cover - defensive
            ok = False
            checks["index"] = "error"
        checks["provider"] = f"{components.provider.name}:{components.provider.model}"
        checks["embedding_model"] = components.embedder.model_id
        content = {"status": "ready" if ok else "not_ready", "checks": checks, "index": _index_identity(info)}
        return JSONResponse(status_code=200 if ok else 503, content=content)

    def _index_identity(info) -> dict:
        """C-1 consistency-guard fields (api-contracts.md §6). The fingerprint is the
        service's configured one; when the collection carries a fingerprint, `info()` has
        already verified that the two are equal."""
        fingerprint = None
        if components.embedding_configuration is not None:
            try:
                fingerprint = components.embedding_configuration().fingerprint()
            except Exception:  # model not loadable: reported as unknown, readiness decided above
                fingerprint = None
        return {
            "collection": info.collection if info is not None else settings.chroma_collection,
            "embedding_fingerprint": fingerprint,
            "index_version_id": info.index_version_id if info is not None else None,
            "stamp": None if info is None else ("full" if info.embedding_fingerprint else "legacy"),
        }

    auth = [Depends(require_internal_auth)]
    app.state.internal_auth = require_internal_auth  # shared with the WBS-2 ingestion router

    @app.post(
        "/api/v1/rag/retrieve",
        response_model=RetrieveResponse,
        dependencies=auth,
        tags=["rag"],
        summary="Scoped evidence retrieval (no generation). Reusable by question generation and evaluation.",
        responses={401: _ERR, 409: _ERR, 422: _ERR, 503: _ERR},
    )
    def retrieve(body: RetrieveRequest, request: Request) -> RetrieveResponse:
        return components.rag.retrieve(body, resolve_request_id(request, body.request_id))

    @app.post(
        "/api/v1/rag/answer",
        response_model=GroundedAnswer,
        dependencies=auth,
        tags=["rag"],
        summary="Grounded answer with structured claims, validated citations and support states.",
        responses={401: _ERR, 409: _ERR, 422: _ERR, 502: _ERR, 503: _ERR, 504: _ERR},
    )
    def answer(body: AnswerRequest, request: Request) -> GroundedAnswer:
        return components.rag.answer(body, resolve_request_id(request, body.request_id))

    return app
