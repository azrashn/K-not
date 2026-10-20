# Course management and material-based quizzes

## What it does
- Students create personal courses (`POST /courses`), edit them (`PATCH /courses/:id`, owner or admin only) and upload PDFs into them with the existing upload flow.
- Quizzes are generated from the READY documents the student selects. The ai-service (`POST /api/v1/quiz/generate`) builds questions **extractively** from indexed chunks: cloze multiple-choice and true/false statements taken verbatim from the material. **No LLM and no external service is used**; nothing leaves the machine. Responses carry `generator: "extractive-v1"` and `llm_used: false`, and the UI says so.
- Every question stores its source (document, page, chunk, verbatim quote). Quotes are verified as substrings of the indexed chunk text before a question is accepted; duplicates, ambiguous items and out-of-scope sources are rejected.
- The backend grades attempts; the answer key, explanation and quote are only returned after submission.

## Limits
- Question quality is bounded by extractive generation: distractors are heuristic (terms from the same materials) and a distractor could occasionally also be acceptable. Fewer questions than requested are returned (with a warning) when the material does not support more.
- When a local LLM provider is added later it must plug into `knot_rag/quiz` behind the same validation (verbatim quote, scope, dedupe); the REST contract does not change.
- Quiz source quotes are cleared when the source document is deleted (references stay).

## Data model (migration `20261021120000_course_ownership_and_quizzes`, additive)
`Course.description`, `Course.createdById` (nullable) and new tables `Quiz`, `QuizDocument`, `QuizQuestion`, `QuizAttempt`, `QuizAttemptAnswer`. Analytics reads them through `GET /analytics/quiz-summary` (completed quizzes, average score, per-attempt scores, per-topic accuracy).

## Local setup
```
cd backend && npx prisma migrate deploy && npx prisma generate && npm run build
```
Backend API tests need a MySQL user that can create databases (`TEST_DATABASE_SERVER_URL`, e.g. a throwaway container: `docker run -d -e MYSQL_ROOT_PASSWORD=... -p 127.0.0.1:3399:3306 mysql:8 --mysql-native-password=ON`). They truncate tables, so never point them at the dev database.
