# Spoonjoy v2 Backlog

Status: proposed canonical backlog
Audit date: 2026-05-27 (refresh)
Baseline: `main` at `c89883f` (`chore: gitignore live smoke artifacts (#104)`)
Verification anchor: `pnpm test:coverage` passes with 228 test files, 0 skipped tests, and 100% statements/branches/functions/lines.

## How To Use This Backlog

This file is the proposed source of truth for Spoonjoy v2 work. It supersedes the stale snapshot in `.tasks/ACTIVE.md` and the missing `backlog-coding.md` references in `feedback/`.

Every implementation item must preserve the repo contract:

- 100% statement, branch, function, and line coverage.
- Zero warnings in required checks.
- Atomic PRs with tests alongside code.
- Cloudflare-first architecture when a platform choice is involved.
- No human handoff unless the only remaining issue is product judgment.

Priority meanings:

- `P0`: Blocks trust, core user flows, or future agent execution.
- `P1`: High-value product or engineering unblocker; should be near-term.
- `P2`: Important feature parity, product expansion, or maintainability work.
- `P3`: Polish, refinement, or optional hardening.

Status meanings:

- `proposed`: Ready for human prioritization and planning.
- `ready`: Scope is accepted and ready to execute.
- `in-progress`: Active branch/PR exists.
- `done`: Merged and verified.
- `superseded`: Replaced by another item.
- `deferred`: Intentionally parked.

## Recommended Next PR Sequence

The previous run-through (SJ-001 → SJ-026) is complete. The next wave focuses on cleanup, production hardening, and the long-deferred password-reset/WebAuthn build.

1. `SJ-034`: Refresh BACKLOG.md and prune stale docs (this PR + follow-up).
2. `SJ-032`: Remove v1 → v2 migration plumbing now that cutover is complete.
3. `SJ-035`: Resolve the lone `fellow-chefs.server.ts:26` performance TODO.
4. `SJ-036`: Finish PostHog setup and add free-tier server-side error tracking.
5. `SJ-037`: Rate-limit `/api/*` and the MCP bearer surface.
6. `SJ-038`: Polish PWA install prompt and offline fallback.
7. `SJ-016`: Build password reset (depends on rate limiting from `SJ-037`).
8. `SJ-016b`: Build WebAuthn enrollment + sign-in (three PRs: server registration, server assertion, client UX).

Completed waves (in chronological order of completion):

- Foundational wave: `SJ-001`, `SJ-002`, `SJ-003`, `SJ-004`, `SJ-005`, `SJ-006`, `SJ-008`, `SJ-009`, `SJ-013`, `SJ-015`, `SJ-023`, `SJ-007`, `SJ-024`, `SJ-017`, `SJ-019`.
- Product-expansion wave: `SJ-010` (search + fellow chefs), `SJ-011` (recipe import), `SJ-012` (recipe forking + spoons), `SJ-014` (ingredient parsing provider refresh), `SJ-020` (analytics/privacy), `SJ-021` (a11y pass), `SJ-022` (Ouroboros MCP), `SJ-025` (MCP cookbook tools), `SJ-026` (shared REST/MCP auth).
- Untracked-at-time-of-shipping wave (now documented retroactively): `SJ-027` (Web Push), `SJ-028` (Cook Mode v2), `SJ-029` (Public Sharing + First-Class Agent Auth), `SJ-030` (Search Index Performance Hardening), `SJ-031` (OAuth Provider Hardening Rounds), `SJ-032` (v1 → v2 Migration Plumbing — now scheduled for removal), `SJ-033` (Cookbook Experience Redesign).

## Backlog Items

### SJ-001 - Establish Agent-Trust Backlog And Docs Source Of Truth

Priority: `P0`
Lane: `agent-trust`, `workflow`, `docs`
Status: `done`

Problem: The repo has several competing backlog and planning artifacts. `.tasks/ACTIVE.md` still presents OAuth as ready-to-start and says OAuth helpers do not exist, while the codebase has OAuth helper libraries, tests, and UI but no registered route endpoints. `feedback/2026-01-29.md` points to a missing `backlog-coding.md`. README/GUIDE also contain stale D1 migration commands.

Evidence:

- `.tasks/ACTIVE.md` lines 7-23 describe stale OAuth state.
- `.tasks/ACTIVE.md` lines 87-121 describe shopping-list Option 2 as active, though much of the D1-backed behavior now exists.
- `feedback/2026-01-29.md` references `backlog-coding.md`, which is not present.
- `README.md` and `GUIDE.md` reference `migrations/init.sql` and `spoonjoy-local`, but the repo uses numbered migrations and the `DB` binding.

Acceptance criteria:

- This `BACKLOG.md` is documented as the canonical backlog.
- `.tasks/ACTIVE.md` is either archived or reduced to a pointer to this backlog.
- README/GUIDE local database instructions use `wrangler d1 migrations apply DB --local` and current seed commands.
- Feedback files either link to this backlog item set or clearly remain historical notes.
- Future planning docs reference stable `SJ-*` IDs.

### SJ-002 - Complete OAuth Initiation And Callback Routes

Priority: `P0`
Lane: `auth`, `product-seams`, `agent-trust`
Status: `done`

Problem: OAuth appears user-facing but route endpoints are missing. Login/signup render provider buttons that submit to `/auth/google` and `/auth/apple`; account settings redirects to `/auth/{provider}?linking=true`; `app/routes.ts` registers no `/auth/*` routes. The helpers and callback orchestration modules exist, so this is a seam-completion issue rather than a greenfield auth project.

Evidence:

- `app/components/ui/oauth.tsx` posts provider forms to `/auth/{provider}`.
- `app/routes/account.settings.tsx` redirects link flow to `/auth/{provider}?linking=true`.
- `app/routes.ts` registers login/signup/logout/account routes but no auth initiation or callback routes.
- `app/lib/apple-oauth*.server.ts`, `app/lib/google-oauth*.server.ts`, and `app/lib/oauth-user.server.ts` are already implemented and heavily tested.

Acceptance criteria:

- Add and register routes for Google initiation, Google callback, Apple initiation, and Apple callback.
- Preserve `redirectTo` and account-linking intent through state/session cookies.
- Google flow uses PKCE and validates state/code verifier.
- Apple flow supports `response_mode=form_post` callback handling.
- Successful login/create/link paths create or preserve user sessions correctly.
- Error paths redirect to login/signup/account settings with actionable `oauthError` values.
- Tests cover missing env vars, invalid state, invalid provider, callback provider errors, existing-account linking, and OAuth-only user session creation.
- Docs list current required Google and Apple secrets.

Completion notes:

- Registered Google and Apple initiation/callback routes in `app/routes.ts`.
- Added shared OAuth route/session helpers for state, redirect preservation, linking intent, callback URL construction, and error redirects.
- Added account settings OAuth error display for linking failures.
- Verified with focused OAuth/auth/account route tests and full coverage before merge.

### SJ-003 - Persist RecipeBuilder Steps And Ingredients On Recipe Create

Priority: `P0`
Lane: `recipes`, `data-integrity`, `core-flow`
Status: `done`

Problem: The create-recipe UI can collect steps and ingredients, but the create action only persists step metadata and explicitly notes that ingredient handling is not implemented. This can silently discard ingredient data entered during the primary recipe creation flow.

Evidence:

- `RecipeBuilderData` includes `steps` with ingredients.
- `app/routes/recipes.new.tsx` parses `stepsJson` but maps each step to `stepNum`, `description`, `stepTitle`, and `duration` only.
- The same action contains the comment that ingredients need additional handling for `ingredientRef` lookup.
- Recipe detail and shopping-list flows depend on persisted step ingredients.

Acceptance criteria:

- Create action validates every submitted step and ingredient using shared validation utilities.
- Invalid `stepsJson` returns a validation error instead of silently creating a recipe with no steps.
- Recipe, steps, ingredient refs, units, and ingredient rows are created in one transaction.
- Step order, duration, optional step titles, ingredient quantities, unit names, and ingredient names round-trip from RecipeBuilder to recipe detail.
- Adding a newly created recipe to the shopping list includes the newly persisted ingredients.
- Tests cover empty steps, invalid JSON, invalid step fields, invalid ingredient fields, duplicate unit/ref reuse, and successful full create.

Completion notes:

- Added a shared recipe-create helper that parses, validates, normalizes, and transactionally persists builder-submitted steps and ingredients.
- Updated the create route to reject invalid step payloads instead of silently creating recipes with empty steps.
- Persisted units, ingredient refs, recipe steps, and ingredient rows in the same transaction as recipe creation.
- Added route and helper tests for empty steps, invalid JSON, invalid step/ingredient fields, duplicate unit/ref reuse, successful full create, and shopping-list inclusion.

### SJ-004 - Finish Recipe Image Upload And Storage

Priority: `P0`
Lane: `recipes`, `cloudflare`, `storage`
Status: `done`

Problem: Recipe image inputs validate files and show previews, but create/edit actions do not upload selected recipe images. Create always stores an empty image URL, and edit only handles clear-image.

Evidence:

- `app/routes/recipes.new.tsx` validates `imageFile`, has a production R2 TODO, then sets `imageUrl: ""`.
- `app/routes/recipes.$id.edit.tsx` validates `imageFile` but never uploads or stores it.
- `app/routes/photos.$.tsx` can serve R2 objects through `/photos/*`.
- `app/routes/account.settings.tsx` already has working R2 upload/delete patterns for profile photos.
- `wrangler.json` currently has D1 config but no R2 bucket binding for `PHOTOS`.

Acceptance criteria:

- Extract or create a reusable Cloudflare R2 image helper for profile and recipe images.
- Configure `PHOTOS` R2 binding in Wrangler for production and document local fallback behavior.
- Create stores uploaded recipe image URLs under a recipe-specific key namespace.
- Edit can replace and clear images, deleting old R2 objects when appropriate.
- File type, size, missing bucket, upload failure, and deletion failure paths are tested.
- Recipe cards and detail pages display the uploaded image after create/edit.

Completion notes:

- Added shared image storage helpers for R2 uploads, local data-URL fallback, validation, and stored-object deletion.
- Moved profile photo upload/removal onto the shared helper so profile and recipe images use the same storage contract.
- Recipe create now uploads selected images under `recipes/{userId}/{recipeId}/...` and stores the resulting served URL.
- Recipe edit now uploads replacements, clears stored images, and handles upload/delete failure paths.
- Added the `PHOTOS` R2 bucket binding to Wrangler and documented production R2 plus local no-bucket fallback behavior.

### SJ-005 - Fix Active Recipe Title Uniqueness

Priority: `P1`
Lane: `data-integrity`, `recipes`, `database`
Status: `done`

Problem: The schema intends to prevent duplicate active recipe titles per chef while allowing title reuse after soft delete, but the current nullable `deletedAt` compound unique constraint does not enforce that rule in SQLite/D1. The corresponding model test was skipped before `SJ-005`.

Evidence:

- `prisma/schema.prisma` has `@@unique([chefId, title, deletedAt])` with a TODO noting it is broken.
- `test/models/recipe.test.ts` previously skipped the duplicate-title integrity test because `NULL` values are not equal in SQLite.

Acceptance criteria:

- Decide on an enforceable strategy for D1/SQLite, such as application-level active duplicate checks or a schema-level active-title key.
- Recipe create and edit prevent duplicate active titles for the same chef.
- Soft-deleted recipes do not block title reuse.
- Race behavior is tested as far as the platform supports.
- The skipped model test is restored or replaced by equivalent active-route/model coverage.

Completion notes:

- Added shared active-title uniqueness validation for SQLite/D1 app-level enforcement.
- Create and edit actions now reject duplicate active titles for the same chef while allowing same-title recipes for other chefs and title reuse after soft delete.
- The Ouroboros MCP `create_recipe` tool uses the same active-title guard, so harness writes follow the app contract.
- Removed the stale skipped model assertion that expected SQLite/D1 to enforce nullable compound uniqueness directly.

### SJ-006 - Eliminate Hidden Test Debt From Skipped Tests

Priority: `P1`
Lane: `quality`, `testing`, `agent-trust`
Status: `done`

Problem: The repo satisfied 100% coverage, but 15 tests were skipped. Several skipped tests covered user-visible edge paths: step deletion dialog errors, reorder error UI, mobile touch targets, and editor parsing behavior.

Evidence:

- Prior `pnpm test:coverage` baseline reported 15 skipped tests.
- Skips include `test/components/recipe/StepEditorCard.test.tsx`, `test/routes/step-reorder-protection-e2e.test.tsx`, `test/routes/step-deletion-protection-e2e.test.tsx`, and `test/routes/recipes-id-steps-id-edit.test.tsx`.

Acceptance criteria:

- Remove all stale `it.skip`/`describe.skip` cases by fixing tests, moving browser-only assertions into Playwright, or replacing them with viable equivalents.
- If a skip is intentionally retained, document the platform limitation and add a tracked backlog ID next to it.
- Coverage remains 100% and all test runs remain warning-free.

Completion notes:

- Removed every explicit `it.skip`/`describe.skip` from `app/` and `test/`; `rg "\b(it|test|describe)\.skip\b|skip\(" test app` now returns no matches.
- Replaced JSDOM layout-dependent touch-target assertions with structural checks against explicit coarse-pointer touch target affordances.
- Added reusable `data-slot="touch-target"` markers to `TouchTarget`, added equivalent switch touch targets, and wrapped `StepEditorCard` action buttons with the shared touch target pattern.
- Replaced stale reorder/deletion UI skips with current action-data rendering tests or removed assertions for route-era UI that no longer exists.
- Verified `pnpm test:coverage` with 137 test files, 3493 tests, 0 skipped tests, and 100% statements/branches/functions/lines.

### SJ-007 - Split Large Route Modules Into Testable Domains

Priority: `P1`
Lane: `architecture`, `maintainability`, `testing`
Status: `done`

Problem: Several route modules mix loader/action logic, domain operations, helper functions, and large UI components. The tests are also large, making future changes expensive under the 100% coverage rule.

Evidence:

- `app/routes/account.settings.tsx` was about 970 lines before the first `SJ-007` extraction slice.
- `app/routes/shopping-list.tsx` was about 946 lines before the second `SJ-007` extraction slice.
- `app/routes/recipes.$id.tsx` is about 762 lines.
- Matching test files exceed thousands of lines, with `test/routes/account-settings.test.tsx` at 4257 lines.

Acceptance criteria:

- Extract account settings photo/auth/password actions into server-side modules with route-level orchestration.
- Extract shopping-list parsing, persistence, ordering, and action handlers into domain modules.
- Extract recipe detail cookbook/shopping-list helpers from the UI route.
- Keep route modules thin without changing behavior.
- Preserve or improve coverage while reducing route test fixture duplication.

Progress notes:

- First slice extracted account settings loader/action, profile photo, OAuth-linking, and password mutation behavior into `app/lib/account-settings.server.ts`, leaving `app/routes/account.settings.tsx` as a much thinner route/UI wrapper.
- Second slice extracted shopping-list parsing, ordering, loader, and action behavior into `app/lib/shopping-list.server.ts` plus client-safe parser helpers in `app/lib/shopping-list-parser.ts`, leaving `app/routes/shopping-list.tsx` focused on route exports, swipe helpers, and UI.
- Third slice extracted recipe-detail loader/action, cookbook save membership, shopping-list ingredient presence, and delete behavior into `app/lib/recipe-detail.server.ts`, leaving `app/routes/recipes.$id.tsx` focused on route exports, UI state, and rendering.
- Scoped route-domain extraction is complete; any further recipe-detail UI component splitting should be tracked as a separate observed backlog item if it blocks future work.

### SJ-008 - Mobile RecipeBuilder And SpoonDock UX Audit

Priority: `P1`
Lane: `mobile`, `ux`, `accessibility`
Status: `done`

Problem: Mobile-first recipe input was previously flagged as unresolved/reverted. Recipe creation is a core mobile flow, so this still needs a real device-size pass rather than component-only confidence.

Evidence:

- `REVIEW-PACKET.md` calls out Recipe Input v2, SpoonDock, mobile optimization, and visual polish for review.
- `SJ-006` added structural touch-target checks, but mobile viewport behavior still needs browser validation.
- `app/root.tsx` uses a mobile-only main area with bottom padding plus `MobileNav`, making obstruction/regression checks important.

Acceptance criteria:

- Audit create/edit/detail/shopping-list flows at small mobile breakpoints in a browser.
- Ensure SpoonDock does not obscure primary actions, forms, modals, or validation messages.
- Verify touch-target behavior in a browser at mobile breakpoints.
- Ensure drag/reorder alternatives are accessible on mobile.
- Capture before/after screenshots or an explicit QA checklist in the PR.

Completion notes:

- Added a mobile Playwright audit spec for create, edit, detail, and shopping-list flows at a 390x844 touch viewport.
- Fixed edit-page SpoonDock Save so it submits current RecipeBuilder state instead of registering a no-op action.
- Added contextual SpoonDock layout support so recipe-detail Edit/List/Save/Share actions fit inside the dock without side-slot overflow.
- Added mobile clearance to the Save to Cookbook sheet so its footer stays above the fixed SpoonDock.
- Added 44px minimum touch-target enforcement for shopping-list item rows and check buttons.
- Captured the ongoing manual QA checklist in `docs/qa/sj-008-mobile-recipebuilder-spoondock-audit.md`.
- Verified focused Vitest coverage, full `pnpm test:coverage`, and the targeted mobile Playwright audit.

### SJ-009 - Add Canonical User Profile Routes And Fix Chef Links

Priority: `P1`
Lane: `profiles`, `navigation`, `product-parity`
Status: `done`

Problem: v2 has a kitchen view that can load another chef via query params, and recipe dock actions link to `/users/{chefId}`, but no `/users/*` route exists. Non-owner recipe detail actions can therefore point users to a missing route.

Evidence:

- `app/routes/_index.tsx` supports `chefId` and `chef` query params.
- `app/components/navigation/use-recipe-dock-actions.tsx` uses `/users/${chefId}` for `view-chef-profile`.
- `app/routes.ts` registers no `/users/:id` or `/users/:username` route.
- Spoonjoy v1 had `/users/{username}` and `/users/{username}/fellow-chefs` routes.

Acceptance criteria:

- Add canonical profile route(s), preferably username-based for shareability.
- Update dock/profile links to valid routes.
- Decide and document whether `chefId` query URLs remain supported as compatibility aliases.
- Tests cover owner, non-owner, unknown chef, unauthenticated visitor, and profile photo fallback states.

Completion notes:

- Added `/users/:identifier` with username-first lookup and id-to-username redirects for compatibility with older `/users/{chefId}` links.
- Kept existing index kitchen `chef` and `chefId` query support intact while making `/users/{username}` the canonical share/profile URL.
- Updated recipe detail header and non-owner SpoonDock chef-profile actions to use canonical username URLs.
- Hid empty-profile recipe creation CTAs for visitor views while preserving owner CTAs.
- Added loader, meta, component, dock-action, header, and RecipeGrid branch coverage for owner, visitor, unknown, unauthenticated, profile-photo, nullable recipe metadata, and empty-state paths.
- Verified `pnpm typecheck`, focused route/component tests, and full `pnpm test:coverage`.

### SJ-010 - Search, Discovery, And Fellow Chefs

Priority: `P2`
Lane: `discovery`, `product-parity`, `social`
Status: `done`

Problem: The revised roadmap calls for search and fellow chefs, and v1 included a fellow-chefs page. v2 has basic public kitchen mechanics but no search/discovery surface.

Evidence:

- `.tasks/ACTIVE.md` roadmap lists search + fellow chefs.
- v1 routes include `/users/{username}/fellow-chefs`.
- v2 index route can display another kitchen only when directly addressed.

Acceptance criteria:

- Define public/private visibility rules for recipes, cookbooks, and profiles.
- Add search over chefs, recipes, and cookbooks using D1-compatible queries.
- Add fellow-chef/follow relationship model if still desired.
- Add empty, loading, privacy, and unauthenticated states.
- Add e2e smoke coverage for discovering and opening another chef's recipe.

Completion notes:

- Shipped via commit `042e654` (feat: add full search UI and MCP tools) and `86bf3f8` (fix: expose search from kitchen home), with FTS5-backed indices in `app/lib/search.server.ts` and `app/routes/search.tsx`.
- Fellow chefs landed via PR #42 (commit `155898e`, "feat: E1 Fellow chefs + Kitchen visitors derived-graph views") — `app/lib/fellow-chefs.server.ts` + `app/routes/users.$identifier.fellow-chefs.tsx`.
- Decision on visibility: recipes are intentionally public (no `isPublic` column); the loader gates ownership-only actions via `isOwner`. Documented in `docs/api.md`. A richer visibility model is parked.
- Search performance hardening shipped separately as `SJ-030` (PRs #84-#88).

### SJ-011 - Recipe Import Flow

Priority: `P2`
Lane: `recipes`, `import`, `v1-parity`
Status: `done`

Problem: v1 had import/add recipe routes and backend import helpers. v2 currently has manual recipe creation plus ingredient parsing, but no import flow.

Evidence:

- v1 routes include `/import-recipes` and `/add-recipes`.
- v1 backend has importing helpers and source data structures.
- v2 schema still has `sourceUrl`, suggesting provenance/import use cases remain relevant.

Acceptance criteria:

- Define v2 import scope: URL import, pasted text, structured JSON, or v1 migration import.
- Persist source URL/provenance when available.
- Reuse ingredient parsing and RecipeBuilder review before save.
- Add validation and recovery states for partial imports.
- Tests cover happy path, unsupported source, parse failure, duplicate title handling, and cookbook assignment.

Completion notes:

- I1 web-page import landed via PR #40 (commit `4ca7fa7`, "feat: I1 — import_recipe_from_url MCP op (web pages)") — `app/lib/recipe-import-fetch.server.ts` + `recipe-import-jsonld.server.ts` + `recipe-import-llm.server.ts`.
- I2 video import landed via PR #43 (commit `d52ac1e`, "feat: I2 — import_recipe_from_url video sources (TikTok + YouTube)") — `app/lib/recipe-import-video.server.ts`.
- Top-level import orchestration in `app/lib/recipe-import.server.ts`. OpenAI wiring fix in PR #81 (`570e859`).
- All paths surface through the MCP `import_recipe_from_url` op so REST/agent clients share the same logic.

### SJ-012 - Recipe Forking/Spooning Flow

Priority: `P2`
Lane: `sharing`, `recipes`, `social`
Status: `done`

Problem: The schema has `sourceRecipeId`, `sourceUrl`, and `recipeForks`, and the roadmap names sharing/forking/spooning, but v2 has no user-facing flow for copying another chef's recipe into your own kitchen.

Evidence:

- `prisma/schema.prisma` includes source/fork fields.
- `WORKING_NOTES.md` notes source fields exist but forking is not implemented in UI.
- Recipe detail already supports saving to cookbooks and sharing, making spoon/fork the next natural action.

Acceptance criteria:

- Define product language: fork, spoon, save copy, or remix.
- Non-owner recipe detail can create an owned copy while preserving source attribution.
- Forked recipes include steps, ingredients, dependencies, image behavior, and cookbook placement decisions.
- Source attribution renders on detail pages.
- Tests cover forking own recipe, forking another user's recipe, deleted source behavior, and duplicate title conflict behavior.

Completion notes:

- Forking shipped via PR #41 (commit `c7590fb`, "feat(fork): F1 recipe fork — clone + provenance + MCP op") — `app/lib/recipe-fork.server.ts`, `app/routes/recipes.$id.fork.tsx`, `app/components/recipe/ForkRecipeButton.tsx`.
- "Spoons" (the related social signal — public acknowledgment of cooking another chef's recipe) shipped via commit `0c2a895` ("feat(spoons): MCP ops, dialog, strip, provenance, e2e") with the spoon-photo affordance refined in `5062e3a`.
- Forks preserve `sourceRecipeId` provenance, copy steps/ingredients/dependencies in a single transaction, and render source attribution on recipe detail.
- MCP op exposed for agents; tests cover happy path, deleted source, duplicate title, and cross-owner isolation.

### SJ-013 - Shopping List Conflict And Idempotency Hardening

Priority: `P1`
Lane: `shopping-list`, `sync`, `data-integrity`
Status: `done`

Problem: Shopping-list Option 2 is largely implemented, but the stale active tracker still identifies conflict behavior and integration hardening as next work. The current server-backed list should be made robust under repeated submissions and multi-session use.

Evidence:

- `.tasks/ACTIVE.md` Unit 3 calls for conflict handling, repeated action idempotency, and soft-delete restore coverage.
- `app/routes/shopping-list.tsx` implements D1-backed checked, deleted, sorting, category, and icon metadata.

Acceptance criteria:

- Tests cover repeated add/toggle/remove/clear submissions.
- Tests cover restoring soft-deleted rows via add flows.
- Multi-session behavior is covered at the route or e2e level.
- Ordering remains deterministic after concurrent-ish toggles and clears.
- UI reconciles optimistic updates with server state cleanly.

Completion notes:

- Scoped item-level toggle and remove actions to the current user's shopping list so posted item ids cannot mutate another user's list.
- Made manual re-adds and recipe-based re-adds reactivate existing checked/deleted rows as active unchecked rows.
- Restored soft-deleted rows to the end of the active list to avoid duplicate or stale ordering.
- Hardened `clearCompleted` to clear legacy rows where `checked` is true but `checkedAt` is missing.
- Added route regression tests for cross-user toggle/remove isolation, checked-row reactivation, soft-deleted manual and recipe restore, legacy clear-completed rows, and deterministic restored ordering.
- Verified focused shopping-list route/UI tests, `pnpm typecheck`, and full `pnpm test:coverage`.

### SJ-014 - Ingredient Parsing Provider Refresh And Runtime Controls

Priority: `P2`
Lane: `ai`, `ingredients`, `cloudflare`
Status: `done`

Problem: Ingredient parsing is implemented against OpenAI structured outputs, but provider research/docs are time-sensitive and should be refreshed before productizing or expanding the AI path. The current parser hardcodes a model ID and route callers directly choose API-key fallback behavior.

Evidence:

- `app/lib/ingredient-parse.server.ts` hardcodes the OpenAI model ID.
- `docs/ingredient-parsing-provider-research.md` and `notes-recipe-input-llm-research.md` are research snapshots, not current operating docs.
- Shopping-list and step routes call `parseIngredients` from several places.

Acceptance criteria:

- Revalidate provider/model choice against official provider docs before changing model behavior.
- Make model/provider configurable through env with a safe default.
- Centralize timeout, retry, error mapping, and structured-output validation.
- Keep deterministic fallback behavior for missing API keys.
- Tests cover configured model/provider, missing key, provider failure, malformed JSON, and multi-line ingredient parsing.

Completion notes:

- Refreshed `docs/ingredient-parsing-provider-research.md` against current official OpenAI, Anthropic, and Gemini docs.
- Kept OpenAI `gpt-4o-mini` as the safe default for focused structured extraction while documenting newer-model/provider evaluation paths.
- Added centralized parser env resolution and runtime controls for `INGREDIENT_PARSE_PROVIDER`, `INGREDIENT_PARSE_MODEL`, `INGREDIENT_PARSE_TIMEOUT_MS`, and `INGREDIENT_PARSE_MAX_RETRIES`.
- Centralized OpenAI timeout/retry construction, unsupported-provider failure, provider error mapping, refusal handling, JSON parsing, and Zod response validation.
- Preserved shopping-list deterministic/manual fallback behavior when no API key is configured.
- Verified focused parser/route tests, `pnpm typecheck`, `pnpm build`, full `pnpm test:coverage`, and `pnpm test:e2e`.

### SJ-015 - Cloudflare Deployment And Environment Hardening

Priority: `P1`
Lane: `cloudflare`, `ops`, `docs`
Status: `done`

Problem: Runtime code expects Cloudflare bindings/secrets that now span D1, R2 photos, OAuth, sessions, and OpenAI. Wrangler has the core bindings, but the deployment posture still needs a preflight-style hardening pass so agents and humans can verify production readiness without rediscovering requirements.

Evidence:

- `wrangler.json` configures D1 and the `PHOTOS` R2 binding, while secrets remain managed out-of-band via Cloudflare.
- `app/cloudflare-env.d.ts` includes `PHOTOS`, `OPENAI_API_KEY`, Google OAuth, and Apple OAuth variables.
- `app/lib/env.server.ts` validates OAuth configuration only; there is no single deployment preflight covering sessions, D1, R2, OAuth, and OpenAI.
- README/GUIDE document the main deployment commands, but do not provide a machine-checkable checklist or failure-mode guidance for missing optional services.

Acceptance criteria:

- Add documented R2 binding configuration for recipe/profile photos.
- Document all required and optional secrets for local preview and production.
- Align env helper types with actual route needs.
- Add a deployment preflight or doc checklist for D1 migrations, seed behavior, R2, OAuth, and OpenAI.
- CI/deploy docs match current workflow commands.

Completion notes:

- Added `pnpm deploy:preflight` with a tested validator for Wrangler bindings, required package scripts, Cloudflare env typing, documented secrets, migration presence, and deploy-command documentation.
- Added `docs/deployment.md` with D1, R2, secret, local `.dev.vars`, preflight, migration, deploy, and failure-mode guidance.
- Added `SESSION_SECRET` to the Cloudflare `Env` type and refreshed README/GUIDE deploy references.
- Verified `pnpm deploy:preflight`, focused deployment-preflight tests, `pnpm typecheck`, full `pnpm test:coverage`, `pnpm build`, and `pnpm test:e2e`.

### SJ-016 - Password Reset And WebAuthn Build

Priority: `P2`
Lane: `auth`, `v1-parity`, `security`
Status: `in-progress`

Problem: v2 schema still has reset-token and WebAuthn credential fields, and v1 included forgot/reset password and WebAuthn client plumbing. v2 has no routes or product decision for these capabilities.

Evidence:

- `prisma/schema.prisma` has `resetToken`, `resetTokenExpiresAt`, `webAuthnChallenge`, and `UserCredential`.
- v1 routes included `/forgot-password` and `/reset-password`.
- v1 auth code included WebAuthn client setup.

Decision (2026-05-27): **In scope.** Build password reset first (depends on `SJ-037` rate limiting), then WebAuthn registration/sign-in/UX as a three-PR series. Schema fields stay; they were forward-thinking.

Execution plan:

- **PR-I (password reset):** `/forgot-password` request form, token gen with crypto-grade randomness, email send action (provider TBD — Cloudflare Email Workers vs Resend free tier), `/reset-password?token=...` form, token consumption + expiry. Heavily rate-limited via `SJ-037`. Tests cover token lifecycle, expired, used, invalid, and race.
- **PR-J1 (WebAuthn registration):** Server-side challenge generation + attestation verification (`@simplewebauthn/server`), credential persistence into `UserCredential`. `POST /auth/webauthn/register/options`, `POST /auth/webauthn/register/verify`. RPID = `spoonjoy.app`.
- **PR-J2 (WebAuthn sign-in):** Server-side assertion verification, `POST /auth/webauthn/sign-in/options`, `POST /auth/webauthn/sign-in/verify`, `signCount` rotation, session creation.
- **PR-J3 (WebAuthn client UX):** Settings-page "Add a passkey" button + passkey list with rename/remove. Login-page "Sign in with passkey" with conditional mediation. Graceful fallback to password if WebAuthn unavailable. Storybook stories + e2e.
- **PR-J4 (passkey settings management) — done:** Account settings now names a passkey at enrollment (optional label) and lists enrolled passkeys (newest first, name + enrollment date) with per-passkey removal guarded against deleting the user's last remaining sign-in method. Adds `UserCredential.name`/`createdAt` (migration `0012_passkey_metadata.sql`), `listUserPasskeys`/`removeUserPasskey` helpers, and a `removePasskey` action.
- **PR-J5 (passkey rename) — done:** Per-passkey inline rename in account settings (`renameUserPasskey` helper + `renamePasskey` action), `userId`-scoped; a blank label clears the name back to the generic fallback. Completes PR-J3's "rename/remove" promise.

### SJ-017 - Cookbook Management Completion

Priority: `P2`
Lane: `cookbooks`, `product`
Status: `done`

Problem: Cookbook creation/detail, title editing, deletion, and recipe membership controls exist, but revalidation found cookbook membership actions were not fully idempotent or relation-scoped.

Evidence:

- `.tasks/ACTIVE.md` deferred backlog listed edit cookbook title, but `app/routes/cookbooks.$id.tsx` now includes inline owner-only title editing and deletion.
- `app/routes/cookbooks.$id.tsx` previously deleted a posted `recipeInCookbookId` without constraining it to the current cookbook id.
- Duplicate add submissions previously returned a 400 even though recipe membership is naturally idempotent.

Acceptance criteria:

- Add edit cookbook title flow with duplicate-title validation.
- Decide whether cookbook delete/archive belongs in this unit.
- Ensure recipe membership actions remain authorized and idempotent.
- Tests cover owner/non-owner, duplicate title, empty title, and detail page refresh behavior.

Completion notes:

- Revalidated that owner-only title editing, duplicate-title validation, delete confirmation, and owner/non-owner UI coverage already exist on `cookbooks/:id`.
- Made duplicate `addRecipe` submissions return success without creating a duplicate row.
- Scoped `removeRecipe` to both `recipeInCookbookId` and the current cookbook id, preventing wrong-cookbook relation deletion.
- Made repeated `removeRecipe` submissions idempotent through `deleteMany`.
- Added route regression tests for duplicate add success, repeated remove, cross-owner relation isolation, and same-owner different-cookbook isolation.

### SJ-018 - Recipe Validation Parity Across Bulk And Per-Step Paths

Priority: `P1`
Lane: `recipes`, `validation`, `data-integrity`
Status: `superseded`

Problem: Shared validators exist and per-step routes use them, but bulk recipe creation currently validates only metadata/image fields before creating step rows. Validation should be consistent whether a user creates steps inline during recipe creation or later through per-step routes.

Evidence:

- `app/lib/validation.ts` contains title, description, step title, step description, servings, quantity, unit, ingredient, image URL, and step reference validators.
- `app/routes/recipes.$id.steps.new.tsx` and step edit routes use step/ingredient validators.
- `app/routes/recipes.new.tsx` validates metadata and image only.

Acceptance criteria:

- Bulk create uses the same validation rules as per-step add/edit.
- Error shape supports field-specific display in RecipeBuilder.
- Client max/min attributes match server rules where applicable.
- Tests prove parity between create-time and later step-edit validation.

Superseded by: `SJ-003`

Notes:

- `SJ-003` added `app/lib/recipe-create.server.ts`, which parses create-time `stepsJson` through shared step title, step description, quantity, unit, and ingredient-name validators.
- `app/routes/recipes.new.tsx` now rejects invalid create-time step/ingredient payloads before recipe creation and returns `errors.steps` to `RecipeBuilder`.
- `test/lib/recipe-create.server.test.ts` covers invalid payload containers, invalid step titles/descriptions/durations, invalid ingredient containers, quantities, units, and names.
- `test/routes/recipes-new.test.tsx` covers invalid create-time steps JSON, invalid submitted step fields, and invalid submitted ingredient fields.

### SJ-019 - Generated Artifact And Local State Hygiene

Priority: `P3`
Lane: `repo-hygiene`, `agent-trust`
Status: `done`

Problem: Local generated directories exist after builds/tests, and the ignore file covers them. This is not currently a tracked-artifact problem, but agents should know these directories are expected local noise and should not stage them.

Evidence:

- Local `coverage/`, `build/`, `playwright-report/`, `test-results/`, `storybook-static/`, and `.react-router/` directories exist.
- `git ls-files` did not report tracked generated artifacts for those paths.
- `.gitignore` covers these directories.

Acceptance criteria:

- Add a short contributor/agent note about ignored generated artifacts if docs are refreshed.
- Do not stage generated local artifacts in future PRs.
- Optionally add a lightweight cleanliness check that fails if known generated paths become tracked.

Completion notes:

- Added README and GUIDE notes naming local-only generated artifact paths that agents should not stage.
- Added a repo-hygiene Vitest guard that fails if known generated artifact directories become tracked or stop being ignored.

### SJ-020 - Observability, Privacy, And Analytics Review

Priority: `P3`
Lane: `analytics`, `privacy`, `ops`
Status: `done`

Problem: PostHog instrumentation exists for page views and recipe interactions, but there is no documented analytics/privacy posture yet. This should be reviewed before broader user testing.

Evidence:

- `app/root.tsx` captures page views and identifies logged-in users.
- `app/routes/recipes.$id.tsx` captures recipe view, scale, ingredient toggle, share, cookbook, and shopping-list events.
- README/GUIDE do not document analytics configuration or privacy expectations.

Acceptance criteria:

- Document analytics env vars and disabled/local behavior.
- Review event payloads for personally identifiable information.
- Add opt-out or environment-based disabling if desired.
- Tests cover safe behavior when PostHog env vars are missing.

Completion notes:

- Added a testable analytics config module for optional PostHog initialization.
- Added `VITE_POSTHOG_DISABLED` as an explicit true-ish hard-disable switch.
- Sanitized pageview URLs to origin + pathname so query strings and hashes are not sent.
- Removed user-entered recipe/cookbook titles from analytics event payloads.
- Documented analytics environment variables, local disabled behavior, session-recording masking, and the current payload privacy posture.

### SJ-021 - Accessibility Pass For Dialogs, Dock, And Recipe Forms

Priority: `P2`
Lane: `accessibility`, `ux`, `quality`
Status: `done`

Problem: The codebase has a solid accessibility testing baseline, but several high-interaction surfaces should get an integrated pass: confirmation dialogs, bottom-sheet save modal, mobile dock actions, RecipeBuilder, and shopping-list swipe actions.

Evidence:

- `SJ-006` and `SJ-008` added touch-target, dialog-error, and mobile dock coverage, but broader integrated keyboard/screen-reader review remains valuable.
- Recipe detail uses bottom-sheet-style `Dialog` for cookbook saving.
- Shopping list uses swipe affordances and optimistic state.
- SpoonDock changes navigation behavior on mobile.

Acceptance criteria:

- Keyboard and screen-reader behavior is verified for dialogs and dock actions.
- Swipe actions have non-gesture alternatives.
- Validation errors are announced and linked to controls.
- Mobile touch targets meet the chosen accessibility threshold.
- Add Storybook/a11y or Playwright assertions where component tests cannot observe layout.

Completion notes:

- Converted shopping-list item toggles to checkbox semantics with item-specific accessible names and checked state.
- Added an always keyboard-reachable row remove action while preserving the swipe-to-delete reveal path.
- Added `aria-current` for active mobile dock links and accessible intent labels for recipe-detail shopping-list dock actions.
- Switched destructive confirmation dialogs to `alertdialog`.
- Added `aria-pressed` for save-to-cookbook modal rows.
- Linked recipe/step form validation errors with `aria-invalid` and accessible descriptions through Headless UI controls.
- Added focused component/route coverage for the updated accessibility semantics while preserving the mobile Playwright audit.


### SJ-022 - Make Spoonjoy The Ouroboros Recipe MCP App

Priority: `P0`
Lane: `mcp`, `ouroboros`, `agent-trust`, `recipes`
Status: `done`

Problem: Ouroboros agents need a first-class recipe substrate rather than browser/shell indirection for recipe memory and shopping-list operations. Spoonjoy should be the official recipe app for the harness through a stdio MCP server that can be registered in `agent.json.mcpServers`.

Acceptance criteria:

- Provide a stdio JSON-RPC MCP server compatible with the Ouroboros harness MCP client.
- Expose health, recipe search, recipe fetch, recipe creation, shopping-list add, and shopping-list fetch tools.
- Support owner scoping through `SPOONJOY_MCP_USER_EMAIL` while allowing explicit `ownerEmail` overrides.
- Document the exact `mcpServers.spoonjoy` bundle config and vault env pattern.
- Cover MCP protocol handling and tool behavior with tests while preserving 100% coverage.

### SJ-023 - Remove Production Build Sourcemap Warnings

Priority: `P0`
Lane: `agent-trust`, `build`, `quality`
Status: `done`

Problem: `pnpm build` exits successfully, but Vite/Rollup emits repeated sourcemap-location diagnostics for several local UI/navigation modules. The repo contract treats warnings as failures, so production build output needs to be quiet before deployment checks can be treated as fully warning-clean.

Evidence:

- `pnpm build` emitted `Error when using sourcemap for reporting an error: Can't resolve original location of error.`
- The messages referenced local modules such as `app/components/ui/navbar.tsx`, `app/components/ui/listbox.tsx`, `app/components/ui/theme-provider.tsx`, `app/components/navigation/dock-context.tsx`, and `app/components/navigation/mobile-nav.tsx`.
- The referenced files begin with module-level `'use client'` directives, which React Router does not require and Rollup commonly reports as ignored directives during bundling.

Acceptance criteria:

- Production build output no longer includes sourcemap-location diagnostics for local app modules.
- Any stale module-level directives are removed or otherwise handled without changing runtime behavior.
- Add coverage or a documented verification command sufficient to keep the warning from regressing.
- Preserve existing typecheck, full coverage, build, and e2e checks.

Completion notes:

- Removed stale module-level `'use client'` directives from local React Router component files.
- Added `test/build-output-hygiene.test.ts` so top-level client directives cannot return unnoticed.
- Verified `pnpm build` output no longer contains sourcemap/directive diagnostics.
- Verified focused build-hygiene test, `pnpm typecheck`, full `pnpm test:coverage`, and `pnpm test:e2e`.

### SJ-024 - Add Direct MCP Shopping-List Item Controls

Priority: `P1`
Lane: `mcp`, `ouroboros`, `shopping-list`, `agent-trust`
Status: `done`

Problem: `SJ-022` made Spoonjoy available to the Ouroboros harness, but the MCP tool surface can only add a whole recipe to a shopping list and fetch the list. For Spoonjoy to act as the official agent recipe/shopping substrate, agents need direct manual item lifecycle tools.

Evidence:

- `app/lib/mcp/spoonjoy-tools.server.ts` exposes `add_recipe_to_shopping_list` and `get_shopping_list`, but no direct add/check/remove item operations.
- The app route already supports manual shopping-list add/toggle/remove, so the missing MCP surface is a harness integration gap rather than a new product concept.

Acceptance criteria:

- Add MCP tools for direct manual shopping-list item add, checked-state update, and soft remove.
- Reuse owner scoping through `SPOONJOY_MCP_USER_EMAIL` / `ownerEmail`.
- Manual item adds are idempotent for matching owner, ingredient, and unit, including checked/deleted row restoration.
- Checked/remove operations cannot mutate another owner's items.
- Tests cover tool metadata, add, merge/restore, check/uncheck, remove, missing owner, invalid quantities, and cross-owner isolation.

Completion notes:

- Added `add_shopping_list_item`, `set_shopping_list_item_checked`, and `remove_shopping_list_item` MCP tools.
- Direct item adds now merge matching owner/unit/ingredient rows, preserve metadata when omitted, restore checked/deleted rows, and handle unitless items.
- Checked/remove operations are scoped to the configured owner and reject cross-owner item ids.
- Updated Ouroboros MCP docs and added tool coverage for metadata, direct add/merge/restore, check/uncheck, remove/idempotent remove, unitless quantity merges, invalid inputs, missing owner config, and cross-owner isolation.

### SJ-025 - Add MCP Cookbook Organization Tools

Priority: `P0`
Lane: `mcp`, `ouroboros`, `cookbooks`, `agent-trust`
Status: `done`

Problem: Spoonjoy is becoming the official recipe app for the Ouroboros harness, but agents could only create/search/fetch recipes and manage shopping lists. They could not organize recipe memory into cookbooks, even though cookbooks are a core Spoonjoy concept.

Evidence:

- `app/lib/mcp/spoonjoy-tools.server.ts` exposed no cookbook tools.
- `docs/ouroboros-mcp.md` documented recipe and shopping-list tools only.
- The app already supports cookbook creation and recipe membership through routes and schema.

Acceptance criteria:

- Add owner-scoped MCP tools for cookbook list, fetch, create, add recipe, and remove recipe.
- Cookbook creation and recipe membership mutations are idempotent for agent retry safety.
- Cookbook payloads exclude deleted recipes and reject newly adding deleted/missing recipes.
- Cross-owner cookbook reads and mutations cannot leak or alter another owner's cookbooks.
- Tests cover tool metadata, create/list/get, duplicate create, add/remove/idempotency, deleted recipe filtering, validation, and cross-owner isolation.

Completion notes:

- Added `list_cookbooks`, `get_cookbook`, `create_cookbook`, `add_recipe_to_cookbook`, and `remove_recipe_from_cookbook` MCP tools.
- Tools reuse `SPOONJOY_MCP_USER_EMAIL` / `ownerEmail` owner scoping and return active recipe summaries suitable for agent memory organization.
- Cookbook create/add/remove are idempotent so agents can retry safely.
- Updated Ouroboros MCP docs and expanded MCP tests for metadata, owner scoping, active recipe filtering, duplicate handling, idempotent mutations, and validation errors.

### SJ-026 - Add Shared REST/MCP API Auth

Priority: `P0`
Lane: `api`, `mcp`, `auth`, `ouroboros`, `agent-trust`
Status: `done`

Problem: Spoonjoy is becoming both a human recipe app and an agent substrate. MCP clients need portable auth, Ouro needs first-class vault-friendly config, and non-agent clients need a normal HTTP API without duplicating MCP business logic.

Evidence:

- MCP owner identity previously depended on `SPOONJOY_MCP_USER_EMAIL` or per-call `ownerEmail`, which is useful locally but not a portable auth boundary.
- No REST API existed for external non-agent clients.
- Duplicating API logic between MCP and HTTP would make recipe/search/cookbook/shopping-list behavior drift.

Acceptance criteria:

- Add hashed, owner-scoped API credentials with local Prisma and D1 migrations.
- Support bearer API tokens for REST and MCP clients.
- Preserve trusted `SPOONJOY_MCP_USER_EMAIL` fallback for Ouro/local stdio bootstrapping without requiring Ouro.
- Reject authenticated attempts to act for a different `ownerEmail`.
- Expose REST endpoints for search, recipes, cookbooks, shopping list, and token lifecycle.
- Keep MCP and REST DRY by routing both through the same shared operation layer.
- Preserve 100% coverage and zero-warning test output.

Completion notes:

- Added `ApiCredential` schema/migrations and token helpers that generate `sj_` tokens, store SHA-256 hashes, track prefixes, update last-used timestamps, and support revocation.
- Refactored MCP tools into `app/lib/spoonjoy-api.server.ts`; `app/lib/mcp/spoonjoy-tools.server.ts` is now a JSON-string adapter over the shared operations.
- Added `GET/POST/PATCH/DELETE /api/*` endpoints that authenticate sessions/bearer tokens and dispatch to the same operation handlers.
- Updated the MCP stdio server to accept `SPOONJOY_MCP_API_TOKEN` and continue supporting `SPOONJOY_MCP_USER_EMAIL` for trusted local/Ouro vault config.
- Documented the HTTP API and updated Ouroboros MCP docs with authz/authn guidance.
- Verified targeted REST/MCP/auth tests, `pnpm typecheck`, and full `pnpm run test:coverage`.

### SJ-027 - PWA + Web Push Notifications

Priority: `P1`
Lane: `pwa`, `notifications`, `engagement`
Status: `done`

Problem: Spoonjoy is web-only but users would benefit from installable PWA + push notifications for engagement events (forks, spoons, cookbook adds).

Completion notes:

- PR #45 (`d0977f8`, "feat: D-006 PWA + Web Push notifications (infrastructure + first trigger)") shipped the manifest, service worker, VAPID setup, and `Spoon a recipe` notification trigger.
- PR #46 (`d1dab9e`, "feat: D-006 PWA + Web Push notifications (remaining triggers + preferences UI)") added fork/cookbook triggers and account-settings preferences UI.
- Install-prompt UX polish + offline fallback tracked separately as `SJ-038`.

### SJ-028 - Paged Cook Mode

Priority: `P1`
Lane: `cooking`, `ux`
Status: `done`

Problem: Cook mode rendered all steps inline; reviewers wanted a focused single-step paged surface.

Completion notes:

- PR #75 (`92016ec`, "Add focused cook mode and market list") introduced the first cook mode pass.
- PR #100 (`9f3c230`, "fix: make cook mode a paged cooking surface") completed the paged surface.
- Hash-routed (`#cook`) so cook mode stays a single-page surface with browser-back behavior.

### SJ-029 - Public Sharing + First-Class Agent Auth

Priority: `P0`
Lane: `sharing`, `mcp`, `agent-trust`, `auth`
Status: `done`

Problem: Recipes were intended to be linkable but the sharing surface and agent-auth model were not first-class.

Completion notes:

- Commit `6482980` ("feat: make public sharing and agent auth first-class") shipped chef-link sharing and the agent-auth contract.
- Commit `f8f03b3` ("feat: add delegated agent auth for spoonjoy mcp") added delegated auth for the MCP bridge.
- Follow-up fixes hardened the flow: `a1096bf` (stale-token bootstrap), `f374d9c` (delegated-token MCP status), `ada405f` (UI + MCP readiness gaps), `c9dd9bf` (canonical agent-auth base URL).

### SJ-030 - Search Index Performance Hardening

Priority: `P1`
Lane: `search`, `performance`, `cloudflare`
Status: `done`

Problem: Initial FTS5 index build (SJ-010) had quirks under D1's variable limits and freshness expectations.

Completion notes:

- PR #84 (`91d5895`, "fix: keep search indexing under D1 variable limit").
- PR #85 (`cd357d4`, "fix: rebuild search index with table scans").
- PR #86 (`76d9d38`, "perf: batch search index inserts").
- PR #87 (`3abfcc8`, "perf: reuse fresh search index").
- PR #88 (`f7b8c9d`, "fix: harden search freshness and deploy auto").

### SJ-031 - OAuth Provider Hardening Rounds

Priority: `P0`
Lane: `auth`, `oauth`, `production-readiness`
Status: `done`

Problem: Post-cutover OAuth surfaced edge-case provider behaviors (callback URL canonicalization, Apple form-post quirks, GitHub provider error semantics, intentional Google disablement during cutover).

Completion notes:

- PR #89 (`c4b1fd3`, "Harden OAuth environment validation"), PR #90 (`9814ee1`, "Mark Google OAuth intentionally disabled for cutover"), PR #92 (`12517be`, preserve apple oauth callback state), PR #93 (`0986d5a`, harden session + recipe trust boundaries), PR #94-#96 (`7be2e09`, `480621e`, `0884445`), follow-ups (`3879f4c`, `71d22f8`, `3bd221a`, `7852b54`, `3864b18`, `b11dccd`).

### SJ-032 - v1 → v2 Migration Plumbing

Priority: `P0`
Lane: `migration`, `data`
Status: `done` (scheduled for removal as part of cleanup wave)

Problem: Cutting over from Spoonjoy v1 (Neon Postgres) to v2 (Cloudflare D1) required one-shot data import.

Completion notes:

- PR #83 (`dbb5bce`, "Prepare v1 data migration and OAuth continuity") shipped `scripts/migrate-v1-neon-to-d1.ts`, `scripts/lib/v1-neon-to-d1.ts`, and a test suite.
- Cutover is complete. The scripts are scheduled for removal in cleanup PR-D (tracked under `SJ-034`) with a `pre-v1-migration-removal` git tag for reversibility.

### SJ-033 - Cookbook Experience Redesign

Priority: `P1`
Lane: `cookbooks`, `ux`, `design`
Status: `done`

Problem: Cookbooks needed an editorial cover surface beyond simple list rendering.

Completion notes:

- Commit `6f3cc2c` ("feat: redesign spoonjoy cookbook experience") shipped the editorial cover treatment.
- Component covered by `app/components/cookbook/CookbookCoverArt.tsx` and Storybook stories.

### SJ-034 - Backlog Refresh + Stale Doc Pruning

Priority: `P2`
Lane: `repo-hygiene`, `docs`, `agent-trust`
Status: `in-progress`

Problem: BACKLOG.md drifted from reality after the foundational wave (4 items marked `proposed` had actually shipped). Repo root accumulated ~6,000 lines of stale Jan/Feb 2026 working-notes and post-cutover artifacts.

Acceptance criteria:

- BACKLOG.md status reflects actual ship state for every `SJ-*` item.
- Untracked-at-ship features get retroactive entries so future audits don't drift again.
- Stale Jan/Feb 2026 notes hard-deleted via `git rm` (reachable through git history if ever needed).
- Post-cutover artifacts removed from `docs/`.
- Planning doc preserved under `.tasks/`.

Progress notes:

- PR-A (this PR) refreshes BACKLOG.md, marks SJ-010/011/012 done, updates SJ-016 to in-progress, adds SJ-027 through SJ-038, and preserves the planning doc.
- PR-B will hard-delete stale docs.

### SJ-035 - Resolve `fellow-chefs.server.ts:26` Performance TODO

Priority: `P3`
Lane: `performance`, `cleanup`
Status: `proposed`

Problem: A single `TODO(perf): materialize if hot — see inch-worm backlog.` remains in `app/lib/fellow-chefs.server.ts:26`. It's the only TODO in ~32k LOC of app code.

Acceptance criteria:

- Measure current p50/p95 of the fellow-chefs query path in production-shaped data.
- If hot (p95 > 50ms): add a small in-memory or D1-side materialized cache.
- If not hot: delete the TODO comment.
- Either outcome lands in a tiny PR with the measurement as justification.

### SJ-036 - PostHog Setup Completion + Free-Tier Error Tracking

Priority: `P1`
Lane: `observability`, `production-readiness`
Status: `proposed`

Problem: PostHog client-side analytics is instrumented but setup was never finished. There is no production server-side error capture. Optimize for free — use PostHog's free Error Tracking feature, not Sentry.

Acceptance criteria:

- Finish PostHog wiring: confirm `VITE_POSTHOG_KEY` resolves in production, sanity-check the project ID, document the dashboard URL in `docs/analytics-privacy.md`.
- Add `posthog-node` for Workers-side server error capture in `workers/app.ts` and `entry.server.tsx`.
- Capture: unhandled exceptions, error responses (5xx), promise rejections. Redact PII (email, session cookies) from payloads.
- Tests cover safe behavior when PostHog env vars missing.
- Deploy + smoke + intentionally trigger one error to confirm capture.

### SJ-037 - API/MCP Rate Limiting

Priority: `P0`
Lane: `security`, `production-readiness`, `api`
Status: `proposed`

Problem: `/api/*` REST endpoints and the MCP bearer surface (from `SJ-026`) accept tokens with no rate limit. A leaked token or abusive script could hammer D1 reads/writes and burn through OpenAI quota via the import path.

Acceptance criteria:

- Per-token + per-IP throttling using Cloudflare Durable Objects (preferred — per-token state isolation) or D1-backed counter (fallback if DOs budget is a concern).
- Return HTTP 429 with `Retry-After` header.
- Log/instrument rate-limit hits via SJ-036 telemetry.
- Tests cover token throttle, IP throttle, reset behavior, `Retry-After` header.
- Documented in `docs/api.md`.
- Unblocks `SJ-016` password reset (which needs strict request throttling).

### SJ-038 - PWA Install UX + Offline Fallback

Priority: `P2`
Lane: `pwa`, `ux`, `engagement`
Status: `proposed`

Problem: D-006 (`SJ-027`) shipped manifest + service worker. The install prompt UX, dismissal persistence, and offline fallback page are not yet polished.

Acceptance criteria:

- Contextual install hint surface — non-pushy, dismissible, respects `beforeinstallprompt` event timing.
- Persist dismissal so the prompt doesn't re-nag the same user across sessions.
- Offline fallback page rendered by the service worker for navigation failures.
- Tighten manifest icons (recheck 192/512), shortcuts, and theme color.
- Tests cover install gating, dismissal persistence, offline page rendering.

### SJ-039 - Claude Connector (remote MCP over Streamable HTTP)

Priority: `P1`
Lane: `mcp`, `connector`, `agent-trust`
Status: `done`

Problem: Spoonjoy had a stdio MCP server (Ouro) and a REST API, but no way for Claude (Claude Code / claude.ai) to use Spoonjoy as a first-class connector. A Claude connector is a remote MCP server; it must share the existing operation layer and use delegated auth.

Acceptance criteria:

- Stateless remote Streamable-HTTP MCP endpoint at `/mcp` returning `application/json`.
- Shares the operation layer, tool adapter, auth, and rate limiter with the REST/stdio surfaces.
- `initialize`/`tools/list` open for discovery; `tools/call` bearer-authenticated with the same bootstrap-tool allowance + cross-owner guard as REST.
- Delegated auth via the existing device-code flow; no raw credentials in Claude.
- 100% coverage; installed + confirmed in Claude Code.

Completion notes:

- Extracted transport-agnostic `handleJsonRpcMessage` from `app/lib/mcp/json-rpc.server.ts` (shared by stdio + HTTP) and added protocol-version negotiation.
- Added shared `app/lib/spoonjoy-api-request.server.ts` (`PUBLIC_BOOTSTRAP_OPERATIONS`, `resolveApiPrincipal`, `buildSpoonjoyApiContext`); refactored `app/routes/api.$.ts` to use it so REST and MCP share one auth+context path.
- Added `app/lib/mcp/http-mcp.server.ts` + `app/routes/mcp.ts` registered at `/mcp`; rate-limited per token + IP.
- Documented in `docs/claude-connector.md`; cross-linked from `docs/ouroboros-mcp.md` + README.

### SJ-040 - OAuth 2.1 for claude.ai One-Click Connector

Priority: `P2`
Lane: `mcp`, `connector`, `auth`
Status: `proposed`

Problem: The `/mcp` connector (`SJ-039`) authenticates with a bearer token, which Claude Code supports via `--header`. claude.ai / Claude Desktop connectors expect OAuth 2.1 (protected-resource + authorization-server metadata, dynamic client registration, PKCE auth-code flow, consent). Implementing it would make Spoonjoy a one-click connector on claude.ai.

Acceptance criteria:

- `/.well-known/oauth-protected-resource` + `/.well-known/oauth-authorization-server` metadata.
- `/authorize` (reusing Spoonjoy login + a consent step), `/token`, and dynamic client registration.
- Access tokens issued as owner-scoped `ApiCredential`s; refresh-token handling.
- Reuse the existing device-code/agent-connection consent backend where possible.
- 100% coverage; verified against Claude's connector OAuth flow.

### SJ-041 - SpoonDock Responsive Audit (down to iPhone 5 / 320px)

Priority: `P1`
Lane: `mobile`, `ux`, `navigation`
Status: `done`

Problem: The mobile SpoonDock broke on narrow phones — even the iPhone 13 mini (375px). With five competing elements (recipe detail: back-place + Cook primary + 3 tools), the grid's left "place" column (`minmax(0,0.9fr)`) collapsed below a usable touch target (measured 24px at 320px) and the `whitespace-nowrap` place label clipped/spilled.

Acceptance criteria:

- Every dock variant fits — no horizontal overflow, in-viewport, >=44px touch targets — at 320px (iPhone 5/SE), 375px (13 mini), and 390px.
- An automated regression guard covers every variant at those widths.
- Storybook surfaces the worst-case configs at narrow widths for visual audit.

Completion notes:

- Place item collapses to a centered icon (min 48px) at <=389px (label becomes `sr-only`, preserving the accessible name); labels return at 390px+. Grid left column floored at `minmax(3rem,...)`; primary/tools/gaps/padding tighten at <=389px; side margins reduced to 0.75rem. Place labels `truncate` + `overflow-hidden` as a universal anti-spill net.
- Added `e2e/flows/spoondock-responsive.spec.ts` auditing all variants (kitchen, search, shopping, account, cookbooks, users, recipe-detail worst case) at 320/375/390px.
- Added narrow-viewport stories to `stories/MobileNav.stories.tsx`.
- Also gitignored `.claude/` and untracked a stray `scheduled_tasks.lock` that had been committed.

## Parking Lot

These are intentionally lower-certainty until product direction is clarified:

- **Native mobile app packaging.** Deferred 2026-05-27 per Ari: "let things stabilize before native mobile."
- **Public/private recipe visibility model beyond basic profile/kitchen routes.** Skipped 2026-05-27 per Ari: "all recipes are currently public — we're good." Revisit if granular sharing rules become desired.
- **Dedicated admin/moderation tools.** No signal needed yet.
