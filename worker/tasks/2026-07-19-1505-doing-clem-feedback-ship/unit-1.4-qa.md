# Unit 1.4 Bootstrap QA

## Deployment

- Command: `pnpm run deploy:qa`
- Target: `https://spoonjoy-v2-qa.mendelow-studio.workers.dev`
- QA D1 migrations through `0023_recipe_cover_prompt_lineage.sql`: applied; follow-up preflight reported no pending migrations.
- QA secrets and R2 round-trip preflight: passed.
- Durable Object binding: `COOK_SESSIONS (CookSession)`.
- Lifecycle configuration: `v1_cook_session` with `new_sqlite_classes: ["CookSession"]`.
- Deployment created: `2026-07-21T04:20:15.936Z`.
- Worker version: `80dc3064-4b3f-4ff9-9a04-3a03660cfa55` at 100% traffic.

## Bootstrap Probe

The first request issued immediately after Wrangler returned reached the previous edge deployment and returned 405. After the deployment propagated, six consecutive requests reached the new version and returned 200. The acceptance assertion was then replayed as two fresh calls against the converged deployment:

```json
{"run":1,"status":200,"header":"80dc3064-4b3f-4ff9-9a04-3a03660cfa55","value":{"ok":true,"storage":"sqlite","residue":0,"workerVersionId":"80dc3064-4b3f-4ff9-9a04-3a03660cfa55"},"assertion":"pass"}
{"run":2,"status":200,"header":"80dc3064-4b3f-4ff9-9a04-3a03660cfa55","value":{"ok":true,"storage":"sqlite","residue":0,"workerVersionId":"80dc3064-4b3f-4ff9-9a04-3a03660cfa55"},"assertion":"pass"}
```

Both calls asserted status 200, the exact four-field response, a matching `X-Spoonjoy-Worker-Version` header, SQLite storage, and zero private probe-table rows after cleanup.

## Residue

- The QA D1 schema query returned `table_count: 0` for `CookSessionIndex`; the bootstrap release neither creates nor writes the future product registry.
- The probe's own post-drop storage count returned `residue: 0` on every successful call, including the two acceptance calls against the same deterministic object.
- `pnpm cleanup:qa` ran before and after QA work. Both local disposable-data scans returned zero recipes, users, spoons, and cross-boundary blockers.
- No disposable QA user, recipe, D1 row, or R2 object was created by this namespace probe.
