# Spoonjoy UI Systems Audit

Date: 2026-05-24

## Audit Harness

This pass created and dogfooded a local Codex skill at:

`/Users/arimendelow/.codex/skills/ui-systems-audit`

The skill follows the full-system-audit shape, but is UI-first: route inventory, design-language checks, rendered screenshot crawl, touch-target checks, clipped-text checks, and finding triage.

Reusable route matrix:

`docs/ui-systems-audit-routes.json`

Latest local screenshot artifact directory:

`/tmp/spoonjoy-ui-crawl-local`

Latest deployed screenshot artifact directory:

`/tmp/spoonjoy-ui-crawl-deployed`

Latest border-rule audit screenshot artifact directory:

`/tmp/spoonjoy-border-crawl`

Latest cookbook-language audit screenshot artifact directory:

`/tmp/spoonjoy-cookbook-language-crawl`

Latest ingredient-width audit screenshot artifact directory:

`/tmp/spoonjoy-ingredient-width-local`

Latest shopping-list/cook-mode focused local artifact directories:

- `/tmp/spoonjoy-cook-shopping-local`
- `/tmp/spoonjoy-cook-mode-local`

Latest strict local crawl artifact directory:

- `/tmp/spoonjoy-strict-local-crawl`

Latest disposable live-smoke artifact directory:

- `/tmp/spoonjoy-live-smoke-local`

Contact sheets:

- `/tmp/spoonjoy-ui-crawl-local/contact-mobile-top.png`
- `/tmp/spoonjoy-ui-crawl-local/contact-tablet-top.png`
- `/tmp/spoonjoy-ui-crawl-local/contact-desktop-top.png`

## Commands Run

```bash
python3 /Users/arimendelow/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/arimendelow/.codex/skills/ui-systems-audit
node scripts/inventory-ui.mjs /Users/arimendelow/Projects/spoonjoy-v2 --json > /tmp/spoonjoy-ui-inventory.json
node scripts/inventory-ui.mjs /Users/arimendelow/Projects/spoonjoy-v2 --json > /tmp/spoonjoy-cookbook-language-inventory.json
pnpm db:seed
UI_AUDIT_EMAIL=demo@spoonjoy.com UI_AUDIT_PASSWORD=demo1234 node scripts/crawl-ui.mjs --base-url http://localhost:5173 --routes docs/ui-systems-audit-routes.json --out /tmp/spoonjoy-ui-crawl-local
UI_AUDIT_EMAIL=demo@spoonjoy.com UI_AUDIT_PASSWORD=demo1234 node scripts/crawl-ui.mjs --base-url https://spoonjoy-v2.mendelow-studio.workers.dev --routes docs/ui-systems-audit-routes.json --out /tmp/spoonjoy-ui-crawl-deployed
pnpm test test/components/recipe/IngredientList.test.tsx test/components/recipe/StepList.test.tsx test/components/ui/button.test.tsx test/components/ui/checkbox.test.tsx test/components/recipe/SpoonsStrip.test.tsx -- --run
pnpm test test/components/recipe/IngredientList.test.tsx test/components/recipe/SpoonsStrip.test.tsx -- --run
pnpm test test/components/ui/design-system-hygiene.test.ts test/components/ui/button.test.tsx -- --run
pnpm test test/routes/focused-step-editor-flow-e2e.test.tsx -- --run
pnpm test:coverage
pnpm typecheck
pnpm build
UI_AUDIT_EMAIL=demo@spoonjoy.com UI_AUDIT_PASSWORD=demo1234 node scripts/crawl-ui.mjs --base-url http://localhost:5173 --routes docs/ui-systems-audit-routes.json --out /tmp/spoonjoy-border-crawl
UI_AUDIT_EMAIL=demo@spoonjoy.com UI_AUDIT_PASSWORD=demo1234 node scripts/crawl-ui.mjs --base-url http://localhost:5173 --routes docs/ui-systems-audit-routes.json --out /tmp/spoonjoy-cookbook-language-crawl
UI_AUDIT_EMAIL=demo@spoonjoy.com UI_AUDIT_PASSWORD=demo1234 node scripts/crawl-ui.mjs --base-url http://localhost:5173 --routes /tmp/spoonjoy-recipe-detail-route.json --out /tmp/spoonjoy-ingredient-width-local
UI_AUDIT_EMAIL=demo@spoonjoy.com UI_AUDIT_PASSWORD=demo1234 node scripts/crawl-ui.mjs --base-url http://localhost:5173 --routes /tmp/spoonjoy-cook-shopping-routes.json --out /tmp/spoonjoy-cook-shopping-local
# Focused Playwright cook-mode screenshot script wrote /tmp/spoonjoy-cook-mode-local.
pnpm test test/routes/shopping-list-ux.test.tsx test/routes/recipes-id.test.tsx test/components/navigation/recipe-dock-actions.test.tsx test/routes/recipe-dock-integration.test.tsx -- --run
UI_AUDIT_EMAIL=demo@spoonjoy.com UI_AUDIT_PASSWORD=demo1234 node scripts/crawl-ui.mjs --base-url http://localhost:5173 --routes docs/ui-systems-audit-routes.json --out /tmp/spoonjoy-strict-local-crawl
pnpm smoke:live -- --base-url http://localhost:5173 --out /tmp/spoonjoy-live-smoke-local
```

Ouroboros harness smoke:

- Slugger exercised first-class Spoonjoy MCP tools: health, search, create recipe, update recipe, search verification, and get recipe.
- The temporary MCP smoke recipe was cleaned from local Miniflare D1 state after the tool smoke because the MCP does not expose recipe deletion.
- Slugger verified the cleaned recipe no longer appears in MCP search and `get_recipe` returns `null`.

## Current Results

Rendered crawl:

- 54 screenshots: 18 routes × mobile, tablet, desktop.
- 0 skipped routes.
- 0 horizontal overflow findings.
- 0 small touch target findings.
- 0 clipped text findings.
- 0 console errors.
- 0 page errors.
- Border-rule re-crawl at `/tmp/spoonjoy-border-crawl` repeated the 54-route matrix with the same zero-error result.
- Cookbook-language re-crawl at `/tmp/spoonjoy-cookbook-language-crawl` repeated the 54-route matrix with the same zero-error result.
- Ingredient-width focused crawl at `/tmp/spoonjoy-ingredient-width-local` covered recipe detail across mobile, tablet, and desktop with the same zero-error result.
- Shopping-list/cook-mode focused crawl at `/tmp/spoonjoy-cook-shopping-local` covered shopping list and recipe detail across mobile, tablet, and desktop with the same zero-error result.
- Focused cook-mode screenshots at `/tmp/spoonjoy-cook-mode-local` covered mobile and desktop after entering cook mode, with 0 console errors, 0 page errors, 0 horizontal overflow, and 0 small touch targets.

Deployed crawl:

- URL: `https://spoonjoy-v2.mendelow-studio.workers.dev`
- Worker version: `69109591-db3a-42f1-9cf5-138613e6d2c3`
- 54 screenshots: 18 routes × mobile, tablet, desktop.
- 0 skipped routes.
- 0 horizontal overflow findings.
- 0 small touch target findings.
- 0 clipped text findings.
- 0 console errors.
- 0 page errors.

Static inventory:

- 117 UI source files inspected.
- 17,049 UI source lines inspected.
- 0 legacy Tailwind color classes.
- 0 copied Catalyst button shells.
- 0 negative tracking classes.
- Review-only findings remain for intentional exceptions: circular avatars, radios, switches, dock controls, CSS palette tokens, and a few custom non-primitive buttons used as full-row controls.

Verification:

- 211 test files passed.
- 4,613 tests passed.
- 100% statement, branch, function, and line coverage.
- Typecheck passed.
- Production build passed.
- `pnpm deploy:auto` passed and deployed Worker version `69109591-db3a-42f1-9cf5-138613e6d2c3`.
- Deployed UI crawl passed.
- First-class Ouro/Spoonjoy MCP create, update, search, and get smoke passed.

2026-05-26 design-translation follow-up:

- Re-read `docs/design-language.md`, `docs/design-prototypes/kitchen-table.html`, and the audit backlog against the rendered app.
- Added `/recipes/r_pizza#cook` to the durable crawl matrix so the paged cooking surface is audited directly instead of inferred from recipe detail.
- Local crawl at `/tmp/spoonjoy-design-translation-crawl-4`: 57 screenshots, 19 routes across mobile/tablet/desktop, 0 skipped routes, 0 horizontal overflow findings, 0 small touch target findings, 0 clipped text findings, 0 console errors, and 0 page errors.
- Fixed the remaining design-translation drift found in that pass: cook mode now renders as a true viewport pager, and cookbook owner tools no longer read like a dead printed heading when collapsed.
- Verification after the follow-up: 220 test files passed, 4,748 tests passed, 100% statement/branch/function/line coverage, typecheck passed, production build passed, and Chromium e2e passed 27/27.

2026-05-26 final-polish follow-up:

- Hardened `scripts/crawl-ui.mjs` so UI crawls now fail on auth skips, HTTP 4xx/5xx responses, console/page errors, horizontal overflow, undersized targets, and clipped text.
- Added `pnpm smoke:live`, a disposable-account browser smoke for live Workers that signs up, creates a recipe, enters cook mode, adds ingredients to the shopping list, checks settings, checks the push public-key endpoint, captures screenshots, and can remote-clean the smoke user.
- Fixed the root shell so route content mounts once instead of once for desktop and once for mobile. The old shell duplicated forms, IDs, effects, and cook-mode panels behind responsive wrappers.
- Strict local crawl at `/tmp/spoonjoy-strict-local-crawl`: 57 route/viewport captures, 0 skipped routes, 0 HTTP failures, 0 console/page errors, 0 overflow findings, 0 clipped-text findings, and 0 small touch-target findings.
- Local disposable smoke at `/tmp/spoonjoy-live-smoke-local`: signup, recipe creation, paged cook mode, recipe-to-shopping-list add, shopping list, and account settings passed with 0 console/page errors. Local `/api/push/public-key` returned 500 because local dev does not have VAPID configured; live Workers must return 200.

2026-05-27 reported-regression follow-up:

- Closed UIA-019 through UIA-030 from the user-reported regression list: long serving labels, missing homepage photos, bordered/rounded recipe imagery, new-recipe parser 404, save-to-cookbook discoverability, delete prominence, shopping-list reorder, empty-cooks CTA, share buttons, mobile settings access, search Enter submit, and unified narrow cook-mode checklists.
- Strict local crawl at `/tmp/spoonjoy-ui-audit-2026-05-27`: 54 route/viewport captures, 0 skipped routes, 0 HTTP failures, 0 console/page errors, 0 overflow findings, 0 clipped-text findings, and 0 small touch-target findings.
- Custom browser acceptance at `/tmp/spoonjoy-custom-acceptance-2026-05-27`: verified homepage recipe photos, edge-to-edge unbordered photo tiles, `/recipes/new` parser no-404 behavior, recipe save/share/delete-maintenance actions, no-cooks CTA, narrow cook-mode checklist width, 2px left-to-right strike animation, stable shopping-list order after checkoff, cookbook share, and mobile settings dock access.
- Local disposable smoke at `/tmp/spoonjoy-local-smoke-2026-05-27`: signup, recipe creation, cook mode, shopping-list add/check, account settings, and push public-key behavior passed.
- Verification after the follow-up: 228 test files passed, 4,817 tests passed, 100% statement/branch/function/line coverage, typecheck passed, production build passed, strict UI crawl passed, custom acceptance passed, and local smoke passed.

## Findings

| ID | Severity | Status | Surfaces | Result |
| --- | --- | --- | --- | --- |
| UIA-001 | High | Fixed | UI primitives, recipe forms, stories | Removed stale Catalyst radius/math patterns and normalized controls to the Spoonjoy radius scale. |
| UIA-002 | High | Fixed | Recipe/detail and shopping checklist | Ingredient rows and step-output rows now share the same checklist grammar; checked rows strike across the content and use inverse dark checks. |
| UIA-003 | High | Fixed | Ingredient checkoff flow | Reintroduced Framer layout animation so checked ingredients move to the bottom pleasantly, respecting reduced motion. |
| UIA-004 | High | Fixed | Recipe detail | Reworked the first viewport around a cookbook-style image/text composition with edge-conscious food photography and clear actions. |
| UIA-005 | Medium | Fixed | Recipe create/edit, step forms | Flattened form sections into ruled cookbook sections; removed nested-card feel. |
| UIA-006 | Medium | Fixed | Recipe image upload | Replaced native file-input feel with a clear photo drop/upload surface and intentional actions. |
| UIA-007 | Medium | Fixed | Step editor | Enlarged the reorder grip into a real 44px drag control with keyboard support retained. |
| UIA-008 | Medium | Fixed | Profile/kitchen sample data | Added seed cleanup for local QA cookbooks so visual audits show realistic cookbooks instead of MCP smoke-test artifacts. |
| UIA-009 | Medium | Fixed | Desktop nav | Restored the real Spoonjoy mark and tightened desktop navigation spacing, current state, and touch targets. |
| UIA-010 | Low | Accepted | Dock, avatars, radios, switches | `rounded-full` remains intentional only where circular shape carries semantic or physical meaning. |
| UIA-011 | Medium | Fixed | Page mastheads, forms, shopping list, ruled lists | Collapsed duplicate horizontal rules so headers, form sections, settings panels, and cookbook lists use one purposeful divider instead of stacked border echoes. |
| UIA-012 | High | Fixed | Cookbook detail | Replaced the admin/table-like recipe membership list with a cookbook table-of-contents treatment; owner add/remove/edit/delete tools now live in a collapsed maintenance area outside the printable contents. |
| UIA-013 | Medium | Fixed | Recipe detail ingredients | Constrained only the per-step ingredient checklist on desktop so quantity labels stay visually connected, while leaving step prose at the wider cookbook reading measure. |
| UIA-014 | Medium | Fixed | Shopping list | Kept the editorial header wider while constraining the market checklist, added Need/Basket/All modes, aisle grouping, a single In basket section for checked rows, and recipe scale when adding ingredients. |
| UIA-015 | High | Fixed | Recipe detail, dock actions | Replaced the old jump link with a focused cook-mode panel, step-by-step controls, shared ingredient checklist grammar, `#cook` deep-link/back behavior, and dock/header entry points. |
| UIA-016 | Medium | Fixed | Cookbook detail | Changed the collapsed owner-tools affordance from a lone dead-looking label into a full-width expandable maintenance row with explicit open/close state. |
| UIA-017 | High | Fixed | Root shell, every route | Removed the duplicate desktop/mobile `<Outlet />` mounting so forms, IDs, route effects, and cook-mode panels exist once. |
| UIA-018 | High | Fixed | UI audit harness | Strict crawl now fails instead of silently accepting skipped auth routes, HTTP failures, console/page errors, overflow, clipped text, or undersized targets. |
| UIA-019 | High | Fixed | Recipe detail scaling | Long serving/yield strings now wrap inside the scale selector without overlapping the controls. |
| UIA-020 | High | Fixed | Kitchen homepage | Recipe index rows restored food thumbnails instead of text-only rows. |
| UIA-021 | Medium | Fixed | Kitchen, pantry, cookbook, search imagery | Recipe photo tiles are edge-to-edge, unbordered, and unrounded. |
| UIA-022 | High | Fixed | New recipe form | Ingredient parser submits to the `/recipes/new` action instead of a missing step-edit route. |
| UIA-023 | High | Fixed | Recipe detail, mobile dock | Save-to-cookbook is visible from recipe detail and opens the saved-state modal. |
| UIA-024 | Medium | Fixed | Recipe detail | Delete moved behind a collapsed maintenance area. |
| UIA-025 | High | Fixed | Shopping list | Checking an item keeps it in place in the default market view while preserving checkoff animation. |
| UIA-026 | Medium | Fixed | Recipe cooks strip | Empty cook history now includes a real log-first-cook CTA. |
| UIA-027 | Medium | Fixed | Recipes, cookbooks, kitchen cards | Recipe and cookbook detail/cards expose share actions via native share or clipboard fallback. |
| UIA-028 | Medium | Fixed | Mobile dock | Mobile users can reach settings/display controls from the dock. |
| UIA-029 | Medium | Fixed | Search | Enter in the search field submits the form. |
| UIA-030 | High | Fixed | Cook mode | Ingredients and step-output uses share one narrow checklist grammar with a thicker left-to-right strikethrough. |

## Re-Audit Notes

Run the crawl after any broad UI change. The automated checks are necessary but not sufficient: inspect the generated contact sheets and at least the mobile recipe detail, shopping list, recipe form, profile, search, and account screenshots manually.

The remaining static flags should not be treated as open defects unless their use expands beyond the accepted cases above.
