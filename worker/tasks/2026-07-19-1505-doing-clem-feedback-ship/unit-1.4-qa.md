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

## Cold Review

A fresh reviewer independently inspected Cloudflare's deployment/version metadata, confirmed `migration_tag: v1_cook_session`, replayed two exact bootstrap probes, queried remote D1, and checked the worktree. It returned `CONVERGED` with no finding at any severity. The reviewer classified the immediate post-deploy 405 as edge propagation before convergence, not an acceptance failure, because the required version-bound calls were replayed successfully after the deployment reached 100%.

## Integration Revalidation

After merging current `main`, the final PR candidate added fail-closed public-probe abuse controls. Deployment `34eb892b-c90e-417e-8043-7a06e287084d` exposed a live-runtime mismatch: Cloudflare represented an empty headerless `POST` with a non-null stream, so version `10cb7e21-4a7d-4457-97bb-959da6e95778` returned 404. The candidate was not accepted. A reviewed repair now accepts only a non-null stream paired with explicit `Content-Length: 0`; headerless or otherwise declared bodies return 404 before rate limiting or Durable Object access.

- Final runtime head: `da1fbd30e0e77ed5edb3c9ed5044d69c224cae4b`.
- QA deployment: `999e7df7-e629-48ac-a1ae-19b75a877dc4`, created `2026-07-21T10:21:42.227883Z`.
- QA Worker version: `a61526d0-249d-472d-a413-c6cad1bcec5a` at 100% traffic.
- Two strict `POST` probes with explicit `Content-Length: 0` returned status 200, the matching version header, and exact `{ok:true,storage:"sqlite",residue:0,workerVersionId:"a61526d0-249d-472d-a413-c6cad1bcec5a"}` payloads.
- Remote QA D1 again returned `table_count: 0` for `CookSessionIndex`; local disposable-data dry-run counts were all zero.
- Two independent security reviews converged after an adversarial headerless non-empty stream test proved 404 with no body read, limiter call, object derivation, or Durable Object fetch.
