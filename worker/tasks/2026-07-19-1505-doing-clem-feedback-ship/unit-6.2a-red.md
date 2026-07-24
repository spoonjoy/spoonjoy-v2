# Unit 6.2a Red Evidence

Verified 2026-07-23.

The authoring contract is frozen across five deliberately red test surfaces without changing production code:

- `RecipeBuilder` exposes the exact nullable course choices, keyboard-first custom-tag entry and Enter-key removal, edit prepopulation, save payload, disabled state, and `aria-invalid` plus described field errors.
- `createRecipeDraft` receives authenticated ownership, course, normalized tags, exactly one clock read, a native D1 binding, and deterministic IDs. The local executor must construct the exact three raw Prisma promises and pass that complete ordered array to one `$transaction`; a real trigger on the second tag proves the initial Recipe must roll back with its tags.
- New/edit actions validate malformed JSON and valid-JSON semantic tag failures, persist normalized metadata, and populate hidden browser payloads. Edit loading proves service ordering independently of insertion order. Non-owner, absent, and deleted edit requests snapshot Recipe, RecipeTag, and containing-Cookbook rows and require exact no-mutation equality.
- The local edit path freezes one operation set for authoring fields, guarded metadata replacement, Recipe and every containing-Cookbook timestamp while preserving an unrelated cookbook. It must construct the exact four query promises plus one delete promise and pass those five operations in order to one Prisma array `$transaction`. Its final-Cookbook trigger aborts only after it observes all earlier authoring and tag mutations in transient state. Full search rows remain byte-for-byte unchanged until `ensureSearchIndexFresh` detects the canonical fingerprint change and rebuilds searchable tag content.
- The isolated Workerd path invokes the authenticated new/edit actions with the request DB binding, spies on both service calls to prove that exact binding is passed as `nativeDatabase`, records every prepared statement and bind, and requires exact ordered SQL and values. Native create must issue one three-statement `DB.batch()`; edit must issue one guarded five-statement batch; all core authoring writes must be members of that batch and no recorded statement may touch search tables. Independent service calls use a Prisma proxy whose `$transaction` always throws while the native binding remains usable. Exhaustive create and edit malformed-envelope matrices corrupt every statement's success flag, affected-count contract, returned-row count, and each returned identity/ownership/authoring/timestamp field without mutation; only a complete all-zero edit envelope maps to raced not-found.

## Red Runs

```text
pnpm vitest run test/components/recipe/RecipeBuilder.test.tsx test/lib/recipe-create.server.test.ts test/routes/recipes-new.test.tsx test/routes/recipes-id-edit.test.tsx --maxWorkers=1 --no-file-parallelism
```

Result: 170 passed, 16 expected failures across 186 tests. Every failure is at an absent course/tag control, loader, validation, atomic persistence, rollback, hidden-payload, or single-timestamp boundary.

```text
pnpm vitest run --config vitest.workers.config.ts test/workers/recipe-tags-d1.test.ts --maxWorkers=1 --no-isolate
```

Result: 2 existing atomicity tests passed and 73 authoring contracts failed as intended across 75 tests: authenticated create omitted the route's native option, create did not reach the forced tag failure, all exhaustive create-result interceptors remained unreached, edit omitted its native service, and all exhaustive edit-result plus all-zero interceptors remained unreached. Both missing and trailing native result envelopes are rejected. Legacy Prisma warnings are captured only around the deliberately red calls, so no diagnostic escapes the warning gate; green execution requires no warning.

## Boundary

Five harsh reviews found and blocked route-composition and executor ambiguity, weak SQL inspection, vacuous rollback timing, incomplete cookbook/search scope, a self-fulfilling loader order, incomplete accessibility semantics, selective create/edit result validation, contradictory not-found handling, missing row-level or attempted-ID no-mutation proofs, and an under-specified local executor shape. Every finding is now represented by an executable assertion, and the final reviewer returned `CONVERGED` with no blocker or major findings. The exact-content change allowlist was advanced only for these five reviewed test files; normative product and protocol authorities remain unchanged. No import UI, provider-specific behavior, or navigation redesign is introduced.
