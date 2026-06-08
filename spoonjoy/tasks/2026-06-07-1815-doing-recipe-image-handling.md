# Doing: Recipe Image Handling End to End

**Status**: COMPLETE
**Execution Mode**: direct
**Created**: 2026-06-07 18:51
**Planning**: ./2026-06-07-1815-planning-recipe-image-handling.md
**Artifacts**: ./2026-06-07-1815-doing-recipe-image-handling/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts (interactive)
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Fix Spoonjoy recipe image handling so uploaded recipe and spoon photos are stored upright, accepted formats match product intent, recipe covers show the right empty/generated states, AI redraws run reliably after assignment, and MCP clients can participate in the same image workflow.

## Upstream Work Items
- None

## Completion Criteria
- [x] JPEG uploads with EXIF orientation retain a sanitized Orientation tag and display upright after private metadata stripping; pixel rotation/transcoding is out of scope for Worker runtime.
- [x] GIF uploads are rejected everywhere recipe or spoon photos are accepted.
- [x] Chef-upload recipe covers and origin-cook spoon covers enqueue stylization after browser and MCP assignment.
- [x] Raw uploads display immediately and generated stylized variants take over when available.
- [x] AI placeholder covers are the only generated no-photo cover; empty/no-cover recipes no longer render the Chef RJ fallback as a recipe image.
- [x] OpenAI image calls handle generated image bytes correctly and persist final images to R2 or deterministic local/test URLs.
- [x] Upload stylization failures do not use text-only food generation fallback and are captured through PostHog `$exception` or controlled server events with properties suitable for a PostHog email alert.
- [x] MCP image upload/spoon photo support is documented and covered by tests.
- [x] The known risotto cover is repaired or a documented blocker explains why the original cannot be safely repaired.
- [x] 100% test coverage on all new code
- [x] All tests pass
- [x] No warnings

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## TDD Requirements
**Strict TDD — no exceptions:**
1. **Tests first**: Write failing tests BEFORE any implementation
2. **Verify failure**: Run tests, confirm they FAIL (red)
3. **Minimal implementation**: Write just enough code to pass
4. **Verify pass**: Run tests, confirm they PASS (green)
5. **Refactor**: Clean up, keep tests green
6. **No skipping**: Never write implementation without failing test first

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

**CRITICAL: Every unit header MUST start with status emoji (⬜ for new units).**

### ✅ Unit 0: Setup/Research
**What**: Confirm the current schema, test helpers, `/photos/*` R2 route, PostHog helpers, OpenAI image docs/spec, and MCP operation registry before edits. Inspect local `prisma/dev.db` and production Cloudflare D1/R2 (`wrangler d1 execute DB --remote` read-only `SELECT` plus R2 read/list only) for the known risotto recipe/cover.
**Output**: Notes in `spoonjoy/tasks/2026-06-07-1815-doing-recipe-image-handling/` naming the risotto row(s), current cover URL(s), whether an original recoverable file exists, the exact test commands selected for later units, and a `coverImageUrl` audit generated from `rg -n "coverImageUrl" app test -S` with each app code occurrence categorized as null-safe, needs update, or intentional fallback.
**Acceptance**: Findings are written, no source files are edited in this unit, remote production access is read-only until Unit 5b, and any destructive repair command is deferred until after implementation tests pass.

### ✅ Unit 1a: Upload Validation And JPEG Orientation — Tests
**What**: Write failing tests in `test/lib/image-storage.server.test.ts`, `test/lib/recipe-spoon.server.test.ts`, `test/components/recipe/RecipeImageUpload.test.tsx`, `test/components/recipe/SpoonDialog.test.tsx`, `test/routes/recipes-new.test.tsx`, `test/routes/recipes-id-edit.test.tsx`, `test/routes/recipes-id-spoons.test.tsx`, `test/routes/account-settings.test.tsx`, `test/components/account/ProfilePhotoField.test.tsx`, and `e2e/flows/recipe-image-handling.spec.ts` using fixture `e2e/fixtures/asymmetric-exif-orientation.jpg` covering: GIF rejection for recipe/spoon food photos, byte-sniffed rejection for GIF bytes disguised as `image/png` or `image/jpeg`, JPEG APP1 privacy stripping while preserving a sanitized EXIF Orientation tag without Worker-side pixel rotation/transcoding, hidden file-input accept lists, user-facing helper/error copy in `RecipeImageUpload`, `SpoonDialog`, recipe create/edit route actions, and spoon photo route actions saying only JPG/PNG/WebP and not GIF, direct `createSpoon(... photoFile ...)` validation, server rejection for invalid spoon photo uploads, browser recipe upload with the asymmetric EXIF-orientation JPEG fixture, saved/reloaded raw image visibility, and upright rendered image verification through a Playwright screenshot or canvas pixel check against an asymmetric orientation marker. Rendered-dimension assertions alone are not sufficient for the upright UX proof. Cover profile-photo behavior staying on an explicit profile-photo MIME allow-list rather than reusing the food-photo constant.
**Output**: Red unit/component/route tests plus a red Playwright e2e test that prove the current upload validation and orientation gaps without changing app runtime code.
**Acceptance**: Targeted tests fail for the current code for the expected reasons: GIF is still accepted in `RECIPE_IMAGE_TYPES`, `RecipeImageUpload`, `SpoonDialog`, and direct `createSpoon(... photoFile ...)`; browser spoon server upload validation is missing. JPEG orientation tests target `storeImage` data-URL fallback and R2 upload paths and may already pass only if Unit 0 proves existing metadata stripping preserves display orientation.

### ✅ Unit 1b: Upload Validation And JPEG Orientation — Implementation
**What**: Update `app/lib/image-storage.server.ts`, `app/lib/recipe-spoon.server.ts`, `app/components/recipe/RecipeImageUpload.tsx`, `app/components/recipe/SpoonDialog.tsx`, `app/routes/recipes.new.tsx`, `app/routes/recipes.$id.edit.tsx`, `app/lib/recipe-detail.server.ts`, `app/lib/account-settings.server.ts`, and `app/components/account/ProfilePhotoField.tsx` so food-photo uploads use a JPEG/PNG/WebP allow-list, all food-photo helper/error copy from components and server route validation mentions only JPG/PNG/WebP, and profile-photo uploads use a separate explicit profile-photo allow-list. For JPEG orientation, use the chosen Worker-compatible strategy: parse APP1 EXIF, preserve only a minimal sanitized APP1 segment containing the Orientation tag when orientation is 2-8, strip all other APP1/private metadata, and do not transcode/rotate pixels in Worker runtime.
**Output**: Runtime code that rejects GIFs and preserves JPEG display orientation metadata across recipe and spoon upload paths without GPS/private EXIF.
**Acceptance**: Unit 1a tests pass, GIF files are rejected in both browser and server routes, and stored JPEG bytes retain sanitized display orientation metadata without private EXIF.

### ✅ Unit 1c: Upload Validation And JPEG Orientation — Coverage & Refactor
**What**: Run the targeted upload/component/route tests, remove duplication if validation messages or accepted MIME lists drift, and ensure edge cases for empty files, malformed JPEGs, non-APP1 JPEGs, and data-URL fallback remain covered.
**Output**: Green targeted upload tests plus any small refactors needed to keep shared image validation centralized.
**Acceptance**: Targeted upload-related tests pass with no warnings and new branches have coverage.

### ✅ Unit 1d: Imported Cover GIF Rejection — Tests
**What**: Write failing tests in `test/lib/recipe-import.test.ts` covering imported recipe cover fetches with `image/gif` content-type, `.gif` extension, or GIF magic bytes disguised as PNG/JPEG being rejected/skipped rather than stored as recipe covers; same-millisecond imported cover uploads using unique keys; and safe-image fetch rejection for blocked schemes, localhost/private IP hosts, public-to-private redirects, oversized responses, and non-image content types.
**Output**: Red import-cover tests proving imported GIF covers are currently accepted.
**Acceptance**: Tests fail on current code because `uploadImportCover` stores GIF covers.

### ✅ Unit 1e: Imported Cover GIF Rejection — Implementation
**What**: Update `app/lib/recipe-import.server.ts` so imported recipe covers use the shared safe-image fetch helper and the same food-photo MIME/magic-byte allow-list as recipe/spoon uploads, reject unsafe/GIF covers without failing the recipe import, and store imported covers under unique immutable keys that include timestamp plus random id.
**Output**: Import-cover fetch/upload path that skips unsafe/GIF images, logs through the existing import logger path, and avoids same-millisecond key collisions.
**Acceptance**: Unit 1d tests pass and non-GIF import cover behavior remains unchanged.

### ✅ Unit 2a: Cover Resolution And Empty State — Tests
**What**: Write failing tests in `test/lib/recipe-cover.server.test.ts`, `test/routes/recipes-id-scaling.test.tsx`, `test/components/recipe/RecipeHeader.test.tsx`, `test/components/recipe/RecipeBuilder.test.tsx`, `test/components/recipe/RecipeImageUpload.test.tsx`, `test/routes/recipes-id.test.tsx`, `test/routes/recipes-id-edit.test.tsx`, `test/routes/recipes-index.test.tsx`, `test/routes/index.test.tsx`, `test/routes/users-identifier.test.tsx`, `test/routes/cookbooks-id.test.tsx`, `test/routes/og-routes.test.ts`, `test/lib/og-image.server.test.tsx`, `test/lib/recipe-fork.server.test.ts`, `test/lib/spoonjoy-api-spoons.test.ts`, `test/routes/api-v1-recipes.test.ts`, and the Playwright e2e spec from Unit 1a covering: no-cover URL returns null/empty state instead of Chef RJ SVG, browser empty recipe cover state, pending `ai-placeholder` covers use `imageUrl: ""` rather than the Chef RJ SVG, a latest empty cover row masks older real covers and resolves to null, placeholder failures leave an empty cover rather than the SVG, `stylizedImageUrl` wins over raw `imageUrl`, AI-placeholder rows become real cover images once their `imageUrl` is generated, recipe replace/clear preserves existing stored cover objects when any DB image URL column still references them (`RecipeCover.imageUrl`, `RecipeCover.stylizedImageUrl`, and `RecipeSpoon.photoUrl` at minimum), recipe OG generation handles a null cover through its intentional OG fallback art, and cookbook OG generation handles null recipe covers by filtering or accepting nulls while preserving OG fallback art. Include fork and spoon regressions: fork a recipe with a stored cover URL, replace or clear the source recipe cover, and assert the fork's copied cover URL remains preserved/fetchable; promote an origin-cook spoon photo to cover, replace or clear the recipe cover, and assert the spoon photo remains preserved/fetchable. Use the Unit 0 `coverImageUrl` audit to decide if an occurrence is already null-safe; every app code occurrence in `app/routes/_index.tsx`, `app/routes/recipes._index.tsx`, `app/routes/recipes.$id.tsx`, `app/routes/recipes.$id.edit.tsx`, `app/routes/users.$identifier.tsx`, `app/routes/cookbooks.$id.tsx`, `app/routes/og.recipes.$id.png.tsx`, `app/routes/og.cookbooks.$id.png.tsx`, `app/lib/recipe-detail.server.ts`, `app/lib/spoonjoy-api.server.ts`, `app/lib/og-image.server.tsx`, `app/components/recipe/RecipeHeader.tsx`, `app/components/recipe/RecipeBuilder.tsx`, `app/components/recipe/RecipeImageUpload.tsx`, `app/components/recipe/SpoonsStrip.tsx`, `app/components/cookbook/CookbookCoverArt.tsx`, and `app/components/pantry/RecipeGrid.tsx` must either be covered or listed as intentionally unchanged.
**Output**: Red tests for cover resolution and display behavior only.
**Acceptance**: Tests fail on current code because `getRecipeCoverImageUrl` always emits the Chef RJ SVG for no-cover recipes.

### ✅ Unit 2b: Cover Resolution And Empty State — Implementation
**What**: Update `app/lib/recipe-cover.server.ts`, `app/routes/recipes.new.tsx`, `app/routes/recipes.$id.edit.tsx`, `app/lib/ai-placeholder-cover.server.ts`, and the Unit 0 audit targets that require null-safe cover handling so real cover resolution can return null while generated AI placeholders remain real images. New no-photo recipes and clear-image flows should create pending `ai-placeholder` covers with `imageUrl: ""`; `scheduleAiPlaceholderCover` replaces that value on success and leaves it empty on failure. Recipe replace/clear must not delete an existing stored cover object unless a reference-count check proves no DB image URL column references that URL (`RecipeCover.imageUrl`, `RecipeCover.stylizedImageUrl`, and `RecipeSpoon.photoUrl` at minimum); only failed just-uploaded objects that never got committed may be deleted unconditionally. Do not change `app/lib/api-v1.server.ts` cover resolver unless tests show drift; it already has a null cover path. Keep OG-image files intentionally separate because OG images need their own fallback art, but update `app/routes/og.cookbooks.$id.png.tsx` and `app/lib/og-image.server.tsx` to filter or accept null recipe cover URLs so cookbook OG does not typecheck-fail or 500 when a cookbook contains no-cover recipes.
**Output**: Null-safe cover resolver and consumer updates that remove Chef RJ recipe-photo fallback leakage.
**Acceptance**: Unit 2a tests pass, empty recipes show empty state, and existing real cover precedence is preserved.

### ✅ Unit 2c: Chef Upload Stylization Scheduling — Tests
**What**: Write failing tests in `test/routes/recipes-new.test.tsx`, `test/routes/recipes-id-edit.test.tsx`, and a shared scheduling helper test if introduced, covering chef-upload recipe cover creation scheduling stylization through `waitUntil` and raw-upload visibility before `stylizedImageUrl` exists.
**Output**: Red route/helper tests for chef-upload stylization scheduling only.
**Acceptance**: Tests fail on current code because browser chef-upload recipe covers do not schedule stylization.

### ✅ Unit 2d: Chef Upload Stylization Scheduling — Implementation
**What**: Update `app/routes/recipes.new.tsx`, `app/routes/recipes.$id.edit.tsx`, and shared stylization scheduling code so chef-upload covers schedule background stylization with the approved prompt and raw images remain visible until completion. Preserve the reference-safe stored-object cleanup rule from Unit 2b when replacing/clearing covers.
**Output**: Browser recipe upload/edit paths that create covers and enqueue stylization consistently.
**Acceptance**: Unit 2c tests pass and origin-cook spoon scheduling remains unchanged.

### ✅ Unit 2e: Cover And Scheduling — Coverage & Refactor
**What**: Run targeted cover/route tests, verify every `coverImageUrl` app code occurrence from the Unit 0 audit is null-safe or intentionally unchanged, verify replace/clear does not delete shared forked cover objects, and remove route duplication if a shared helper is introduced.
**Output**: Green targeted cover and scheduling test run plus small refactors needed for shared behavior.
**Acceptance**: Targeted cover and route tests pass with no warnings and no unhandled null image consumers remain.

### ✅ Unit 2f: Search Cover Freshness — Tests
**What**: Write failing tests in `test/lib/search.server.test.ts` covering search document `imageUrl` returning null for no-cover recipes, `stylizedImageUrl` winning over raw `imageUrl`, and the search source fingerprint changing when a `RecipeCover.imageUrl` or `RecipeCover.stylizedImageUrl` value changes without a new cover row.
**Output**: Red search tests that prove search currently misses cover URL updates because `RecipeCover` fingerprinting only uses count and max `createdAt`.
**Acceptance**: Tests fail on current code for stale search image behavior or unchanged source fingerprint after cover URL updates.

### ✅ Unit 2g: Search Cover Freshness — Implementation
**What**: Update `app/lib/search.server.ts` so the search source fingerprint includes a deterministic ordered `RecipeCover` content fingerprint based on cover id, `imageUrl`, and `stylizedImageUrl`, without adding a Prisma schema migration solely for this freshness bug.
**Output**: Search rebuild detection that notices cover image/stylized URL updates.
**Acceptance**: Unit 2f tests pass and search result image URLs follow the same cover precedence as direct recipe/card views.

### ✅ Unit 3a: OpenAI Base64 And Storage — Tests
**What**: Write failing tests in `test/lib/image-gen.server.test.ts` covering OpenAI `b64_json` image generation/edit responses, outgoing generated-image requests using base64 response semantics where the model requires/supports it (`response_format: "b64_json"` for URL-capable legacy/current calls, or the SDK's equivalent base64 path for GPT image models), decoded-byte bucket writes, unique generated cover R2 keys for same-millisecond calls, deterministic local/test URLs only when an explicit local/test fallback flag is enabled and bucket is absent, production-like bucket absence rejecting instead of storing temporary/data URLs, and errors when neither URL nor base64 data exists. Include edit tests proving returned `b64_json` is consumed without relying on URL fetches.
**Output**: Red tests for OpenAI response parsing and generated-byte persistence only.
**Acceptance**: Tests fail on current code because it expects `data[0].url` and fetches returned URLs.

### ✅ Unit 3b: OpenAI Base64 And Storage — Implementation
**What**: Update `app/lib/image-gen.server.ts` so generated image requests ask for base64 response semantics where required/supported, generated image outputs decode `b64_json`, store bytes directly to R2 under unique immutable keys that include timestamp plus random id, and retain deterministic local/test behavior only behind an explicit local/test fallback flag without relying on temporary URLs for GPT image models. Production-like bucket absence must fail instead of persisting temporary/data URLs. Keep the existing model choice intentional for this fix (`gpt-image-1` for stylization and the current placeholder model unless Unit 0 proves it unsupported); upgrading to the latest image model is outside this task.
**Output**: Image generation helper that supports base64-first durable persistence with cache-busting generated cover keys.
**Acceptance**: Unit 3a tests pass.

### ✅ Unit 3c: OpenAI Image Edit Inputs And No Text Fallback — Tests
**What**: Write failing tests in `test/lib/image-gen.server.test.ts` and `test/lib/spoon-cover-stylization.server.test.ts` covering image edit source resolution to multipart `File` inputs from data URLs, R2 `/photos/*` keys, and absolute HTTPS URLs fetched server-side through a shared safe-image fetch helper. All edit source bytes, including decoded data URLs, R2 object reads, and network fetches, must pass the same food-photo byte validator before `File` creation: exact JPEG/PNG/WebP MIME allow-list, matching magic bytes, max decoded size, and rejection for empty/truncated/malformed bytes, GIF bytes even when mislabeled, SVG/text payloads, and MIME/magic mismatches. Network fetches must also reject non-HTTP(S) schemes, private/localhost IP hosts, and public-to-private redirects by testing manual redirect handling where every `Location` is scheme/host validated before the next fetch, redirect count is capped, and a private redirect target is never requested. Verify upload stylization does not call a text-only fallback after image-to-image failure.
**Output**: Red tests for source-image resolution and fallback removal only.
**Acceptance**: Tests fail on current code because it passes a source URL string to `images.edit` and falls back to text generation.

### ✅ Unit 3d: OpenAI Image Edit Inputs And No Text Fallback — Implementation
**What**: Update `app/lib/image-gen.server.ts` and `app/lib/spoon-cover-stylization.server.ts` so image edits always use multipart `File` inputs: decode data URLs locally, read `/photos/*` from R2 when a bucket is available, and fetch absolute HTTPS URLs server-side only through the shared safe-image fetch helper described in Unit 3c. The helper must use manual redirect handling (`redirect: "manual"`), validate each hop before fetching the next URL, and cap redirects. Run every source byte path through the shared food-photo validator before constructing the OpenAI edit `File`. Stop upload stylization after image-to-image failures without inventing food.
**Output**: Worker-compatible image-to-image path that uses real source image bytes and no text-only stylization fallback.
**Acceptance**: Unit 3c tests pass and background generation still never breaks the request path.

### ✅ Unit 3e: Image Generation PostHog Capture — Tests
**What**: Write failing tests in `test/lib/ai-placeholder-cover.server.test.ts`, `test/lib/spoon-cover-stylization.server.test.ts`, `test/lib/analytics-server.test.ts`, or a new helper test covering image generation telemetry. Use `captureException` / PostHog `$exception` for thrown generation/edit/upload/store failures, with extras `{ feature: "recipe_image_generation", operation, recipeId, coverId, sourceType, model, quotaKind }`. Use controlled event `spoonjoy.image_generation.skipped` only for non-throw skip reasons `{ reason: "quota_exhausted" | "missing_openai_key" | "missing_runner", operation, recipeId, coverId, sourceType, quotaKind }`. Allowed telemetry values: `operation` is `"placeholder_generate"` or `"cover_stylize"`; `sourceType` is `"ai-placeholder"`, `"chef-upload"`, or `"spoon"`; `quotaKind` is `"placeholder"` or `"stylization"`; `model` is the attempted OpenAI model string or `"none"` when no runner/model was attempted. Tests for `missing_openai_key` and `missing_runner` must assert telemetry emits and image-generation ledger quota is not created or consumed.
**Output**: Red tests for PostHog error/event metadata on image generation failures.
**Acceptance**: Tests fail on current code because background generation only logs to the logger.

### ✅ Unit 3f: Image Generation PostHog Capture — Implementation
**What**: Update image generation background tasks and analytics helper code so thrown failures call `captureException`, and quota exhaustion/missing OpenAI configuration/missing runner call `captureEvent` with event `spoonjoy.image_generation.skipped`. Check OpenAI configuration and runner availability before consuming ledger quota so config gaps never burn user quota. Preserve the existing behavior that capture failures never affect user requests. Do not add Spoonjoy-owned email delivery.
**Output**: Image generation telemetry path plus docs for configuring PostHog email alerts.
**Acceptance**: Unit 3e tests pass; docs mention PostHog alert setup; no email provider or email-send code is added.

### ✅ Unit 3g: OpenAI And PostHog — Coverage & Refactor
**What**: Run targeted image-gen/stylization/analytics tests, inspect failure metadata shape, and remove duplicate model/source constants if introduced.
**Output**: Green targeted image generation and analytics test run plus any small refactors.
**Acceptance**: Targeted tests pass with no warnings.

### ✅ Unit 4a: MCP Upload Tools — Tests
**What**: Write failing tests in `test/lib/mcp/spoonjoy-tools.server.test.ts`, `test/lib/mcp/http-mcp.server.test.ts`, `test/routes/mcp.test.ts`, `test/routes/api.test.ts`, and `test/lib/spoonjoy-api-spoons.test.ts` covering new `upload_recipe_image` and `upload_spoon_photo` tools, base64 decoding, MIME validation, GIF rejection, storage namespaces, returned `/photos/...` URL shape when R2 is available, returned data URL shape only when bucket is absent and an explicit local/test image-fallback flag is enabled, production-like bucket absence rejecting instead of returning data URLs, scope enforcement, annotations, and transport-level request body caps for `/mcp` and `/api/tools/*` before upload-tool dispatch. Body-cap tests must cover oversized `Content-Length` rejection and no-`Content-Length` oversized streaming/chunked bodies rejected while reading, before JSON parsing or tool dispatch, with limits sized for the 5 MB decoded image limit plus JSON/base64 overhead.
**Output**: Red tests for dedicated Option A upload tools only.
**Acceptance**: Tests fail on current code because upload tools do not exist.

### ✅ Unit 4b: MCP Upload Tools — Implementation
**What**: Update `app/lib/spoonjoy-api.server.ts`, MCP descriptors, and docs so dedicated upload tools accept `{ imageBase64, mimeType, filename }`, store through shared image-storage validation, and return stored image URLs. Data URL upload fallbacks require an explicit local/test image-fallback allowance in the API context; production-like missing bucket rejects. Add shared transport body-size enforcement for `/mcp` and legacy `/api/tools/*` POSTs before JSON/upload dispatch using both `Content-Length` checks and a capped streaming body reader that aborts while reading oversized no-`Content-Length` bodies.
**Output**: Dedicated MCP upload operations with complete schema, scopes, annotations, and docs.
**Acceptance**: Unit 4a tests pass.

### ✅ Unit 4c: MCP Recipe And Spoon Image Assignment — Tests
**What**: Write failing tests in `test/lib/spoonjoy-api-spoons.test.ts` and `test/lib/mcp/spoonjoy-tools.server.test.ts` covering `create_recipe`/`update_recipe` accepting only image URLs that are either owner-namespaced `/photos/recipes/<ownerId>/...` URLs verified to exist in R2, owner-namespaced `/photos/spoons/<ownerId>/...` URLs when assigning from a spoon photo, or any valid food-photo data URL only when bucket is absent and an explicit local/test image-fallback flag is enabled. Cover explicit-local/test no-bucket round trips by calling `upload_recipe_image`, passing its returned data URL into `create_recipe` and `update_recipe`, and asserting cover creation plus stylization scheduling; call `upload_spoon_photo`, pass its returned data URL into both `create_spoon` and `update_spoon`, and assert photo assignment plus eligible stylization. Cover production-like missing bucket rejecting upload and data-URL assignment. Cover origin-cook `update_spoon` photo changes creating a new active `RecipeCover` or replacing the active `sourceSpoonId` cover, the raw replacement photo becoming visible immediately, and stylization scheduling against that cover. Cover tests must reject external URLs for recipe cover assignment, arbitrary data URLs in bucket-backed recipe/spoon update contexts, invalid/non-food/GIF/oversized data URLs in no-bucket contexts, nonexistent R2 keys, foreign-user `/photos/...` keys, `/photos/profiles/...`, `/photos/imports/...`, `/photos/covers/...` generated keys for chef-upload assignment, encoded path traversal/weirdness, and malformed `/photos` prefixes. Also cover `create_spoon` and `update_spoon` continuing to accept existing external `photoUrl` for backward compatibility but stylization only running automatically for stored `/photos/...` or valid food-photo data URLs, both spoon mutations using uploaded `photoUrl`, and MCP-origin cover stylization scheduling through `waitUntil`.
**Output**: Red tests for assigning uploaded URLs to recipe and spoon records.
**Acceptance**: Tests fail on current code because recipe tools do not accept image URLs and MCP-origin recipe covers do not schedule stylization.

### ✅ Unit 4d: MCP Recipe And Spoon Image Assignment — Implementation
**What**: Update `app/lib/spoonjoy-api.server.ts` and shared scheduling helpers so recipe create/update can attach only validated owner-namespaced stored upload URLs without inline base64 payloads in bucket-backed contexts, allow any valid food-photo data URL only when bucket is absent and an explicit local/test image-fallback flag is enabled, reject production-like missing bucket image uploads/assignments, reject arbitrary external/data recipe cover URLs and invalid `/photos/...` keys, keep spoon `photoUrl` backward compatibility, and apply the same stored `/photos/spoons/<ownerId>/...` and explicit-local/test valid-data-URL validation to both `create_spoon` and `update_spoon`. For origin-cook spoons, `update_spoon` photo changes must create a new active cover or replace the active `sourceSpoonId` cover so the raw replacement is immediately visible and stylization targets that cover. Schedule stylization only for stored `/photos/...` or valid food-photo data URL spoon photos. In explicit local/test no-bucket mode, provenance is intentionally limited to authenticated caller scope plus validated bytes because data URLs are not owner-addressable.
**Output**: MCP recipe/spoon URL assignment paths that share cover creation and stylization behavior with browser routes.
**Acceptance**: Unit 4c tests pass.

### ✅ Unit 4e: MCP Image Support — Coverage & Refactor
**What**: Run targeted MCP/API tests and generated-doc checks, verify default-owner fallback rules remain unchanged, and update `docs/ouroboros-mcp.md`.
**Output**: Green targeted MCP/API test run plus updated connector docs.
**Acceptance**: MCP/API tests pass with no warnings and schemas reject unknown image payload shapes.

### ✅ Unit 5a: Risotto Repair And Regression E2E — Tests/Preparation
**What**: Add any remaining automated regression coverage not already introduced in Units 1-4, specifically Vitest or Playwright/e2e harness coverage for stylized cover replacement through deterministic mocked image runner paths if Unit 2/3 tests did not already cover it, and verify it red before implementation per strict TDD. Prepare a non-destructive risotto repair script or documented command in the artifacts directory that targets only the known row.
**Output**: Remaining red regression/e2e or harness tests if needed and dry-run repair artifact that prints target IDs and current URLs.
**Acceptance**: If Units 1-4 already introduced and passed the required Playwright/Vitest coverage, Unit 5a records those test names in the artifacts and adds no redundant test. Any newly needed regression/harness test is verified red here. Repair script has a dry-run mode and prints affected IDs before changing data.

### ✅ Unit 5b: Risotto Repair And Regression E2E — Implementation
**What**: Implement only the Unit 5a regression/e2e fixture/harness changes needed to satisfy tests written in Unit 5a, run the dry-run risotto repair, then repair only the known risotto cover if a recoverable original or deterministic rotation/stylization path exists. Any repaired/generated replacement must use a new `/photos/...` key rather than overwriting existing immutable photo URLs. Record before/after IDs and image URLs in the artifacts directory.
**Output**: Passing regression/e2e check and risotto repair evidence or documented unrecoverable-original blocker.
**Acceptance**: E2E regression passes locally; risotto repair either succeeds with before/after evidence or the artifacts document an unrecoverable-original blocker without broad data changes.

### ✅ Unit 5c: Full Validation
**What**: Run `pnpm run typecheck`, targeted tests, full coverage or the repo-accepted coverage command, Playwright e2e, and any smoke/MCP checks needed for confidence.
**Output**: Validation logs or summarized command outputs saved in the artifacts directory.
**Acceptance**: All required commands pass with no warnings.

### ✅ Unit 5d: Merge And Notification
**What**: Commit final docs/status updates, push, open/merge PR or merge branch to main per repo workflow, push main, and notify Slugger with `ouro msg --to slugger "Done: ..."` after merge.
**Output**: Merged implementation on main, pushed remote branch/main, and Slugger notification command output.
**Acceptance**: The implementation is merged, remote is updated, task docs reflect completion, and Slugger is notified.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Run red tests first and save red outputs in the artifacts directory, but do not commit or push red test-only states. Commit after the paired implementation/coverage phase is green and warning-free.
- Push after each unit complete
- Run full test suite before marking unit done
- **All artifacts**: Save outputs, logs, data to `./2026-06-07-1815-doing-recipe-image-handling/`
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-06-07 18:51 Created from planning doc
- 2026-06-07 18:54 Addressed granularity review findings
- 2026-06-07 18:56 Granularity review converged on round 2
- 2026-06-07 19:01 Addressed validation finding for direct spoon photo storage validation
- 2026-06-07 19:06 Validation review converged on round 2
- 2026-06-07 19:09 Addressed ambiguity review findings with concrete cover audit, OpenAI transport, telemetry, risotto, and e2e requirements
- 2026-06-07 19:11 Addressed ambiguity round 2 findings for e2e TDD order and telemetry enums
- 2026-06-07 19:13 Ambiguity review converged on round 3
- 2026-06-07 19:15 Addressed quality review finding by moving empty-state e2e to cover unit
- 2026-06-07 19:16 Removed stale empty-state wording from upload test unit
- 2026-06-07 19:17 Quality review converged on round 3
- 2026-06-07 19:25 Addressed Tinfoil scrutiny findings for JPEG orientation, pending placeholders, search freshness, red commits, and model note
- 2026-06-07 19:30 Addressed Tinfoil round 2 findings for profile constants, generated key uniqueness, and import GIF rejection
- 2026-06-07 19:34 Addressed Tinfoil round 3 findings for latest empty covers, byte sniffing, stored URL boundaries, and import key uniqueness
- 2026-06-07 19:39 Addressed Tinfoil round 4 findings for safe import fetch and stored upload URL validation
- 2026-06-07 19:52 Addressed Tinfoil round 5 findings for no-bucket data URL assignment and data URL stylization validation
- 2026-06-07 19:57 Addressed Tinfoil round 6 findings for positive edit-source byte validation and no-bucket MCP upload round trips
- 2026-06-07 20:03 Addressed Tinfoil round 7 finding for `update_spoon` image assignment validation
- 2026-06-07 20:09 Addressed Tinfoil round 8 findings for origin-cook spoon cover refresh, manual safe-fetch redirects, and MCP transport body caps
- 2026-06-07 20:14 Addressed Tinfoil round 9 finding for reference-safe stored cover object cleanup
- 2026-06-07 20:20 Addressed Tinfoil round 10 findings for spoon-photo references and cookbook OG null-cover handling
- 2026-06-07 20:26 Addressed Tinfoil round 11 findings for capped streaming tool bodies and no-quota missing OpenAI skips
- 2026-06-07 20:31 Tinfoil scrutiny converged on round 12
- 2026-06-07 20:40 Addressed Stranger round 1 findings for orientation wording, explicit local/test fallbacks, OpenAI base64 request semantics, stale test path, recipe OG coverage, and Unit 5 TDD order
- 2026-06-07 20:46 Addressed Stranger round 2 findings for food-photo format copy, upright-render e2e assertion, and exact test paths
- 2026-06-07 20:52 Addressed Stranger round 3 findings for exact e2e fixture/spec paths, exact MCP recipe test path, and server validation copy
- 2026-06-07 20:57 Addressed Stranger round 4 finding by requiring marker-based pixel/screenshot orientation proof
- 2026-06-07 21:00 Stranger scrutiny converged on round 5; doing doc ready for execution
- 2026-06-07 20:55 Unit 0 complete: wrote research artifacts, cover usage audit, OpenAI image API notes, and read-only risotto D1/R2 evidence; source EXIF orientation is unrecoverable but clockwise local repair preview is upright
- 2026-06-07 21:00 Addressed Unit 0 review findings by adding test-helper inventory, complete app coverImageUrl categorization, and saved read-only R2 command evidence
- 2026-06-07 21:29 Unit 1a-1c complete: added red upload/orientation tests and EXIF e2e fixture, implemented JPG/PNG/WebP food-photo validation with byte sniffing, preserved sanitized JPEG Orientation metadata, kept profile photos on a separate allow-list, and validated with targeted Vitest, Playwright e2e, scoped 100% coverage, typecheck, and build artifacts.
- 2026-06-07 21:43 Unit 1d-1e complete: added red import-cover tests for GIF content type, GIF extensions, disguised GIF bytes, unsafe schemes/hosts/redirects, and same-millisecond keys; implemented safe imported-cover fetch with food-photo byte validation, manual redirect validation, unique immutable import keys, and validated with targeted Vitest, 100% coverage on new helper code, typecheck, and build artifacts.
- 2026-06-07 21:51 Addressed Unit 1d-1e review finding by switching imported cover byte caps to streamed response reads that cancel once the cap is exceeded; added red/green regression artifacts, preserved 100% helper coverage, and reran targeted Vitest, typecheck, and build.
- 2026-06-07 22:06 Unit 2a-2b complete: added red cover-resolution, route, component, OG, API, fork, spoon-photo, and reference-safe cleanup tests; implemented nullable cover resolution, empty pending `ai-placeholder` rows for no-photo create/clear flows, null-safe consumers, cookbook OG null filtering, and skipped old stored-object deletion while DB rows still reference old cover URLs. Validated with 516 targeted tests, 100% focused helper coverage, typecheck, and build artifacts.
- 2026-06-07 22:15 Addressed Unit 2a-2b review finding by aligning API v1 cover precedence with the latest-cover resolver; added red/green API v1 regression artifacts and reran the expanded 523-test target suite, typecheck, and build.
- 2026-06-07 22:23 Unit 2c-2d complete: added red create/edit route regressions for chef-upload stylization scheduling, wired browser recipe create/edit chef uploads into the existing cover stylization scheduler, preserved immediate raw cover visibility, and validated with create/edit route tests, expanded spoon scheduling route tests, typecheck, and build artifacts.
- 2026-06-07 22:27 Unit 2e-2g complete: added red search freshness coverage for pending-cover and stylized-cover URL updates on existing cover rows, added deterministic `RecipeCover` content to the search source fingerprint, and validated with green search tests, 100% focused search coverage, typecheck, and build artifacts.
- 2026-06-07 22:33 Addressed Unit 2 reviewer findings: moved stylization runner availability ahead of quota consumption so missing OpenAI config cannot burn stylization quota, replaced serialized search cover URL fingerprint content with a compact latest-active-cover SHA-256 hash including cover id, recipe id, createdAt, raw URL, and stylized URL, and added search regressions for no-cover null, latest empty cover masking, and compact metadata. Validated with red/green helper/search artifacts, 142 route scheduling tests, 100% focused coverage, typecheck, and build.
- 2026-06-07 22:42 Unit 3a-3b complete: added red image-generation tests for OpenAI `b64_json` decoding, direct byte storage, unique generated cover keys, explicit local/test data URL fallback, production-like bucket absence rejection, missing image-data errors, and edit response base64 handling; implemented bytes-first generated image persistence and updated generation/import scheduler tests. Validated with 143 targeted generation/import tests, 100% focused image-gen coverage, typecheck, and build artifacts.
- 2026-06-07 22:48 Unit 3c-3d complete: added red edit-source tests for data URLs, R2 `/photos/*` objects, HTTPS safe-image fetch, invalid/GIF source bytes, missing stored objects, malformed/unsupported URLs, multipart `File` forwarding to OpenAI edits, and no text-only fallback after edit failure; implemented validated source-file resolution and removed stylization fallback generation. Validated with 151 targeted generation/import tests, 100% focused image-gen coverage, typecheck, and build artifacts.
- 2026-06-07 23:01 Unit 3e-3g complete: added red telemetry tests for missing OpenAI keys, missing runners, quota skips, generation/stylization exceptions, and plaintext HTTP edit-source rejection; implemented PostHog `$exception`/`spoonjoy.image_generation.skipped` capture with recipe/cover metadata, no-quota runner resolution, HTTPS-only edit-source fetches, and PostHog alert docs. Validated with 107 focused tests, 100% focused scheduler/telemetry coverage, typecheck, and build artifacts.
- 2026-06-07 23:30 Unit 4a-4e complete: added MCP recipe/spoon upload tools, capped MCP and legacy tool request bodies, validated owner-scoped image assignment for recipe and spoon mutations, preserved external spoon photo compatibility, scheduled MCP-origin stylization with explicit local/test fallbacks, documented the upload-first connector workflow, and validated with 152 focused tests, 100% focused coverage, typecheck, and build artifacts.
- 2026-06-07 23:34 Unit 5a complete: confirmed existing orientation e2e and deterministic stylization tests cover the remaining regression surface, wrote the risotto repair dry-run plan, re-read the exact remote D1 target row, and confirmed the planned repair R2 key does not exist.
- 2026-06-07 23:42 Unit 5b complete: uploaded the clockwise upright risotto repair to a new immutable R2 key, verified direct R2 and served `/photos` readback hashes, guarded the remote D1 update to the known cover row, rolled back and retried safely during an initial R2 readback anomaly, and deleted disposable probe objects.
- 2026-06-08 00:18 Unit 5c full validation passed: `pnpm run typecheck`, `pnpm run build`, `pnpm exec vitest run --fileParallelism=false`, `pnpm run test:coverage` with 100% statements/branches/functions/lines, and `pnpm run test:e2e` with 59/59 Playwright tests passing.
- 2026-06-08 00:52 Unit 5d merge validation passed on current `origin/main`: conflict-focused Vitest, typecheck, build, full `pnpm run test:coverage` at 100%, and full Playwright e2e rerun with 59/59 passing after one transient recipes-flow retry.
