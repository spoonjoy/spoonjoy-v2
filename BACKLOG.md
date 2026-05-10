# Spoonjoy v2 Backlog

Status: proposed canonical backlog
Audit date: 2026-05-10
Baseline: `main` at `3533955` (`Upgrade GitHub Actions to Node 24 runtime (#3)`)
Verification anchor: `pnpm test:coverage` passed with 137 test files, 3493 tests, 0 skipped tests, and 100% statements/branches/functions/lines.

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

1. `SJ-001`: Establish backlog/docs source of truth.
2. `SJ-002`: Finish OAuth route endpoints so visible auth buttons stop posting to missing routes.
3. `SJ-003`: Fix recipe creation data loss by persisting RecipeBuilder steps and ingredients.
4. `SJ-004`: Finish recipe image upload/storage on Cloudflare R2.
5. `SJ-005`: Fix active recipe title uniqueness and unskip the integrity test.
6. `SJ-006`: Remove or replace skipped tests so 100% coverage also means no hidden skipped assertions.
7. `SJ-008`: Run the mobile RecipeBuilder/SpoonDock UX pass once core create/edit data paths are trustworthy.

Completed in sequence: `SJ-001`, `SJ-002`, `SJ-003`, `SJ-004`, `SJ-005`, `SJ-006`.

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
Status: `proposed`

Problem: Several route modules mix loader/action logic, domain operations, helper functions, and large UI components. The tests are also large, making future changes expensive under the 100% coverage rule.

Evidence:

- `app/routes/account.settings.tsx` is about 981 lines.
- `app/routes/shopping-list.tsx` is about 930 lines.
- `app/routes/recipes.$id.tsx` is about 762 lines.
- Matching test files exceed thousands of lines, with `test/routes/account-settings.test.tsx` at 4257 lines.

Acceptance criteria:

- Extract account settings photo/auth/password actions into server-side modules with route-level orchestration.
- Extract shopping-list parsing, persistence, ordering, and action handlers into domain modules.
- Extract recipe detail cookbook/shopping-list helpers from the UI route.
- Keep route modules thin without changing behavior.
- Preserve or improve coverage while reducing route test fixture duplication.

### SJ-008 - Mobile RecipeBuilder And SpoonDock UX Audit

Priority: `P1`
Lane: `mobile`, `ux`, `accessibility`
Status: `proposed`

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

### SJ-009 - Add Canonical User Profile Routes And Fix Chef Links

Priority: `P1`
Lane: `profiles`, `navigation`, `product-parity`
Status: `proposed`

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

### SJ-010 - Search, Discovery, And Fellow Chefs

Priority: `P2`
Lane: `discovery`, `product-parity`, `social`
Status: `proposed`

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

### SJ-011 - Recipe Import Flow

Priority: `P2`
Lane: `recipes`, `import`, `v1-parity`
Status: `proposed`

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

### SJ-012 - Recipe Forking/Spooning Flow

Priority: `P2`
Lane: `sharing`, `recipes`, `social`
Status: `proposed`

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

### SJ-013 - Shopping List Conflict And Idempotency Hardening

Priority: `P1`
Lane: `shopping-list`, `sync`, `data-integrity`
Status: `proposed`

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

### SJ-014 - Ingredient Parsing Provider Refresh And Runtime Controls

Priority: `P2`
Lane: `ai`, `ingredients`, `cloudflare`
Status: `proposed`

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

### SJ-015 - Cloudflare Deployment And Environment Hardening

Priority: `P1`
Lane: `cloudflare`, `ops`, `docs`
Status: `proposed`

Problem: Runtime code expects Cloudflare bindings/secrets that are incompletely reflected in Wrangler config and docs. This is especially important before image uploads, OAuth routes, and AI parsing become expected production features.

Evidence:

- `wrangler.json` configures D1 but no `PHOTOS` R2 binding.
- `app/cloudflare-env.d.ts` includes `PHOTOS`, `OPENAI_API_KEY`, Google OAuth, and Apple OAuth variables.
- README/GUIDE document Google callback config that is not represented in `app/lib/env.server.ts`, and omit several required Apple/OpenAI/R2 pieces.

Acceptance criteria:

- Add documented R2 binding configuration for recipe/profile photos.
- Document all required and optional secrets for local preview and production.
- Align env helper types with actual route needs.
- Add a deployment preflight or doc checklist for D1 migrations, seed behavior, R2, OAuth, and OpenAI.
- CI/deploy docs match current workflow commands.

### SJ-016 - Password Reset And WebAuthn Parity Decision

Priority: `P2`
Lane: `auth`, `v1-parity`, `security`
Status: `proposed`

Problem: v2 schema still has reset-token and WebAuthn credential fields, and v1 included forgot/reset password and WebAuthn client plumbing. v2 has no routes or product decision for these capabilities.

Evidence:

- `prisma/schema.prisma` has `resetToken`, `resetTokenExpiresAt`, `webAuthnChallenge`, and `UserCredential`.
- v1 routes included `/forgot-password` and `/reset-password`.
- v1 auth code included WebAuthn client setup.

Acceptance criteria:

- Decide whether password reset and WebAuthn are in v2 scope before public launch.
- If in scope, implement flows with security review, rate limits, and email/provider strategy.
- If out of scope, remove dead schema fields or document them as intentionally deferred.
- Tests cover token lifecycle, expired/used token handling, and account recovery edge cases if implemented.

### SJ-017 - Cookbook Management Completion

Priority: `P2`
Lane: `cookbooks`, `product`
Status: `proposed`

Problem: Cookbook creation/detail exist, and recipes can be saved/removed from cookbooks, but deferred tasks still mention editing cookbook titles. Full cookbook lifecycle is not complete.

Evidence:

- `.tasks/ACTIVE.md` deferred backlog lists edit cookbook title.
- `app/routes.ts` registers `cookbooks/new` and `cookbooks/:id`, but no edit route.

Acceptance criteria:

- Add edit cookbook title flow with duplicate-title validation.
- Decide whether cookbook delete/archive belongs in this unit.
- Ensure recipe membership actions remain authorized and idempotent.
- Tests cover owner/non-owner, duplicate title, empty title, and detail page refresh behavior.

### SJ-018 - Recipe Validation Parity Across Bulk And Per-Step Paths

Priority: `P1`
Lane: `recipes`, `validation`, `data-integrity`
Status: `proposed`

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

### SJ-019 - Generated Artifact And Local State Hygiene

Priority: `P3`
Lane: `repo-hygiene`, `agent-trust`
Status: `proposed`

Problem: Local generated directories exist after builds/tests, and the ignore file covers them. This is not currently a tracked-artifact problem, but agents should know these directories are expected local noise and should not stage them.

Evidence:

- Local `coverage/`, `build/`, `playwright-report/`, `test-results/`, `storybook-static/`, and `.react-router/` directories exist.
- `git ls-files` did not report tracked generated artifacts for those paths.
- `.gitignore` covers these directories.

Acceptance criteria:

- Add a short contributor/agent note about ignored generated artifacts if docs are refreshed.
- Do not stage generated local artifacts in future PRs.
- Optionally add a lightweight cleanliness check that fails if known generated paths become tracked.

### SJ-020 - Observability, Privacy, And Analytics Review

Priority: `P3`
Lane: `analytics`, `privacy`, `ops`
Status: `proposed`

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

### SJ-021 - Accessibility Pass For Dialogs, Dock, And Recipe Forms

Priority: `P2`
Lane: `accessibility`, `ux`, `quality`
Status: `proposed`

Problem: The codebase has a solid accessibility testing baseline, but several high-interaction surfaces should get an integrated pass: confirmation dialogs, bottom-sheet save modal, mobile dock actions, RecipeBuilder, and shopping-list swipe actions.

Evidence:

- Skipped tests mention touch-target and dialog-error coverage.
- Recipe detail uses bottom-sheet-style `Dialog` for cookbook saving.
- Shopping list uses swipe affordances and optimistic state.
- SpoonDock changes navigation behavior on mobile.

Acceptance criteria:

- Keyboard and screen-reader behavior is verified for dialogs and dock actions.
- Swipe actions have non-gesture alternatives.
- Validation errors are announced and linked to controls.
- Mobile touch targets meet the chosen accessibility threshold.
- Add Storybook/a11y or Playwright assertions where component tests cannot observe layout.


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

## Parking Lot

These are intentionally lower-certainty until product direction is clarified:

- Native mobile app packaging.
- Public/private recipe visibility model beyond basic profile/kitchen routes.
- Dedicated admin/moderation tools.
- Data migration from Spoonjoy v1 production into v2.
