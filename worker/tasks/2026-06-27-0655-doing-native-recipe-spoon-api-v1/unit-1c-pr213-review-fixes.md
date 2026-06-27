# Unit 1c PR #213 Review Fix Evidence

Date: 2026-06-27 07:57 PDT

## Findings Addressed

- REST recipe spoon create/update now reject arbitrary external `photoUrl` values, foreign-user spoon photo URLs, profile/other namespaces, and nonexistent stored objects.
- REST recipe spoon create/update accept owner-scoped stored spoon photo URLs only after `PHOTOS.get(key)` proves the object exists.
- Create-spoon idempotency can recover an already-created spoon and cover from an incomplete idempotency row without duplicating either record.
- Create-spoon idempotency recovery keeps an in-flight reservation only when the recoverable spoon row exists; pre-write validation failures delete their reservation so retries return validation errors instead of becoming permanently stuck as `idempotency_in_progress`.
- OpenAPI and generated playground create-spoon examples no longer include delete-only `removed: true`; delete-spoon examples still include `removed: true`.
- The doing doc no longer labels Unit 1c as blocked; validation evidence and the remaining coverage-threshold caveat are recorded separately.

## Validation Commands

- Red check before implementation: `pnpm exec vitest run test/routes/api-v1-recipe-spoons.test.ts test/lib/api-v1-openapi.server.test.ts` failed on unsafe `photoUrl`, in-flight create-spoon retry, and create-spoon `removed` example assertions.
- Green focused regression: `pnpm exec vitest run test/routes/api-v1-recipe-spoons.test.ts test/lib/api-v1-openapi.server.test.ts test/lib/recipe-image-assignment.server.test.ts` passed 21/21.
- Green relevant API/docs/telemetry after the additional pre-write validation regression: `pnpm exec vitest run test/routes/api-v1-recipe-spoons.test.ts test/routes/api-v1-telemetry.test.ts test/docs/developer-platform-guide.test.ts test/lib/api-v1-openapi.server.test.ts test/lib/recipe-image-assignment.server.test.ts --maxConcurrency=1 --sequence.concurrent=false --sequence.shuffle=false` passed 42/42.
- Green typecheck: `pnpm run typecheck`.
- Green build: `pnpm run build`.
- Coverage attempt: `pnpm exec vitest run --coverage test/routes/api-v1-recipe-spoons.test.ts test/lib/api-v1-openapi.server.test.ts test/lib/recipe-image-assignment.server.test.ts --coverage.include=app/lib/api-v1.server.ts --coverage.include=app/lib/api-v1-openapi.server.ts --coverage.include=app/lib/recipe-image-assignment.server.ts --coverage.include=app/lib/recipe-spoon.server.ts` passed 21/21 tests, then failed the repo-level 100% threshold because the included large pre-existing files report partial file coverage (`api-v1.server.ts`, `recipe-spoon.server.ts`).

## Generated Artifact Check

- `pnpm run api:playground:generate` regenerated `app/lib/generated/api-v1-playground.ts`.
- `app/lib/generated/api-v1-playground.ts` create-spoon response example contains `mutation.clientMutationId` and no `removed` field.
- `app/lib/generated/api-v1-playground.ts` delete-spoon response example still contains `removed: true`.
