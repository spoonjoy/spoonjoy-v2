# Doing: Ship Clem Feedback

**Status**: READY_FOR_EXECUTION (2026-07-21 audited review converged)
**Execution Mode**: direct
**Created**: 2026-07-19 15:34
**Planning**: ./2026-07-19-1505-planning-clem-feedback-ship.md
**Artifacts**: ./2026-07-19-1505-doing-clem-feedback-ship/

## Execution Mode

- **direct**: Execute units sequentially in the current task, using fresh sub-agents for required reviews and bounded fixes.

## Objective
Ship Clem's accepted feedback as focused Spoonjoy product behavior: cross-device cooking, consistent shopping restoration, private saves, manual tags, and neutral recipe metadata/scaling. Preserve the existing navigation, agent-first import model, and exact existing Pebble-specific behavior without adding, removing, or reinterpreting it.

## Upstream Work Items
- `./2026-07-14-1313-clem-feedback-source.md`
- `./2026-07-19-1505-doing-clem-feedback-ship/cook-session-protocol-v1.md` is the normative cook contract.
- `./2026-07-19-1505-doing-clem-feedback-ship/product-data-contract.md` is the normative schema/API/import/shopping contract.

## Completion Criteria
- [ ] Every feedback-source row has either shipped behavior or a regression test for its explicit rejection.
- [ ] Real Workers-runtime tests prove one owner-scoped SQLite DO, object-name guards, direct discovery, concurrent start convergence, exact receipt replay/conflict, stale-attempt/revision handling, quotas, hibernatable WebSocket fan-out/order, deletion races, eviction recovery, idempotent terminal transitions, scheduler collisions, recipe purge, and permanent owner deletion.
- [ ] After ordinary D1-backed authentication, private `GET /api/cook-sessions` performs no D1 cook-state/recipe-ID/discovery query, reads the owner's DO directly, and returns active rows newest-first; an authenticated home revalidates immediately on mount/focus/visibility/online and every five seconds only while visible, online, and initially empty.
- [ ] Two authenticated browser contexts can begin from an initially empty second-device home, discover the same active session within five seconds without a manual reload or recipe identifier, and synchronize step, checklist, and scale changes.
- [ ] Anonymous progress remains usable across local reloads but never reaches the authenticated DO/D1 path; an anonymous -> user A -> logout -> user B browser sequence, including a stale socket and legacy local key, cannot cross principals.
- [ ] D1 contains no cook state, discovery index, metadata, receipt, or cleanup projection; recipe source data is read from D1 only for receipt-miss start/restart snapshot construction.
- [ ] Owner deletion requires the reserved short-lived deletion-intent bearer, commits a permanent `deleted` tombstone, removes session/receipt rows, application-OPEN sockets, and alarms, is idempotent, and returns 410 `owner_deleted` for every later otherwise-valid authenticated non-delete operation while preserving validation/auth precedence.
- [ ] Recipe edits never silently remap an active session; completion and abandonment remove resume state without social side effects.
- [ ] Web, REST, MCP, and legacy shared shopping add paths pass one restoration/concurrency matrix, including repaired unitless duplicates, database-enforced active identity uniqueness, quantity aggregation, rollback, monotonic sync timestamps, native-sync readback, and deterministic fresh-end ordering; existing non-add operations remain compatible.
- [x] SavedRecipe migration backfills existing cookbook-derived saved expectations once; subsequent save/unsave and cookbook membership changes are independent and private.
- [x] `/saved-recipes` and REST `/api/v1/saved-recipes` perform owner-scoped literal-substring SQL search with canonical UTC-text descending `(savedAt, recipeId)` keyset pagination, return at most 24 recipes, reject malformed/noncanonical cursors, use private no-store responses, and never materialize the full saved collection in Worker memory.
- [x] Idempotent `PUT`/`DELETE /api/v1/saved-recipes/:recipeId` mutations use existing `kitchen:write` authorization/idempotency, while `GET /api/v1/saved-recipes` uses `kitchen:read`; soft-deleted recipes are excluded and cascade deletion removes saves.
- [ ] Recipe tags enforce nullable course `main|side|appetizer|dessert`, ten normalized custom labels, per-recipe uniqueness, code-point/control-character validation, owner-only writes, deterministic output order, and no AI source or endpoint.
- [ ] My Recipes and global search apply course/tag predicates before their existing result limits; My Recipes rejects unsafe page values and never sends an unsafe SQLite offset.
- [ ] My Recipes/search treat repeated tag filters as AND, preserve `q`/course/tags through My Recipes pagination and current bounded-search filter links, and expose keyboard-accessible filter/reset and authoring controls.
- [ ] REST v1 contracts, OpenAPI, generated playground, and MCP recipe reads expose the same neutral course/tags metadata and optional `scale` contract without persisting scaled values; absent scale preserves current payloads and invalid scale errors match across adapters.
- [x] Existing import remains agent/API-only, current navigation remains reachable, and the task adds, removes, or reinterprets no Pebble-specific runtime/docs/fixture behavior.
- [ ] Numeric migration `0025_clem_feedback_product.sql` applies from empty and from `test/fixtures/clem-feedback-pre-feature.sql` atop migrations 0000-0024, preserves foreign keys, normalizes mixed savedAt encodings, fences membership insert/delete after the four-row backfill, reconciles its specified three unitless duplicates without quantity loss, matches Prisma plus documented raw indexes, and creates no cook table; exact product activation alone removes the verified fence.
- [ ] QA and the bootstrap PR create migration `v1_cook_session` through atomic `wrangler deploy`; the pre-product compatibility release makes the complete public protocol matrix, including owner DELETE, retryable against inert DO code. The product PR activates protocol v1 atomically with forward repair only; a workflow-only follow-up runs exact-version Clem candidate smoke at 0%, promotes to 100%, and permits rollback only between protocol-v1-capable versions.
- [ ] All changed code has 100% statement, branch, function, and line coverage; unit, Workers, Playwright, typecheck, build, and migration commands fail on warnings and pass cleanly in CI.
- [ ] Changed UI passes keyboard/accessibility checks and `visual-qa-dogfood` at mobile and desktop viewports with no overlap, truncation, unreachable controls, or open absurdity findings.
- [ ] QA migration/deploy, two-client smoke, REST/MCP shopping/save/tag/scaling smoke, and cleanup pass before merge; cleanup uses a reserved five-minute `account:write kitchen:read` intent credential, calls owner deletion before relational-user deletion, and proves zero cook rows/receipts/application-OPEN sockets/alarms plus the expected minimal deleted-owner tombstone.
- [ ] The reviewed bootstrap/product/canary-restoration PR chain merges in order with green CI; each automatic production workflow deploys its exact merge SHA, canonical health identifies it, production smoke passes, and disposable data is removed.
- [ ] 100% test coverage on all new code.
- [ ] All tests pass.
- [ ] No warnings.
- [ ] `visual-qa-dogfood` evidence is captured, its absurdity ledger is closed, and automated visual metrics pass.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code.
- All branches covered, including auth, malformed input, conflict, reconnect, retry, rollback, empty, boundary, and cleanup paths.
- Cloudflare-specific DO/D1/WebSocket behavior runs in the official Workers Vitest integration with Istanbul and `--max-workers=1 --no-isolate`.
- App services/routes/components run under the existing full 100% Istanbul gate; browser behavior runs in Playwright.
- Unit and Workers setups fail unexpected console/process warnings; every Playwright spec uses the shared browser warning/page-error fixture; a tested diagnostic-aware command wrapper fails actual typecheck, build, generated-contract, and Prisma/Wrangler migration warnings without false-positive matching ordinary output.

## TDD Requirements
**Strict TDD - no exceptions:**
1. **Tests first**: Write failing tests before implementation.
2. **Verify failure**: Run the focused tests and record the expected red failure.
3. **Minimal implementation**: Write only enough code to satisfy the tests.
4. **Verify pass**: Run focused tests, full app coverage, typecheck, and build with no warnings.
5. **Refactor**: Clean up while all gates remain green.
6. **Adapter requests**: Capture and assert outgoing HTTP/DO/SQL request shapes separately from response handling.

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

### ✅ Unit 0: Baseline And Source Freeze
**What**: Record clean branch/upstream state, plan/source hashes, Node/pnpm/Cloudflare versions, and baseline gates. Create the fixture with the exact foreign-key-safe reset order, including `UPDATE Recipe SET sourceRecipeId = NULL` before recipe deletion, and every literal value/FK frozen in planning; record raw-fixture SHA-256 and the migration-set SHA-256 generated by bytewise filename order with `filename NUL bytes NUL`; map every feedback row.
**Output**: Baseline logs, fixture/hash manifest, and feedback-to-unit map in the artifacts directory plus the committed seed fixture.
**Acceptance**: 7,226 existing tests pass at 100% app coverage; fixture clears seeded application rows and yields exactly five total memberships/three active duplicates; foreign-key check is empty; typecheck/build pass; `git status --porcelain` is empty after commit; every source row maps to a unit or explicit rejection test. Product migration rehearsal uses the current 0000-0024 numeric baseline.

### ✅ Unit 1.1a: Workers Test Lane - Tests
**What**: Add failing tests for `vitest.workers.config.ts`, `wrangler.workers-test.json`, exact Vitest `4.1.10`/Workers pool `0.18.6`, Istanbul 100% thresholds, serialized shared storage, package commands, and CI invocation. In `test/config/warning-policy.test.ts`, test a new diagnostic-aware `scripts/run-with-warning-policy.mjs` against representative Node/Vite/Wrangler warning forms plus benign output containing the word "warning"; require app/Workers Vitest hooks to fail unexpected `console.warn`, unowned `console.error`, and process warnings; require a new `e2e/fixtures.ts` to fail browser `warning`/`error` console events and `pageerror`; and require every Playwright spec/setup file that imports `test` or `expect` to use that fixture while type-only support imports remain from `@playwright/test`.
**Output**: Red Workers-lane, warning-policy, fixture-inventory, and workflow-contract evidence.
**Acceptance**: Focused tests fail only because the Workers lane and warning-enforcement infrastructure are absent.

### ✅ Unit 1.1b: Workers Test Lane - Implementation
**What**: Upgrade all Vitest packages to `4.1.10`; add `@cloudflare/vitest-pool-workers@0.18.6`, `vitest.workers.config.ts`, `vitest.workers.setup.ts`, `wrangler.workers-test.json`, `test:workers`/`test:workers:coverage`, and the mandatory CI job. Add the tested warning wrapper and route typecheck, build, generated-contract checks, and local/QA migration rehearsals through it in verification/CI. Replace `test/setup.ts`'s blanket act/SQLite suppression with fail-after-test warning capture: tests that intentionally exercise logging must own an exact spy, React tests repair their act boundary, and Node SQLite processes use the runtime's warning-disable flag so no warning is emitted. Add the shared Playwright fixture and mechanically switch every test-bearing existing spec/setup import to it.
**Output**: Executable official Workers-runtime lane and repo-wide zero-warning enforcement.
**Acceptance**: Injected sentinel warnings fail in every runner, benign text does not; `pnpm run test:workers`, app coverage, Playwright, typecheck, build, and migration rehearsals pass with no warning emitted or suppressed.

### ✅ Unit 1.1c: Workers Test Lane - Verification
**What**: Run both app and Workers coverage, the complete Playwright suite, wrapped typecheck/build/generated-contract/migration commands, and warning-sentinel self-tests; review config/CI isolation and prove no blanket suppression remains.
**Output**: Dual 100% coverage reports, zero-warning gate logs, and reviewer result.
**Acceptance**: New config/warning logic reaches 100%; the empty Workers lane passes; app remains 100%; every intentional sentinel fails for the expected diagnostic, every clean command passes, and fresh test-infrastructure review converges.

### ✅ Unit 1.2a: Namespace Bootstrap - Tests
**What**: Using the Unit 1.1 Workers lane, add failing config/runtime tests for class `CookSession`, binding `COOK_SESSIONS`, top-level/QA `v1_cook_session` `new_sqlite_classes`, environment types, SQLite storage, and the frozen public/internal probe paths, header, body, object name, success body, and two-run idempotence. Also cover every syntactically valid future public `/api/cook-sessions` method/path, including an upgrade request, and every recognized future internal request with `X-Spoonjoy-Cook-Protocol: 1`: after the frozen session/bearer scope and mutation/upgrade origin checks, each returns the exact HTTP 503 `cook_session_protocol_unavailable` envelope, `Retry-After: 1`, and `Cache-Control: private, no-store` without upgrade or storage mutation; malformed/unrecognized/bootstrap-disabled probe requests return 404.
**Output**: Red `test/config/cook-session-binding.test.ts` and Workers-lane `test/workers/cook-session-bootstrap.test.ts` evidence.
**Acceptance**: Config test and `pnpm run test:workers -- test/workers/cook-session-bootstrap.test.ts` fail only on absent namespace code/config.

### ✅ Unit 1.2b: Namespace Bootstrap - Implementation
**What**: Add the inert `workers/cook-session.ts` export and bootstrap/protocol-stub routing in `workers/app.ts` plus `wrangler.json` production/QA binding, `COOK_SESSION_BOOTSTRAP_MODE=1`, legacy migration, and `app/cloudflare-env.d.ts` types. The DO probe creates/reads/drops its private table and deletes all storage before returning the exact planning-contract body; recognized future protocol-v1 requests return only the frozen retryable response and never touch storage.
**Output**: One deployable, forward-compatible inert SQLite DO namespace.
**Acceptance**: Unit 1.2a tests pass and `pnpm run typecheck` plus `pnpm run build` are green.

### ✅ Unit 1.2c: Namespace Bootstrap - Verification
**What**: Cover every namespace/config branch and review storage/lifecycle correctness.
**Output**: Focused coverage and reviewer report.
**Acceptance**: Namespace code is 100% covered and a fresh Cloudflare review has no BLOCKER/MAJOR finding.

### ✅ Unit 1.3a: Bootstrap Deployment Mode - Tests
**What**: Add failing tests in `test/scripts/deploy-production-canary.test.ts`, `test/scripts/deployment-preflight.test.ts`, and `test/release-workflow-security.test.ts` for `.github/workflows/production-deploy.yml`'s three source-controlled phases: atomic bootstrap, atomic first-product activation, and protocol-v1-only gradual canary. Freeze exact-SHA/version/probe verification, no rollback to a pre-boundary/inert version, sanitized artifact output, and 0%/100% canary behavior only in the final phase.
**Output**: Red named deploy/workflow contract tests.
**Acceptance**: Focused tests fail only because lifecycle-aware deployment behavior is absent.

### ✅ Unit 1.3b: Bootstrap Deployment Mode - Implementation
**What**: Extend `scripts/deploy-production-canary.ts`, `.github/workflows/production-deploy.yml`, and `docs/deployment.md` with explicit source-controlled atomic-bootstrap, atomic-product-activation, and protocol-v1-canary branches, without a new orchestrator; commit the bootstrap branch as active in this PR.
**Output**: One reviewed lifecycle- and protocol-aware production deployment mode.
**Acceptance**: Focused deploy/workflow tests, typecheck, build, and full app coverage pass.

### ✅ Unit 1.3c: Bootstrap Deployment Mode - Verification
**What**: Cover every deployment decision/failure/artifact branch and obtain release/security review.
**Output**: 100% deploy-script coverage and reviewer report.
**Acceptance**: No secret reaches logs/artifacts; no invalid rollback is possible; review converges.

### ✅ Unit 1.4: Bootstrap QA
**What**: Deploy the inert namespace to QA; call `POST /.well-known/spoonjoy-cook-session-bootstrap` twice; assert `{ok:true,storage:'sqlite',workerVersionId:<deployed version>,residue:0}` and matching version header; then confirm no cook table or probe storage remains.
**Output**: Sanitized QA deployment, smoke, and cleanup logs.
**Acceptance**: QA has `v1_cook_session`, the inert DO responds, and no disposable D1/DO row remains.

### ✅ Unit 1.5: Bootstrap PR And Merge

**Integration scope expansion (2026-07-20):** Merging current `main` introduced React 19 streaming bootstrap scripts under enforced CSP. The bootstrap PR therefore also carries the focused `renderToReadableStream` nonce repair, its entry-server regression coverage, cookie-only Playwright state isolation, and bounded bootstrap-probe abuse controls required to make the exact merged candidate pass CSP-clean E2E and QA. This is reviewed integration/release scope only; it does not activate cook-session product behavior.
**What**: On `worker/clem-feedback-e2e`, run final gates and open a PR to `main`. Enforce the planning-contract allowlist: focused task docs/artifacts, frozen `test/fixtures/clem-feedback-pre-feature.sql`, package/lockfile, Wrangler/env types, Worker app/new inert class, Workers-test config/tests, CI/production workflow, and existing deploy script/tests/docs only; resolve review/CI and merge.
**Output**: Bootstrap PR URL and exact merge SHA.
**Acceptance**: Required reviews/CI are green and the merge SHA contains only docs plus lifecycle/test/deploy bootstrap scope.

**Completed**: PR #283 merged as `0a473a6b55a9cb0edaf8867b29d2b473c2cf15db`. Forward-only probe and CI repairs shipped through PR #285 (`9abbd3e81be986b2bc79d02f1c7b51a90cc07b42`) and PR #286 (`d50b8ff5730c68597f6b80077df799927a56e3bf`).

### ✅ Unit 1.6: Production Lifecycle Boundary
**What**: Follow the automatic atomic production deploy, verify exact merge SHA/version, call the same frozen bootstrap probe twice, assert matching version/body and zero residue, and record the no-pre-boundary-rollback rule.
**Output**: Sanitized production deployment/version/health/cleanup evidence.
**Acceptance**: Production has the SQLite namespace, canonical health identifies the bootstrap merge, zero residue remains, and failure recovery is forward-only across this boundary.

**Completed**: Main CI run 29829965212 passed. Production run 29831028729 promoted deployment `aef2ca40-d9f0-4dbf-8602-bd45068b9a2b` at 100% Worker version `3a7cdc3b-0097-4da3-842a-d39f104d4ff0`, tagged to `d50b8ff5730c68597f6b80077df799927a56e3bf`. Canonical health and two independent strict probes matched the version and reported residue 0; production D1 contained zero cook tables.

### ✅ Unit 1.7: Product Branch Handoff
**What**: Create `/Users/arimendelow/Projects/spoonjoy-v2-clem-feedback-product` on `worker/clem-feedback-product` from the verified bootstrap merge with future base `main`, and record merge/deploy/version/ancestry/branch/worktree/task paths in `bootstrap-handoff.md` without changing runtime code.
**Output**: Initial handoff manifest and clean local product branch at the bootstrap merge; the audited-doc baseline and first push are owned by Unit 1.7R.
**Acceptance**: Merge-base succeeds, task docs and the frozen fixture remain reachable, `git status --porcelain` is empty, and the initial local product branch equals the verified bootstrap merge.

**Completed**: Created the requested worktree/branch from exact verified merge `d50b8ff5730c68597f6b80077df799927a56e3bf`; `bootstrap-handoff.md` records release, ancestry, and repair-chain evidence.

### ✅ Unit 1.7R: Audited Baseline Refresh
**What**: Preserve the original Unit 0 evidence as historical, then create `unit-0r-audited-baseline.md` with immutable authority hashes for the accepted source, two normative contracts, feedback map, raw fixture, D1 fixture derivative, and numeric migration set 0000-0024. At exact source `d50b8ff5730c68597f6b80077df799927a56e3bf`, enumerate every tracked Pebble-text hit outside the current task-evidence directory; freeze each path/blob/SHA-256 plus the no-new-hit command as the product/docs/fixture preservation manifest before product work. Record planning/doing hashes separately as point-in-time execution-document hashes at the Unit 1.7R commit; later progress/status edits are expected and do not invalidate the immutable authority manifest. Replay raw migrations plus the raw fixture in fresh Node SQLite. Because Wrangler D1 rejects explicit SQL `BEGIN`/`COMMIT`, derive its fixture payload by deleting exactly the lines `BEGIN IMMEDIATE;` and `COMMIT;`, record both fixture hashes and the deterministic transform command, and replay migrations plus that payload in isolated Wrangler D1 state. Assert the same literal counts/FKs and freeze 0025 as the product migration number.
**Output**: Superseding authority manifest, clean replay logs, and the first clean pushed product-branch baseline; original Unit 0 files remain unchanged evidence.
**Acceptance**: Immutable authority hashes match the reviewed bytes and remain stable; point-in-time planning/doing hashes identify the exact Unit 1.7R commit without pretending later execution updates are immutable. The migration-set hash includes `0024_remove_legacy_demo_identities.sql`, the D1 derivative differs only by the two forbidden transaction-wrapper lines, both engines reproduce the fixture counts/zero FK errors, temporary persistence is removed, the reviewed docs/contracts are committed and pushed, and Unit 2 may not start without this checkpoint.

**Completed**: Replayed the frozen fixture and migrations in native SQLite and isolated Wrangler D1, froze the eight-path Pebble manifest, closed six cold-review rounds, and recorded immutable source/contract/fixture/migration hashes plus point-in-time execution-document hashes in `unit-0r-audited-baseline.md`.

### ✅ Unit 1.8a: Product Deployment Mode - Tests
**What**: On the product branch, change config/runtime/deploy contract tests to require no `COOK_SESSION_BOOTSTRAP_MODE`, public probe 404 with the private inert probe still covered, retained binding/migration, the source-controlled atomic-product-activation workflow branch, and explicit rejection of versions-upload/canary before the product smoke boundary.
**Output**: Red updated binding/bootstrap/deploy tests.
**Acceptance**: Focused tests fail only because the checked-in config/workflow still enables bootstrap deployment mode.

**Completed**: Added config/type/source, Node Worker, real-Workers, and deploy-contract regressions. The app lane has exactly four expected failures with 946 passing tests; the real-Workers lane has exactly two expected public-adapter failures with 11 private-probe/protocol tests passing. A harsh test review returned `CONVERGED`.

### ✅ Unit 1.8b: Product Deployment Mode - Implementation
**What**: Remove `COOK_SESSION_BOOTSTRAP_MODE`, retain private probe compatibility through Unit 7.1, and select the workflow/script's atomic-product-activation branch; do not change the Durable Object binding or migration and do not restore canaries yet.
**Output**: Atomic product-activation configuration with an unreachable public bootstrap probe and preserved namespace.
**Acceptance**: Unit 1.8a tests, Workers/app coverage, typecheck, and build pass; no production/QA config enables the public probe.

**Completed**: Removed the public bootstrap flag from production, QA, real-Workers config, and the environment type; deleted the public adapter and retained an explicit no-work 404 guard; selected source-controlled `atomic-product-activation`; and updated the lifecycle runbook. All 8,111 app tests and 13 Workers tests pass at exact 100% coverage, app/scripts typechecks and production build are warning-clean, and harsh Cloudflare/release review returned `CONVERGED`.

### ✅ Unit 1.8c: Product Deployment Mode - Verification
**What**: Run all three deployment-phase contract tests and a fresh release/Cloudflare review, then finalize `bootstrap-handoff.md` with the product-activation-mode commit and pushed head.
**Output**: Verified handoff manifest and clean pushed product branch.
**Acceptance**: Review converges, `git status --porcelain` is empty, branch is pushed, and Unit 1.9 starts only from this checkpoint.

**Completed**: Replayed every deployment-phase contract plus full coverage/typecheck/build gates, obtained converged Cloudflare/release review, pushed exact implementation commit `1e2aeea6debea36e386b8ca95ad01f1e9089b2cb`, and froze its tree/remote/invariant evidence in `bootstrap-handoff.md`.

### ✅ Unit 1.9a: Pre-Product Compatibility - Tests
**What**: On a fresh `worker/clem-feedback-pre-product-compat` branch/worktree from the verified main SHA, add failing exact-source tests for the six runtime add entrypoints plus seed named in `product-data-contract.md`. Require active-first then deterministic tombstone lookup, old-full-index tombstone restoration, post-0025 active-survivor selection, one uniqueness-conflict reread, exact idempotent set-not-add seed reruns, unchanged success/client shapes, deterministic same-recipe identity coalescing, finite product/sum failure, and failure-injected all-or-nothing web, REST, and shared agent/MCP recipe bulk adds. Add failing Worker tests that recognize `DELETE /api/cook-sessions`, enforce the reserved deletion-intent bearer/Origin boundary, and return retryable 503 without DO mutation. Add the exact per-surface `product_activation_pending` mappings and headers, including typed MCP `-32001`, OpenAPI, and rollback tests for every named adapter. Exercise the exact bounded cause-chain recognizer with near-miss tokens and real Prisma local-SQLite plus Wrangler D1 trigger errors, then run the migration-gap harness against active-plus-tombstone and tombstone-only identities.
**Output**: Red shopping/owner-route compatibility and exact-source provenance tests with no schema/migration change.
**Acceptance**: Tests fail only on incomplete writer selectors/seed behavior, absent web bulk transactionality, absent owner DELETE classification, and absent exact temporary cutover mappings.

**Completed**: Commit `a450e383b05a4173851c8475d066680d1f4a6212` froze the exact shopping, seed, saved-cutover, adapter, rollback, and owner-delete compatibility contracts on the isolated compatibility branch. The red failures were confined to the deliberately absent compatibility implementation; no schema or migration changed.

### ✅ Unit 1.9b: Pre-Product Compatibility - Implementation
**What**: Add the smallest shared compatibility selector/update/coalescing builder and route all six runtime writers through it, preserving success outputs; make the web, REST, and shared agent/MCP recipe bulk paths each one finite, coalesced, all-or-nothing array transaction and retry a recognized uniqueness conflict by rebuilding the whole transaction once. Keep seed on a separate selector-backed provisioner that sets configured values exactly and remains idempotent. Map only the bounded recognizer's `saved_recipe_cutover_pending` result to the four frozen web/REST/legacy/MCP responses and document REST in OpenAPI. Add the typed transient JSON-RPC path without changing ordinary invalid-parameter handling. In `workers/app.ts`, add only the owner DELETE classification and reserved-resource/account-scope/Origin checks needed to return the inert retryable response. Do not change Prisma schema, migrations, DO storage, final raw upsert, or unrelated shopping operations.
**Output**: An old/new-schema-safe compatibility Worker that also closes the owner-delete skew gap.
**Acceptance**: Focused tests, repeated seed idempotence, bulk failure rollback, full app/Workers coverage, typecheck, build, and exact changed-file allowlist pass.

**Completed**: The compatibility branch routed every named writer through active-first/tombstone-aware selection, made each recipe bulk adapter finite/coalesced/transactional with one whole-transaction retry, preserved exact client success shapes, added the bounded cutover mappings, and classified owner deletion without mutating the inert DO. Exact head `3f79172ff802305ff8180af536a78ecbf5d39712` passed focused and full app/Workers 100% coverage, warning-gated typecheck/build, seed idempotence, migration-gap, changed-file, and harsh review gates.

### ✅ Unit 1.9c: Pre-Product Compatibility PR And Production
**What**: Review and deploy the exact compatibility candidate to QA on schema 0024. Verify every shopping writer, authenticated owner DELETE retryable response, exact source SHA/Worker version/canonical health, two bootstrap probes, zero pending migration 0025, and zero residue; freeze those identities in `bootstrap-handoff.md`. Open, merge, and follow the compatibility PR's automatic atomic-bootstrap production deployment, then verify the same behavior plus exact merge SHA/version/health and probes. Merge that main commit into `worker/clem-feedback-product` without reverting product task docs and record both environments' exact active compatibility identities.
**Output**: QA and production compatibility source/version/health identities plus product-branch ancestry evidence.
**Acceptance**: The exact compatibility Worker is 100% active in QA and production on schema 0024 before migration 0025 can run anywhere; product branch descends from it; old Worker/new DO owner deletion can no longer return 404; no schema/data change occurred; QA/production residue is zero.

**Completed**: QA ran the exhaustive six-writer/owner-delete matrix at source `3f79172ff802305ff8180af536a78ecbf5d39712`, tree `6dc720e8d4af087277c73240d0336d522e1c5aaa`, Worker version `aa058075-115e-4cb9-aaec-af49027eb314`, schema 0024, and zero residue. PR #291 merged as `60c46277c01fc1065901a6fba24b9ff8cb15129d`; PR #294 repaired only post-promotion probe convergence and production then promoted exact source `40b8f4c85f85f0fa1f807e150013bc7b9675eff5` as Worker version `144bd85d-d0c8-41ea-ae3a-9abf0dbcb6aa`. Canonical health, two strict probes, targeted owner-delete classification, browser writer smoke, D1 migration inventory, and broad zero-residue cleanup passed. Product merge `8ec4cb1dad1ce67c24c446502b986b29defee991` preserves atomic-product mode and descends from both production commits; 664 focused app/release tests, 30 real-Workers tests, warning-gated typecheck, and build pass on the integrated tree.

### ✅ Unit 2.1a: Product Models - Tests
**What**: From Unit 1.9c, add failing Prisma/schema tests for every exact `product-data-contract.md` SavedRecipe, RecipeTag, nullable Recipe.course, relation, index, and shopping `@@unique` removal; explicitly assert no Prisma/D1 cook model exists. Treat the already-deployed active-row selectors as compatibility regressions. Before generating the new client, add byte-shape tests around legacy agent/API `import_recipe_from_url` proving both persisted and dry-run outputs project to their pre-feature contracts, MCP continues to exclude import, all three named docs describe the boundary correctly, and no current/future schema field can leak.
**Output**: Red `test/models/clem-feedback-schema.test.ts` evidence.
**Acceptance**: Focused tests fail only because the product models/column and explicit legacy import projections are absent; the Unit 1.9 active-row selector regressions remain green.

**Completed**: Commit `9e83637cf21c967cdda8d98fa53223ad00e12c81` added the exact schema, persisted/dry-run projection, documentation-boundary, MCP exclusion, and compatibility-selector test matrix. The focused red run had 104 passing tests and seven expected failures limited to the absent product models/index removal, explicit import projections, and guide language; no implementation, generated client, migration, or D1 state changed.

### ✅ Unit 2.1b: Product Models - Implementation
**What**: First replace `import_recipe_from_url` raw row pass-through in `app/lib/spoonjoy-api.server.ts` with explicit pre-feature persisted and dry-run projections and correct the three named docs without adding an import UI/MCP tool. Then remove only the generated shopping compound-unique selector/constraint from Prisma, implement exact SavedRecipe, RecipeTag, and Recipe.course models, regenerate the client, and update both cleanup paths (`test/helpers/cleanup.ts` and `test/setup.ts`). Preserve the Unit 1.9 active-first compatibility service and its find-first selectors; Unit 3.1 later replaces only that transitional runtime service with final atomic raw SQL.
**Output**: Prisma-modeled product schema aligned with tombstone-preserving shopping identity and generated types.
**Acceptance**: Model/seed/interim-shopping tests, legacy import byte-shape regressions, Prisma generation/push, typecheck, and build pass; no source references the removed generated `shoppingListId_unitId_ingredientRefId` unique-selector property, the Unit 1.9 find-first compatibility service remains green, no D1 cook model exists, and adding `Recipe.course` does not alter import output.

**Completed**: Reviewer repair commit `b5802158` strengthened exact model/D1 absence, recursive serialized legacy-import, coherent docs/render, and complete compatibility regressions. Implementation `3ba273e4` added the exact Prisma models/relations/indexes, removed only the generated full shopping unique, updated both cleanup paths, and recursively allowlisted the persisted/dry-run pre-feature import shapes without adding MCP or UI import. Prisma generate/push, 46 strengthened tests, 168 Unit 1.9 regressions, warning-gated typecheck/build, and all 8,283 app tests at exact 100% coverage pass.

### ✅ Unit 2.1c: Product Models - Verification
**What**: Cover model helpers/cleanup branches and review ownership/FK/privacy boundaries.
**Output**: Coverage and data-review evidence.
**Acceptance**: New helper code is 100% covered and review converges.

**Completed**: A fresh cold data/privacy review at exact implementation `3ba273e4` reproduced Prisma format/generate and disposable database push, 46 focused tests, 168 complete compatibility regressions, warning-clean typecheck/build, and all 8,283 app tests at exact 100% coverage. Review converged with no ownership, FK, privacy, cleanup, import-boundary, selector, or compatibility finding.

### ✅ Unit 2.2a: Product Schema And SavedRecipe Backfill Migration - Tests
**What**: Add failing migration assertions for empty/fixture application from numeric migrations 0000-0024, every frozen SavedRecipe/RecipeTag/Recipe.course detail, explicit absence of any cook table, exactly four saves, canonical UTC-text user-a/recipe-r1 Jan 3 savedAt, authoritative `RecipeInCookbook.createdAt` with a synthetic differing `updatedAt`, exact integer/real-half-rounding/five-text-grammar normalization, min/max range boundaries, negative-in-range values, and invalid/non-finite/out-of-range abort. Include leap-day acceptance; impossible month/day rejection; `24:00:00`, leap-second, and minute overflow rejection; valid `+14:00|-14:00`; and rejection of offsets beyond `14:00`. Cover direct raw invalid canonical-width savedAt rejection through the full clock/calendar/digit/non-null strftime CHECK, exact two cutover triggers, trigger-blocked insert/delete/cascade with rollback, FK integrity, and saved-row soft/hard recipe deletion behavior; do not assert shopping repair yet.
**Output**: Red product-schema and saved-backfill sections of `test/scripts/migration-0025-clem-feedback-product.test.ts`.
**Acceptance**: Focused migration tests fail only because migration 0025 and its required schema/backfill behavior are absent.

**Completed**: Commit `544358d0` freezes the exact numeric baseline and sole target migration, complete additive DDL/projection and existing-row preservation, four-row fixture backfill, every numeric/text timestamp boundary and invalid rollback path, canonical raw SavedRecipe writes, exact membership fences, FK/unique/cascade semantics, and post-fence save independence without asserting Unit 2.3 shopping repair. The executable red has 44 intended absent-migration failures plus one passing NaN driver-limitation fact; six harsh review rounds converged.

### ✅ Unit 2.2b: Product Schema And SavedRecipe Backfill Migration - Implementation
**What**: Create the exact frozen SavedRecipe/course/tag schema, canonical savedAt raw check/indexes, mixed-encoding deterministic SavedRecipe backfill, exact membership insert/delete cutover triggers, and no cook schema in `migrations/0025_clem_feedback_product.sql`.
**Output**: Additive new tables/column and one-time saved-state backfill.
**Acceptance**: Every schema, absence-of-progress-state, index, constraint, trigger/fence, FK, timestamp-normalization, and saved-backfill assertion passes from both fixtures with exact counts and preserved FKs.

**Completed**: Commit `bb8e0bb0` adds the exact course/tag/save schema, fail-closed mixed-encoding normalization and distinct backfill, and two membership fences without shopping repair or cook state. All 45 focused and 121 migration tests, warning-gated typecheck/build, and all 8,328 app tests at exact 100% coverage pass; fresh cold data/migration review converged.

### ✅ Unit 2.2c: Product Schema And SavedRecipe Backfill Migration - Verification
**What**: Rehearse the current schema/backfill-only 0025 under a newly created temporary Node SQLite database and a newly isolated local Wrangler D1 state directory, then delete both and review prior-Worker compatibility; do not reuse this migration state in Unit 2.3.
**Output**: Rehearsal and reviewer evidence.
**Acceptance**: Both engines agree, no existing table contract breaks, and review converges.

**Completed**: Fresh file-backed Node SQLite and isolated Wrangler local D1 states each replayed exact 0000-0024, the frozen fixture, and committed 0025; both produced identical four-save/tag/course/membership/shopping/fence/cook-table/FK results and both temporary roots were deleted with nonexistence proved. The full 168-test prior-Worker compatibility matrix passed and fresh verification review converged without claiming Unit 2.3 shopping behavior.

### ✅ Unit 2.3a: Shopping Repair Migration - Tests
**What**: Add failing migration tests for every `product-data-contract.md` reconciliation rule, the static one-row `_Migration0025Clock` lifecycle and identical captured clock across repaired rows, owner-specific account-global native-sync high-water including a newer non-shopping resource, logical checked normalization, finite quantity/source/sum overflow failure, SQLite-BINARY survivor order, collision-free null/unit discriminator, exact partial expression index `(shoppingListId,ingredientRefId,COALESCE('u:' || unitId,'n:'))`, matching Unit 3.1 conflict target, and setup parity differing only by setup's `IF NOT EXISTS`. Extend the Unit 1.9 harness to execute every exact active compatibility writer against post-0025 active-plus-tombstone and tombstone-only identities.
**Output**: Red shopping section of the migration 0025 test.
**Acceptance**: Tests fail because repair/index SQL is absent.

**Completed**: Commit `ee9c864f` freezes the exact migration clock/use/drop, repair, per-family owner high-water/isolation/validation, finite quantity and overflow, BINARY survivor, logical checked, metadata, tombstone, discriminator, index/setup/conflict-target, and real-D1 six-writer compatibility contracts. The final red is 47 pass/37 intentional migration failures plus 12 pass/two intentional Workers failures, all confined to the absent repair/active-index behavior; typecheck is warning-clean and three cold-review rounds converged.

### ✅ Unit 2.3b: Shopping Repair Migration - Implementation
**What**: Add the exact migration-clock create/capture/use/drop, repair, legacy-index drop, and non-`IF NOT EXISTS` partial expression index from `product-data-contract.md` to migration 0025. In `test/setup.ts` immediately after shopping-row cleanup, add the same index name/columns/expression/predicate via Prisma raw execution with setup-only `IF NOT EXISTS`.
**Output**: One database-enforced active shopping identity per list/ingredient/unit.
**Acceptance**: All repair/index fixtures pass and the exact Unit 1.9 production compatibility Worker remains correct during the migration-before-product-promotion gap.

**Completed**: Commit `7df3662f` implements the frozen migration clock, deterministic active-row reconciliation, owner-global high-water validation, legacy-index replacement, and setup parity. It also removes Prisma's ignored D1 transaction facade from REST manual-item hydration, makes `prisma:warn` on `console.info` a centrally enforced failure, and preserves idempotent replay without a post-commit read. The 84 focused migration cases, 318 migration/writer cases, 57 warning-policy cases, 14 real-D1 cases, exact 100% app/Workers coverage, typecheck, build, and two-stage cold review all pass; full evidence is in `unit-2.3b-verification.md`.

### ✅ Unit 2.3c: Shopping Repair Migration - Verification
**What**: Create fresh temporary Node SQLite and isolated local Wrangler D1 state after Unit 2.3b, apply complete final 0025 from migrations 0000-0024 plus fixture, run duplicate/rollback-failure checks, run apply/list twice in that fresh state, review data, then delete both states.
**Output**: Shopping migration verification and review evidence.
**Acceptance**: Migration is applied once, second apply is a no-op, no data is lost, the exact compatibility source passes post-migration, and review converges.

**Completed**: Exact source `9c02616f` and migration SHA-256 `151009d5410997365ec56c249a50c75b7aeecadd0841b677f1b0bd7a9ab2c6e6` passed fresh file-backed SQLite and isolated Wrangler D1 replays. Both repaired the frozen duplicates identically; a forced clock collision rolled back and remained pending; Wrangler applied 0025 once and reported no pending migration on second apply/list; active-only uniqueness, tombstone coexistence, product counts, fences, and FK integrity passed. The complete compatibility source passed 169/169, 41 temporary entries and the harness were deleted with no residue, and cold review converged. Full evidence is in `unit-2.3c-verification.md`.

### ✅ Unit 2.4a: Reviewed Migration Gate - Tests
**What**: Add failing deploy-script tests for D1 recovery bookmark; acceptance of the exact reviewed migration-clock create/insert/reference/drop, legacy-index drop, 0025 statements, and two cutover triggers; rejection of every unrelated DROP/DML/trigger/index form; duplicate/backfill preflight; no-cook-table verification; trigger-closed post-apply state; and one shared QA/production unlock helper. Initial activation requires exact compatibility source/version, exactly two triggers, and only that the target descend from compatibility; it must accept an indirectly descended pre-merge QA candidate. Same-target reconciliation preserves the target's historical `baseSourceSha` without adding an ancestry edge. Ordinary forward repair reserves literal `target.baseSourceSha == predecessor.lineageParentSourceSha`, requires the frozen environment-specific predecessor binding, atomic-product mode and protocol-boundary ancestry on canonical active/target sources, the target first-parented by the canonical production predecessor, and only zero/one/two named triggers. Test production's exact-source-only rule and QA's narrowly allowed same-build predecessor alias with byte-identical tree and Worker/DO bundles, including rejection of any one-field mismatch and the required QA rebinding after each production merge. The post-restoration case also requires literal base/lineage equality and freezes runtime floor, original failed restoration head, and latest lineage parent; first repair parents the failed restoration, each pre-activation failed merged repair permits only a next target first-parented by that latest failed repair while production stays on the floor, and activation switches later failures to ordinary repair. Require dual ancestry, restored atomic-product mode, removed workflow delta, zero triggers, bidirectional skew, and environment-specific QA/production predecessor bindings. After exact target 100% identity, or on target-already-active retry, execute both `DROP TRIGGER IF EXISTS` statements and require zero-row readback. Cover lost response, partial prior unlock, wrong source/version, unexpected inventory, failed activation, failed-health active target, post-unlock smoke repair, a multi-attempt post-restoration repair chain, and rejection of arbitrary descendants/rollback. Freeze and test every schema-version-1 cutover artifact key/enum/phase transition from `product-data-contract.md`, including the complete source/bundle/predecessor records, strict success/failure validation, and ambiguous-response reconciliation in QA evidence and `production-release.json`.
**Output**: Red migration-gate tests.
**Acceptance**: Tests fail because the existing additive gate rejects the reviewed 0025 forms and lacks recovery checks.

**Completed**: Commit `cc24794e` freezes the exact reviewed migration/cutover contract, all schema-v1 evidence transitions, exact historical and graph-derived runtime manifests, immutable protocol-boundary topology, digest-bound receipt reuse, and executable historical/product skew matrices. Typecheck, seven exact-source controls, 16-source history audit, and diff hygiene pass; the full gate is intentionally 8 green/482 RED only at the nine absent Unit 2.4b exports, while the existing deployment suite remains 469 green/14 integration RED. Twenty adversarial review rounds converged. Full evidence is in `unit-2.4a-red.md`.

### ✅ Unit 2.4b: Reviewed Migration Gate - Implementation
**What**: Extend the existing migration gate for the deterministic 0025 forms in both QA and production, including the one exact reviewed legacy-index drop, two exact fence triggers, recovery bookmark, preflight, no-cook-table assertion, the four machine-distinguished cutover transitions, strict environment-specific predecessor bindings and repeatable post-restoration lineage chain, plus the idempotent exact-target post-activation unlock/readback helper. Update `docs/deployment.md` in this unit: replace its blanket additive-only prohibition with the exact reviewed-maintenance allowlist, compatibility/fence/product sequence, forward-only recovery, QA same-build alias proof/rebinding, repeatable repair-chain rules, and statement-hash checks while retaining rejection of every unreviewed destructive migration. Use the same source-controlled helper in Unit 9.4, Unit 9.6, and every forward repair from Units 9.4-9.7 and 9.10.
**Output**: Narrowly safe automatic product-migration path and matching operator runbook.
**Acceptance**: Gate tests pass, unrelated destructive SQL remains rejected, and script typecheck/build are green.

**Completed**: Commit `4d8379f2` implements the shared QA/production cutover state machine, exact reviewed-SQL gate, recovery bookmark continuity, runtime and predecessor attestation, idempotent same-target reconciliation/unlock, strict durable artifacts, and production adapter. GitHub continuity uses independently validated immutable per-run-attempt state artifacts, bounded owner provenance checks, exact artifact-ID restore, and bookmark-preserving writes. Full evidence is in `unit-2.4c-verification.md`.

### ✅ Unit 2.4c: Reviewed Migration Gate - Verification
**What**: Reach 100% gate/parser coverage and obtain migration/release/security review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every allow/reject/failure branch is covered and review converges.

**Completed**: The stable full gate passed 383 files and 9,052 tests with exact 100% statement, branch, function, and line coverage and zero warning output. App/script typechecks, production build, source-controlled deployment preflight, ShellCheck, generated-contract stability, and diff hygiene passed. Two independent adversarial reviewers converged after cross-run crash, rerun, immutable publication, exact-ID restore, owner-provenance, and lookalike-artifact cases were closed. See `unit-2.4c-verification.md`.

### ✅ Unit 3.1a: Atomic Shopping Service - Tests
**What**: Add failing captured-SQL tests that replace the Unit 1.9 transitional runtime lookup/retry helper with one statement using exact conflict target `(shoppingListId,ingredientRefId,COALESCE('u:' || unitId,'n:')) WHERE deletedAt IS NULL`. Cover every finite/null quantity/category/icon merge and non-finite/overflow atomic failure; logical checked handling; active unchecked/checked/deleted ID rule; fresh end including empty-list index 0; null/empty/arbitrary unit identity; concurrency; deterministic bulk coalescing; exact mixed integer/real/Z/offset/`CURRENT_TIMESTAMP` time normalization; the exact owner account-global high-water across User, active Recipe, Cookbook, NativeSyncTombstone, ShoppingList, and all active/deleted ShoppingListItem timestamps; a newer example from each non-shopping family; invalid/overflow abort; canonical output; and strict +1ms cursor advance for inserts whose new ID sorts below the prior tombstone or whose account cursor came from a newer non-shopping entry. Retain web/REST/shared-agent bulk rollback and keep seed outside this service.
**Output**: Red `test/lib/shopping-list-mutations.server.test.ts` with captured SQL/bindings.
**Acceptance**: Focused tests fail because the deployed transitional service still performs read/update/retry and restores a tombstoned ID instead of using the final atomic partial-index statement.
**Completed**: Commit `2ff6f338` freezes 92 focused cases across exact SQL/bindings, every merge/identity/clock boundary, real independent-connection concurrency, canonical local/D1 adapter output, result cardinality, authoritative created counts, and no retry. The 31 existing helper cases remain green; 61 cases are intentionally red only because the two final atomic exports do not exist. Warning-gated typecheck and diff check pass, and four harsh review rounds converged.

### ✅ Unit 3.1b: Atomic Shopping Service - Implementation
**What**: Replace the Unit 1.9 transitional runtime implementation in `app/lib/shopping-list-mutations.server.ts` with one bound SQLite `INSERT ... ON CONFLICT (shoppingListId,ingredientRefId,COALESCE('u:' || unitId,'n:')) WHERE deletedAt IS NULL DO UPDATE ... RETURNING` statement exactly matching the migrated expression index and product contract's owner account-global native-sync high-water, without schema detection or application retry. Preserve adapter outputs and each existing bulk transaction boundary; leave the seed-specific provisioner unchanged.
**Output**: One database-linearized add/restore function.
**Acceptance**: Service tests pass under local SQLite and the D1-compatible adapter; typecheck/build pass.
**Completed**: Commit `f22f3bcd` replaces every deployed manual/recipe writer with one database-linearized partial-index upsert, preserves local/D1 transaction boundaries, isolates seed compatibility, and passes the exact local plus real-D1 matrices, typechecks, and production build.

### ✅ Unit 3.1c: Atomic Shopping Service - Verification
**What**: Reach 100% service coverage and obtain SQL/concurrency review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every quantity/state/conflict/error branch is covered and review converges.
**Completed**: The final 383-file/9,168-test app gate and 44-test Workers gate are exact 100% with zero warnings. Fresh review converged after real-D1 CTE compatibility, strict decoder, seed ownership, meaningful metadata assertions, and non-add interleaving findings were closed. See `unit-3.1c-verification.md`.

### ✅ Unit 3.2: Web And REST Shopping Verification
**What**: Run the Unit 1.9 manual/recipe web and REST adapter contracts against the final Unit 3.1 service, including idempotency, exact outgoing inputs, fresh ordering, rollback, and byte-shape-compatible check/delete/clear responses. This is a verification-only unit; any defect receives a failing regression in its owning Unit 3.1 implementation before repair.
**Output**: Green web/REST matrix, full coverage, and API review evidence.
**Acceptance**: Every web/REST adapter/auth/idempotency/rollback branch stays green, both web/REST recipe bulk paths prove zero partial writes, non-add contracts are unchanged, and review converges.
**Completed**: The focused web/REST matrix passes 88/88, the full app and Workers gates remain exact 100%, and a fresh API reviewer converged with no findings across transaction boundaries, rollback, auth/idempotency, response envelopes, ordering, and unchanged non-add behavior. See `unit-3.2-verification.md`.

### ✅ Unit 3.3: MCP, Legacy, And Native Sync Shopping Verification
**What**: Run the Unit 1.9 `addShoppingListItemTool`/`addRecipeToShoppingListTool` contracts and native-sync readback against the final Unit 3.1 service for shared additions, ordering, monotonic timestamps, tombstones, and explicit absence of web/MCP exactly-once claims. This is verification-only; defects return to Unit 3.1 with a failing regression.
**Output**: Green agent/native matrix, full coverage, and API/sync review evidence.
**Acceptance**: All surfaces pass one state matrix, check/remove/native serialization remain unchanged, and review converges.
**Completed**: The focused MCP/native matrix passes 86/86 and the real Workerd D1 cutover matrix passes 14/14. Full exact-coverage gates remain green, and a fresh reviewer converged on bulk atomicity, account-global timestamps, tombstone/readback compatibility, unchanged check/remove serialization, and no exactly-once overclaim. See `unit-3.3-verification.md`.

### ✅ Unit 4.1a: Neutral Recipe Metadata - Tests
**What**: Add failing tests for top-level `course`/`tags` on read-specific wrappers around `recipeDetail`, `formatRecipe`, and `formatRecipeSummary`, actual MCP `get_recipe`/`search_recipes`, and REST recipe list/detail, with no personalized save state. Require new OpenAPI `RecipeReadSummary`/`RecipeReadDetail` schemas only on REST recipe GETs while existing `RecipeSummary`/`RecipeDetail` remain on cookbook/native/mutation schemas. Freeze generic REST `/api/v1/search` and MCP `search_spoonjoy` on their existing `SearchResult` shape: recipe results add only `metadata.course`/`metadata.tags`, while non-recipe metadata is byte-compatible. Add real `SearchDocument` recipe metadata and freshness tests over the exact active-recipe population, fixed Recipe `{recipeId,course}` rows, and fixed RecipeTag `{id,recipeId,label,normalizedLabel,createdAt,updatedAt}` rows, including same-timestamp course/label-only replacements. Add byte-shape regressions for native sync; REST recipe/step/ingredient/output-use mutations and recovery; MCP create/update; legacy agent/API import persisted and dry-run outputs; explicit MCP import exclusion; cookbook summaries; generated examples; and all three legacy import docs.
**Output**: Red metadata contract tests.
**Acceptance**: Read-surface/search/OpenAPI tests fail because isolated course/tags projection is absent, while every named non-read consumer retains its pre-feature byte shape.
**Completed**: Commit `14fd8f0f` freezes the exact read/search/OpenAPI/generated/docs contract with 29 intentional feature failures and 204 passing compatibility tests across 13 files. The mutation/recovery/native/cookbook/import preservation matrix passed 95/95 before the deliberate public-read upgrade, focused preservation passed 8/8 afterward, typecheck remained warning-clean, and the fourth fresh adversarial review converged with no findings. See `unit-4.1a-red.md`.

### ✅ Unit 4.1b: Neutral Recipe Metadata - Implementation
**What**: Add read-specific metadata wrappers without changing the base serializer output, and wire only REST recipe list/detail plus MCP `get_recipe`/`search_recipes`; update `app/lib/search.server.ts` recipe documents/freshness so generic REST search and MCP `search_spoonjoy` receive persisted course/tags inside existing recipe-result metadata only. Over the exact active-recipe document population, fingerprint fixed-key Recipe `{recipeId,course}` rows by recipe ID and RecipeTag `{id,recipeId,label,normalizedLabel,createdAt,updatedAt}` rows by recipeId/normalizedLabel/id with lowercase SHA-256 and canonical ISO timestamps; same-timestamp course/tag-label substitutions must change freshness. Add OpenAPI `RecipeReadSummary`/`RecipeReadDetail` for REST recipe list/detail GETs and extend only the recipe branch of generic `SearchResult.metadata`; keep existing `RecipeSummary`/`RecipeDetail` on native, cookbook, import, and mutation schemas/examples. Regenerate the playground and update developer docs. Keep non-recipe search results, native sync, every named REST/MCP mutation or recovery response, and cookbook summaries byte-compatible.
**Output**: Neutral course/tag read parity.
**Acceptance**: Focused metadata/API/MCP/SearchDocument/freshness/OpenAPI tests and every non-read byte-shape regression pass; two consecutive playground generations leave no git diff.
**Completed**: Final implementation `50413dfd` adds read-only REST/MCP projections, active-population metadata hashes alongside all-row freshness signals, exact code-unit tag ordering, closed discriminated search schemas, generated examples, and developer docs without changing base serializers or non-read hydration. The final focused matrix passes 235/235, repeated generation is byte-stable, and typecheck/build pass.

### ✅ Unit 4.1c: Neutral Recipe Metadata - Verification
**What**: Reach 100% read-wrapper/adapter coverage, rerun the named base-serializer consumer matrix, and obtain API compatibility review.
**Output**: Coverage, generated diff, and reviewer evidence.
**Acceptance**: Every empty/order/privacy branch is covered, all enumerated mutation/native/cookbook contracts remain byte-identical, and review converges.
**Completed**: The isolated app gate passes 384 files and 9,205 tests with exact 100% statements, branches, functions, and lines and zero warnings. Galileo's three findings were frozen and fixed; fresh follow-up reviewer Hubble converged with no findings. See `unit-4.1-verification.md`.

### ✅ Unit 4.2a: Read-Time Scaling - Tests
**What**: Add failing pure/REST/MCP/OpenAPI/playground/docs tests for the exact frozen `GET /api/v1/recipes/:id?scale=` and MCP `get_recipe({scale})` contract: finite `0.1..100`; exact REST JSON-number grammar including exponent acceptance and plus/hex/whitespace/leading-zero/dot-form rejection; MCP number-only input; top-level scale metadata; six-decimal ingredient quantity rounding; multiplication/rounded-result overflow; all-or-nothing adapter errors; unchanged servings/storage; absent-argument byte compatibility; REST `validation_error` field `scale`; MCP invalid-argument mapping; OpenAPI bounds; and optional metadata only on `RecipeReadDetail`.
**Output**: Red scaling-helper and adapter tests.
**Acceptance**: Tests fail because the shared validator/scaler and arguments are absent.
**Completed**: Commits `8d5e727d`, `89f61072`, and `d6fbf063` freeze 182 pure, REST, MCP, JSON-RPC, OpenAPI, generated-playground, and docs contracts. The final red matrix has 31 intended feature failures and 151 passing compatibility assertions; three cold review rounds closed factor-one/toFixed precision, multi-step deep preservation, duplicate-query, error-wording, and optional/exclusive MCP ownership gaps before converging.

### ✅ Unit 4.2b: Read-Time Scaling - Implementation
**What**: Add the pure scaling helper and wire REST detail query plus MCP `get_recipe` argument without changing stored quantities or default responses. Add the bounded `scale` query parameter and optional response metadata to `RecipeReadDetail` in `app/lib/api-v1-openapi.server.ts`, regenerate `app/lib/generated/api-v1-playground.ts`, and update `docs/api.md` plus `app/routes/developers.tsx` with scaled and unscaled detail examples.
**Output**: One read-only scaling contract across REST and MCP.
**Acceptance**: Focused scaling/API/MCP/OpenAPI/playground/docs tests, two stable generations, typecheck, and build pass.
**Completed**: Commit `e2953a18` adds the shared strict parser/scaler, REST and MCP read adapters, optional detail-only OpenAPI metadata, stable generated playground, docs, and focused desktop/mobile visual evidence. The seven scaling suites pass 222/222 warning-clean, typecheck/build and the post-commit generated-contract gate pass, repeated generation retains SHA-256 `2a6dad7a72cb438f88d35b41e1f3a2df3ea0fcd2751feb1709d7500ca1e4806f`, and fresh API plus visual reviews converge after an unrelated-serializer error-classification regression was frozen and fixed.

### ✅ Unit 4.2c: Read-Time Scaling - Verification
**What**: Reach 100% validation/rounding/serialization coverage and obtain API review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Null/NaN/infinite/bounds/precision/default branches are covered and review converges.
**Completed**: Final implementation `e2953a18` plus verification hardening `d8e2cc11` pass the 225-test focused matrix and the isolated 386-file/9,286-test app gate at exact 100% statements, branches, functions, and lines with zero warnings. Typecheck, production build, deterministic generation, focused visual QA, and API/visual/test reviews pass after serializer-classification, defensive-rethrow coverage, exact-envelope, and MCP-overflow transport gaps were closed. See `unit-4.2-verification.md`.

### ✅ Unit 4.3: Rejected-Scope Boundary Verification
**What**: Turn the Unit 1.7R exact `d50b8ff...` Pebble path/blob/SHA-256 provenance manifest into a passing regression: the product hit list remains the same eight paths, unrelated historical task files remain byte-identical, and every Pebble-bearing runtime branch/test case/assertion remains exact in source and behavior even when shared files gain unrelated accepted-feature assertions. Reject any diff hunk that adds/removes/reinterprets a Pebble-bearing span and any new hit outside current task evidence. Also assert no first-party import UI, AI tagging surface, broad navigation regression, or personalized save metadata in MCP/public reads.
**Output**: Green `test/config/clem-feedback-boundaries.test.ts`, changed-file/content allowlist, and scope-review evidence without a Pebble runtime change.
**Acceptance**: Exact existing Pebble behavior remains unchanged, every rejected scope has an executable guard, navigation/import regressions stay green, and review converges.
**Completed**: Commit `b743b639` freezes the exact eight protected provider-bearing paths and lines, historical blobs/digests, current authority hashes, all 133 content-addressed product-tree changes, unchanged navigation ownership, agentic-only import, manual-only categorization, and neutral public read contracts. The post-commit boundary suite passes 9/9, the focused matrix passes 23 files/446 tests, warning-policy typecheck is clean, and a five-round harsh review independently reproduced the manifest plus 141 boundary/saved-user tests before returning `PASS`. See `unit-4.3-verification.md`.

### ✅ Unit 5.1a: Saved Service And Cursor - Tests
**What**: Add failing service/query tests for the exact Unicode-whitespace/category-C/200-code-point display query plus separately NFKC/lowercased tag-query pipeline, preservation of compatibility characters in prose fields, wildcard/backslash escaping, ASCII-NOCASE/non-ASCII-exact fields, no second tag normalization pass, empty query, canonical 24-byte savedAt writes, strict cursor timestamp round trip, exact unpadded fixed-key cursor JSON with encoded/decoded byte caps and recipe-ID grammar including a 256-four-byte-code-point maximum round trip, every reordered/noncanonical/malformed case, explicit save/unsave, cookbook independence, owner scoping, PUT active-recipe enforcement, idempotent unsave after soft/hard deletion, mixed historical timestamp rejection at the service boundary, strict BINARY tie predicate, Unicode counterexamples, 24-row bound, and SQL `LIMIT 25` next-page detection without full materialization.
**Output**: Red `test/lib/saved-recipes.server.test.ts` query/service tests.
**Acceptance**: Focused tests fail because the canonical service/cursor is absent.
**Completed**: Commit `1a563a83` freezes 46 independently enumerated normalization, cursor, SQL, live SQLite, pagination, save, unsave, owner-isolation, and deletion contracts. The red run fails only because `app/lib/saved-recipes.server.ts` is absent; three harsh test-review rounds closed SQL grouping, true two-connection race synchronization, Unicode White_Space/category-C boundaries, cursor symmetry, mixed-lookahead validation, and bidirectional cookbook-independence gaps before converging.

### ✅ Unit 5.1b: Saved Service And Cursor - Implementation
**What**: Add `app/lib/saved-recipes.server.ts` with owner-scoped mutations, list query, cursor codec, and deletion rules.
**Output**: One private SavedRecipe data/query service.
**Acceptance**: Focused service tests, typecheck, and build pass.
**Completed**: Commit `1cac98f0` implements the private owner-scoped SavedRecipe service, bounded literal-search SQL, strict canonical cursor codec, active-recipe save, and idempotent unsave. All 46 frozen service tests, warning-policy typecheck, production build, and diff hygiene pass; a fresh privacy/concurrency review converged with no BLOCKER or MAJOR finding.

### ✅ Unit 5.1c: Saved Service And Cursor - Verification
**What**: Reach 100% service/cursor coverage and obtain data/privacy review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every cursor/query/error/boundary branch is covered and review converges.
**Completed**: Commit `3c5b868c` closes every service branch at exact 100% coverage, replaces the deletion-racy read/upsert pair with one active-recipe `INSERT ... SELECT ... ON CONFLICT ... RETURNING` statement, proves immediate hard-delete cascade, captures the outgoing SQL/bind contract, and removes a random search-test collision. The final warning-clean app gate passes 9,345 tests at exact 100% coverage; typecheck, production build, boundary/telemetry ratchets, diff hygiene, and the repaired data/privacy review all converge. Evidence is recorded in `unit-5.1-verification.md`.

### ✅ Unit 5.2a: Saved REST API - Tests
**What**: Add failing `test/routes/api-v1-saved-recipes.test.ts` plus existing API v1 OpenAPI/route-coverage/developer-doc tests for exact always-200 PUT/DELETE envelopes, stable row-existence/absence recovery after domain-write/idempotency-completion failure, exact same-request `replayed:false` versus later-request `replayed:true` semantics and later request ID, conflict/in-progress behavior, scopes, privacy, malformed semantic errors, cache headers, PUT soft-delete rejection, DELETE missing/soft/hard-delete idempotence, replay, and outgoing service inputs.
**Output**: Red saved REST/OpenAPI/contract/docs adapter tests.
**Acceptance**: Tests fail because the saved routes/contracts are absent.
**Completed**: Commit `35abf80d` freezes the REST, scope, OpenAPI, generated-playground, and developer-documentation contract. The five-file red gate has 16 intended absent-feature failures and 22 passes; typecheck and the change-boundary ratchet pass warning-free. A cold local audit strengthened PUT/DELETE lifecycle coverage to use real missing, soft-deleted, hard-deleted, and cascaded database states after the fresh reviewer service hit its account-level quota. Evidence is recorded in `unit-5.2a-red.md`.

### ✅ Unit 5.2b: Saved REST API - Implementation
**What**: Add handlers in `app/lib/api-v1.server.ts`, operation/scope mapping in `app/lib/api-v1-contract.server.ts`, schemas/routes in `app/lib/api-v1-openapi.server.ts`, regenerated `app/lib/generated/api-v1-playground.ts`, and documentation in `docs/api.md` plus `app/routes/developers.tsx`, all using the saved service.
**Output**: Private documented SavedRecipe REST contract.
**Acceptance**: Focused API/OpenAPI tests and generated diff pass.
**Completed**: Commit `0b428d15` ships bearer-scoped saved-recipe list/save/unsave REST handlers, exact private envelopes and idempotency recovery, SDK and connector OpenAPI profiles, deterministic generated playground output, developer docs, and desktop/mobile visual evidence. A fresh adversarial pass added and fixed the same-key soft-delete retry regression so historical saved rows cannot turn a repeated `PUT` from `404` into a false `200`. The final focused gate passes 88/88 with warning-clean typecheck/build and byte-stable generation; evidence is recorded in `unit-5.2b/verification.md`.

### ✅ Unit 5.2c: Saved REST API - Verification
**What**: Reach 100% REST adapter coverage and obtain API/security review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Auth/cache/idempotency/error branches and outgoing inputs are covered; review converges.
**Completed**: Commit `8cff104a` closes hydration-race, pre-write cleanup, telemetry-redaction, cursor-schema, credential-varying cache, and recovered-receipt failure coverage. All 9,368 app tests pass at exact 100% coverage with warning-clean generated-contract, typecheck, build, boundary, and diff gates. The original API/security review's four findings were repaired and the same reviewer returned `CONVERGED`; evidence is recorded in `unit-5.2c-verification.md`.

### ✅ Unit 5.3a: Saved Web Experience - Tests
**What**: Add failing `test/routes/saved-recipes.test.tsx`, `test/lib/recipe-detail.server.test.ts`, and `test/routes/recipes-id.test.tsx` cases for paginated `/saved-recipes`, recipe-detail save/unsave action/UI, distinct cookbook copy/control, independence, empty/search/error states, and keyboard behavior.
**Output**: Red saved-page and recipe-detail UI tests.
**Acceptance**: Tests fail because web still derives saves from cookbook membership.
**Completed**: Commits `5a519d75` and `7f777337` freeze 152 route, server, and component tests with 125 surrounding passes and 27 intentional absent-feature failures. The contract covers canonical cursor ordering and hydration, exact validation/error behavior, persisted independence in both directions, soft-delete history, optimistic pending/revalidation/rollback semantics, rapid-toggle suppression, semantic Enter/Space operation, and exact per-control guest redirects. The 9-test content boundary and diff hygiene pass warning-free, and three harsh review rounds converged. Evidence is recorded in `unit-5.3a-red.md`.

### ✅ Unit 5.3b: Saved Web Experience - Implementation
**What**: Convert `app/routes/saved-recipes.tsx` to `app/lib/saved-recipes.server.ts`; add the dedicated save action in `app/lib/recipe-detail.server.ts` and save UI alongside distinctly labeled cookbook controls in `app/routes/recipes.$id.tsx`.
**Output**: Independent private saved-recipe web workflow.
**Acceptance**: Focused route/component tests and app typecheck/build pass.
**Completed**: Commits `9d972ecc` through `2b1986d5`, with closeout `60673902`, ship the independent private saved page, recipe-detail save action, optimistic header/dock Save control, and distinct Cookbook workflow. The implementation preserves state across revalidation, rolls back failed optimistic updates, composes repeated response headers across standard and Cloudflare runtimes, and keeps expected private-query failures out of unexpected telemetry. Focused tests, warning-gated typecheck, production build, and direct local Worker/D1 save/unsave/list probes pass.

### ✅ Unit 5.3c: Saved Web Experience - Verification
**What**: Reach 100% route/component coverage, run full gates, and obtain product/accessibility/privacy review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every UI/action/empty/error branch is covered and review converges.
**Completed**: Commit `60673902` closes the Cloudflare D1 raw ISO-string coercion gap with a strictly validated text envelope and SQLite storage-class guard. The isolated final gate passes 389 files and 9,404 tests at exact 100% coverage: 21,321 statements, 17,260 branches, 4,114 functions, and 19,606 lines. All 9 scope guards, typecheck, build, focused matrices, and zero-warning policies pass; the implementation reviewer converged after its MINOR BLOB-coercion finding received a red SQL-contract test and repair. Evidence is recorded in `unit-5.3-verification.md`.

### ✅ Unit 5.4: Saved Web Visual QA
**What**: Run `visual-qa-dogfood` on recipe save/cookbook controls and saved empty/populated/search/pagination states at 390x844 and 1440x900.
**Output**: Screenshots, metrics, and closed absurdity ledger.
**Acceptance**: Save and cookbook controls have distinct accessible names, keyboard focus, and at least 44px targets; screenshots show no horizontal overflow, overlap, or truncation; the absurdity ledger has no open item.
**Completed**: Commit `60673902` records 13 inspected desktop/mobile screenshots plus automated metrics for every required state. All roots match viewport width, every measured target is at least 44px, Save and Cookbook retain distinct names and visible keyboard focus, saved descriptions wrap without truncation, and the dialog focus treatment is clean. The absurdity ledger has no open item, fresh visual review converged, Playwright passed 2/2 warning-free, direct Worker/D1 probes returned 200, and all seven local QA residue categories are zero.

### ⬜ Unit 6.1a: Tag Normalization And Storage - Tests
**What**: Add failing service tests for course enum/null; exact NFKC-first processing; pre-whitespace Unicode General Category `C` rejection; Unicode `White_Space` trim/collapse; `Array.from` code-point count; locale-independent `toLowerCase` without renormalization; tab/newline/format/lone-surrogate cases; 40-code-point and ten-tag limits; first-spelling duplicates; deterministic order; edit owner/active-recipe checks; composable SQL operation builders; equivalent local Prisma raw-operation fallback; statement-count/success/affected-row/returned-row validation; and malformed-result and executor-error handling. Add failing isolated Workerd D1 tests for native batch outgoing statements/binds, atomic replacement rollback, concurrency, and no partial observer state.
**Output**: Red `test/lib/recipe-tags.server.test.ts` and `test/workers/recipe-tags-d1.test.ts` tests.
**Acceptance**: The service tests fail because validation/storage operation services are absent, and the Worker tests fail because the native D1 batch executor is absent.

### ⬜ Unit 6.1b: Tag Normalization And Storage - Implementation
**What**: Add tag validation, composable edit operation builders carrying or causally depending on the recipe/owner/active guard, and one storage/query executor that runs one prepared native `D1Database.batch()` through the request binding in production or the equivalent Prisma raw-operation array transaction locally; validate every outgoing/result contract and keep reads deterministic.
**Output**: One canonical recipe-owned tag/course service with native-batch and local-fallback executors.
**Acceptance**: Focused service and isolated Workerd D1 tests, typecheck, and build pass; atomic replacement never relies on a Prisma transaction through `@prisma/adapter-d1`.

### ⬜ Unit 6.1c: Tag Normalization And Storage - Verification
**What**: Reach 100% validation/storage/executor coverage, run malformed-result and error matrices, prove local fallback rollback plus isolated Workerd D1 rollback/concurrency, and obtain data/concurrency review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every invalid/boundary/duplicate/concurrent/malformed-result/error branch is covered; outgoing native statements and binds, edit recipe/owner/active guards, statement and row contracts, rollback, and absence of partial observer state are proven; review converges.

### ⬜ Unit 6.2a: Tag Authoring - Tests
**What**: Add failing tests for `RecipeBuilder`, `createRecipeDraft`, and route `action` in `app/routes/recipes.new.tsx`/`app/routes/recipes.$id.edit.tsx`: course selection, custom-tag editing, hidden payload, validation errors, authenticated-chef creation, owner/active-only edits, route passage of the native DB binding, equivalent local fallback, and one atomic operation set containing the authenticated chef's initial Recipe plus foreign-key-dependent requested tags on create or guarded authoring/course update plus tag replacement on edit. Extend the isolated Worker test for create/edit route composition. Both paths bind one timestamp for `Recipe.updatedAt` and every containing `Cookbook.updatedAt`; forced mid-batch failures must preserve Recipe, RecipeTag, recipe/cookbook timestamps, and canonical search-fingerprint authority without direct search-table mutation.
**Output**: Red authoring route/component tests plus create/edit route-composition extensions in `test/workers/recipe-tags-d1.test.ts`.
**Acceptance**: Route/component tests fail because authoring fields and dual-executor route wiring are absent, and the extended Worker tests fail because create/edit actions do not yet compose and pass the native batch operations.

### ⬜ Unit 6.2b: Tag Authoring - Implementation
**What**: Add controls to `app/components/recipe/RecipeBuilder.tsx`; extend `app/lib/recipe-create.server.ts` so `createRecipeDraft` accepts course/tags and composes the initial Recipe insert with authenticated `chefId` plus requested RecipeTag inserts that depend on the new row through their foreign keys; add `app/lib/recipe-tags.server.ts`; and wire create/edit actions to pass the request's native DB binding. Execute create and edit through the dual executor: production uses one prepared `D1Database.batch()`, while local/tests use the equivalent Prisma raw-operation array transaction. The edit batch includes guarded authoring/course update, tag delete/recreate, one-timestamp `Recipe.updatedAt` and containing-`Cookbook.updatedAt` advancement for native sync, and the resulting canonical search-fingerprint change without direct search-table mutation; every edit mutation carries or causally depends on the recipe/owner/active guard and all statement/result contracts are validated.
**Output**: Manual course/tag authoring on new and edit flows.
**Acceptance**: Focused authoring, native-binding, dual-executor, forced mid-batch rollback, and canonical-search-authority tests plus typecheck/build pass; create cannot expose a recipe missing requested tags, edit is all-or-nothing, edits of absent/deleted/non-owned recipes mutate nothing, and production atomicity never relies on `@prisma/adapter-d1` transactions.

### ⬜ Unit 6.2c: Tag Authoring - Verification
**What**: Reach 100% component/action/dual-executor coverage; prove route binding passage, outgoing native batch shape/binds, equivalent local fallback, and forced mid-batch rollback across Recipe, RecipeTag, recipe/cookbook timestamps, and canonical search authority; obtain product/accessibility/data review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every payload/validation/binding/executor/result/rollback/keyboard branch is covered, isolated Workerd D1 and local rollback evidence agree, no direct search-table mutation occurs, and review converges.

### ⬜ Unit 6.3a: Tag Filters And Search - Tests
**What**: Add failing tests in the named route/service tests for `%20`/`+` input equivalence, raw count rejection before normalization, first-occurrence dedupe/order, SQL AND against canonical `RecipeTag.normalizedLabel`, display-label/Unicode counterexamples, direct Recipe course predicates, My Recipes `q/course/tag*/page` and global `scope/q/course/tag*` URL order with `+` spaces, reset preserving q, all/recipes preservation, non-recipe scope clearing and forged-filter 400, `scope=all` recipe-only filtering before the 30-result limit, invalid-filter 400, pre-limit predicates, and page normalization; assert Unit 4.1's SearchDocument display metadata/freshness contract remains green rather than using it as predicate authority.
**Output**: Red query/route/filter tests.
**Acceptance**: Tests fail because tag/course predicates and filter UI/query handling are absent.

### ⬜ Unit 6.3b: Tag Filters And Search - Implementation
**What**: Update exactly `app/routes/my-recipes.tsx`, `app/lib/my-recipes-search.server.ts`, `app/routes/search.tsx`, and `app/lib/search.server.ts` with the route-specific query ordering/scope semantics from `product-data-contract.md`, accessible controls, direct Recipe/RecipeTag canonical SQL predicates, and safe pagination/link preservation; keep Unit 4.1 metadata for display only and do not change `_index.tsx`, `users.$identifier.tsx`, or the already-complete freshness fingerprint.
**Output**: Course/tag discovery on existing bounded surfaces.
**Acceptance**: Focused query/route tests and build pass; no home/profile expansion occurs.

### ⬜ Unit 6.3c: Tag Filters And Search - Verification
**What**: Reach 100% query/UI coverage and obtain SQL/search/accessibility review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Empty/malformed/multi-filter/pagination/freshness branches are covered and review converges.

### ⬜ Unit 6.4a: Web Tag Read Parity - Tests
**What**: Add failing persisted-data tests only for recipe-detail metadata, My Recipes cards, and global-search cards; assert deterministic public course/tags and no AI/save metadata. REST/MCP serializers are already complete in Unit 4.1 and remain regression tests, not red targets.
**Output**: Red web read-surface integration tests.
**Acceptance**: Tests fail only because persisted tag data does not yet reach the three named web surfaces.

### ⬜ Unit 6.4b: Web Tag Read Parity - Implementation
**What**: Complete includes/displays in `app/lib/recipe-detail.server.ts`, `app/routes/recipes.$id.tsx`, `app/routes/my-recipes.tsx`, `app/routes/search.tsx`, and `app/lib/search.server.ts` for the three Unit 6.4a web surfaces; do not change REST/MCP serializers.
**Output**: End-to-end manual metadata web read parity.
**Acceptance**: Focused web parity tests pass and Unit 4.1 REST/MCP regressions remain green without generated diffs.

### ⬜ Unit 6.4c: Web Tag Read Parity - Verification
**What**: Reach 100% web integration coverage, run full gates, and obtain product/accessibility review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: All empty/order/privacy branches are covered and review converges.

### ⬜ Unit 6.5: Tag Visual QA
**What**: Run `visual-qa-dogfood` on authoring, recipe metadata, My Recipes, and search at 390x844 and 1440x900, including ten 40-code-point tags and empty filters.
**Output**: Screenshots, metrics, and closed absurdity ledger.
**Acceptance**: No horizontal overflow, overlap, or truncation occurs; all controls have reachable focus and at least 44px targets; active filters have programmatic selected state and visible labels; the absurdity ledger has no open item.

### ⬜ Unit 7.1a: Cook Contracts And Auth - Tests
**What**: Add failing tests for every exact route/body/status/error/internal shape and the total precedence table in `cook-session-protocol-v1.md`, including safe-integer/Date bounds, owner-epoch receipt-miss/apply fields, `cook_session_epoch_changed`, combined-invalid cases, and fail-closed `cook_session_unavailable` mapping. Require one `owner:v1:<userId>` object, public `__owner__` rejection, fresh allowlisted internal requests, sentinel/operation/name guards, inbound internal-header stripping, exact configured Origin, the read/write bearer matrix, reserved-resource deletion-intent bearer with `account:write` and session/ordinary-token rejection, raw successful 101 bypass, exact inbound/synthesized Upgrade behavior, and Worker-to-stub-DO WebSocket handle preservation. Build committed executable #283 DO plus exact Unit 1.9 compatibility-Worker bundles/manifests with merge/tree/blob/source/bundle hashes and full-history verification; execute the full skew matrix in CI without a facsimile. Cover golden request hashes, receipt-before-D1 lookup, D1 only on receipt-miss start/restart, missing/deleted/zero-step/oversized/unavailable recipes, canonical snapshots, and exact internal miss/apply envelopes.
**Output**: Red cook-contract and Worker-router tests.
**Acceptance**: Focused tests fail against the inert bootstrap/runtime router.

### ⬜ Unit 7.1b: Cook Contracts And Auth - Implementation
**What**: Implement that exact boundary, retain the private probe/class/binding/migration, and add `workers/cook-session-protocol-v1-boundary` in this same first-real-protocol commit. Derive one owner object, construct new internal requests, enforce every scope/origin/size/schema rule, bypass normal finalization for successful 101 responses, propagate old-DO retry responses, and implement receipt-before-D1 two-phase start/restart with captured owner epoch and no automatic retry on epoch mismatch. Record the marker addition commit SHA for Unit 9.9.
**Output**: Secure typed HTTP/WebSocket transport boundary.
**Acceptance**: Focused pure/Worker tests, typecheck, and build pass.

### ⬜ Unit 7.1c: Cook Contracts And Auth - Verification
**What**: Reach 100% contract/router coverage and obtain security/API review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every auth/origin/name/header/cache/validation/size/receipt-hit/D1-miss/upgrade/protocol-skew/provenance branch is covered, the boundary marker has one addition commit, and review converges.

### ⬜ Unit 7.2a: Cook State Machine - Tests
**What**: Add failing Workers-runtime tests for every exact STRICT DDL table/column/check/index including safe `owner_meta.cook_epoch` and private `cook_session.socket_generation`; stored-type behavior for losslessly coercible numeric text plus rejection of non-lossless cross-type values; exact max/max+1 revision, epoch, and Date-millisecond boundaries; public state/snapshot/summary shape; golden request hash; recipe-scoped receipt rule including allowed cross-recipe UUID reuse; and every state transition in `cook-session-protocol-v1.md`, with no `pending_projection`. This unit owns creation of the one owner mutex and uses it for all state-machine fetch/apply paths. Cover concurrent different-ID start convergence, same-key exact replay, mutation conflict, stale attempt/revision, recipe changed, terminal start, progress validation, eviction, atomic terminal/restart transactions, and every pre-commit failure remaining unreceipted. Direct list, recipe purge/epoch increment, owner deletion, and their intentional exactly-once termination are Unit 7.5 ownership.
**Output**: Red real-DO state-machine tests.
**Acceptance**: Tests fail because the inert class has no state machine.

### ⬜ Unit 7.2b: Cook State Machine - Implementation
**What**: Implement the exact protocol DDL, state/snapshot serializers, transition table, fixed-key hash, receipt storage/replay, compact public summaries, and sole owner mutex in `workers/cook-session.ts`; every state-machine entrypoint acquires it and apply rechecks receipts while held.
**Output**: Durable canonical cook state wholly independent of D1.
**Acceptance**: Focused Workers tests pass under serialized shared storage.

### ⬜ Unit 7.2c: Cook State Machine - Verification
**What**: Reach 100% state-machine coverage and obtain concurrency/model review.
**Output**: Workers coverage and reviewer evidence.
**Acceptance**: Every transition/conflict/replay/race/eviction/transaction/error branch is covered and review converges.

### ⬜ Unit 7.3a: Owner Coordination, Limits, And Alarm - Tests
**What**: Add failing real-runtime tests extending the Unit 7.2 mutex to scheduler/alarm work without creating another lock. Cover physical/session/receipt/attempt quotas, the exact competing-limit precedence, and exact 429 contracts, but not socket quota/admission; logical `<= now` expiry on the already implemented direct detail/receipt-lookup/mutation paths; 256-receipt then 32-receipt-free-session physical batches; no cascade beyond the bound; minimum/immediate scheduling; missing-alarm repair on ordinary implemented entrypoints; finite Cloudflare retry exhaustion followed by entrypoint repair; idempotent delayed alarm delivery; restart-versus-due-retention ordering; and a committed state/receipt followed by post-commit alarm failure returning 503, then same-ID retry repairing the alarm and replaying the stored 200/201. Direct owner-list and recipe-delete expiry are Unit 7.5 ownership.
**Output**: Red owner-coordination/quota/scheduler tests using real DO storage.
**Acceptance**: The Unit 7.2 mutex/concurrency tests remain green; new tests fail only because quota accounting, logical/physical expiry, and scheduler/alarm behavior are absent.

### ⬜ Unit 7.3b: Owner Coordination, Limits, And Alarm - Implementation
**What**: Reuse the exact Unit 7.2 mutex while implementing session/receipt/attempt limits, logical expiry, bounded receipt-first physical cleanup, `ensureAlarm` repair, one-alarm scheduling, and privacy-safe telemetry. Socket limits/admission remain wholly owned by Unit 7.4. Do not claim exact physical cleanup time and do not add D1 cook state.
**Output**: Strongly consistent owner coordination, quotas, and retention scheduler.
**Acceptance**: Focused Workers tests pass; every successful transaction preserves quota invariants; D1 remains untouched by cook state.

### ⬜ Unit 7.3c: Owner Coordination, Limits, And Alarm - Verification
**What**: Reach 100% mutex/quota/expiry/scheduler coverage and obtain Cloudflare/data/privacy review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every quota boundary, logical-expiry transition, cleanup batch, missing/delayed/exhausted alarm, scheduling collision, and telemetry branch is covered and review converges.

### ⬜ Unit 7.4a: Cook WebSockets - Tests
**What**: Add failing real-runtime tests owning active socket admission and quota behavior: dual recipe/attempt tags; complete ready/pending/quarantined attachment grammar with private `socketGeneration` and `lastSentRevision:-1` sentinel; terminal-before-quota 409; expired/missing 404; 8-per-recipe/32-per-owner canonical-valid-ready-OPEN quotas; CLOSING/pending/quarantined/malformed/unknown-version/stale-canonical exclusion; logical-expiry-on-socket admission plus missing-alarm repair through that later entrypoint; isolated pre-persist/send/post-persist/quarantine/close failures; first-persist-no-send truthfulness; post-commit alarm failure before fan-out followed by same-ID lagging-ready catch-up without pending/current duplication; durable ambiguous-delivery quarantine; invalid-message generation rotation with quarantine-plus-close failure across eviction; canonical fallback after failed terminal/restart close; terminal-transition catch-up despite the now-terminal canonical row; best-effort error-frame semantics; explicit message/close/error handlers; exact initial/frame/terminal/restart ordering; message-size behavior; and upgrade races. Recipe-purge/owner-delete socket behavior remains Unit 7.5 ownership. Prove old-attempt/generation handles cannot receive frames or count after hibernation and successful 101 returns only after the initial ready attachment is durable.
**Output**: Red WebSocket tests under `--max-workers=1 --no-isolate`.
**Acceptance**: Tests fail because socket handling is absent.

### ⬜ Unit 7.4b: Cook WebSockets - Implementation
**What**: Implement exact active admission, dual tags, pending-before-send/ready-after-send durable attachments, explicit quarantine, attachment-plus-canonical-state validation on every retrieved handle, canonical-valid-ready-OPEN filtering, receipt-driven lagging-ready catch-up, the terminal-only post-commit/replay delivery validator and pending-to-quarantined terminal path, isolated failures, explicit hibernation handlers, fan-out/frame/terminal/restart/order/size/close behavior, and upgrade admission from the protocol contract. Expose tested recipe/owner quarantine-close helpers for Unit 7.5 without implementing purge/deletion state here.
**Output**: Live canonical cross-device snapshot channel.
**Acceptance**: Focused real-runtime WebSocket tests pass without response cloning or warnings.

### ⬜ Unit 7.4c: Cook WebSockets - Verification
**What**: Reach 100% socket coverage and obtain Cloudflare/security review.
**Output**: Workers coverage and reviewer evidence.
**Acceptance**: Every upgrade/message/reconnect/stale/ordering/deduplication/close/race branch is covered and review converges.

### ⬜ Unit 7.5a: List, Purge, And Owner Deletion - Tests
**What**: Keep Unit 7.3 logical/physical expiry and Unit 7.4 socket-entrypoint alarm repair green, then add failing Workers tests for direct owner-SQLite list and recipe DELETE logical expiry, bodyless retry, and missing-alarm repair through both later entrypoints; transactionally incremented owner epoch; delayed start/restart lookup-versus-purge in every order with unreceipted `cook_session_epoch_changed`; idempotent purge ending that recipe's receipt guarantee and quarantine-closing only recipe sockets; and every crash-repair boundary of reserved-intent permanent owner deletion. Fault-inject socket quarantine/close, post-`deleting`, transaction, `deleteAlarm`, `getAlarm`, recount, retry from `deleting`, retry from `deleted`, and an already-running alarm. Require exact truthful 204 proof headers, repeat-delete proof, deleted-state no-revival handlers, later authorized 410s, total precedence, no `deleteAll`, tombstone eviction recovery, recipe isolation, and all mutex race orders.
**Output**: Red list/purge/cleanup/deleted-socket tests with Unit 7.3 retention green.
**Acceptance**: Tests fail because direct discovery, recipe purge, deleted-state socket handling, and owner tombstoning are absent.

### ⬜ Unit 7.5b: List, Purge, And Owner Deletion - Implementation
**What**: Reuse Unit 7.3 retention without reimplementing it; add direct active list, recipe purge as one epoch-increment/session-and-receipt-delete transaction followed by Unit 7.4 quarantine-close helpers, deleted-state socket handlers, and exact crash-repairable owner deletion/proof headers. `deleted` repeats cleanup/alarm verification before 204; alarm handlers reconcile deleting/deleted state; purge is the two-phase-operation barrier and explicitly ends exactly-once for that recipe. No route/script reads or deletes a D1 cook row.
**Output**: Strongly consistent discovery and fail-closed lifecycle cleanup.
**Acceptance**: Focused Workers/API tests pass; zero row/application-OPEN-socket/alarm residue leaves the expected deleted-owner tombstone and D1 has no cook table.

### ⬜ Unit 7.5c: List, Purge, And Owner Deletion - Verification
**What**: Reach 100% list/recipe-purge/owner-delete/deleted-socket coverage while rerunning Unit 7.3 retention, run full Workers/app gates, and obtain privacy/recovery review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every owner-state precedence, idempotent resume, socket/alarm ordering, tombstone, retention, purge, and race branch is covered and review converges.

### ⬜ Unit 8.1a: Cook Client Transport - Tests
**What**: Add failing client/hook tests for every outgoing shape; principal/transport epoch checks on detail/mutation/reconciliation promises and reconnect/online/stability timers; inbound connection-generation/recipe/attempt/strictly-newer-revision guard; adversarial user-A/user-B and old-attempt/new-attempt resolution; valid error-frame stop; malformed/unlisted frames; terminal-once handling; bodyless recipe DELETE retry and 204-before-fresh-start; `cook_session_epoch_changed` stop/list refresh; and both exact reconciliation tables in `cook-session-protocol-v1.md`. Cover same-ID mutation retry, every conflict choice, detail-vs-socket ordering, close-code handling, offline/online, no immediate reset on open, 30-second/useful-progress reset, repeated short-open backoff, and capped delays `[1000, 2000, 5000, 10000][Math.min(failureIndex, 3)]`.
**Output**: Red `test/hooks/useCookSession.test.tsx` transport tests.
**Acceptance**: Tests fail because the authenticated client transport is absent.

### ⬜ Unit 8.1b: Cook Client Transport - Implementation
**What**: Add `app/lib/cook-session-client.ts` and `app/hooks/useCookSession.ts` as the sole authenticated browser transport/state hook, with one principal/transport epoch guarding every asynchronous continuation before any state write or retry.
**Output**: One tested browser adapter for the cook API/WebSocket.
**Acceptance**: Focused hook tests, typecheck, and build pass.

### ⬜ Unit 8.1c: Cook Client Transport - Verification
**What**: Reach 100% hook/client coverage and obtain adapter/reconnect review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every request/reconnect/conflict/error branch and outgoing shape is covered; review converges.

### ⬜ Unit 8.2a: Cook Mode UI - Tests
**What**: Add failing `test/components/recipe/CookModePanel.test.tsx` and `test/routes/recipes-id.test.tsx` cases for authenticated start/resume, progress, mismatch choices, terminal actions, reconnect/errors, and preserved anonymous local reload behavior.
**Output**: Red cook-panel and recipe-route tests.
**Acceptance**: Tests fail because authenticated cook mode still uses local-only route state.

### ⬜ Unit 8.2b: Cook Mode UI - Implementation
**What**: Extract `app/components/recipe/CookModePanel.tsx`; integrate it and `useCookSession` only in `app/routes/recipes.$id.tsx`, retaining that route's anonymous local adapter without reading it in authenticated mode.
**Output**: Dual authenticated/anonymous cook UI with explicit mismatch and terminal actions.
**Acceptance**: Focused route/component tests and build pass.

### ⬜ Unit 8.2c: Cook Mode UI - Verification
**What**: Reach 100% route/component coverage and obtain product/accessibility review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every UI state/action/error branch is covered and review converges.

### ⬜ Unit 8.3a: Home Cook Discovery - Tests
**What**: Keep the Unit 7.5 Worker/API owner-DO list cases as green regressions, then add failing `test/hooks/useCookSessionDiscovery.test.tsx` and `test/routes/index.test.tsx` cases for the exact private items/order returned by `GET /api/cook-sessions`, immediate mount/focus/visibility/online refresh, five-second initially-empty polling, hidden/offline stop, found-session stop, and no visitor polling. Give discovery its own principal epoch and adversarially resolve user-A list promises/timers after user B or logout is current; no stale continuation may replace state or schedule another fetch. Retain the no-D1 recipe-ID/index oracle.
**Output**: Red home discovery tests.
**Acceptance**: Tests fail because the continue-cooking section and revalidator are absent.

### ⬜ Unit 8.3b: Home Cook Discovery - Implementation
**What**: Add `app/hooks/useCookSessionDiscovery.ts`; wire its active-session card/list only in `app/routes/_index.tsx` using the already-implemented Unit 7.5 `GET /api/cook-sessions` route. Do not change Worker/API list ownership in this unit.
**Output**: Recipe-ID-free second-device discovery.
**Acceptance**: Focused home tests and build pass with maximum five-second visible/online discovery.

### ⬜ Unit 8.3c: Home Cook Discovery - Verification
**What**: Reach 100% loader/timer/event coverage and obtain privacy/performance review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every visibility/network/list-state branch is covered and review converges.

### ⬜ Unit 8.4a: Principal Isolation - Tests
**What**: Add failing browser-state tests for anonymous -> user A -> logout -> user B, stale sockets, delayed detail/mutation/list promises, delayed reconnect/discovery timers, legacy `spoonjoy-cook-progress:*` keys, account change, and zero anonymous upload/read by authenticated code.
**Output**: Red principal-transition tests.
**Acceptance**: Tests fail on missing authenticated isolation teardown only, while anonymous local behavior remains green.

### ⬜ Unit 8.4b: Principal Isolation - Implementation
**What**: Add logout/unmount/socket teardown, invalidate both cook and discovery principal epochs before reset, cancel their timers, and keep principal-scoped in-memory state without reading, migrating, or deleting anonymous recipe progress.
**Output**: Explicit browser principal isolation.
**Acceptance**: Focused transition tests pass with no cross-user state exposure.

### ⬜ Unit 8.4c: Principal Isolation - Verification
**What**: Reach 100% teardown/storage coverage and obtain security/privacy review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every stale/unmount/logout/storage branch is covered and review converges.

### ⬜ Unit 8.5: Two-Context Cook Flow Verification
**What**: Add the complete Playwright flow for initially empty second home, start on device A, discovery on B, bidirectional step/checklist/scale sync, reconnect, mismatch choice, terminal removal, and disposable cleanup as a verification-only contract. It is expected to pass from Units 7.1-8.4. If it exposes a defect, first add the smallest failing regression to the owning earlier unit, repair there, then rerun this flow three consecutive times.
**Output**: Green `e2e/flows/cook-session-cross-device.spec.ts`, three-run stability evidence, full gates, and end-to-end review.
**Acceptance**: All three runs pass without retry, flake, warning, or residue; every discovered defect has an owning lower-level regression; review converges.

### ⬜ Unit 8.6: Cook Experience Visual QA
**What**: Run `visual-qa-dogfood` on anonymous/authenticated cook mode, continue-cooking, mismatch, reconnect, terminal, and long-content states at 390x844 and 1440x900.
**Output**: Screenshots, pixel/interaction metrics, and closed absurdity ledger.
**Acceptance**: Screenshots show no horizontal overflow, overlap, or truncation; all actions are keyboard reachable with at least 44px targets; focus order follows the workflow; the absurdity ledger has no open item.

### ⬜ Unit 9.1a: Feature Smoke Runner - Tests
**What**: Add failing tests for an import-safe `--include-clem-feedback-smoke` orchestration surface in `scripts/smoke-live-helpers.mjs` and matching scenarios in `scripts/smoke-api-live.mjs`: two-client cook, shopping restore, save independence, tags/filters, REST/MCP scaling/metadata, reserved-intent owner-delete proof and authorized 410 replay, exact target/version/Worker-version-override checks, browser console warning/error plus page-error collection, sanitized artifacts, and failure propagation. Freeze the existing excluded `scripts/smoke-live.mjs` byte-for-source; the covered API runner and a package/workflow command invoke the new mode directly.
**Output**: Red `test/scripts/smoke-live-helpers.test.ts` and `test/scripts/smoke-api-live.test.ts` evidence.
**Acceptance**: Focused tests fail because Clem feature smoke coverage is absent.

### ⬜ Unit 9.1b: Feature Smoke Runner - Implementation
**What**: Implement all new parsing, orchestration, diagnostics, target/version, cleanup, and scenario logic in covered import-safe exports from `scripts/smoke-live-helpers.mjs` and `scripts/smoke-api-live.mjs`. Add a tested package/workflow command that invokes the covered API runner's Clem mode directly. Do not modify the excluded `scripts/smoke-live.mjs`; reuse the current target/version/artifact model and add no new orchestrator.
**Output**: One reusable QA/production Clem feature smoke mode.
**Acceptance**: Focused runner tests, script typecheck, and build pass.

### ⬜ Unit 9.1c: Feature Smoke Runner - Verification
**What**: Reach 100% statement/branch/function/line coverage on every new helper/API runner line, assert the excluded live CLI remains byte-identical, execute the covered Clem runner live, and obtain security/API/release review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every new target/version/failure/warning/error/sanitization branch and main-entry guard is covered, no excluded executable line is added, live execution proves the covered wiring, and review converges.

### ⬜ Unit 9.2a: Feature Cleanup - Tests
**What**: Extend `test/scripts/cleanup-local-qa-data.test.ts` and `test/scripts/smoke-live-helpers.test.ts` with failing cases for owner-wide DELETE before relational user deletion; random five-minute bearer generation with only hash/prefix persisted; exact scopes `account:write kitchen:read`, no `kitchen:write`; reserved `oauthResource=urn:spoonjoy:account-delete-intent:v1`; public issuance rejection; exact `Authorization` and `Origin: target.origin`; credential deletion in `finally`; idempotent 204 replay; exact proof headers `X-Spoonjoy-Cook-Owner-State: deleted`, `X-Spoonjoy-Cook-Live-Sessions: 0`, `X-Spoonjoy-Cook-Live-Receipts: 0`, `X-Spoonjoy-Cook-Open-Sockets: 0`, and `X-Spoonjoy-Cook-Alarm: absent` on both deletes; authorized 410 `owner_deleted` checks for later list/detail; expected tombstone acceptance; refusal on auth/purge/verification failure; ambiguous D1 user-delete readback and retry only while the user/credential remains; local/QA/production target isolation; secret sanitization; and zero-live-residue assertions.
**Output**: Red named cleanup-helper/script tests.
**Acceptance**: Tests fail because new feature residue is not yet enumerated/purged.

### ⬜ Unit 9.2b: Feature Cleanup - Implementation
**What**: Extend only `scripts/cleanup-local-qa-data.mjs` and cleanup exports in `scripts/smoke-live-helpers.mjs`: remote QA apply validates the exact disposable user, mints a random five-minute `account:write kitchen:read` credential with the exact reserved deletion-intent resource through the existing D1 admin channel, stores only SHA-256/prefix, calls `DELETE /api/cook-sessions` twice with exact target-origin and bearer headers, verifies all five zero-row/open-socket/tombstone proof headers on both 204 responses plus later list/detail 410 `owner_deleted`, then deletes relational feature/user data. Delete the temporary credential in `finally`. On an ambiguous relational user-delete failure, query user existence and retry owner deletion only while the credential remains valid. Preserve dry-run, explicit apply, and production broad-read-only behavior; never claim direct remote visibility into internal DO SQLite beyond the server-enforced proof contract.
**Output**: Idempotent target-scoped owner-first feature cleanup.
**Acceptance**: Focused cleanup tests and script typecheck pass; captured requests prove exact reserved-resource `account:write kitchen:read` authentication without `kitchen:write`, no token enters output/artifacts, no remote mutation occurs in tests, and relational user deletion cannot begin before owner deletion is verified.

### ⬜ Unit 9.2c: Feature Cleanup - Verification
**What**: Reach 100% cleanup coverage and obtain privacy/destructive-operation review.
**Output**: Coverage and reviewer evidence.
**Acceptance**: Every ordering/retry/target/error branch is covered and review converges.

### ⬜ Unit 9.3: Final Local Verification And Cold Reviews
**What**: Run cleanup, Prisma generation/push, numeric migrations twice, generated-contract diff, script/app typechecks, full app/Workers coverage, Playwright, build, boundary oracle, and clean-tree checks; execute every relevant command through its Unit 1.1 warning hook/wrapper and save the clean output. Run fresh implementation, test, security/privacy, migration/release, API, and design reviews. Make the final tracked planning/doing progress update in this unit, then freeze the candidate tree: from Unit 9.4 onward all QA/production/closure receipts and unit status live only in `$DESK` plus immutable CI/deployment artifacts, never in the product repository.
**Output**: Final local logs, converged reviewer reports, and exact immutable candidate source/tree/payload hashes with external evidence authority initialized.
**Acceptance**: Every command passes with 100% new-code coverage and zero warnings; no review has an open BLOCKER/MAJOR; branch is clean and pushed; the tracked tree states the external-authority handoff and no later unit requires a product-repository evidence/status mutation.

### ⬜ Unit 9.4: Product QA
**What**: Using the shared Unit 2.4 helper's initial path, verify QA's exact compatibility source/version is active before product deployment, apply migration 0025, and require exactly both SavedRecipe fence triggers. Initial QA accepts the reviewed candidate when it descends from compatibility even though its literal first parent is an intervening product commit; no base/lineage equality is imposed. Deploy that exact product candidate atomically, verify exact source/version/canonical health, then idempotently run both `DROP TRIGGER IF EXISTS` statements and require zero trigger rows before feature smoke. A same-target retry preserves the recorded historical base without a new ancestry edge and may begin from zero/one/two named triggers; ambiguous or partial prior unlock is repaired by the same helper. For a later ordinary or post-restoration repair, load the latest external environment-specific predecessor binding, require literal target base/lineage equality, and allow QA's exact active candidate source to alias the canonical production predecessor only after tree plus Worker/DO bundle equality. If a product target became active but deployment verification, unlock, or smoke failed, record that exact active source and use only the legal forward-repair or post-restoration-chain path; never require the compatibility source again or revert to bootstrap. Then run two-client and REST/MCP feature smoke plus visual QA, feature cleanup, and zero-residue checks.
**Output**: Sanitized QA deployment/smoke/visual/cleanup evidence plus frozen `qaAcceptedProductSourceSha`, `qaAcceptedProductTreeSha`, and deploy-payload hash in `$DESK`/CI artifacts outside the candidate tree.
**Acceptance**: QA proves compatibility-version precheck, exact product-version postcheck, idempotent zero/one/two-trigger unlock/readback, the exact predecessor binding and forward-only repair-chain semantics before every feature scenario passes; disposable D1/R2/user data, DO session/receipt rows, application-OPEN sockets, and alarms are absent; each exercised owner retains only the expected fail-closed deleted tombstone proven by the exact 204 headers and later authorized 410s. The accepted source/tree/bundle hashes identify the sole candidate permitted into Unit 9.5.

### ⬜ Unit 9.5: Product PR And CI
**What**: Open the product PR from exact `qaAcceptedProductSourceSha`, complete self/cold review, and resolve all required comments/CI failures. Any tracked-byte change invalidates the accepted source; rerun changed local gates and Unit 9.4, then replace both QA-accepted hashes. Merge only when the PR head equals the final QA-accepted source and the resulting merge commit's tree equals `qaAcceptedProductTreeSha`; main drift or conflict resolution reopens QA.
**Output**: Product PR URL, review disposition, and exact merge SHA.
**Acceptance**: Required reviews/checks are green, no unresolved comment remains, PR head is the exact final QA candidate, and merged tree equals both the reviewed and QA-accepted product tree.

### ⬜ Unit 9.6: Atomic Product Activation
**What**: Follow the source-controlled atomic-product-activation workflow and shared Unit 2.4 helper. Initial production activation requires exact compatibility source/version plus exactly both SavedRecipe fence triggers and target descent from compatibility; base/lineage equality is not an initial-path rule. Verify exact product merge SHA/version/canonical health at 100% and prove no versions-upload/traffic split; then allow zero/one/two named triggers, execute both `DROP TRIGGER IF EXISTS` statements, and require zero-row readback before feature smoke. A lost response, partial prior unlock, or same-target retry preserving the historical target base is repaired idempotently without adding an ancestry edge. If a product source became active but verification or later smoke failed, record it and require the ordinary forward repair's literal target base/first parent and lineage parent to equal that exact production source, with atomic-product mode and protocol-boundary ancestry; its trigger inventory may be zero/one/two and it never requires returning to compatibility. Unit 9.10's post-restoration chain is the sole direct-parent exception while production remains on its floor, but still requires target base/lineage equality to the frozen chain head. Every runtime-changing repair checks in exact active-predecessor/candidate Worker/DO bundle manifests and passes both skew directions before promotion; a byte-identical workflow-only repair must prove both bundle hashes match before reusing prior evidence. After each successful production activation, prove the still-active QA candidate source has the exact merge tree and Worker/DO bundle hashes and record it as QA's same-build alias to this production merge; otherwise redeploy the exact merge to QA before accepting another repair. Keep this unit incomplete until the repair succeeds; never restore the inert bootstrap Worker, accept an arbitrary descendant, or unlock for a different source. Record the exact final successful source as `acceptedProductSourceSha`; later units must not infer it from the original PR.
**Output**: Sanitized successful atomic production release/version evidence; failed attempts retain forward-repair evidence without satisfying the unit.
**Acceptance**: The final product or repair merge SHA is the sole 100% production version and canonical health identifies it; both cutover triggers are absent only after that proof; `acceptedProductSourceSha` and the QA-to-production same-build predecessor binding are frozen with exact tree and Worker/DO bundle hashes, no rollback to the inert bootstrap version occurs, and failure alone never permits Unit 9.7.

### ⬜ Unit 9.7: Production Smoke And Visual QA
**What**: Run production Clem feature smoke, two-client continuation, `visual-qa-dogfood`, and canonical health against `acceptedProductSourceSha`. On any failure, capture identifiers/evidence and attempt owner-first cleanup before repair. If cleanup succeeds, create/merge a reviewed forward repair and repeat Units 9.6-9.7 without restoring the inert bootstrap Worker. If the failed owner-delete/cleanup feature itself prevents cleanup, write a sanitized external `cleanup_blocked` receipt with exact principal/resource IDs and no credential, preserve the relational users needed to mint fresh intent credentials, activate the reviewed forward repair first, then mint fresh credentials and finish cleanup of the old attempt before any new smoke. Keep Unit 9.7 incomplete throughout and replace `acceptedProductSourceSha` only after repair activation, old-attempt cleanup, and a wholly successful rerun.
**Output**: Successful production smoke/visual evidence and closed absurdity ledger; failed attempts retain cleanup/forward-repair evidence without satisfying the unit.
**Acceptance**: Every product/visual scenario passes on `spoonjoy.app`, canonical health identifies the atomically activated product/repair merge, all disposable IDs are captured for Unit 9.8, and only successful forward repair permits Unit 9.8.

### ⬜ Unit 9.8: Production Cleanup
**What**: At cleanup start, mint a fresh five-minute reserved-resource `account:write kitchen:read` intent credential for each exact smoke principal; do not rely on any credential surviving smoke/visual QA. Call owner-wide cook deletion twice before relational cleanup, verify all five exact 204 proof headers including `X-Spoonjoy-Cook-Open-Sockets: 0` on both calls and later authorized list/detail 410 `owner_deleted`, then remove disposable SavedRecipe/RecipeTag/shopping/R2/user data and revoke the fresh credential in `finally`. On ambiguous relational deletion, read back user existence and retry owner deletion only while credentials remain. If owner deletion cannot reach its proof contract, do not delete the relational user: record external `cleanup_blocked`, activate a reviewed forward repair through Unit 9.6, mint a new credential, complete cleanup of these exact principals, then rerun Units 9.7-9.8 against the new accepted source. Assert production D1 still has no cook table; accept only zero owner session/receipt rows, application-OPEN sockets, and alarms plus the expected permanent deleted tombstone. Freeze `acceptedProductSourceSha` in the external cleanup receipt.
**Output**: Sanitized production cleanup receipt and zero-residue evidence.
**Acceptance**: Cleanup targets the exact Unit 9.7 owners, owner deletion is verified before relational deletion, every deletion succeeds or proves absence, all live-residue assertions return zero, expected tombstones remain fail-closed, and canary restoration has not begun early.

### ⬜ Unit 9.9a: Canary Restoration - Tests
**What**: Create the first `worker/clem-feedback-canary-restoration` from exact `acceptedProductSourceSha` recorded by the final successful Units 9.6-9.8, freeze the unique addition commit of `workers/cook-session-protocol-v1-boundary` as `SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA`, and freeze exact `acceptedProductSourceSha` as historical `SPOONJOY_PRODUCT_ROLLBACK_FLOOR_SHA`. Add failing workflow/deploy contract tests with `fetch-depth: 0` that read the active runtime source's checked-in release mode from full git history. For the one-shot `atomic-product-activation` -> `protocol-v1-canary` transition, require boundary ancestry, exact equality of active/rollback runtime source with the floor, the initial restoration candidate's base/first parent equal to that floor, byte-identical Worker and DO bundle hashes (or a fresh bidirectional predecessor/candidate skew matrix if that invariant is ever broken), exact-version 0% MCP OAuth plus Clem smoke, candidate headers/cleanup, 100% promotion, and a full diff from the floor containing only the workflow allowlist. A workflow-only retry after a failed merged restoration may descend from the floor/latest failed restoration, retain the full-diff allowlist, and start with active runtime restored to the exact floor. If failure exposes a genuine runtime defect, test a repeatable post-restoration product-repair chain: the first atomic-product target parents the original failed restoration; each repair merged without production runtime mutation becomes the mandatory lineage parent for the next target while production remains on the floor; every target retains floor/original-head ancestry, removes the canary delta, uses exact environment-specific predecessor bindings, and reruns QA plus Units 9.6-9.8. Once any repair activates in production, later failures use ordinary exact-active-source repair. A wholly successful repair becomes the new floor before a fresh restoration branch. Also construct a synthetic successor whose active/candidate modes are both `protocol-v1-canary` and prove immediate-predecessor rollback without floor equality. Assert the restoration diff neither creates nor moves the boundary marker.
**Output**: Red workflow-only restoration tests and exact changed-file allowlist.
**Acceptance**: Expected red failures are exactly absent full-history mode parsing, one-shot floor enforcement, initial-versus-retry ancestry handling, restoration smoke/cleanup wiring, workflow-only full-diff validation, and future canary-to-canary rollback behavior; existing boundary/bootstrap/product tests remain green.

### ⬜ Unit 9.9b: Canary Restoration - Implementation
**What**: Change only `.github/workflows/production-deploy.yml`, its existing deployment script/tests, and `docs/deployment.md` as required to select protocol-v1-canary; configure the exact Unit 7.1 boundary and accepted-product historical rollback-floor SHAs; machine-enforce exact floor equality only when full-history source configuration proves the active release mode is `atomic-product-activation` and the candidate is the restoration to `protocol-v1-canary`; prove Worker/DO bundle hashes are byte-identical before reusing the product skew receipt; retain normal boundary/immediate-predecessor rules for later canary-to-canary releases; and run existing MCP OAuth plus Clem feature smoke under the candidate version override before promotion with exact response-version and cleanup checks. Do not alter Worker, DO, app, schema, migration, feature code, or the boundary marker.
**Output**: Minimal workflow-only restoration patch.
**Acceptance**: Focused release tests, full app coverage, typecheck, and build pass through zero-warning gates; changed-file allowlist contains only the named delivery files/tests/docs.

### ⬜ Unit 9.9c: Canary Restoration - Verification
**What**: Run the release/security test suite, verify full-history ancestry and the marker's unique Unit 7.1 addition commit, and obtain fresh Cloudflare/release/security review of the workflow-only diff and rollback floor.
**Output**: Converged restoration review and clean pushed branch.
**Acceptance**: Every deployment-phase branch remains covered, reviewers find no BLOCKER/MAJOR, and branch status is clean/pushed.

### ⬜ Unit 9.10: Canary Restoration PR And Deployment
**What**: Open and merge the workflow-only PR after green CI, proving the initial PR base/first parent is exact `acceptedProductSourceSha`, its configured historical floor equals that source, its full diff from the floor is allowlisted, and it did not add or move the boundary marker. For this one-shot restoration only, verify from full-history active-runtime configuration that mode is `atomic-product-activation`, require active/rollback runtime source to equal the floor, run exact-version 0% MCP OAuth plus Clem candidate smoke/cleanup, promote to 100%, and verify exact merge-SHA/version/canonical health. On failure restore runtime to that exact floor. A workflow-only repair PR starts from current main/latest failed restoration, descends from the floor, keeps the full diff from the floor workflow-only, and repeats while active runtime remains the floor. If candidate smoke exposes a genuine runtime defect, suspend restoration and freeze `{runtimeFloorSourceSha, originalFailedRestorationSourceSha, lineageParentSourceSha}` externally. The first atomic-product repair target first-parents the failed restoration. If that repair merges but production remains on the floor, advance only `lineageParentSourceSha` to the failed repair head and create the next target as its first-parent child; continue with floor/original-head ancestry, removed canary delta, zero triggers, bidirectional skew, and the exact QA/production predecessor bindings through Unit 9.4 and Units 9.6-9.8. If a repair activates in production but later fails, switch to ordinary forward repair from that exact active source. Freeze only a wholly successful repair as the new accepted source/floor, rebind QA to its merge identity, then start a new restoration branch with direct parent equal to it. After success, prove a synthetic later canary release can roll back to its immediate protocol-v1-canary predecessor without historical floor equality. Clean candidate-smoke data to zero relational/R2/session/receipt/application-OPEN-socket/alarm state while retaining only the expected tombstone.
**Output**: Restoration PR URL/merge SHA plus sanitized candidate, promotion, rollback-floor, and cleanup evidence.
**Acceptance**: The restoration merge SHA is 100% in production, canonical health identifies it, the one-shot 0%/100% transition started from and could restore only the exact accepted-product rollback floor while both versions descend from the frozen Unit 7.1 protocol boundary, later canary-to-canary releases use their immediate compatible predecessor rather than the stale historical floor, and candidate-smoke cleanup leaves zero relational/R2/live-DO residue plus only the expected deleted-owner tombstone. This restoration merge is the final product-repository mutation for the task; all remaining closure writes are external.

### ⬜ Unit 9.11: Task Closure
**What**: After Unit 9.10 succeeds, leave the frozen product-repository planning/doing bytes untouched; reconcile the externally authoritative `$DESK` checklist/receipts against feedback, PRs, smoke, cleanup, and the shipped restoration identity; archive Desk state; remove a worktree only when its status is empty and its merge is an ancestor of `origin/main`; delete only the corresponding merged local branch; and notify Slugger.
**Output**: Archived done Desk record, external cleanup/closure receipt, and Slugger completion message, with no new product commit or workflow trigger.
**Acceptance**: Unit 9.10 is accepted, no ready required work or residue remains, every external terminal artifact points to the shipped production restoration merge, every product worktree is clean before removal, and no source exists after the verified restoration merge.

## Execution
- **TDD strictly enforced**: tests -> red -> implement -> green -> refactor.
- Commit after each phase and push after every atomic commit.
- Run the full app suite before closing every implementation/refactor unit; run the Workers suite for every Worker/DO change.
- Run `visual-qa-dogfood` before closing every UI unit.
- Through Unit 9.3, save sanitized logs/screenshots/reviews under `./2026-07-19-1505-doing-clem-feedback-ship/` and update tracked planning/doing progress normally. From the Unit 9.3 candidate freeze onward, store all QA/production/closure evidence and status only in `$DESK` and immutable CI/deployment artifacts outside this repository.
- Never mutate the candidate/product tree merely to record Unit 9.4+ evidence. Any functional/review fix creates a new candidate and reruns Unit 9.4; after the successful restoration merge, no product-repository mutation is permitted for this task.
- Use a fresh sub-agent review for every code, SQL, workflow, API, security/privacy, or UI unit and every substantive fix; surface only true credential/capability or unsafe destructive-production blockers.

## Progress Log
- 2026-07-19 15:34 Created from the approved focused planning doc.
- 2026-07-19 16:12 Granularity Round 2 covered every migration schema addition and separated production cleanup from smoke/visual QA.
- 2026-07-19 16:20 Validation Round 1 aligned shopping uniqueness, saved REST, and Playwright paths with the current repository.
- 2026-07-19 16:24 Validation Round 2 converged against repository paths, names, and conventions.
- 2026-07-19 16:31 Ambiguity Round 1 froze bootstrap, schema, protocol, inventory, branch, and measurable verification contracts.
- 2026-07-19 16:43 Ambiguity redesign replaced the stale baseline and completed scalar, hash, infrastructure, inventory, quantity, and repeated-query contracts.
- 2026-07-19 16:52 Ambiguity harsh review completed canonical hash/socket behavior, literal fixture values, and saved/filter file inventories.
- 2026-07-19 17:00 Final ambiguity findings fixed SQL constraints, total reconnects, shopping metadata, bootstrap tests, fixture hashing, and canonical links.
- 2026-07-19 17:06 Final ambiguity convergence fixes specified receipt/projection fields and same-attempt stale reconciliation.
- 2026-07-19 17:10 Ambiguity Pass 4 converged with no executor-blocking findings.
- 2026-07-19 17:17 Quality Round 1 fixed Workers-lane ordering, migration-test ownership, product-mode TDD, and rollback completion semantics.
- 2026-07-19 17:23 Quality Round 2 isolated Prisma checks and guaranteed fresh migration rehearsal state.
- 2026-07-19 17:29 Quality redesign separated REST/MCP from web tag parity and added post-promotion recovery.
- 2026-07-19 17:33 Quality Pass 5 converged across all 114 units.
- 2026-07-19 17:38 Scrutiny Pass 6 fixed seed/raw-index integration, actual MCP naming, and bootstrap cleanup ownership.
- 2026-07-19 17:45 Scrutiny Pass 7 fixed initial registry atomicity and isolated metadata read serializers from mutation/native contracts.
- 2026-07-19 18:18 Scrutiny Pass 8 addressed six findings: handshake cleanup mutex, authenticated remote purge, schema-time import shielding, read-only OpenAPI schemas, search projection ownership, and fixture reset.
- 2026-07-19 18:37 Scrutiny Pass 8 Round 2 addressed five findings: scale contract ownership, tag content hashing, cleanup origin, atomic authoring, and self-reference reset.
- 2026-07-19 18:57 Scrutiny redesign addressed cook scope enforcement, fixture survival across bootstrap, and restart/purge serialization.
- 2026-07-19 19:20 Scrutiny redesign added cross-version atomic activation, exact socket admission/frame ordering, compile-safe Prisma sequencing, and owned zero-warning enforcement.
- 2026-07-19 19:33 Scrutiny Pass 8 Tinfoil converged with no BLOCKER or MAJOR findings.
- 2026-07-19 19:35 Scrutiny Pass 9 Stranger converged with no BLOCKER or MAJOR findings.
- 2026-07-19 19:35 Marked READY_FOR_EXECUTION; Work Doer starts at Unit 0 on the clean pushed `worker/clem-feedback-e2e` branch.
- 2026-07-19 19:00 Unit 0 complete: froze and validated the pre-feature fixture, source/migration hashes, feedback map, clean runtime/auth state, 7,226-test 100% baseline, typecheck, build, and zero local QA residue.
- 2026-07-19 19:01 Unit 0 cold review converged; the reviewer independently replayed the fixture and reproduced its counts, FK result, and hashes.
- 2026-07-19 19:07 Unit 1.1a red boundary: the Workers file's four tests fail on the absent package/config/CI lane, and the warning-policy suite fails transform on its absent shared gate module; no product assertion fails.
- 2026-07-19 20:12 Unit 1.1a cold review converged after the red suite was expanded to 31 independently collected contracts (28 expected infrastructure failures, three parser/baseline passes) and every BLOCKER/MAJOR false-positive path was closed.
- 2026-07-20 00:48 Unit 1.1b complete: shipped the official Workers lane, repo-wide diagnostic enforcement, exact Node SQLite exception, isolated browser runtime/cleanup, and CI gates; 7,292 app tests and 63 CI-equivalent browser tests passed, and five harsh review rounds converged with zero runtime residue.
- 2026-07-20 01:05 Unit 1.1c complete: replayed 7,298 app tests and 10 Workers tests at 100%, 63 browser tests, all wrapped compiler/build/generated/migration gates, warning sentinels, and labeled zero-residue checks; fresh infrastructure review converged after three evidence-audit rounds.
- 2026-07-20 01:54 Unit 1.2a complete: froze 12 real-Workers CookSession lifecycle contracts plus three config contracts; exact red commands fail only on the absent namespace/class, warning sentinels and Node Worker tests stay isolated and green, and three harsh review rounds closed route, auth-ordering, adapter, storage-bookmark, probe, and lane-collision false positives.
- 2026-07-20 11:41 Unit 1.2b complete: added the inert SQLite CookSession export, exact public/private bootstrap adapter, authenticated retry-only protocol stubs, production/QA binding and legacy migration, and environment types; real Workers coverage, typecheck, production/QA build dry-runs, and harsh Cloudflare/security review converged.
- 2026-07-20 11:55 Unit 1.2c complete: expanded the Worker adapter matrix to 36 auth, routing, bootstrap, forwarding, propagation, and analytics cases; focused app and real Workers coverage are exactly 100%, the full 7,337-test app gate is 100%, and fresh test review converged.
- 2026-07-20 16:02 Unit 1.3a complete: froze 564 lifecycle-aware deploy, workflow, serializer, rollback, zero-migration, and artifact-validation contracts; 381 pre-existing paths pass, 183 implementation contracts remain intentionally red, and 22 harsh release/security review rounds converged.
- 2026-07-20 16:02 Unit 1.3b started: implementing the approved release-mode contracts without changing Unit 1.3a tests.
- 2026-07-20 21:16 Unit 1.3b complete: added immutable exact-revision migration application, lifecycle-aware atomic/bootstrap/product/canary modes, strict release artifacts, forward-only boundary repair, operator documentation, and zero-warning route-test settling; 7,734 app tests, typechecks, build, and deployment preflight passed.
- 2026-07-20 21:16 Unit 1.3c complete: both modified deploy scripts reached 100% branch coverage, the 721-test release matrix passed, and a fresh release/security review converged after all artifact, provenance, migration-atomicity, and recovery findings were closed.
- 2026-07-20 21:16 Unit 1.4 started: deploying the inert namespace to QA and proving two-run bootstrap idempotence with zero D1 and Durable Object residue.
- 2026-07-20 21:22 Unit 1.4 complete: QA deployed `v1_cook_session` at Worker version `80dc3064-4b3f-4ff9-9a04-3a03660cfa55`; two strict post-propagation probes returned the exact version-bound SQLite payload and zero residue, and direct D1 inspection found no product registry table or row.
- 2026-07-20 21:22 Unit 1.5 started: running the bootstrap allowlist and final gates, then opening, reviewing, and merging the bootstrap PR.
- 2026-07-21 03:21 Unit 1.5 integration audit repaired Cloudflare's empty-POST stream mismatch and a CI-only unterminated sentinel line; two harsh reviews converged, 8,112 app tests and 13 Workers tests passed at exact 100% coverage, and exact head `da1fbd30` deployed to QA as version `a61526d0-249d-472d-a413-c6cad1bcec5a` with two passing probes plus zero D1/DO/local residue.
- 2026-07-21 05:24 Unit 1.5 complete after forward repairs: PR #283 merged the namespace/bootstrap; PR #285 fixed explicit empty-body production probing; PR #286 fixed the CI-discovered fellow-chef hydration mismatch and latent form-test act warning.
- 2026-07-21 05:42 Unit 1.6 complete: main CI run 29829965212 passed all lanes and production run 29831028729 atomically promoted exact source `d50b8ff5730c68597f6b80077df799927a56e3bf` as deployment `aef2ca40-d9f0-4dbf-8602-bd45068b9a2b`, Worker version `3a7cdc3b-0097-4da3-842a-d39f104d4ff0`; health, two strict probes, and no-cook-table D1 inspection passed.
- 2026-07-21 05:43 Unit 1.7 complete: created `/Users/arimendelow/Projects/spoonjoy-v2-clem-feedback-product` on `worker/clem-feedback-product` from the exact verified merge and recorded `bootstrap-handoff.md`.
- 2026-07-21 05:43 Reopened planning/doing for latest-model audit. The prior per-recipe DO plus D1 registry contradicted Clem's no-D1-progress feedback; this revision supersedes it with one owner-scoped SQLite DO, direct discovery, no D1 cook schema, and permanent owner tombstoning. Historical progress lines remain evidence of the superseded design process.
- 2026-07-21 06:31 Latest-model architecture and product/data reviews rejected the first audit revision on protocol executability, expression-index uniqueness, bootstrap-version provenance, shopping migration skew, alarm/logical-expiry semantics, hibernation identity, deletion crash repair, cleanup observability, tombstone consistency, duplicate discovery ownership, and canary-boundary placement. The normative `product-data-contract.md` and `cook-session-protocol-v1.md` now freeze every schema/body/status/error/transition/reconnect/index/proof contract; the doing units assign the separate compatibility release, Unit 0R refresh, protocol-boundary commit, exact cleanup headers, and non-duplicated ownership. Fresh convergence review is required before execution resumes.
- 2026-07-21 11:59 Unit 1.7R complete after six cold-review rounds. Final reviewers converged on the product/data contract, repeatable release repair state graph, owner-DO protocol/security boundary, and cross-document unit ownership; native SQLite, isolated Wrangler D1, Pebble preservation, warning-clean 950-test deployment baseline, and authority hashes are frozen in `unit-0r-audited-baseline.md`.
- 2026-07-21 12:08 Unit 1.8a complete: froze removal of the bootstrap variable/type/adapter in production, QA, and real Workers; retained the private SQLite probe and namespace migration; pinned atomic product activation; and proved six expected red assertions with every unrelated focused test green. Harsh test review converged.
- 2026-07-21 12:49 Unit 1.8b complete: made the former public bootstrap route permanently inert, removed its config/type surface, preserved the private SQLite class/binding/migration, and selected atomic product activation. Full app and Workers coverage are exactly 100%, typechecks/build are warning-clean, and harsh Cloudflare/release review converged.
- 2026-07-21 12:50 Unit 1.8c complete: exact implementation `1e2aeea6debea36e386b8ca95ad01f1e9089b2cb` is pushed, its tree and public/private lifecycle invariants are frozen in the handoff, every deployment phase remains covered, and fresh release review converged.
- 2026-07-21 19:08 Unit 1.9a complete: froze the full red pre-product shopping, saved-cutover, adapter rollback, and inert owner-delete compatibility matrix on the isolated compatibility branch without schema or migration changes.
- 2026-07-21 23:38 Unit 1.9b complete: exact compatibility tree `6dc720e8d4af087277c73240d0336d522e1c5aaa` passed focused/full 100% coverage, typecheck/build, migration-gap, live QA, and harsh review gates across all six writers plus owner deletion.
- 2026-07-22 01:15 Unit 1.9c complete: PRs #291/#294 are merged and production-verified at Worker version `144bd85d-d0c8-41ea-ae3a-9abf0dbcb6aa`; product merge `8ec4cb1d` descends from both compatibility commits, preserves atomic product activation, and passes the combined compatibility/activation integration gates.
- 2026-07-22 01:24 Unit 2.1a complete: froze exact Prisma product-model/index absence, legacy import allowlist, three-guide boundary, MCP exclusion, and compatibility-selector contracts; the red run produced only the seven intended product gaps.
- 2026-07-22 01:51 Unit 2.1b complete after cold-review repair: exact models and cleanup paths, recursive schema-proof legacy import projections, and coherent agent/API-versus-MCP docs pass Prisma generation/push, 214 focused/compatibility tests, typecheck/build, and 8,283-test 100% coverage.
- 2026-07-22 02:09 Unit 2.1c complete: fresh cold data/privacy review independently reproduced every Prisma, database, focused, compatibility, compiler, build, and exact-coverage gate at implementation `3ba273e4` and converged with no findings.
- 2026-07-22 02:29 Unit 2.2a complete: commit `544358d0` freezes 45 executable migration contracts across exact additive schema/projection inventory, immutable source data, mixed-time normalization, fail-closed rollback, fences, FKs, and save lifecycle; 44 intended failures are solely absent 0025 behavior, the NaN driver fact passes, and six cold-review rounds converged.
- 2026-07-22 02:44 Unit 2.2b complete: commit `bb8e0bb0` implements exact product schema/backfill/fences with no shopping or cook-state expansion; 45 focused, 121 migration, compiler/build, and 8,328-test exact-coverage gates pass, and cold data/migration review converged.
- 2026-07-22 02:52 Unit 2.2c complete: new Node SQLite and isolated Wrangler D1 states agreed on the exact four-save product backfill, unchanged fixture data, fences, no cook state, and zero FK violations; both roots were deleted, 168 prior-Worker compatibility tests passed, and cold verification review converged.
- 2026-07-22 03:35 Unit 2.3a complete: commit `ee9c864f` adds 84 executable migration tests and a real-D1 pre-activation matrix for all six deployed compatibility writers; 37 plus two red failures are exclusively the missing shopping repair/index, compiler and 157 existing writer/seed tests are clean, and harsh review converged after three rounds.
- 2026-07-22 18:06 Unit 3.1b complete: commit `f22f3bcd` atomically linearizes all six deployed shopping add writers against the migrated partial expression index, removes runtime lookup/retry compatibility, and keeps seed-only recovery private.
- 2026-07-22 18:06 Unit 3.1c complete: 9,168 app tests and 44 Workers tests pass at exact 100% coverage; typechecks/build are warning-clean, real Workerd D1 proves the final SQL, and fresh SQL/concurrency review converged.
- 2026-07-22 18:09 Unit 3.2 complete: the 88-test web/REST matrix, full exact-coverage gates, and fresh API review confirm atomic bulk rollback, auth/idempotency compatibility, deterministic ordering, and unchanged non-add contracts.
- 2026-07-22 18:14 Unit 3.3 complete: the 86-test MCP/native matrix and 14-test real-D1 cutover replay pass; fresh sync review confirms shared atomicity, account-global timestamps, preserved tombstones/serialization, and no exactly-once claim.
- 2026-07-21 19:20 Unit 4.1a complete: commit `14fd8f0f` freezes 233 neutral-metadata and compatibility contracts with the exact 29-red/204-green split; typecheck is warning-clean and the fourth cold review converged.
- 2026-07-21 20:50 Units 4.1b-4.1c complete: final implementation `50413dfd` passes the 235-test focused matrix, isolated 9,205-test exact-coverage gate, typecheck, stable generation, and production build; Galileo's three findings were fixed and fresh follow-up reviewer Hubble converged.
- 2026-07-22 21:11 Unit 4.2a complete: commits `8d5e727d`, `89f61072`, and `d6fbf063` freeze the exact 182-test scaling contract with 31 intended feature failures, 151 passing compatibility assertions, fresh red evidence, and three cold review rounds ending in convergence.
- 2026-07-22 21:40 Unit 4.2b complete: commit `e2953a18` ships strict read-time scaling across REST/MCP/OpenAPI/docs with 222 focused tests, warning-clean typecheck/build, deterministic generation, focused visual QA, and converged API/visual review.
- 2026-07-22 22:21 Unit 4.2c complete: verification commit `d8e2cc11` closes unexpected-error and MCP-overflow transport coverage; the final committed tree passes 9,286 tests at exact 100% coverage, all clean gates, and converged API/test review.
- 2026-07-22 23:26 Unit 4.3 complete: commit `b743b639` preserves every rejected-scope boundary with a 133-entry content manifest, 9 executable guards, a 446-test focused matrix, warning-clean typecheck, and five-round review convergence.
- 2026-07-22 23:46 Unit 5.1a complete: commit `1a563a83` freezes the full red SavedRecipe query/cursor/mutation contract; the expected missing-service failure is isolated and three harsh review rounds converged.
- 2026-07-23 00:00 Unit 5.1b complete: commit `1cac98f0` ships the private owner-scoped service; 46 focused tests, warning-clean typecheck/build, diff hygiene, and cold privacy/concurrency review pass.
- 2026-07-23 00:30 Unit 5.1c complete: commit `3c5b868c` reaches exact focused/full coverage, atomically linearizes save against deletion, proves cascade behavior and outgoing SQL, and passes all warning, build, boundary, telemetry, and cold data/privacy gates.
- 2026-07-23 08:48 Unit 5.2a complete: commit `35abf80d` freezes 13 REST adapter tests plus OpenAPI, route-registration, playground, docs, and boundary assertions; all 16 failures are the intended absent feature, 22 surrounding checks and typecheck pass, and the locally repaired cold audit is recorded after the reviewer service reached its account quota.
- 2026-07-23 09:16 Unit 5.2b complete: commit `0b428d15` ships the private SavedRecipe REST/OpenAPI/generated/docs contract, passes the 88-test focused matrix plus warning-clean typecheck/build and visual QA, and fixes the audit-discovered soft-delete retry inconsistency before release.
- 2026-07-23 10:15 Unit 5.2c complete: commit `8cff104a` passes 9,368 tests at exact 100% coverage, all warning-clean contract/compiler/build/boundary gates, and repaired API/security review convergence across all four findings.
- 2026-07-23 10:58 Unit 5.3a complete: commits `5a519d75` and `7f777337` freeze the independent saved web workflow across 152 tests with the exact 27-red/125-green split; the boundary oracle passes 9/9 and the third harsh review converged.
- 2026-07-23 14:38 Unit 5.3b complete: commits `9d972ecc` through `60673902` ship the independent saved page and recipe-detail Save workflow, including portable response-header composition and real Cloudflare Worker/D1 save, unsave, and list behavior.
- 2026-07-23 14:38 Unit 5.3c complete: the isolated 389-file/9,404-test gate is exact 100% across 21,321 statements, 17,260 branches, 4,114 functions, and 19,606 lines; all focused, scope, compiler, build, warning, privacy, accessibility, and repaired integrity-review gates converge.
- 2026-07-23 14:38 Unit 5.4 complete: 13 final screenshots, 13 state/viewport metric records, 2/2 Playwright projects, closed absurdity ledger, converged visual review, and seven-category zero-residue cleanup prove the desktop/mobile saved experience.
- 2026-07-23 Architecture audit: replaced the invalid Prisma-D1 atomicity assumptions in the normative tag contract and Units 6.1-6.2 with the reviewed native prepared `D1Database.batch()`/local Prisma raw-operation dual-executor contract, including binding passage, ownership scope, result validation, rollback/concurrency proof, native-sync timestamps, and canonical search-fingerprint authority.
