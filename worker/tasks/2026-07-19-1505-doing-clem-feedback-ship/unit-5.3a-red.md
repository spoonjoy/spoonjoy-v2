# Unit 5.3a Red Evidence

Verified 2026-07-23.

The saved web contract is frozen across the three required test surfaces:

- `test/routes/saved-recipes.test.tsx` requires authenticated, owner-scoped `SavedRecipe` reads; cookbook independence; active-recipe filtering; exact saved-time and binary recipe-ID ordering across opaque service cursors; hydration-order preservation; malformed cursor/query `400` messages; unrelated error propagation; a useful route failure state; query-preserving next links; and independent empty, search, and row copy.
- `test/lib/recipe-detail.server.test.ts` requires owner-scoped `isSaved` loader state plus idempotent save/unsave actions with direct persisted-row assertions. Cookbook add/remove actions must preserve the saved row and saved timestamp, saved actions must preserve cookbook membership, a failed soft-deleted save must leave its historical row intact, and the owner must still be able to unsave that row.
- `test/routes/recipes-id.test.tsx` requires semantic, keyboard-operable `Save recipe` and `Remove saved recipe` toggle states with `aria-pressed`; pending optimism; rapid-toggle suppression; loader-authoritative revalidation; failed-save rollback and feedback; a distinctly named `Add to cookbook` control/dialog with cookbook-specific creation copy; and guest login routing with no mutation or dialog side effect.

Command:

```text
pnpm exec vitest run test/routes/saved-recipes.test.tsx test/lib/recipe-detail.server.test.ts test/routes/recipes-id.test.tsx
```

Result: 152 tests collected, 125 surrounding tests passed, and 27 intended feature assertions failed with no warning output. The failures are confined to the legacy cookbook-derived drawer, absent recipe-detail saved state/actions, absent cursor/error UI, and the still-conflated Save/Cookbook control.

The first harsh review found five gaps in the initial red contract: optimistic race and rollback semantics; canonical equal-timestamp pagination/hydration; persisted independence in both directions; preservation of a historical row after a rejected soft-deleted save; and malformed-query, unrelated-error, failure-state, guest, and keyboard coverage. The repaired contract freezes all five and the parent runner independently reproduced the exact result above.

The second review found that component-level independence and guest redirects were still asserted only in aggregate. The final repair proves cookbook add/remove cannot change the independent Save state, save/unsave cannot change cookbook membership state while pending or after revalidation, and each guest control independently performs exactly one correct login redirect without a mutation or dialog side effect. The parent runner again reproduced the same exact 152-test result.
