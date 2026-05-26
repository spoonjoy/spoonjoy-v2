# UI Systems Audit Backlog

Date: 2026-05-24

Current pass focus:

- Shopping list should behave like a narrow, one-thumb market checklist on desktop and mobile. Header/prose may keep a wider editorial measure; list rows, category filters, and list tools should stay visually connected.
- Cook mode should become a real focused cooking surface, not just a jump link to all steps.
- Keep the rendered crawl aligned with the prototype states that can regress visually, including the `#cook` paged cooking surface.

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
