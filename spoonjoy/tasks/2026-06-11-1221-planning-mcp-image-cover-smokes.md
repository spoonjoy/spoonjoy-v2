# Planning: MCP/API Image Cover Smokes

**Status**: approved
**Created**: 2026-06-11 12:21

## Goal
Add a QA-targeted live smoke that proves Spoonjoy's remote API/MCP image and cover operations work end to end without touching production data or leaving disposable residue.

## Upstream Work Items
- `SJ-045`

## Scope

### In Scope
- Add an environment-aware script for QA image/cover smoke coverage.
- Bootstrap a disposable QA chef through browser signup, then mint a scoped API token through the same session.
- Exercise `/api/tools/*` and `/mcp` for recipe-image upload, spoon-photo upload, recipe creation, spoon creation, cover listing, spoon-image browsing, cover creation from upload, cover creation from spoon, active-cover swap, cover archive, and GIF rejection.
- Include a JPEG-with-EXIF upload and verify the stored object is still retrievable and no longer contains the original dirty APP1 payload.
- Clean the disposable QA user in the same run and verify no `codex-smoke-%` user remains.
- Add focused automated tests for the new script helpers and package command.
- Update durable docs/backlog state so future agents know `SJ-045` status.

### Out of Scope
- Changing the active image generation provider or editorial prompt.
- Running expensive image provider benchmarks or canaries.
- Broad remote production cleanup.
- A new email notification system.
- UI polish for recipe cover browsing.

## Completion Criteria
- [ ] `pnpm smoke:qa:image-cover` targets only the QA base URL and remote QA D1/R2 state.
- [ ] Smoke uploads a recipe image and spoon photo, rejects GIF uploads, creates a recipe, creates a spoon, lists/switches/archives covers, and browses spoon images.
- [ ] Smoke verifies EXIF metadata normalization with a downloaded stored object from `/photos/*`.
- [ ] Smoke cleans its disposable QA chef and verifies no matching user remains.
- [ ] MCP `/mcp` JSON-RPC is exercised with the minted bearer token, not only legacy `/api/tools/*`.
- [ ] 100% test coverage on all new code.
- [ ] All tests pass.
- [ ] No warnings.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## Open Questions
- None. Autopilot decision: use QA only for live mutation coverage; production verification remains health/deploy-only unless a future task explicitly asks for production mutation smokes.

## Decisions Made
- Use browser signup for auth bootstrap because `scripts/smoke-live.mjs` already proves the QA signup flow and deletes the disposable user by D1 email.
- Mint a short-lived smoke token through `/api/tools/create_api_token` using the session, then use that bearer for both `/api/tools/*` and `/mcp`.
- Use the existing food image allow-list (`image/jpeg`, `image/png`, `image/webp`) as the GIF rejection contract.
- Use a tiny synthetic JPEG with a unique APP1 marker as the EXIF fixture; the live smoke only needs to prove storage normalization and retrieval, not visual rendering.
- Use `generateEditorial: false` for deterministic cover mutations; provider quality and canaries belong to `SJ-046`.

## Context / References
- `BACKLOG.md`
- `spoonjoy/tasks/2026-06-10-1521-planning-next-work-queue.md`
- `scripts/smoke-live.mjs`
- `scripts/smoke-live-helpers.mjs`
- `scripts/smoke-api-live.mjs`
- `app/routes/api.$.ts`
- `app/routes/mcp.ts`
- `app/lib/spoonjoy-api.server.ts`
- `app/lib/spoonjoy-api-request.server.ts`
- `app/lib/image-upload-tools.server.ts`
- `app/lib/image-storage.server.ts`
- `app/lib/recipe-image.ts`
- `test/routes/api.test.ts`
- `test/routes/mcp.test.ts`
- `test/lib/mcp/spoonjoy-tools.server.test.ts`

## Notes
The smoke should write a JSON artifact with created IDs, image URLs, cover IDs, MCP/API check names, cleanup output, and any screenshots only if browser debugging is useful. The script must refuse remote non-QA targets unless explicitly expanded in a later task.

## Progress Log
- 2026-06-11 12:21 Created
