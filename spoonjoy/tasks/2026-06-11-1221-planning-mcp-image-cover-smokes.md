# Planning: MCP/API Image Cover Smokes

**Status**: done
**Created**: 2026-06-11 12:21

## Goal
Add a QA-targeted live smoke mode that proves Spoonjoy's remote API/MCP image and cover operations work end to end without touching production data or leaving disposable residue.

## Upstream Work Items
- `SJ-045`

## Scope

### In Scope
- Add a QA-only opt-in image/cover mode to `scripts/smoke-live.mjs` plus a `smoke:qa:image-cover` package command.
- Add a scheduled/manual GitHub Actions smoke job that runs only when the QA deployment and Cloudflare credentials are present, and skips cleanly otherwise.
- Bootstrap a disposable QA chef through browser signup, then mint a scoped API token through the same session.
- Exercise `/api/tools/*` and `/mcp` for recipe-image upload, spoon-photo upload, recipe creation, spoon creation, cover listing, spoon-image browsing, cover creation from upload, cover creation from spoon, cover regeneration/status, active-cover swap, cover archive, and GIF rejection.
- Include a JPEG-with-EXIF upload and verify the downloaded stored object preserves the intended orientation tag while stripping the original dirty/private APP1 payload.
- Prove cover provenance labels for the three user-facing cases: verbatim chef upload (`Chef photo`), editorialized chef photo (`Editorialized chef photo`), and no-photo AI placeholder (`AI generated`).
- Add a pre-mutation QA safety gate that proves the target is exactly the QA Worker URL, the static config points at the QA D1/R2 resources, Cloudflare credentials can reach QA, and image-provider secrets needed for the editorial path exist before any smoke data is created.
- Record every created QA id, the created API credential id, every canonical `/photos/{namespace}/{ownerId}/uploads/*` upload key, and every `/photos/covers/*` generated-cover key observed on this run's recipe cover records; validate each key before delete, delete those R2 objects explicitly, verify they are gone, revoke the smoke credential, clean the disposable QA user in the same run, and verify the exact run-scoped user email is gone.
- Report unrelated `codex-smoke-%` residue in the smoke artifact without broad-delete behavior or making this run race concurrent smoke users.
- Add focused automated tests for the new script helpers and package command.
- Update durable docs/backlog state so future agents know `SJ-045` status.

### Out of Scope
- Changing the active image generation provider or editorial prompt.
- Running expensive image provider benchmarks or canaries.
- Broad remote production cleanup.
- A new email notification system.
- UI polish for recipe cover browsing.

## Completion Criteria
- [x] `pnpm smoke:qa:image-cover` targets only the QA base URL and remote QA D1/R2 state.
- [x] Smoke uploads a recipe image and spoon photo, rejects GIF uploads, creates a recipe, creates a spoon, lists/switches/archives covers, regenerates a cover, reads generation status, and browses spoon images.
- [x] Smoke verifies EXIF metadata normalization with a downloaded stored object from `/photos/*`: dirty APP1 marker removed and sanitized Orientation equals the source fixture's intended orientation.
- [x] Smoke proves `Chef photo`, `Editorialized chef photo`, and `AI generated` provenance labels through QA API/MCP-visible recipe-cover state.
- [x] Smoke records and deletes every created QA R2 object key, refuses to delete upload keys outside `recipes/{ownerId}/uploads/` or `spoons/{ownerId}/uploads/`, refuses to delete `covers/*` keys unless they were observed on this run's cover records, verifies those exact objects are gone, revokes its smoke credential, cleans its disposable QA chef, and verifies the exact run-scoped email remains at count zero.
- [x] MCP `/mcp` JSON-RPC is exercised with the minted bearer token for the critical cover/spoon operations, not just for token/list/ping checks.
- [x] CI/scheduled QA smoke exists and is credential-gated so it never mutates production and never fails forks or unconfigured environments just because QA secrets are absent.
- [x] 100% test coverage on all new code.
- [x] All tests pass.
- [x] No warnings.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## Open Questions
- None under the current user mandate. The user explicitly authorized no human gates for these obvious verification and cleanup decisions; this task uses sub-agent reviewer convergence instead of a human approval stop.

## Decisions Made
- Extend `scripts/smoke-live.mjs` instead of `scripts/smoke-api-live.mjs`; the API smoke is public/read-only and should not grow mutating QA checks.
- Use browser signup for auth bootstrap because `scripts/smoke-live.mjs` already proves the QA signup flow and deletes the disposable user by D1 email.
- Mint a run-scoped smoke token through `/api/tools/create_api_token` using the browser session with explicit scopes `recipes:read` and `kitchen:write`, then use that bearer for both `/api/tools/*` and `/mcp`; revoke the created credential through the browser session during cleanup.
- Use the existing food image allow-list (`image/jpeg`, `image/png`, `image/webp`) as the GIF rejection contract.
- Use a small valid JPEG with a unique dirty APP1 marker and a real Orientation tag as the EXIF fixture; the live smoke proves storage normalization and retrieval by parsing the downloaded object.
- Use `generateEditorial: false` for the deterministic verbatim-cover path, then explicitly run the provider-backed editorial path through cover regeneration/status so provenance is not inferred from unit tests alone.
- Prove the no-photo `AI generated` provenance by observing the placeholder cover created for the smoke recipe before any uploaded/spoon photo becomes active. If the QA image-provider credentials are absent, the scheduled workflow skips the job before mutation rather than passing a partial provenance smoke.
- Derive R2 cleanup keys from returned `/photos/*` URLs only after canonical validation: upload keys must be under `recipes/{ownerId}/uploads/` or `spoons/{ownerId}/uploads/`, generated cover keys must be under `covers/` and present on the smoke recipe's cover records. Keep them in the smoke artifact and delete/verify those exact keys from the QA bucket in `finally` before/alongside credential and D1 cleanup.

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

Endpoint acceptance matrix:
- Browser/session: signup and create a no-photo recipe so the same path that users hit can produce the initial AI placeholder cover.
- `/api/tools/create_api_token`: mint the run-scoped bearer from the authenticated browser session with explicit `recipes:read kitchen:write` scopes.
- `/api/tools/upload_recipe_image`: upload the oriented JPEG fixture and assert stored-object EXIF normalization.
- `/api/tools/upload_recipe_image`: reject GIF bytes and assert no R2 key is recorded.
- `/api/tools/upload_spoon_photo`: upload the spoon photo fixture.
- `/mcp` `tools/list`: assert the remote MCP connector exposes the expected image/cover tools.
- `/mcp` `create_spoon`: create the origin spoon with the uploaded spoon photo.
- `/mcp` `list_recipe_spoon_images`: prove cover-source browsing sees the spoon photo.
- `/mcp` `create_recipe_cover_from_upload`: create and activate the verbatim chef-upload cover.
- `/mcp` `create_recipe_cover_from_spoon`: create a spoon-sourced cover.
- `/mcp` `regenerate_recipe_cover`: trigger editorial regeneration for a cover and poll `/mcp` `get_cover_generation_status` to a bounded terminal state.
- `/mcp` `set_active_recipe_cover`: swap between cover variants.
- `/mcp` `archive_recipe_cover`: archive an inactive cover and verify it is only visible when archived covers are requested.
- `/mcp` `list_recipe_covers`: verify active/inactive/archived state and provenance labels.

Runtime safety gates:
- The image-cover smoke mode refuses any `targetEnv` other than `qa` and any origin other than `https://spoonjoy-v2-qa.mendelow-studio.workers.dev`.
- Before mutation, the smoke runs or embeds the equivalent QA preflight checks for static `wrangler.json` QA D1/R2 isolation, Cloudflare authentication, remote QA D1 access, and remote QA R2 access.
- Before mutation, the full package command verifies remote QA has at least one configured image-provider secret accepted by the app's provider stack; if not, it exits before signup/upload instead of partially passing.
- Provider-backed generation polling is bounded: fixed attempt count, fixed delay, terminal success/failure handling, and cleanup in `finally` on timeout or failure.
- R2 cleanup only deletes exact keys returned by this run's upload/generation responses and only after validation against the smoke user's upload namespaces or this run's generated `covers/*` records.
- Credential cleanup revokes the created API credential by id before D1 user cleanup.
- User cleanup verifies the exact disposable email. A separate residue count may be recorded, but this smoke does not broad-clean unrelated `codex-smoke-%` users.

## Progress Log
- 2026-06-11 12:21 Created
- 2026-06-11 12:47 Reviewer found the first plan under-scoped. Added regenerate/status coverage, provenance proof, exact R2 cleanup, EXIF orientation assertions, and CI/scheduled QA gating before implementation.
- 2026-06-11 12:55 Reviewer found safety/cleanup ambiguity. Added concrete QA preflight gates, endpoint-by-operation matrix, bounded provider polling, run-scoped user cleanup, canonical R2 key validation, and no-human-gate reviewer convergence language.
- 2026-06-11 13:00 Moved the endpoint matrix and runtime gates into Notes to keep the planning doc compliant with the work-planner template.
- 2026-06-11 13:05 Planning approved after sub-agent reviewer convergence with no findings.
- 2026-06-11 13:31 Adversarial doing-doc review found generated `covers/*` cleanup and token lifecycle gaps. Updated plan to include generated-cover key validation, explicit smoke token scopes, and credential revocation.
