# SJ-008 Mobile RecipeBuilder And SpoonDock Audit

Date: 2026-05-10
Status: automated guardrails added; manual checklist retained for future visual review
Viewport: iPhone 13 Playwright profile

## Automated Coverage

`e2e/flows/mobile-recipebuilder-spoondock.spec.ts` now verifies:

- Recipe create flow keeps RecipeBuilder controls reachable above the fixed SpoonDock.
- Recipe edit flow exposes contextual dock Cancel and Save actions, and dock Save submits current RecipeBuilder state.
- Recipe detail contextual actions fit within the dock and keep the Save to Cookbook sheet usable.
- Shopping-list mobile controls have 44px touch targets and Add remains clear of the dock.

## Manual QA Checklist

Use this checklist when doing a headed visual pass or reviewing screenshots:

- Open `/recipes/new` at 390x844 and verify Title, Add Step, step action buttons, and Create Recipe are not hidden behind the dock.
- Add two steps and verify Move Up/Move Down remain visible touch alternatives to drag reordering.
- Open `/recipes/:id/edit` and verify contextual Cancel and Save appear in the dock with no horizontal crowding.
- Change the title on `/recipes/:id/edit`, tap dock Save, and verify the recipe detail page shows the updated title.
- Open `/recipes/:id`, verify Edit/List/Save/Share fit inside the dock, then tap Save and verify the bottom sheet footer is above the dock.
- Open `/shopping-list`, verify Add Item controls, item check buttons, and any visible clear actions are reachable without dock obstruction.
- Verify all dock links/buttons and primary form buttons are comfortably thumb-sized on a physical or emulated mobile viewport.

## Notes

The audit found and fixed two concrete mobile issues:

- Edit-page dock Save was registered but not connected to the RecipeBuilder state submit path.
- Contextual recipe-detail actions could overcrowd the default fixed-width dock side columns.

Shopping-list item rows also now enforce a 44px minimum row/check-button touch target.
