# Spoonjoy v2 Audit Report

Audit date: 2026-05-10
Repo: `/Users/arimendelow/Projects/spoonjoy-v2`
Baseline branch/commit: `main` at `3533955`
Output: proposed canonical backlog in `BACKLOG.md`

## Executive Summary

Spoonjoy v2 is in a much stronger engineering state than the stale local backlog suggests. The protected quality gate is green locally: `pnpm test:coverage` passed with 129 test files, 3363 tests, and 100% statements/branches/functions/lines. GitHub Issues returned no open issues through `gh issue list`.

The main risk is not broad code rot. It is trust-surface drift: user-facing UI and docs imply features that are either missing at route seams or only partially wired. The most important examples are OAuth buttons that post to unregistered routes, RecipeBuilder ingredient/image inputs that are not fully persisted on create/edit, and docs/backlog files that point future agents at old or nonexistent task sources.

## What I Checked

- Local backlog/docs: `.tasks/ACTIVE.md`, `.tasks/COMPLETED.md`, `WORKING_NOTES.md`, `REVIEW-PACKET.md`, `feedback/2026-01-29.md`, `notes-*`, README/GUIDE.
- Route map and user-facing seams: `app/routes.ts`, auth routes, recipe routes, account settings, shopping list, photo serving.
- Core schema and migrations: `prisma/schema.prisma`, `migrations/`, Wrangler config.
- Test and CI posture: `pnpm test:coverage`, `.github/workflows/ci.yml`, `.github/workflows/storybook.yml`, skipped-test inventory.
- v1 parity hints from `/Users/arimendelow/Projects/spoonjoy`: routes for profiles, fellow chefs, import/add recipes, forgot/reset password, and WebAuthn/OAuth plumbing.
- GitHub issue backlog: `gh issue list --limit 100` returned `[]`.

## Current Strengths

- 100% coverage is enforced and currently passing locally.
- Test volume is substantial: 3379 total tests with 3363 passing and 16 skipped.
- Core React Router v7 + Cloudflare/D1 stack is in place.
- Route-platform typing and test/build gates were recently hardened.
- OAuth library code is already well-tested, even though route endpoints are missing.
- Shopping list D1-backed persistence is mostly implemented, including checked/deleted/sort metadata.
- Profile photo upload already demonstrates a usable R2 upload/delete pattern.
- Recipe step dependencies and reorder/deletion validations have serious test coverage.

## Primary Risks

### 1. Stale Planning Artifacts

`.tasks/ACTIVE.md` still says OAuth helpers do not exist and presents shopping-list Option 2 as in-progress. The code has moved far beyond that. `feedback/2026-01-29.md` also references a missing `backlog-coding.md`. This creates a real TTFA hazard: a future agent can follow stale instructions and duplicate or undo working systems.

Backlog item: `SJ-001`

### 2. OAuth UI Posts To Missing Routes

`OAuthButtonGroup` renders Google and Apple buttons that submit to `/auth/google` and `/auth/apple`. Account settings redirects to `/auth/{provider}?linking=true`. `app/routes.ts` does not register those routes. Helper modules exist for Apple, Google, and OAuth user creation/linking/unlinking, so this should be a focused route-completion effort.

Backlog item: `SJ-002`

### 3. Recipe Creation Can Drop User Input

`RecipeBuilder` collects steps and ingredients, but `app/routes/recipes.new.tsx` only persists step metadata. It ignores step ingredients and ignores selected recipe image files. For a recipe product, silent loss of newly entered ingredients is a core-flow problem.

Backlog items: `SJ-003`, `SJ-004`, `SJ-018`

### 4. Image Storage Is Half Wired

Profile photos already upload to R2 when `PHOTOS` is available and fall back locally. Recipe image upload validates files but does not store them. Wrangler config does not currently bind `PHOTOS`, even though app types and routes expect it.

Backlog items: `SJ-004`, `SJ-015`

### 5. Data Integrity Has A Known Broken Constraint

The schema intends unique active recipe titles per chef, but nullable `deletedAt` makes the compound unique ineffective in SQLite/D1 for active rows. The corresponding model test is skipped.

Backlog item: `SJ-005`

### 6. Coverage Is Green But Skips Hide Edge Work

The 100% coverage gate is valuable and currently green, but skipped tests cover real behavior: recipe title uniqueness, touch targets, step deletion/reorder UI errors, and dialog behavior. These should be burned down so coverage and confidence line up.

Backlog item: `SJ-006`

### 7. Route Modules Are Getting Heavy

Large route files are workable now but will become friction under strict coverage. `account.settings.tsx`, `shopping-list.tsx`, and `recipes.$id.tsx` should be decomposed after the urgent product seams are fixed.

Backlog item: `SJ-007`

### 8. v1 Parity Is Partial

v1 had profile routes, fellow chefs, recipe import/add flows, forgot/reset password, and WebAuthn/OAuth infrastructure. v2 has some schema support and partial profile/kitchen mechanics, but several routes/features are missing or not yet product-decided.

Backlog items: `SJ-009`, `SJ-010`, `SJ-011`, `SJ-012`, `SJ-016`

## Verification Results

Command run:

```bash
pnpm test:coverage
```

Result summary:

```text
Test Files  129 passed (129)
Tests       3363 passed | 16 skipped (3379)
Coverage    100% statements, 100% branches, 100% functions, 100% lines
```

GitHub issue check:

```text
gh issue list --limit 100 -> []
```

Generated artifact hygiene:

- Local generated directories exist: `coverage/`, `build/`, `playwright-report/`, `test-results/`, `storybook-static/`, `.react-router/`.
- `.gitignore` covers these paths.
- `git ls-files` did not show those generated paths as tracked.

## Recommended Execution Plan

First wave:

1. `SJ-001` - Make `BACKLOG.md` canonical and clean stale docs/tasks.
2. `SJ-002` - Complete OAuth routes.
3. `SJ-003` - Persist recipe create steps/ingredients.
4. `SJ-004` - Finish recipe image upload and R2 binding/docs.
5. `SJ-005` - Fix active recipe title uniqueness.
6. `SJ-006` - Remove skipped tests or replace them with viable coverage.

Second wave:

1. `SJ-018` - Validation parity between bulk create and per-step routes.
2. `SJ-013` - Shopping-list sync/idempotency hardening.
3. `SJ-008` - Mobile RecipeBuilder/SpoonDock pass.
4. `SJ-009` - Canonical profile routes and chef-link repair.
5. `SJ-007` - Route/module decomposition.

Product-expansion wave:

1. `SJ-010` - Search/discovery/fellow chefs.
2. `SJ-011` - Recipe import flow.
3. `SJ-012` - Forking/spooning flow.
4. `SJ-016` - Password reset/WebAuthn decision.
5. `SJ-017` - Cookbook management completion.

## Notes For Future Agents

- Do not use `.tasks/ACTIVE.md` as truth unless it has been explicitly refreshed after this audit.
- Do not stage `.claude/`, local `AGENTS.md`, generated build/test artifacts, or ignored local state unless the user asks.
- Treat `BACKLOG.md` IDs as durable coordination handles.
- For OpenAI model/provider work, re-check official docs before changing model IDs or structured-output API usage; the local research docs are snapshots.
- Preserve the 100% coverage contract even for docs-adjacent code changes that touch executable files.
