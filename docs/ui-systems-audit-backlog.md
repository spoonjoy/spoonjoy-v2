# UI Systems Audit Backlog

Date: 2026-05-24

Current pass focus:

- Shopping list should behave like a narrow, one-thumb market checklist on desktop and mobile. Header/prose may keep a wider editorial measure; list rows, category filters, and list tools should stay visually connected.
- Cook mode should become a real focused cooking surface, not just a jump link to all steps.
- Keep the rendered crawl aligned with the prototype states that can regress visually, including the `#cook` paged cooking surface.
- 2026-05-27 follow-up: fix the reported live UI/product regressions before declaring v2 ready. Completion means each item below is fixed, covered by focused tests where practical, browser-smoked at mobile and desktop, and included in the next deployed smoke.

## Active Acceptance Checklist

- None after the 2026-05-27 regression pass.

## Closed In This Pass

- UIA-001: Stale Catalyst radius and copied button/form styling: fixed.
- UIA-002: Ingredient and step-output checklist mismatch: fixed.
- UIA-003: Ingredient checked-row reorder animation regression: fixed.
- UIA-004: Recipe detail composition and photo treatment: fixed.
- UIA-005: Recipe create/edit/step form cardiness: fixed.
- UIA-006: Native-looking photo chooser: fixed.
- UIA-007: Decorative/small step drag handle: fixed.
- UIA-008: Local QA cookbook data polluting visual audit screens: fixed.
- UIA-009: Desktop nav/logo inconsistency: fixed.
- UIA-011: Duplicate and ornamental horizontal rules across mastheads, forms, shopping list, and ruled lists: fixed.
- UIA-012: Cookbook detail mixed printed contents with inline admin/table controls: fixed.
- UIA-013: Recipe detail ingredient checklists were too wide on desktop while prose needed to remain wider: fixed.
- UIA-014: Shopping-list checklist measure and usefulness: fixed.
- UIA-015: Recipe cook mode first-class focused flow: fixed.
- UIA-016: Cookbook detail collapsed owner tools read like a dead printed heading: fixed.
- UIA-017: Root layout mounted route content twice behind desktop/mobile wrappers, duplicating forms, IDs, effects, and cook-mode panels: fixed.
- UIA-018: UI crawl could silently pass with skipped authenticated routes, 404s, console errors, clipped text, overflow, or small targets: fixed.
- UIA-019: Long serving/yield strings must wrap inside `ScaleSelector` without overlapping the +/- controls: fixed.
- UIA-020: The kitchen homepage recipe index must show recipe photos, not just text rows: fixed.
- UIA-021: Recipe photos in kitchen, pantry, cookbook, and search index treatments must be edge-to-edge, unbordered, and unrounded unless they are literal cookbook-cover objects: fixed.
- UIA-022: The new-recipe ingredient parser must submit to a valid `/recipes/new` parse action and never navigate to a 404: fixed.
- UIA-023: Saving a recipe into a cookbook must be visible from recipe detail on desktop and mobile, with a clear saved-state modal: fixed.
- UIA-024: Destructive recipe deletion must live behind a maintenance affordance and not compete with cooking/saving/sharing actions: fixed.
- UIA-025: Shopping-list checkoff must not cause surprising category jumps in the default all view; completion motion should be pleasant and stable: fixed.
- UIA-026: Empty cook history must include a real CTA to log the first cook: fixed.
- UIA-027: Recipes and cookbooks must expose native-share/clipboard share buttons on detail pages and primary kitchen cards/rows: fixed.
- UIA-028: Mobile users must have an obvious route to settings/display controls from the dock: fixed.
- UIA-029: Pressing Enter in the search field must submit the search form: fixed.
- UIA-030: Follow/cook mode ingredients and step-output uses must share one narrow centered checklist grammar, with a thicker left-to-right strikethrough: fixed.

## Product Backlog Seeded

- CM-002: Persist cook-mode progress across reloads, screen locks, and PWA relaunches: queued.
- CM-003: Add step timers/rest cues where recipe data supports them: queued.
- CM-004: Consider a larger hands-free cook-mode text setting after real kitchen use: queued.
- SL-002: Add recipe/source grouping for shopping-list items once users have multiple active meal plans: queued.
- SL-003: Add smarter duplicate review for near-matches such as cherry tomato/tomato before merging quantities: queued.

## Accepted Exceptions

- Circular UI remains only for avatars, radio/switch controls, theme toggle, and mobile dock affordances.
- The search quick-filter receipt, dialogs, dropdown menus, toasts, and cookbook covers are allowed to be framed surfaces because they are tools, overlays, or repeated objects.
- CSS hex values are allowed only in design-token declarations and the Chef RJ fallback SVG.

## Next Audit Trigger

Re-run `ui-systems-audit` when a PR changes shared UI primitives, navigation, recipe detail, recipe forms, shopping list, profile/kitchen surfaces, or cookbook/search layouts.

For deployed/staging checks, do not rely on local seed IDs. Use `pnpm smoke:live -- --base-url <worker-url>` to create disposable data, prove the live workflow, and clean up the smoke account. Pass `--keep-smoke-data` only when the human explicitly wants temporary debugging data preserved.
