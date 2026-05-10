# Spoonjoy v2 UI Audit Backlog

Date: 2026-05-10

This backlog was generated from the UI systems audit and executed in the same work session. Items are intentionally written as product/design outcomes, not just files touched.

## Completed

### UI-001: Establish Spoonjoy Design Tokens

Status: Done

Outcome:

- Added app-wide Spoonjoy tokens for typography, color, shadows, panels, cards, page texture, and reduced motion.
- Added reusable `sj-*` classes for pages, panels, cards, receipt surfaces, hover lift, links, muted text, and form sections.

### UI-002: Load Distinctive Production Fonts

Status: Done

Outcome:

- Loaded Fraunces, Source Serif 4, and IBM Plex Sans Condensed in app root.
- Loaded the same fonts in Storybook preview.

### UI-003: Redesign Shared UI Primitives

Status: Done

Outcome:

- Reworked buttons, inputs, textareas, selects, listboxes, dropdowns, dialogs, alerts, toasts, headings, text, field labels, theme toggle, navbar, sidebar, app shell, and auth layout.

### UI-004: Redesign Public Home and Authenticated Kitchen

Status: Done

Outcome:

- Tokenized public landing hero.
- Reworked authenticated kitchen header, tabs, recipe cards, cookbook cards, and empty states.

### UI-005: Redesign Recipe Detail

Status: Done

Outcome:

- Rebuilt recipe hero/header into an editorial card over a rounded image hero.
- Reworked cook-mode steps, ingredient rows, step output references, and cookbook save affordances.

### UI-006: Redesign Recipe Builder and Photo Upload

Status: Done

Outcome:

- Reworked recipe details form, image upload, error states, step sections, and actions.
- Preserved the existing hidden-form submission architecture.

### UI-007: Redesign Step Add/Edit and Ingredient Tooling

Status: Done

Outcome:

- Reworked new-step and edit-step routes.
- Reworked step editor cards, ingredient parser, parsed ingredient rows, dependency selector, and output-use callouts.

### UI-008: Redesign Shopping List

Status: Done

Outcome:

- Reframed shopping list as a market-run/receipt experience.
- Preserved swipe reveal/delete, optimistic state, category grouping, and touch targets.

### UI-009: Redesign Account Settings

Status: Done

Outcome:

- Reframed settings as kitchen identity.
- Reworked profile photo, user info, OAuth accounts, and password sections.

### UI-010: Redesign Pantry, Profile, and Cookbooks

Status: Done

Outcome:

- Reworked PantryPage, BioCard, RecipeGrid, CookbookCard, user profile, cookbook detail, and new cookbook creation.

### UI-011: Bring Storybook Current

Status: Done

Outcome:

- Updated the current stories that showed old zinc/neutral surfaces.
- Added Storybook font loading.
- Kept stories focused on current app surfaces rather than stale redundant variants.

### UI-012: Harden Search for D1 Runtime Limits

Status: Done

Outcome:

- Fixed `/search` runtime failures caused by overlarge Prisma nested include queries on D1.
- Added regression coverage for paged search indexing.

### UI-013: Fix Wrangler Preview Deploy Hashing

Status: Done

Outcome:

- Removed the repo-level `blake3-wasm@3.0.0` override that broke Wrangler 4.90.0 asset hashing.
- Regenerated the lockfile so Wrangler resolves its supported `blake3-wasm@2.1.5`.
- Kept Wrangler's local `getPlatformProxy()` import out of the production Worker bundle so the build and deploy paths agree.
- Verified Wrangler deploy dry-run reaches successful upload planning and binding validation.

## Verification Backlog

### UI-V001: TypeScript Check

Status: Done

Command:

```bash
npm run typecheck
```

### UI-V002: Deployment Preflight

Status: Done

Command:

```bash
npm run deploy:preflight
```

### UI-V003: Full Coverage

Status: Done

Command:

```bash
npm run test:coverage
```

Result:

- 146 files passed.
- 3559 tests passed.
- 100% statements, branches, functions, and lines.

### UI-V004: Production Build

Status: Done

Command:

```bash
npm run build
```

### UI-V005: Storybook Build

Status: Done

Command:

```bash
npm run build-storybook
```

### UI-V006: Browser QA

Status: Done

Scope:

- Desktop public home.
- Mobile public home.
- Search.
- Auth screens.
- Recipe builder route.
- Shopping list route.

Result:

- No console errors or page errors in local browser QA.
- Auth-gated routes redirected to login as expected.

### UI-V007: Cloudflare Preview QA

Status: Blocked on human billing authorization

Completed:

- Wrangler OAuth login for Mendelow Studio.
- Wrangler deploy dry-run succeeds after the `blake3` resolution fix.
- Real deploy uploads static assets successfully.

Blocked:

- Cloudflare refuses the `PHOTOS` R2 binding until R2 is activated for the account.
- The dashboard requires payment details and explicit authorization for over-free-tier usage before R2 can be activated and the `spoonjoy-photos` bucket can be created.
