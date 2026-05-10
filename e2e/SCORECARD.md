# E2E Test Scorecard

**Updated**: 2026-05-10
**Total**: 25 tests | **Passed**: 25 | **Failed**: 0

---

## Summary by Flow

| Flow | Pass | Fail | Status |
|------|------|------|--------|
| Auth | 6 | 0 | Pass |
| Recipes | 3 | 0 | Pass |
| Cookbooks | 5 | 0 | Pass |
| Shopping List | 5 | 0 | Pass |
| Mobile RecipeBuilder/SpoonDock | 4 | 0 | Pass |
| Smoke Test | 1 | 0 | Pass |
| Setup | 1 | 0 | Pass |

---

## Mobile Guardrails Added In SJ-008

- Recipe create flow keeps RecipeBuilder controls reachable above the fixed SpoonDock.
- Recipe edit flow exposes contextual Cancel and Save actions, and dock Save submits current RecipeBuilder state.
- Recipe detail contextual actions fit inside the dock and keep the Save to Cookbook sheet usable.
- Shopping-list mobile controls have touch targets and Add remains clear of the dock.

---

## Commands

```bash
# Run all tests
pnpm test:e2e

# Run the mobile audit only
env -u FORCE_COLOR -u NO_COLOR pnpm test:e2e e2e/flows/mobile-recipebuilder-spoondock.spec.ts

# Run with UI for debugging
pnpm test:e2e:ui
```
