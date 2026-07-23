# Unit 5.3a Red Evidence

Verified 2026-07-23.

The saved web contract is frozen across the three required test surfaces:

- `test/routes/saved-recipes.test.tsx` requires authenticated, owner-scoped `SavedRecipe` reads; cookbook independence; active-recipe filtering; service cursor pagination; invalid-cursor `400`; query-preserving next links; and independent empty, search, and row copy.
- `test/lib/recipe-detail.server.test.ts` requires owner-scoped `isSaved` loader state plus idempotent save/unsave actions that preserve cookbook membership, keep the first canonical `savedAt`, reject soft-deleted saves, and still permit unsaving a historical row.
- `test/routes/recipes-id.test.tsx` requires a keyboard-operable `Save recipe` toggle with `aria-pressed`, a distinctly named `Add to cookbook` control/dialog, cookbook-specific creation copy, and optimistic independence between the two workflows.

Command:

```text
pnpm exec vitest run test/routes/saved-recipes.test.tsx test/lib/recipe-detail.server.test.ts test/routes/recipes-id.test.tsx
```

Result: 146 tests collected, 126 surrounding tests passed, and 20 intended feature assertions failed with no warning output. The failures are confined to the legacy cookbook-derived drawer, absent recipe-detail saved state/actions, absent cursor UI, and the still-conflated Save/Cookbook control.
