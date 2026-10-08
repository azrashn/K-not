# K-not Backend (WBS-4)

NestJS 11 + TypeScript 5.9 + Prisma 7 + MySQL 8. Implements the public API, authentication,
courses and memberships, documents and storage, ingestion job orchestration, the internal
callback API, and the proxy to the WBS-3 RAG service.

**Contracts:** `docs/architecture/` (`api-contracts.md`, `data-model.md`,
`document-lifecycle.md`, `document-contract.md`). The WBS-2/WBS-3 contracts (`ingest.v1`,
`rag.v1`, `pages.v1`) are consumed unchanged.

## Run

```bash
cd backend
npm ci                                  # also runs `prisma generate`
cp .env.example .env                    # fill in secrets; export them or use your process manager
npx prisma migrate deploy               # MySQL 8 is required
npx ts-node scripts/seed.ts scripts/seed.example.json   # admin seed: users, courses, ACTIVE IndexVersion
npm run build && npm start              # http://localhost:3000
```

Run the ai-service with matching settings:

| Setting | Required value |
| --- | --- |
| `RAG_INTERNAL_API_TOKEN`, `INGEST_CALLBACK_TOKEN`, `STORAGE_ROOT` | The same values as the backend |
| `NESTJS_INTERNAL_URL` | The backend URL |
| `INGEST_ENABLED` | `true` |
| `EMBEDDING_*`, `CHROMA_COLLECTION` | The ACTIVE IndexVersion |

The seed creates the ACTIVE IndexVersion with the ADR-010 configuration: `intfloat/multilingual-e5-small`,
revision `614241f…`, fingerprint `sha256:7858637f…`. If the ai-service's `/ready` reports another
fingerprint or collection:
- answers return `503 INDEX_VERSION_MISMATCH`;
- dispatch pauses;
- there is no fallback to another model.

## API

| Route | Notes |
| --- | --- |
| `POST /auth/login`, `GET /auth/me` | E-mail + password, Argon2id, HS256 JWT (1 h, no refresh). Accounts are **seed-only** (U1). |
| `GET /courses`, `GET /courses/:id` | Members; admins may view any course. Non-members get 404. |
| `GET/POST /courses/:id/documents` | Upload: multipart `file` (PDF, ≤ 30 MB, `%PDF-` check), `document_type`, `title?`, `visibility?`. |
| `GET /documents/:id`, `POST …/retry`, `DELETE …` | Visibility and ownership as in api-contracts §5; invisible documents get 404. |
| `GET /documents/:id/pages/:page`, `GET /documents/:id/file` | Source viewer, served from the `pages.v1` artifact, and the original PDF. |
| `POST /courses/:id/answers` | `GroundedAnswer` returned unchanged, plus a `documents` map. 20/min/user. |
| `POST /internal/v1/ingestion-jobs/:jobId/events` | Python callbacks. `INGEST_CALLBACK_TOKEN` only; never exposed publicly. |
| `GET /health`, `GET /ready` | Liveness; readiness (database plus AI index state). |

- **Errors:** `{schema_version: "api.v1", error: {code, message, request_id, retryable, details}}`.
- **Correlation:** `X-Request-ID` is accepted, echoed, and forwarded to Python.
- **Answers are not stored** (U6 decision), so no excerpts of deleted documents are retained.
- **Admin operations (CLI):** `npx ts-node scripts/admin.ts reconcile [--apply] | purge-pending | sweep | index-check`.

## Tests

| Suite | Command | Uses |
| --- | --- | --- |
| unit | `npm run test:unit` | Pure logic |
| api | `npm run test:api` | **Real MySQL 8** (`knot_test_w<N>` databases, migrated automatically; server from `TEST_DATABASE_SERVER_URL`) and a **fake** ai-service (`test/support/fake-ai.ts`, a test double) |
| integration | `npm run test:integration` | Real MySQL and the **real Python ai-service** (WBS-2 + WBS-3), started by the test with the `HashingEmbedder` and the extractive (non-LLM) provider |
| integration (e5) | `KNOT_REAL_E5=1 npm run test:integration` | The same flow with the pinned e5-small model; needs it in the local Hugging Face cache |

## Known limitations

- **In-memory rate limits.** Login and answer limits are per process; a multi-instance
  deployment needs a shared store.
- **Callback route exposure.** The callback route is served on the same port as the public API.
  The reverse proxy must not route `/internal/*` (WBS-9).
- **Partial admin operations.** IndexVersion migration and activation (blue/green, ADR-015) and
  bulk reindex are not implemented; reconcile, purge, sweep and the index check are.
- **No LLM provider configured** (U2). Answer quality with a real LLM is untested; the
  integration test uses the extractive baseline.
