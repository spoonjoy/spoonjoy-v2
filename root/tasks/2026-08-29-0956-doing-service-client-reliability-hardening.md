# Service and client reliability hardening — execution contract

Status: READY
Owner: root
Source: `origin/main@b0a5967e3e5547bbc741dd83992587442d75b45c`
Planning doc: `root/tasks/2026-08-29-0956-planning-service-client-reliability-hardening.md`
Review: Tinfoil Hat READY; Stranger With Candy READY

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

- RFC 9207 `iss` on authorization responses and mix-up rejection fixtures; issuer-bound client credentials; DCR `application_type`; scope step-up/resource validation; CIMD discovery and DCR deprecation compatibility.
- Assert metadata and behavior never claim a 2026 capability that is not implemented.

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
