# Service and client reliability hardening — execution contract

Status: PROCESSING
Owner: root
Source: `origin/main@b0a5967e3e5547bbc741dd83992587442d75b45c`
Planning doc: `root/tasks/2026-08-29-0956-planning-service-client-reliability-hardening.md`
Review: Tinfoil Hat READY; Stranger With Candy READY

Progress: PR 1 and its discovered E2E infrastructure hardening are merged and production-verified. PR 2 / Units 2.1-2.3 are merged and production-verified. PR 3 / Units 3.1-3.2 are merged and production-verified. PR 4 / Unit 4.1 is merged and production-verified; Unit 4.2 is implementation- and review-complete on `root/oauth-grant-dual-write`, pending merge/release verification.

## Unit 1.1 TDD evidence

- Initial infrastructure run failed before test collection because the disposable `test.db` schema was stale (`NotificationPreference` missing). Rebuilt the local test schema; this was not counted as the unit red.
- First intended red: `pnpm exec vitest run test/scripts/smoke-live-helpers.test.ts test/scripts/deploy-production-canary.test.ts --fileParallelism=false` — 6 failures. Both atomic modes resolved `promoted` instead of invoking the injected full-canary failure; both command sequences lacked `smoke:mcp:oauth`; `validateMcpCanaryRecoveryEvidence` did not exist; Git metadata was only 12 characters.
- Reporter intended red: `pnpm exec vitest run test/scripts/report-mcp-oauth-canary.test.ts test/release-workflow-security.test.ts --fileParallelism=false` — 4 failures. Missing/incomplete evidence exited zero, malformed evidence produced no summary, and the workflow still derived recovery from `needs.deploy.result`.
- Reviewer regression red: the synthetic lifecycle test proved an atomic `forward_repair_required` artifact at phase `canary` was overwritten with `phase: unknown`; the reporter raw-result leak test proved the reporter sanitized before scanning; direct issue-management import failed because no test seam/export existed.
- Green evidence: 1,026 affected tests; changed release/validation scripts at 100% statements/branches/functions/lines; repository-wide `pnpm run test:coverage` at 8,404 tests and 100% across 19,800 statements, 15,665 branches, 3,916 functions, and 18,180 lines; zero warnings. `typecheck`, `typecheck:scripts`, production build, Prisma validation, and `git diff --check` pass. Correctness, test, and Ponytail re-reviews are READY.
- Merge/release evidence: PR #309 merged as `b684794b4dc3ed3b3b17e4718cde3cea23815636`; rerun attempt 2 of main CI run `33270302296` passed every required job. Production deploy `33271165071` promoted Worker `93344dcd-6890-435e-9115-2051b21b8217`; the live health header, release artifact, and canary artifact agree on that Worker and source SHA. All ten ordered OAuth/MCP checks passed, refresh replay was rejected, legacy credentials were promoted, cleanup residue was zero, and artifact leak count was zero.

## Discovered infrastructure hardening before PR 2

- Main CI attempt 1 was aborted after four passing Playwright tests when local workerd emitted its known asynchronous server-write `Connection reset by peer` diagnostic. The identical reviewed tree had passed all 64 tests minutes earlier and passed all 64 again on rerun; this was not an application regression.
- Intended red after test-database setup: focused warning-policy/E2E tests failed because the generic policy had no scoped filter seam and the launcher had no exact workerd peer-reset filter.
- Minimum green: add a generic opt-in diagnostic-filter seam while keeping its default fail-closed; install only an E2E-launcher filter that requires the exact workerd exception/source/write/reset signature plus a workerd-only stack. Exact split chunks pass; incomplete bundles, read/broken-pipe/source-line/stack near-misses, adjacent application errors, and the generic unfiltered policy remain fatal.
- Green/review evidence: the composed launcher/policy regression splits raw UTF-8 bytes inside the `✘` glyph and across the stack, proving the exact bundle never reaches Playwright's outer warning gate. Incomplete and near-match bundles replay and fail. Focused tests pass 74/74; both changed production files have 100% statement/branch/function coverage. Repository-wide coverage passes 8,404 tests at 100% across 19,855 statements, 15,691 branches, 3,928 functions, and 18,226 lines with zero warnings. Script/full typechecks and the production build pass. Correctness/security and test/Ponytail re-reviews are READY.
- Merge/release evidence: PR #310 merged as `e15f23b151710fe5292f29d9bb10d35bb7e06589`; main CI run `33273339073` passed every required job, including E2E. Production deploy `33274032881` promoted Worker `119de200-5031-4a85-9ffa-e88b94386067`; live headers and release-bound canary evidence agree on source/Worker identity, all ten checks passed, cleanup residue was zero, and artifact leak count was zero.
- Follow-up evidence to retain: production artifact download emitted a third-party `Buffer()` deprecation warning outside the repository warning gate. Evaluate the pinned artifact action/runtime separately; do not weaken the warning policy to hide it.

## Unit 2.1 TDD evidence

- Header-classifier intended red: the new dated fixture matrix could not import `http-mcp-protocol.server.ts`; after the pure classifier existed, route integration produced seven failures because protocol GETs still rendered route data and actions had no strict adapter.
- Canary-contract red: the widened affected run failed two exact smoke-helper request-shape assertions after the MCP builders began sending the required dual-media `Accept` value. The expectations now pin that header, and the release-bound OAuth/MCP canary sends it too.
- Negotiation regression red: `application/json;q=1;q=0, text/event-stream` incorrectly passed because the parser trusted the first duplicate quality parameter. Duplicate quality parameters now fail closed while unrelated media parameters remain compatible.
- Header-slice green: 163 affected route, Worker, smoke-helper, and protocol tests pass; the separate Workers/D1 saved-recipe cutover suite passes 13/13. The new protocol and route server modules have complete statement/function coverage, with the unreachable destructuring default removed to preserve full branch coverage. Application and script typechecks pass with zero warnings.
- Modern-semantics intended reds: nine validation failures proved omitted optional `clientInfo`, invalid request IDs, unsafe raw `Mcp-Name`, discovery extras, and list cursors were mishandled; two malformed-UTF-8 tests proved replacement decoding survived; four response tests proved required server metadata was absent; two negotiation tests proved legacy HTTP advertised `2099-01-01`; five unsupported-version tests proved request IDs were discarded; the canary source contract proved modern `Mcp-Name`/tool dispatch were absent.
- Adversarial review regressions: unsupported-version ID recovery initially bypassed the token/IP limiters while reading a bounded multi-megabyte body; a stream test now proves limiter denial returns 429 without pulling or consuming the body. Discovery initially advertised only the modern era despite the same server implementing the legacy path; all discovery surfaces now report both dated versions.
- Modern-semantics green: 265 focused protocol/route/core/canary tests pass; the real Worker + D1 adapter suite passes 14/14 and exercises authenticated discovery; the live OAuth canary now exercises authenticated 2026 discovery, private tool listing, and a read-only tool call with exact `Mcp-Method`, `Mcp-Name`, dual `Accept`, and request `_meta`. Exact changed production coverage is 100% statements (356/356), branches (336/336), functions (51/51), and lines (319/319). Repository coverage and Workers coverage pass with zero warnings; Workers coverage is 100% across 37 statements, 23 branches, 5 functions, and 37 lines. Clean typechecks, script typecheck, production build, generated contract, syntax check, and diff check pass. Correctness, test, and Ponytail re-reviews are READY.

## Unit 2.2 TDD evidence

- Canonical-boundary intended red: nine failures proved trailing-dot origins were not normalized, non-HTTP schemes and credential-bearing issuers survived, encoded-path serialized origins were accepted, and the MCP landing page exposed the internal Worker request origin instead of the configured public origin.
- Persistent-policy intended red: six exact-resource fixtures proved any parseable URL whose path was `/mcp` received a non-expiring access token, including alternate origins, ports, schemes, queries, and fragments. Persistence now requires byte-for-byte equality with the canonical configured resource; refresh rotation preserves noncanonical resource binding without promoting it to persistent access.
- Provider-boundary regressions: a hostile-forwarding fixture proved provider callback URLs ignored the configured public origin; three invalid-config initiation fixtures and three legacy callback fallbacks then proved malformed configured origins escaped as uncaught errors. Google, GitHub, and Apple now derive callback identity from the configured canonical origin and fail closed through the existing `oauth_unconfigured` contract. Stored callback redirects remain preferred for in-flight compatibility.
- Adversarial green: strict serialized-origin parsing rejects path, query, userinfo, backslash, encoded authority, Unicode authority, control characters, and malformed trailing-dot forms while retaining canonical DNS, IPv6, default-port, and local-development origins. Exact MCP audience fixtures cover case, slash, encoded path, query, fragment, alternate origin, and port variants. The route-level refresh test asserts both the new access token and newly active refresh row retain the exact noncanonical resource.
- Verification green: the affected OAuth/MCP/provider suites pass, including the final 453-test boundary run and focused 157/167-test provider reruns; repository-wide clean coverage passes at 100% with zero warnings. Clean application and script typechecks, production build, and `git diff --check` pass. Correctness/security, test, and Ponytail re-reviews are READY.

## Unit 2.3 TDD and verification evidence

- Authorization-boundary reds proved RFC 9207 `iss` was absent, issuer-confused callbacks were accepted, DCR ignored `application_type`, clients/codes/refresh/access credentials lacked issuer provenance, reposted consent fields remained authoritative, and MCP tool calls did not return RFC 6750 `insufficient_scope`. The implementation adds exact issuer propagation and matching, one-time server-side consent snapshots, DCR validation/defaulting, exact issuer grouping/disconnect, and pre-dispatch scope step-up.
- Legacy migration regressions prove safe first-use promotion for client/code/refresh/access rows, permanent binding, orphan omission, exact-issuer REST/MCP rejection, and no mutation of a legacy client before its credential issuer is validated. The additive migration remains nullable and hostname-free; root and Prisma migration bytes are identical, legacy rows stay null, indexes/FKs are exact, and consent rows cascade on user deletion.
- Harsh review reproduced wrong-issuer poisoning in both partial-migration orientations. Stored non-null code/refresh provenance is now rejected before any legacy client promotion, while a null dependent row is promoted only after the client is authoritative; wrong-issuer requests leave every row untouched and the correct issuer subsequently succeeds. A proposed Prisma transaction/rotation guard was deliberately removed after release review proved `@prisma/adapter-d1` ignores Prisma transaction boundaries and emits a live warning. Native D1 batching, fail-closed database guards, response-loss receipts, and D1 failpoint/race proof remain honestly assigned to PR 5; Unit 2.3 makes no atomic issuance/rotation claim.
- DCR now rejects every non-string `redirect_uris` member and non-string `client_name` instead of silently rewriting malformed metadata. First-party Apple/password OAuth clients use deterministic issuer-specific IDs, preserve the canonical production ID, return the effective `client_id`, and prove token refresh at a second issuer. RFC 7009 revocation returns the same 200 for unknown, mismatched, cross-issuer, and already-revoked tokens. The documented connection example now embeds issuer provenance and its opaque ID decodes to the exact runtime disconnect tuple.
- Consent approval creates the authorization code before consuming its transaction and removes a losing race's unpublished code, so an injected code-write failure preserves the already-approved transaction and concurrent approvals still expose exactly one code. The consent snapshot reconstructs validated fixed protocol constants instead of storing them; shared OAuth token/hash helpers replace the duplicate route-level crypto implementation.
- Disconnect cleanup is retryable across its unavoidable pre-grant-schema multi-write window: core refresh-token revoke no longer exits before cleaning a surviving access credential, and account surfaces recover ownership from stable connection keys copied onto both refresh and access rows. Injected access-write failure proves refresh-first partial state is visible, a retry revokes the original access credential, and a complete later reconnect remains outside the original disconnect generation even at SQLite/D1's same-second timestamp boundary. Web forms and native opaque IDs carry exact ownership snapshots; 101-key groups partition deterministically as 32/32/32/5, stale snapshots survive later inserts, and a real PrismaD1 test proves the maximum query stays below D1's 100-bind limit. Full atomic disconnect remains assigned to PR 5.
- Protocol claims remain honest: authorization-server metadata advertises RFC 9207 support and only MCP revisions `2025-06-18` and `2026-07-28`; protected-resource metadata and the live canary assert exact issuer/resource equality and absence of CIMD claims. URL-shaped client IDs are never fetched. DCR remains the compatibility path while CIMD is deferred behind a separately reviewed SSRF, timeout, persistence, and abuse policy.
- Official-client evidence: TypeScript SDK 2.0.0 exercises both supported revisions against `/mcp`; the repeatable Python harness proves MCP 1.23.0 negotiates `2025-06-18` and MCP 2.1.1 negotiates `2026-07-28`. Both list 41 tools and call `get_shopping_list`; credentials stay out of argv, the bridge is loopback-only with a 1 MiB body cap, and normal/failure/signal paths leave no process, database, virtualenv, or token residue.
- Verification green: clean app coverage passes 392 files / 8,673 tests at 100% statements (20,195/20,195), branches (16,022/16,022), functions (3,984/3,984), and lines (18,535/18,535), with zero warnings. Workers coverage passes 45/45 at 100% across 37 statements, 23 branches, 5 functions, and 37 lines. Clean app/script typechecks, production build, Prisma validation, standard and from-zero local/QA rehearsal of all 27 migrations, official Python SDK conformance, `git diff --check`, and post-dogfood cleanup are green. Deployment preflight passes every repository/configuration check and stops only on the expected pending remote `0026` migration, which must be applied by the exact-SHA production workflow after merge. Final security, release/test, and Ponytail/UI reviews are READY.
- CI contract regression: the Python action/conformance steps initially made the exact deployment preflight reject the repository's own CI workflow. The canonical contract now pins `actions/setup-python` by full SHA, Python 3.13, exact step order, and the non-optional clean conformance command; mutation tests reject missing, repinned, downgraded, skipped, and soft-failed variants. A separate async test leak was fixed by waiting for the preflight's terminal summary before restoring environment and console/process spies; the warning policy remains fail-closed.
- Hosted E2E repairs pin the ephemeral Worker's public origin to `http://localhost:5197`, send the required dual-media MCP `Accept` value, and derive the passkey continuation resource from the active issuer instead of production. The warning gate now recognizes both OS-level spellings of the same exact workerd server-write close (`Connection reset by peer` and `Broken pipe`) only when paired with the exact source/write signature and a workerd-only stack; connection-aborted, read, source-line, missing-stack, adjacent-application-output, and non-workerd near-misses remain fatal. The exact CI migration → seed → Playwright sequence passes all 64 tests from zero, and the operator's pre-existing local D1 state is restored unchanged with zero disposable residue.
- Visual absurdity ledger: desktop 1280x720 and narrow 390x844 Account settings were rendered with two identically named/resource-bound connections from distinct issuers. Both rows keep issuer, counts, and an issuer-specific accessible Disconnect name visible; narrow text wraps without horizontal overflow and actions remain reachable above the persistent navigation. Browser console: no warnings/errors. Disposition: no `ready` or `needs reviewer gate` items; reviewer gate pending. Disposable local user, clients, refresh/access rows, `.dev.vars`, browser tabs, and server were removed; cleanup reports zero residue and zero cross-boundary blockers.

## Unit 3.1 TDD evidence

- The first two attempts failed on fresh-worktree setup rather than the contract: the shared dependency symlink exposed a stale generated Prisma client and shared SQLite path. The worktree now has an isolated offline install and disposable `prisma/test.db`; no data-loss override was applied to the shared test database. These setup failures are not counted as the unit red.
- Intended red: all initial 14 before/after cases failed because the optional persistence callback did not exist, so every mutation completed instead of raising its exact `oauth-failpoint:<stage>:<timing>` sentinel. The frozen matrix names code consumption, access insert, refresh insert, parent revoke, replacement-pair insert, disconnect refresh revoke, and disconnect access revoke. Harsh review then added four nested rotation cases; the two guarded zero-row regressions failed because `after` was emitted before commit was established.
- Minimum green: one optional async dependency callback brackets only the seven named persistence boundaries. No caller supplies it in production, default behavior remains a no-op, and rotation explicitly brackets the complete replacement pair while forwarding the same callback to its access and refresh sub-writes.
- State evidence: an after-consumption failure strands a burned authorization with no credentials; after-access and before-refresh failures leave a live orphan access credential; after-parent and before-replacement failures leave the parent revoked without a replacement; nested rotation after-access/before-refresh proves the revoked parent plus orphan replacement access state; after-refresh-revoke and before-access-revoke failures leave refresh revoked while access remains live. After-write cases also preserve committed rows while returning the injected failure, covering response-loss ambiguity. Guarded zero-row races emit only `before`, then preserve the canonical `invalid_grant` error.
- Focused green: all 18 failpoint cases and both zero-row guard regressions pass within a 107-test core run. The affected core OAuth, HTTP OAuth, web account-settings, and native account-settings suites pass 357/357. Repository-wide clean coverage passes 393 files / 8,691 tests at 100% statements (20,222/20,222), branches (16,050/16,050), functions (3,984/3,984), and lines (18,562/18,562), with zero warnings. Clean application/script typechecks, production build, Prisma validation, and `git diff --check` pass. Harsh review is READY after closing nested-rotation, guarded-after, and exact-parent-identity findings. Local-D1 reproduction remains a PR-exit requirement with Unit 3.2; the fresh worktree's local Wrangler D1 is not initialized and the read-only QA-residue probe therefore found no `Recipe` table rather than application residue.

## Unit 3.2 TDD evidence

- Intended red: the SQLite concurrency characterization could not import the deliberately missing test-only deterministic race coordinator. Minimum green adds a two-contender promise coordinator with no clocks, timers, sleeps, production synchronization, or shared product state. Both clients finish validation and arrive at the pre-write hook; a designated contender proceeds, and the stale loser is released only after the guarded write's committed `after` signal.
- Two separately constructed SQLite Prisma clients race byte-identical authorization-code inputs through consumption plus issuance. Exactly one returns a token pair and the indistinguishable replay receives canonical `invalid_grant`; exact code/access/refresh hash sets and every user/client/issuer/resource/scope/connection/revocation/expiry field are pinned. Two separately constructed clients also race the same public refresh bearer with `honest_client` and `indistinguishable_replay` each designated winner in turn. Either claimant can own the live replacement family, while the loser receives `invalid_grant`; the exact residual set proves the parent revoked, child refresh live, and both old and replacement access credentials live. The current server cannot tell an honest concurrent retry from theft, so a strict family-compromise response cannot safely distinguish which claimant to punish.
- Local PrismaD1 runs the same independent-client code/refresh races and all 18 Unit 3.1 before/after failpoint cases against the real Miniflare D1 binding. The failpoint matrix pins stage-specific residual counts and revocation fields; the concurrency and restart cases pin complete rows and exact token hashes. Exact per-user cleanup is required because the canonical Workers command deliberately uses `--no-isolate`; the first run exposed accumulating 3/5-row counts before that reset existed. The suite also disconnects and replaces every PrismaD1 client between issuance, rotation, and observation and pins every persisted connector field; its claim is deliberately limited to client replacement.
- Worker-down persistence has a stronger three-process proof. Three distinct `tsx` OS processes independently create and dispose Wrangler `getPlatformProxy` local-D1 bindings against one explicit temporary persistence directory: process 1 migrates/seeds/issues, process 2 starts with fresh module memory and a fresh binding process then rotates, and process 3 restarts both again and observes exact user, client, parent/child refresh hashes, access hashes, connection key, issuer/resource/scope, expiry, and revocation state. Synthetic plaintext tokens cross only captured stdin/stdout between the test-owned processes, are never printed or snapshotted, error diagnostics redact token prefixes, and the persisted directory is removed in `finally`.
- Full Workers integration initially failed because a third independently collected schema-owning file ran before the CookSession suite, which deliberately replaces `User` and `ApiCredential` with a minimal schema. The OAuth D1 suite is now imported by the established full-schema D1 integration file, and their shared migration helper writes a completion marker only after every repository migration succeeds. The established CookSession-to-full-schema lifecycle remains intact without global test-order configuration.
- Hosted Linux CI exposed Prisma's exact documented D1 warning when the client-replacement proof reached an implicit transaction boundary: D1 ignores both implicit and explicit Prisma transactions. The test owns that exact platform-specific diagnostic as characterization evidence instead of suppressing Prisma warnings globally; native D1 atomicity remains the next unit's required repair.
- Focused green: SQLite concurrency passes 3/3; combined core/failpoint/concurrency passes 110/110; local D1 OAuth persistence/concurrency passes 22/22; the complete no-isolate Workers suite passes 67/67; and the three-process restart probe passes 1/1. Repository-wide clean coverage passes 395 files / 8,695 tests at 100% statements (20,222/20,222), branches (16,050/16,050), functions (3,984/3,984), and lines (18,562/18,562), with zero warnings. Workers coverage passes 67/67 at 100% across 37 statements, 23 branches, 5 functions, and 37 lines. Clean application/script typechecks, production build, Prisma validation, and `git diff --check` pass. Final harsh review is READY after closing exact authorization-code hash-set assertions across SQLite and D1.
- Merge/release evidence: PR #312 merged as `4d537ce8bff0a6f6e720114ee88c51ed7e8b76bd`. Main CI `33295619956` and Storybook `33295619960` passed. Production deploy `33296239299` promoted Worker `d684e5e3-6ebd-4c34-b3f3-5e26bae178d2`; live health headers, the release artifact, and the canary artifact agree on source/Worker identity. All ten ordered OAuth/MCP checks passed, refresh replay was rejected, legacy credentials were promoted, and cleanup residue was zero. The task-owned remote branch, local branch, and worktree were removed after verification.

## Unit 4.1 TDD evidence

- The first two focused attempts failed before the contract because the fresh worktree lacked dependencies and its disposable test schema. The locked dependency graph and isolated `prisma/test.db` were initialized; neither setup failure counts as the red.
- Intended red: all 11 migration-contract cases failed because both copies of `0027_oauth_grants_and_lineage.sql` were absent. The frozen contract requires an additive migration, byte-identical root/Prisma SQL, preserved legacy rows and old-worker inserts, nullable non-authoritative bridge hints, durable grant/issuance/lineage tables, exact status/reason checks, unique issuance sources/outputs, contiguous non-branching grant-local refresh lineage, one active generation, cascading ownership, indexes, and a clean foreign-key audit.
- Design review initially found issuer omission and a lineage shape that could admit cross-grant parents, skipped generations, cycles, or branching. The corrected READY design makes issuer required, removes redundant family identity, and uses a composite self-reference plus generation checks and a unique parent. Existing-row bridge IDs remain non-authoritative until contraction; PR 5 owns semantic guards and immutable transition writes inside native D1 batches.
- Initial harsh implementation review found that cascading source/output deletes could erase authoritative lineage while leaving live descendant credentials, and that separate FKs did not prove a lineage row's grant, issuance kind, output, and parent belonged to the same transition. Retention-sensitive source/output/parent references now use `NO ACTION`; composite issuance-identity and parent-source FKs bind all transition identities; generation checks require an authorization-code root and refresh-token descendants. Direct parent-refresh/output deletion is rejected while lineage exists. Production-shaped user cascades and separate client-owned sidecar cleanup both pass. Re-review is CONVERGED with no blocker or major finding. Fresh pre-merge review then caught exact-client, MCP-canary, and broad disposable-user cleanup deleting protected token rows before their sidecars. Regression fixtures now execute all three paths against populated issuance/lineage graphs, each cleanup deletes the owning grant first, and a client-leading grant index prevents cascade scans.
- Green evidence: focused migration/cleanup/canary-helper/source-policy contracts pass 186/186; the real Miniflare D1 mixed-version suite passes 38/38; the three-process restart proof passes 1/1. The unchanged legacy issue/rotate/disconnect implementation operates across replaced PrismaD1 clients on the expanded schema, leaves all bridge hints null and all three new tables empty, revokes both generations, and finishes with `PRAGMA foreign_key_check` clean. Repository coverage passes 396 files / 8,709 tests at 100% statements (20,222/20,222), branches (16,050/16,050), functions (3,984/3,984), and lines (18,562/18,562), with zero warnings. Workers coverage passes 68/68 at 100% across 37 statements, 23 branches, 5 functions, and 37 lines. Clean app/script typechecks, production build, from-zero local/QA migration rehearsals, Prisma validate/generate, migration byte equality, and `git diff --check` pass. Exact-head harsh re-review after the broad-cleanup correction is READY with no blocker, major, or minor finding.
- Merge/release evidence: PR #313 merged as `c9dcf61c8e554d3a39b236c075af4477cfc94ac9`. Main CI `33299950206`, Storybook `33299950224`, production deploy `33300623867`, and credentialed production D1 audit `33300765975` passed. Migration `0027` applied in production, the release-bound ten-step OAuth/MCP canary passed with zero cleanup residue, and live health identifies promoted Worker `f955fb19-2a2f-4464-9738-7c7b8c2e3074`. The production audit reports zero active refresh rows missing a resource, duplicate active connection keys, access/refresh resource mismatches, and canary residue. Its current contract does not yet include `PRAGMA foreign_key_check` or new-table row counts; that audit expansion remains required rather than inferred.

## Unit 4.2 TDD and verification evidence

- Backfill intended red: the deterministic planner module was absent. The frozen fixture matrix covers clean and historical generations, null resource, semantic scope order, orphan access/refresh rows, duplicate active refreshes, unknown user/client, null keys, identity mismatch, existing-link mismatch, and orphan grants. The minimum green emits stable redacted issue categories and guarded idempotent SQL; production apply requires an exact reviewed SHA-256 plan digest and a second explicit production confirmation.
- Real local-D1 rehearsal applied migrations `0000` through `0027`, inserted one disposable clean connection, produced one deterministic grant plus refresh/access hints, applied only the exact digest, immediately rescanned to zero mutations/issues, passed a second dry run and `PRAGMA foreign_key_check`, then removed all disposable rows and artifacts.
- Runtime dual-write creates the durable `OAuthGrant` before returning newly issued access/refresh credentials and writes the same grant ID into both rows. Rotation reuses a linked parent grant; a genuinely legacy unlinked parent remains unlinked rather than guessing ownership. Explicit disconnect durably revokes linked grants. Reads remain legacy-compatible for rollback. Historical issuance/lineage is deliberately not fabricated from timestamps; PR 5 owns authoritative transition records and native D1 batching.
- Corruption regressions prove cross-linked refresh/grant identities fail before revocation or legacy resource promotion mutates anything. Web and native disconnect surfaces persist the selected grant's `revoked/disconnect` state while preserving unrelated grants. The production workflow rejects non-main code before exposing protected D1 credentials, keeps the scheduled path read-only, isolates exact-plan apply in a protected job, fails on missing credentials/digest, and reruns the invariant audit after apply.
- The full audit SQL is executed against production-shaped corrupt SQLite fixtures rather than string-inspected only. It detects NULL/non-NULL issuer and connection-key disagreement plus semantic refresh-scope mismatch, accepts reordered equivalent scope sets, checks `PRAGMA foreign_key_check`, missing/orphan grant relationships, and durable grant counts. The generated command also passes against the real clean local D1 database with every failure invariant at zero.
- Crash recovery is process-independent. Issue, rotation, and observation run in separate OS processes against persisted local D1. Three additional tests terminate the process immediately after each committed legacy resource-promotion write without Prisma or platform disposal; a new process retries to one exact grant/refresh/access resource family and leaves an unrelated family unchanged. No module global, queue, cache, or in-memory receipt is authoritative.
- Final verification: affected suites pass 489/489; abrupt-process restart tests pass 4/4; real Miniflare D1 suite passes 38/38. Repository coverage passes 397 files / 8,749 tests at 100% statements (20,301/20,301), branches (16,148/16,148), functions (3,994/3,994), and lines (18,635/18,635), with zero warning-gate output. Workers coverage passes 68/68 at 100% across 37 statements, 23 branches, 5 functions, and 37 lines. Application/script typechecks, production build, real local audit, and `git diff --check` pass. Exact-head harsh correctness review is READY; Ponytail reports `Lean already. Ship.`

## Execution rules

- Execute in the dependency order below. Split work into atomic PRs at the indicated boundaries; do not leave a PR open as the final state of an accepted implementation task.
- For every unit, write the named test first, run it, and record the observed failure. A compilation error caused only by a deliberately missing production API is an acceptable first red; a test that fails for unrelated setup is not.
- Implement the minimum production behavior that makes the new test pass, then run the focused file, affected suite, full suite, coverage, build, migration validation, and consuming-surface smoke appropriate to that unit.
- Maintain 100% changed-production coverage, repository-mandated 100% coverage, and zero warnings.
- Never log or snapshot raw token/code/verifier material. Synthetic data is disposable and must be removed in the same run.
- Update the planning doc when evidence invalidates an assumption. Do not silently substitute a new architecture.

## PR 1 — Make production canary truth impossible to fake

### Unit 1.1: canary in every deployment mode

Test first:

- Extend release-workflow simulations for `atomic-bootstrap` and every other mode.
- Reproduce that deploy success without full OAuth/MCP checks or cleanup can close the incident.
- Assert missing/malformed checks, missing cleanup, wrong Worker/source SHA, skipped secrets, or a bootstrap-only probe can never be release-green or close recovery.

Minimum green:

- Run the full OAuth/MCP canary after every production deployment mode.
- Require a versioned result artifact with the exact expected check set, observed Worker/source identity, cleanup count zero, and no failure.
- Drive incident recovery only from validated canary content, never from `needs.deploy.result`.

Verification: workflow unit/simulation suite, fixture artifacts, staging deploy, one exact-SHA production canary with zero residue.

PR exit: no deployment code path can produce a connector-recovery signal without complete exact-SHA evidence.

## PR 2 — Pin and enforce the MCP/OAuth boundary

### Unit 2.1: protocol fixture matrix

Test first:

- Add table-driven `/mcp` tests covering POST/GET/DELETE/OPTIONS, supported and unsupported `Accept`, missing/supported/unsupported `MCP-Protocol-Version`, valid/invalid/missing `Origin`, authenticated/unauthenticated requests, JSON-RPC request/notification/batch shapes, body limits, and resource challenges.
- Assert GET with `Accept: text/html` preserves the intentional connector landing page, while unsupported SSE/DELETE transport cases return explicit MCP/HTTP responses with no unrelated application HTML.
- Add dated fixture metadata naming the MCP spec version each expectation comes from, including honest 2025-06-18 and 2026-07-28 paths.

Minimum green:

- Introduce one strict MCP transport adapter in front of application routing.
- Preserve the 2025 JSON handshake path and content-negotiated human landing page; add a separate 2026 stateless path with `server/discover`, per-request identity/capabilities, required routing headers, and deterministic/cacheable lists. Return 405 for unsupported GET-SSE/DELETE streaming/session behavior; validate origin, accept, and protocol version; preserve request ID and canonical challenge headers.
- Preserve known successful Claude request shapes without client-name security exceptions.

Verification: focused MCP route/server tests, JSON-RPC tests, production build, local transport smoke, live metadata/401 probe.

### Unit 2.2: canonical origin/resource normalization

Test first:

- Add adversarial forwarded-host/proto/port, mixed-case host, trailing-dot, encoded-path, alternate-origin `/mcp`, and hostile `Origin` cases.
- Prove only the configured canonical protected resource receives persistent-policy compatibility during migration.

Minimum green:

- Centralize trusted issuer/resource/origin derivation and exact canonical resource comparison.
- Never trust unsanitized forwarding headers over configured production origin.

Verification: OAuth route/metadata/MCP contract suites and production metadata diff.

### Unit 2.3: MCP 2026 authorization conformance

Test first:

- RFC 9207 `iss` on authorization responses and mix-up rejection fixtures; issuer-bound client credentials; DCR `application_type`; scope step-up/resource validation; explicit absence of CIMD capability claims while DCR compatibility remains.
- Assert metadata and behavior never claim a 2026 capability that is not implemented.

Security scope correction: CIMD fetching is deliberately deferred. It is optional interoperability behavior, and the reviewed implementation would have added an unauthenticated outbound-fetch SSRF/timeout surface plus unbounded client-record growth. Unit 2.3 therefore proves that URL-shaped client IDs are never fetched, publishes no CIMD support claim, and retains DCR as the compatible registration path. Add CIMD only with a separately reviewed fetch policy, bounded persistence, and abuse controls.

Minimum green:

- Implement the dated 2026 authorization contract alongside the 2025 path, preserving observed Claude compatibility behind explicit version/capability negotiation.

Verification: official TypeScript/Python SDK conformance for both supported revisions, metadata snapshots, mix-up and issuer-confusion security tests.

PR exit: protocol fixtures and official SDK clients are green, content-negotiated human HTML remains, and no unsupported transport falls through to HTML. Real-Claude enforcement remains an explicit activation gate when its controlled test account is available.

## PR 3 — Reproduce atomicity failures before changing storage

### Unit 3.1: OAuth mutation failpoint harness

Test first:

- Add deterministic failpoints before and after code consumption, access insert, refresh insert, parent revoke, replacement insert, disconnect refresh revoke, and disconnect access revoke.
- Existing implementation must visibly reproduce stranded authorization, orphan credential, revoked-without-replacement, and partial disconnect states.

Minimum green:

- Add test-only dependency injection around OAuth persistence operations. No production behavior change.

Verification: each red is attributable to the intended failpoint and captured as a regression expectation for PR 4.

### Unit 3.2: concurrency baseline

Test first:

- Race identical code exchanges and identical refreshes across independent database clients.
- Assert the current winner/loser outcome and record all residual rows. For two honest concurrent refreshes, capture the unavoidable public-bearer ambiguity that can compromise the winning family.

Minimum green:

- Only deterministic test coordination/barriers; no sleeps and no production synchronization.

PR exit: every known partial-write and concurrency failure is reproducible locally and on local D1.

## PR 4 — Expand the durable grant schema

### Unit 4.1: additive grant/issuance/lineage schema

Test first:

- Migration tests from a production-shaped pre-change fixture.
- Foreign-key, unique issuance, unique lineage, valid status/reason, and grant identity constraint tests.
- Mixed-version tests proving the current Worker can run against the expanded schema.

Minimum green:

- Add `OAuthGrant` and atomic issuance/refresh lineage fields/tables as additive nullable structures.
- Add indexes for grant lookup, active-family audit, expiry, and cleanup.
- Express D1-only partial indexes/triggers in reviewed raw migration SQL where Prisma cannot model them.

Verification: fresh migration, upgrade migration, foreign key check, Prisma generate/validate, old Worker compatibility suite.

### Unit 4.2: deterministic backfill and audit

Test first:

- Fixtures for one clean connection, multiple revoked generations, null legacy resource, orphan access, duplicate active connection, cross-resource mismatch, and unknown client.
- Assert clean rows map deterministically and ambiguous rows are reported without mutation.

Minimum green:

- Idempotent dry-run-first backfill and repair-report command.
- Dual-write grants for newly issued legacy-path credentials while reads remain unchanged.

Verification: repeated dry runs are identical, apply then dry run is clean, no secret material in output.

PR exit: expanded schema is deployed and audited with old behavior still rollback-compatible.

## PR 5 — Make OAuth state transitions atomic

### Unit 5.1: native transactional token store

Test first:

- Port all Unit 3.1 failpoint cases to assert all-or-none state.
- Assert database precondition failures abort the entire batch rather than committing after a zero-row update.
- Assert local SQLite and local D1 have identical externally visible results.
- Race exchange/rotation against client revocation, grant compromise, expiry, and disconnect; require active client/grant, unexpired code/refresh, user, redirect, PKCE, resource, scope, and parent-generation checks inside the batch.

Minimum green:

- Implement `OAuthTokenStore` with native D1 prepared statements and `batch()` for production.
- Generate secrets before the batch; store hashes only.
- Use unique issuance records, foreign keys, and guard triggers/constraints so code eligibility and refresh-parent eligibility cannot silently lose races.
- Make every zero-row security guard deliberately fail the batch; route-side validation is not an authority boundary.

Verification: failpoint matrix, migration integration, secret-redaction scan, D1 batch rollback proof.

### Unit 5.2: atomic authorization-code exchange

Test first:

- Valid exchange, expired/mismatched/consumed code, PKCE failure, concurrent duplicate, D1 pre-commit failure, post-commit response failure.
- Assert one complete grant on success and no mutation on every pre-commit failure.

Minimum green:

- Replace separate consume/issue calls with one store transition.
- Preserve one-time-code semantics after a lost response; return standards-compliant `invalid_grant` on replay.

### Unit 5.3: atomic refresh rotation and reuse response

Test first:

- Valid rotation, concurrent rotation, wrong client/resource, revoked/expired token, failpoint matrix, old-generation replay after a successful rotation.
- Assert replay atomically marks the active grant compromised, immediately invalidating every grant-bound access and refresh credential, with a security event but no token data.
- Race two legitimate refresh calls and assert one issuance followed by the documented compromise outcome; require synthetic/reference clients to serialize refresh unless a cryptographically bound retry key exists.

Minimum green:

- Rotate parent, create child generation/access, and update active generation atomically.
- Transition one complete family to compromised on detected reuse per RFC 9700. During the mixed-version rollback window, synchronously revoke descendant rows too; after every eligible Worker checks grant state, descendant cleanup becomes retryable housekeeping.

### Unit 5.4: atomic disconnect

Test first:

- Disconnect active, already-disconnected, one of multiple same-client grants, and partial-failure injection.
- Assert exact-grant scope and idempotence. During the mixed-version window assert descendants are synchronously revoked in the same transaction; after the rollback floor advances, assert grant-aware Workers deny descendants even when housekeeping fails.

Minimum green:

- Make one guarded grant-state transition authoritative. During the mixed-version window, synchronously revoke descendant rows in the same transaction so a pre-grant-aware rollback cannot resurrect them. Only after every serving and rollback-eligible Worker checks grant state may descendant-row cleanup become asynchronous.

### Unit 5.5: revocation linearization

Test first:

- Race disconnect/compromise against an authenticated read, a D1 mutation, and each external-side-effect class.
- Assert a D1 mutation revalidates active grant/authorization epoch in its commit transaction; revocation-first rejects and mutation-first is recorded as accepted before disconnect.
- Assert cross-system work cannot create a new operation intent after revocation; an intent accepted before revocation follows its documented finish/compensate contract.

Minimum green:

- Add grant authorization epoch to operation admission. Make D1 mutation admission/write atomic; make external work execute only from a persisted authorized intent.
- Document that already-authorized reads and operations accepted before the revocation linearization point may complete.

PR exit: all Unit 3 regressions now green; concurrency has the documented linearizable or security-driven outcome; pre-grant-aware rollback cannot resurrect credentials; invariant audit remains clean.

## PR 6 — Cut reads to grants and close the schema

### Unit 6.1: grant-owned reads and account state

Test first:

- Account/API views for multiple client/resource grants, revoked/expired/reused families, and legacy unmapped records.
- Assert the UI/API never infers one connection by grouping on client name alone.

Minimum green:

- Read connection state from `OAuthGrant` and expose safe client/resource/created/last-used/status metadata.
- Add exact-grant disconnect/reconnect diagnostics without exposing token hashes.

### Unit 6.2: enforce and contract

Test first:

- Upgrade from every supported deployment schema; rollback to every declared compatible Worker; reject null/duplicate/cross-grant production writes.

Minimum green:

- Enforce required grant links and active-family uniqueness after backfill is clean and rollback window has passed.
- Remove legacy inference/dual-write paths in a separate contract migration.

PR exit: grant is the only canonical connection state and both forward migration and declared rollback work.

## PR 7 — Remove incidental auth writes and expose degradation

### Unit 7.1: deferred usage observation

Test first:

- Valid authentication succeeds when usage update throws/times out.
- `lastUsedAt` schedules through `waitUntil`, is rate-capped per credential, and never regresses timestamp.
- Revocation/client/resource checks remain synchronous.

Minimum green:

- Split authenticate from observe-use; schedule/coalesce the latter with bounded failure telemetry.

### Unit 7.2: limiter degradation and local ceilings

Test first:

- Missing, timeout, throw, deny, and success for each binding; telemetry unavailable; abusive concurrent/body request cases.

Minimum green:

- Emit explicit enforced/missing/error states and alertable counters.
- Add per-isolate concurrency/work admission plus platform quotas. Use fail-closed/503 behavior for risk-tier surfaces when the global limiter is unavailable; do not represent per-isolate admission as a global ceiling.

PR exit: a valid read has no mandatory non-security write; loss of rate limiting is visible and bounded.

## PR 8 — Make production proof continuous and exact

### Unit 8.1: release canary exactness

Test first:

- Workflow tests for candidate SHA mismatch, deployed SHA mismatch, missing secret, skipped phase, timeout, cleanup failure, refresh failure, and disconnect failure.

Minimum green:

- Pin canary runner/fixtures to the candidate or deployed source SHA.
- Exercise code exchange, MCP initialize/list/call, refresh, disconnect, and residue audit.
- Missing credentials and cleanup failures are red, never successful skips.

### Unit 8.2: high-cadence and independent synthetics

Test first:

- Synthetic phase tests, bounded retries/backoff, stale heartbeat, forged/replayed heartbeat, duplicate incident suppression, single-monitor false recovery, recovery closure, credential rotation/separation, and least-privilege cleanup.

Minimum green:

- Add a Cloudflare scheduled synthetic and a provider-neutral one-minute external synthetic entrypoint, plus separate long-lived sentinel and persistent service-worker browser lanes.
- Keep GitHub deep canary as independent diagnostic redundancy.
- Emit authenticated timestamp/nonce/run-ID/source/target heartbeats with separate execution and incident credentials; reject replay/forgery and rotate credentials.
- Open one durable incident per failure class. A single monitor can open/escalate but cannot suppress or close it; require two independent recovery sources or operator closure.

### Unit 8.3: SLOs and paging

Test first:

- Metric cardinality/privacy tests and alert-policy fixtures for outage, error-budget burn, stale heartbeat, invariant failure, rate-limit degradation, and cleanup failure.

Minimum green:

- Add dashboards/runbook links, count erroneous/excess 429s, cap audited rate-limit exclusions, and encode the sub-five-minute polling/timeout/retry/evaluator/delivery budget.
- Build provider-neutral two-channel alert delivery, then stop at the explicit activation gate for the operator's selected vendor/destinations. Run a controlled delivery test and record acknowledgement time after activation.

PR exit: provider-neutral engineering and staging evidence are complete. Production activation additionally requires selected monitor/paging destinations and credentials; after that gate, public failure is independently detected under five minutes, monitor death under ten, and the release cannot be green without cleanup and exact-SHA proof.

## PR 9 — Make tool retries and failures deterministic

### Unit 9.1: mutation idempotency

Test first:

- Inventory D1-only, R2, generation/AI, and other external side-effect domains. For every class, simulate commit/accepted-intent followed by lost response and identical retry; concurrent duplicate; same operation ID with different canonical input; cross-user/grant/client/tool/scope replay; revoked grant replay; expired record; storage failure.

Minimum green:

- Bind required operation identity to user, grant, client, tool, scope, and canonical input; reauthorize before replay; store only minimal/bounded or encrypted results under an explicit retention policy.
- For D1-only mutations, persist result atomically with the mutation. For R2/external effects, use deterministic resource keys and pending/completed reconciliation; promise deduplication/resumption, not a cross-system transaction.
- Explicitly mark mutations not retry-safe when a client cannot provide stable identity; never guess from timing alone.

### Unit 9.2: safe error and output contracts

Test first:

- Invalid input, unauthenticated, forbidden, conflict, rate limit, transient dependency, timeout, and unexpected exception for every tool family; assert redaction and retry metadata.
- Snapshot `outputSchema`, `structuredContent`, deterministic ordering/cache hints, legacy text, and scope-filtered `tools/list` across supported protocol versions.

Minimum green:

- Add one bounded error taxonomy and controlled retry fields/correlation ID; remove raw exception messages.
- Add structured outputs alongside legacy text and filter the catalog to granted scopes.

PR exit: operations declared retry-safe have proven domain-appropriate deduplication/replay, operations without stable identity are honestly declared non-retry-safe, errors do not leak internals, and clients can make deterministic retry decisions.

## PR 10 — Bound credential lifetime without mass disconnect

### Unit 10.1: capability telemetry and canary refresh

Test first:

- Client-family refresh observation, unknown clients, telemetry loss, privacy/cardinality, and canary cohort selection.

Minimum green:

- Measure refresh capability without changing lifetimes; continuously rotate a canary grant on each target client.

### Unit 10.2: staged finite access lifetime

Test first:

- New vs existing grants, canary/non-canary, expiry boundary, refresh recovery, stale refresh, and rollback switch.

Minimum green:

- Issue 24-hour access tokens to canary/new compatible grants, then reduce by configuration toward one hour after the planning acceptance window.
- Never retroactively expire persistent credentials; transition them on explicit reauthorization/revocation.

### Unit 10.3: refresh expiry and security events

Test first:

- Inactivity/absolute expiry boundaries, password/security event, family reuse, clock skew, and user-facing reconnect state.

Minimum green:

- Add configured inactive and maximum refresh lifetimes and atomic security-event revocation.

PR exit: compromise window is bounded for compatible new grants, with measured zero-regression client evidence.

## PR 11 — Capacity, retention, chaos, and recovery proof

### Unit 11.1: property/fuzz/load suites

Test first:

- State-machine property sequences, JSON/header/body fuzz seeds, concurrent exchange/refresh storms, reconnect loops, and representative tool mixes.

Minimum green:

- Deterministic model oracle, sanitized regression corpus, and repeatable load harness with no production data.
- Publish safe capacity envelope and saturation alerts; do not tune before measuring.

### Unit 11.2: bounded retention and janitor

Test first:

- Age/cardinality fixtures for expired codes, stale DCR clients, revoked generations, replay tombstones, expired idempotency rows, orphan references, batch boundaries, and interrupted cleanup.

Minimum green:

- Add indexed retention policy and dry-run-first bounded janitor with replay/audit retention floors, residue/size alerts, idempotence, and resumability.

### Unit 11.3: migration and rollback policy enforcement

Test first:

- Unsafe contract migration, missing compatibility declaration/bookmark/audit, last-compatible version selection, and rollback after schema expansion.

Minimum green:

- CI policy checks and release metadata make unsafe migrations non-deployable.

### Unit 11.4: disaster-recovery game day

Test first:

- Scripted scenarios for bad Worker, bad secret, D1 write outage, limiter outage, monitor outage, bad migration, replay, and expired grant.

Minimum green:

- Run in staging/non-production copy, record detection/RTO/RPO, verify Time Travel retention/tier, preserve undo bookmark, and update runbooks from observed friction.
- Production restore remains a two-person manual gate.

PR exit: every stated SLO/RTO/RPO/capacity claim has observed evidence and a current owner.

## Cross-PR release gates

Before every merge:

1. Focused red/green evidence recorded.
2. Affected and full tests pass with zero warnings and required coverage.
3. `npm run build`, Prisma validation/generation, and migration upgrade checks pass.
4. Security review confirms secret redaction, audience/client/grant binding, and fail-closed security state.
5. Branch candidate/staging canary and cleanup pass; production exact-SHA proof is necessarily post-merge because the current release workflow only deploys SHAs on `origin/main`.

After merge:

1. Deployment references the merged source SHA and declared schema compatibility.
2. Production synthetic, invariant audit, and heartbeat are green.
3. When protocol/auth/client behavior changed, real-client smoke passes for the affected matrix entries.
4. Alert and error-budget state remain healthy for the soak window.
5. Task-owned branches, worktrees, smoke identities, clients, grants, credentials, recipes, cookbooks, and artifacts are cleaned.

Real-Claude smoke and two-channel paging activation are explicit human gates when they require the selected test account, vendor, destinations, or credentials. Provider-neutral implementation proceeds without them, but production compatibility/paging is not declared complete until they pass.

## Required independent reviews

- Tinfoil Hat: trust boundaries, token theft/replay, concurrency, partial failure, destructive recovery, secret leakage, monitor compromise.
- Stranger With Candy: false semantics, external client ownership, canonical state, migration ambiguity, misleading green checks, impossible promises.
- Implementation reviewer: minimum-green discipline, direct D1/Prisma correctness, coverage, operational complexity.
- Merge reviewer: exact-head, migration compatibility, candidate/deployed SHA, rollback, live smoke, cleanup.
