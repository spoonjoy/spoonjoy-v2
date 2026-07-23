# Unit 6.2a Red Evidence

Verified 2026-07-23.

The authoring contract is frozen across five deliberately red test surfaces without changing production code:

- `RecipeBuilder` exposes the exact nullable course choices, keyboard-first custom-tag entry and removal, edit prepopulation, save payload, disabled state, and accessible field errors.
- `createRecipeDraft` receives authenticated ownership, course, normalized tags, one timestamp, a native D1 binding, and deterministic IDs. A real local trigger on the second tag proves the initial Recipe must roll back with its tags.
- New/edit actions validate course and tag JSON, persist normalized metadata, and populate hidden browser payloads. Edit loading includes ordered display tags.
- The local edit path freezes one operation set for authoring fields, guarded metadata replacement, Recipe and containing-Cookbook timestamps, and unchanged `SearchDocument`/`SearchIndexMetadata` authority. A real later-tag trigger must preserve every original row and timestamp.
- The isolated Workerd path records every prepared statement and bind. Native create must issue one three-statement `DB.batch()`; the real edit action must receive the request DB binding and issue one guarded five-statement batch with no search-table write. Real D1 triggers force create/edit rollback.

## Red Runs

```text
pnpm exec vitest run test/components/recipe/RecipeBuilder.test.tsx --coverage=false
```

Result: 35 passed, 6 expected failures, all caused by the absent course/tag controls and component data fields.

```text
pnpm exec vitest run test/lib/recipe-create.server.test.ts --coverage=false
```

Result: 11 passed, 2 expected failures. The current helper ignores course/tags/dependencies, so the fixed timestamp is absent and the later-tag trigger is never reached.

```text
pnpm exec vitest run test/routes/recipes-new.test.tsx test/routes/recipes-id-edit.test.tsx --coverage=false --maxWorkers=1
```

Result: 124 passed, 8 expected failures, all at the absent loader, validation, persistence, rollback, or hidden-payload boundary.

```text
pnpm exec vitest run --config vitest.workers.config.ts --maxWorkers=1 --no-isolate test/workers/recipe-tags-d1.test.ts --coverage=false
```

Result: 2 existing atomicity tests passed and 3 authoring tests failed as intended: create made zero native batches, create did not reach the forced tag failure, and edit redirected after taking the legacy Prisma D1 transaction path. The test owns and asserts that exact legacy warning during red execution, so no diagnostic escapes the warning gate; green execution requires no warning.

## Boundary

The exact-content change allowlist was advanced only for these five reviewed test files. The normative product and protocol authorities are unchanged. No import UI, provider-specific behavior, or navigation redesign is introduced.
