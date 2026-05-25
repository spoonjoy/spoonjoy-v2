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

Contact sheets:

- `/tmp/spoonjoy-ui-crawl-local/contact-mobile-top.png`
- `/tmp/spoonjoy-ui-crawl-local/contact-tablet-top.png`
- `/tmp/spoonjoy-ui-crawl-local/contact-desktop-top.png`

## Commands Run

```bash
python3 /Users/arimendelow/.codex/skills/.system/skill-creator/scripts/quick_validate.py /Users/arimendelow/.codex/skills/ui-systems-audit
node /Users/arimendelow/.codex/skills/ui-systems-audit/scripts/inventory-ui.mjs /Users/arimendelow/Projects/spoonjoy-v2 --json > /tmp/spoonjoy-ui-inventory.json
node /Users/arimendelow/.codex/skills/ui-systems-audit/scripts/inventory-ui.mjs /Users/arimendelow/Projects/spoonjoy-v2 --json > /tmp/spoonjoy-cookbook-language-inventory.json
pnpm db:seed
UI_AUDIT_EMAIL=demo@spoonjoy.com UI_AUDIT_PASSWORD=demo1234 /Users/arimendelow/.codex/skills/ui-systems-audit/scripts/crawl-ui.mjs --base-url http://localhost:5173 --routes docs/ui-systems-audit-routes.json --out /tmp/spoonjoy-ui-crawl-local
UI_AUDIT_EMAIL=demo@spoonjoy.com UI_AUDIT_PASSWORD=demo1234 /Users/arimendelow/.codex/skills/ui-systems-audit/scripts/crawl-ui.mjs --base-url https://spoonjoy-v2.mendelow-studio.workers.dev --routes docs/ui-systems-audit-routes.json --out /tmp/spoonjoy-ui-crawl-deployed
pnpm test test/components/recipe/IngredientList.test.tsx test/components/recipe/StepList.test.tsx test/components/ui/button.test.tsx test/components/ui/checkbox.test.tsx test/components/recipe/SpoonsStrip.test.tsx -- --run
pnpm test test/components/recipe/IngredientList.test.tsx test/components/recipe/SpoonsStrip.test.tsx -- --run
pnpm test test/components/ui/design-system-hygiene.test.ts test/components/ui/button.test.tsx -- --run
pnpm test test/routes/focused-step-editor-flow-e2e.test.tsx -- --run
pnpm test:coverage
pnpm typecheck
pnpm build
UI_AUDIT_EMAIL=demo@spoonjoy.com UI_AUDIT_PASSWORD=demo1234 /Users/arimendelow/.codex/skills/ui-systems-audit/scripts/crawl-ui.mjs --base-url http://localhost:5173 --routes docs/ui-systems-audit-routes.json --out /tmp/spoonjoy-border-crawl
UI_AUDIT_EMAIL=demo@spoonjoy.com UI_AUDIT_PASSWORD=demo1234 /Users/arimendelow/.codex/skills/ui-systems-audit/scripts/crawl-ui.mjs --base-url http://localhost:5173 --routes docs/ui-systems-audit-routes.json --out /tmp/spoonjoy-cookbook-language-crawl
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

- 210 test files passed.
- 4,594 tests passed.
- 100% statement, branch, function, and line coverage.
- Typecheck passed.
- Production build passed.
- `pnpm deploy:auto` passed and deployed Worker version `69109591-db3a-42f1-9cf5-138613e6d2c3`.
- Deployed UI crawl passed.
- First-class Ouro/Spoonjoy MCP create, update, search, and get smoke passed.

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

## Re-Audit Notes

Run the crawl after any broad UI change. The automated checks are necessary but not sufficient: inspect the generated contact sheets and at least the mobile recipe detail, shopping list, recipe form, profile, search, and account screenshots manually.

The remaining static flags should not be treated as open defects unless their use expands beyond the accepted cases above.
