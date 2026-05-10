# Spoonjoy v2 UI Systems Audit

Date: 2026-05-10
Focus: world-class UI redesign pass for the React Router v7 Spoonjoy app.

## Executive Summary

Spoonjoy v2 already had a strong product direction: warm recipe-book language, kitchen memory, mobile dock usage, practical flows for recipes, cookbooks, shopping lists, search, account settings, REST, and MCP support. The UI system was still split between two modes:

- Warm, intentional route-level moments on the home and search pages.
- Generic Catalyst/zinc scaffolding across shared primitives, creation flows, account settings, shopping list, and several nested recipe screens.

This audit moved Spoonjoy toward a cohesive product identity: an editorial family-kitchen platform with tactile paper, brass, tomato, herb, expressive typography, rounded recipe-card surfaces, and calmer forms that preserve the existing functional contracts.

## Design Direction

The new direction is "warm editorial kitchen OS":

- Display typography: Fraunces for recipe-book character and memorable headings.
- Body typography: Source Serif 4 for warm, readable recipe content.
- UI typography: IBM Plex Sans Condensed for compact, confident controls and labels.
- Palette: paper, ink, brass, tomato, herb, mint, flour, and rose instead of generic zinc/blue.
- Surface language: recipe cards, receipt-like shopping list panels, blurred paper panels, editorial hero crops.
- Motion: subtle lift and state transitions, with reduced-motion support.
- Accessibility: touch targets preserved, contrast-oriented variables, semantic structure retained.

## Audit Findings

### 1. Shared Primitives Were Too Generic

Buttons, fields, headings, text, dialogs, dropdowns, listboxes, toasts, nav items, and the app shell all inherited neutral Tailwind/Catalyst defaults. Because these primitives are used everywhere, the whole app felt less designed than the best route-level pages.

Status: Fixed.

Primary changes:

- Added Spoonjoy design tokens and reusable classes in `app/styles/tailwind.css`.
- Loaded production fonts in `root.links()` and Storybook preview head.
- Reworked `Button`, `Input`, `Textarea`, `Select`, `Listbox`, `Heading`, `Text`, `Fieldset`, `Dialog`, `Dropdown`, `Toast`, `ThemeToggle`, `Navbar`, `Sidebar`, `StackedLayout`, and `AuthLayout`.

### 2. Recipe Viewing Needed a Flagship Editorial Treatment

The recipe detail page was functionally rich but visually understated: full-width image, plain content section, neutral steps, and generic modal styles.

Status: Fixed.

Primary changes:

- Rebuilt `RecipeHeader` as a rounded editorial hero with overlapping recipe-card content.
- Restyled scale controls, chef identity, description, and empty image placeholder.
- Restyled recipe steps as a cook-mode panel with tactile sectioning.
- Restyled save-to-cookbook and delete dialog surfaces.

### 3. Recipe Creation and Step Editing Still Looked Like Internal Tools

New/edit recipe and nested step screens used `font-sans`, blue links, zinc panels, and plain form scaffolding.

Status: Fixed.

Primary changes:

- Reworked `recipes.new`, `recipes.$id.edit`, `recipes.$id.steps.new`, and `recipes.$id.steps.$stepId.edit`.
- Reworked `RecipeBuilder`, `RecipeImageUpload`, `StepCard`, `IngredientList`, ingredient parser, parsed ingredient rows, step dependency selector, and step output callouts.
- Preserved existing form submission architecture, hidden form handoff, refs, and test-visible labels.

### 4. Shopping List Needed a Daily-Use Identity

Shopping list is a primary loop, but it read as a neutral CRUD page. The swipe/delete/toggle behavior was strong and worth preserving.

Status: Fixed.

Primary changes:

- Reframed the page as a "Market run" with a receipt-like add panel.
- Preserved `min-h-11` touch targets, swipe reveal behavior, category grouping, optimistic removal/checking, and existing test selectors.
- Reworked item rows, category headers, parsed-review state, add-from-recipe panel, empty state, and destructive actions.

### 5. Account Settings Needed to Feel First-Class

Account settings had the right functionality but looked administrative rather than trusted.

Status: Fixed.

Primary changes:

- Reframed settings as "Kitchen identity".
- Built carded user info, profile photo, connected accounts, and password sections.
- Preserved OAuth, password, file upload, and tests via existing labels/data-testid attributes.

### 6. Kitchens, Profiles, Pantry, and Cookbooks Needed One Visual Language

Kitchen/profile/cookbook/pantry surfaces mixed old rounded-sm zinc cards with warmer route copy.

Status: Fixed.

Primary changes:

- Reworked authenticated kitchen cards, tabs, empty states, recipe cards, cookbook cards, profile page, pantry components, cookbook detail, and cookbook creation.
- Reworked public landing hero to use the same tokenized design system.

### 7. Storybook Needed to Match Current App Reality

Storybook had been curated, but its remaining stories still showed old neutral cards and did not load the new fonts.

Status: Fixed.

Primary changes:

- Updated App Foundation, Confirmation Dialog, Recipe Builder, and Recipe View stories.
- Added Storybook font preloads via `.storybook/preview-head.html`.
- Updated Storybook manager brand URL to `https://spoonjoy.app`.

### 8. Search Indexing Had a D1 Runtime Failure

Local browser QA found `/search` could 500 under D1 because full rebuild indexed all recipes with nested includes in one Prisma call, producing too many SQL variables.

Status: Fixed.

Primary changes:

- Paged `recipeDocuments()` in `app/lib/search.server.ts` with cursor pagination and a small D1-safe page size.
- Added a regression test covering more than one page of recipe documents.
- Rebuilt the local search route successfully after the fix.

### 9. Cloudflare Deploy Was Blocked by a Wrangler Dependency Override

Preview deploy initially failed during asset hashing with `Make sure to await blake3.load() before trying to use any functions`. The repo forced `blake3-wasm@3.0.0`, while Wrangler 4.90.0 declares `blake3-wasm@2.1.5` and calls its hash API synchronously.

Status: Fixed.

Primary changes:

- Removed the transitive `pnpm.overrides` for `blake3-wasm` and `@c4312/blake3-internal`.
- Regenerated `pnpm-lock.yaml` so Wrangler resolves its supported `blake3-wasm@2.1.5`.
- Kept the local-only `getPlatformProxy()` import out of the production Worker bundle with a Vite-ignored dynamic import.
- Verified `wrangler deploy --dry-run` now completes through asset hashing and binding validation.

## Risk Review

- Functional behavior was intentionally left unchanged except for the D1-safe search indexing fix and Wrangler dependency-resolution fix.
- The app now depends on Google Fonts for the intended typography. Fallbacks remain defined, and the app still renders if fonts fail.
- CSS uses modern `color-mix()` and variable-based Tailwind arbitrary values. Build and browser QA verify generation/rendering locally.
- Local D1 proxy support still uses Wrangler in development/scripts, but the production Worker build no longer bundles Wrangler CLI internals.
- Cloudflare preview deploy is blocked only by R2 account activation requiring payment details and explicit billing authorization. I did not remove the `PHOTOS` binding because recipes need images and the user explicitly asked to keep/setup photo storage.

## Verification

Completed:

- `npm run typecheck`
- `npm run deploy:preflight`
- `npm run test:coverage` - 146 files, 3559 tests, 100% statements/branches/functions/lines
- `npm run build`
- `npm run build-storybook`
- Local browser QA with desktop and mobile coverage for `/`, `/login`, `/signup`, `/search`, `/search?q=tomato&scope=all`, `/recipes/new`, and `/shopping-list`
- `npx wrangler deploy --config build/server/wrangler.json --name spoonjoy-v2-ui-world-class-redesign --keep-vars --message "Preview UI world-class redesign" --dry-run`

Cloudflare status:

- Wrangler OAuth login is working for Mendelow Studio.
- Static asset upload succeeded during the real deploy attempt.
- Worker publication is blocked by Cloudflare R2 activation. The dashboard requires card/payment details and authorization for over-free-tier usage before the `spoonjoy-photos` bucket can be created or bound.
