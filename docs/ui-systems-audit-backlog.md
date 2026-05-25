# UI Systems Audit Backlog

Date: 2026-05-24

There are no open UI audit findings after the current pass.

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

## Accepted Exceptions

- Circular UI remains only for avatars, radio/switch controls, theme toggle, and mobile dock affordances.
- The search quick-filter receipt, dialogs, dropdown menus, toasts, and cookbook covers are allowed to be framed surfaces because they are tools, overlays, or repeated objects.
- CSS hex values are allowed only in design-token declarations and the Chef RJ fallback SVG.

## Next Audit Trigger

Re-run `ui-systems-audit` when a PR changes shared UI primitives, navigation, recipe detail, recipe forms, shopping list, profile/kitchen surfaces, or cookbook/search layouts.
