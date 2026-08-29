# Service and client reliability hardening plan

Status: READY
Owner: root
Source: `origin/main@b0a5967e3e5547bbc741dd83992587442d75b45c`
Scope: Spoonjoy OAuth authorization server, remote MCP protected resource, connector lifecycle, production release/monitoring/recovery, and compatibility with clients Spoonjoy does not control
Review: Tinfoil Hat READY; Stranger With Candy READY

## Objective

Make a Spoonjoy connector remain usable until the user explicitly disconnects it or a documented security/expiry condition requires reauthorization, without unexplained disconnects, weakened OAuth replay protections, or hidden failures. “Reliable” means the service preserves its own invariants across concurrency, timeouts, partial platform failures, deploys, and recovery; conforms to the MCP/OAuth contracts clients rely on; detects production regressions before users do; and gives operators a rehearsed recovery path.

The target is not a literal promise that an external client, the internet, GitHub Actions, or Cloudflare can never fail. The target is that Spoonjoy never silently creates or strands an invalid connection state, fails explicitly and recoverably at boundaries it does not own, and can prove those properties continuously.

## Reliability contract

The finished system must satisfy these invariants:

1. An authorization code is consumed if and only if its access token, refresh token, and grant lineage are durably committed in the same D1 transaction.
2. During a successful refresh rotation, the presented refresh token is revoked if and only if its replacement access and refresh tokens commit in the same D1 transaction. Replay, expiry, explicit disconnect, and security events may revoke without replacement under their separate rules.
3. At most one refresh generation is active for a grant. Reuse of a rotated refresh token revokes the active family and produces a security signal.
4. Every access and refresh token is bound to one user, client, grant, scope, and canonical MCP resource. Once all serving and rollback-eligible Workers enforce grant state, one authoritative grant-state transition invalidates exactly that grant and every descendant credential. During the mixed-version window, the same transaction also marks descendant rows revoked so rollback to a pre-grant-aware Worker cannot resurrect them.
5. No raw access token, refresh token, authorization code, or PKCE verifier is stored or emitted in logs, analytics, workflow artifacts, or errors.
6. A transient telemetry, `lastUsedAt`, audit, or authenticated read-path limiter-backend failure never turns an otherwise valid MCP read into a failure, and the degraded protection remains visible. Risk-tier issuance and mutation surfaces may return explicit retryable 503s when their required global protection is unavailable.
7. Unsupported MCP methods and protocol variants fail as MCP responses, never as an unrelated application HTML route.
8. A client is never declared compatible from mocks alone. Contract tests, a production synthetic, and a real-client smoke each cover a different boundary.
9. Code rollback remains safe across every database migration in its declared rollback window.
10. Missing monitor credentials or a monitor that has stopped running is an alerting failure, not a successful green check.

## Initial service levels

These are release criteria after the measurement work lands, not claims about the current system:

- Availability: 99.99% successful use of an already-valid connector and 99.95% successful fresh OAuth connection journeys over a rolling 30 days, excluding invalid caller input and correctly applied contractual rate limits. Erroneous/excess 429s and limiter deny-all failures count against availability; excluded throttling is capped and audited.
- Correctness: zero known orphan access credentials, partially issued grants, duplicate active generations, cross-resource credentials, or unexplained connector revocations.
- Detection: a total OAuth/MCP outage or broken end-to-end synthetic is delivered to the paging evaluator within 5 minutes; a missing synthetic heartbeat within 10 minutes. The one-minute external poll, 30-second request budget, at most one 30-second retry, one-minute evaluator window, and one-minute delivery budget keep worst-case outage detection under four minutes.
- Recovery: last-known-good Worker rollback within 15 minutes; OAuth data repair or point-in-time recovery decision within 30 minutes; D1 recovery point no older than one minute when Time Travel is available.
- Performance: p95 server overhead below 750 ms for metadata, token, and MCP protocol-only calls, and p99 below 2 seconds. Tool execution latency is measured separately by tool.
- Release health: zero unresolved P0/P1 connector alerts and at least one successful post-deploy synthetic at the deployed source SHA before promotion is considered complete.

The 99.99% existing-connector objective permits roughly 4.4 minutes of error budget in a 30-day month; the 99.95% onboarding objective permits roughly 22 minutes. Exhausting half the relevant budget pauses risky connector changes; exhausting all of it permits only reliability and security releases until the rolling window recovers.

## Evidence from the current implementation

### What is already strong

- PKCE S256, exact redirect matching, authorization-code replay prevention, resource binding, OAuth metadata, DCR limits, token hashing, refresh rotation, and client revocation already exist.
- MCP requests are authenticated, body-bounded, token/IP limited, request-correlated, and instrumented with outcome, latency, client, resource, and tool metadata.
- Production deployment is source-SHA aware, creates a release artifact, runs a candidate canary, supports Worker version rollback, and has dedicated OAuth/MCP and D1 audit workflows.
- A read-only production D1 probe returned a current Time Travel bookmark, establishing present capability at one-minute resolution; the paid/free account tier and therefore 30-day/7-day retention remain unverified.

### P0 failure paths

- `app/lib/oauth-server.server.ts:298` burns an authorization code before `app/lib/oauth-server.server.ts:346` and `:358` independently create its access and refresh tokens. A failure between those writes strands the authorization.
- `app/lib/oauth-server.server.ts:438` revokes the presented refresh token before `:450` independently issues its replacement. A failure after revocation disconnects a previously healthy connector.
- `app/lib/oauth-server.server.ts:394` and `:398` split refresh and access-token revocation, allowing partial disconnect state.
- Refresh-token replay is rejected, but the schema has no durable token family/generation lineage with which to revoke the active descendant after reuse.
- MCP access tokens are currently persistent for any URL whose path is `/mcp`, rather than only the canonical protected resource, and existing access credentials are not keyed to one grant/connection.

### Protocol and client-boundary gaps

- The MCP transport is a custom stateless JSON implementation. Unsupported GET/SSE paths can fall through to the application surface instead of returning an explicit MCP method error.
- The protected resource does not yet enforce the MCP Streamable HTTP `Origin`, `Accept`, and supported protocol-version rules as a coherent boundary.
- Automated tests emulate clients but cannot prove Claude's hosted connector, browser connector, Desktop, or future protocol behavior. Anthropic hosts remote connector traffic in its cloud even when the UI is Desktop, so closing the local app is not a meaningful persistence test by itself.
- Access tokens are persistent, so real-client refresh behavior is rarely exercised and may regress without detection.
- `initialize` currently echoes any nonempty client protocol version. MCP 2026-07-28 is now released and removes that handshake in favor of self-describing stateless requests, so Spoonjoy can falsely claim support for a wire contract it does not speak.
- Mutating tools do not share a universal durable operation key. If the server commits but the HTTP response is lost, a client retry can duplicate user state.
- Unexpected tool failures are not yet a stable, privacy-safe taxonomy that tells a client whether retry is safe.

### Operational gaps

- GitHub explicitly documents that scheduled Actions can be delayed or dropped. GitHub run history inspected on 2026-08-29 showed nominally hourly gaps of about 6h52m and 5h24m, so it cannot be the only availability detector.
- Scheduled workflows treat missing secrets as a successful skip. That converts monitoring misconfiguration into green status.
- The OAuth canary runs code checked out from the default branch; its runner can drift from the exact production source SHA it is meant to certify.
- The checked-in `atomic-bootstrap` deployment path does not run the full OAuth/MCP canary. Production deploy run `33214198978` uploaded `production-release.json` with `checks=null` and `cleanup=null`, yet issue `#307` was closed as recovered from deploy success. This is a proven false-green release path and is the first operational fix; exact artifact digest/tier metadata was not available in the audit and is not claimed.
- The D1 audit finds useful invariants but does not own a durable incident/alert lifecycle equivalent to the OAuth canary.
- PostHog events and suggested monitors exist, but repository evidence does not prove alert policies, heartbeat monitoring, paging routes, or alert delivery tests are configured.
- Worker rollback does not roll back D1. A schema migration can therefore make an old Worker unsafe even when the deployment workflow can technically select it.
- Authentication updates `ApiCredential.lastUsedAt` synchronously on every valid API/MCP call, adding a D1 write and failure point to read-only traffic.

## Standards baseline

Implementation and tests must be pinned to dated, primary specifications rather than “whatever latest means” at runtime:

- OAuth Security Best Current Practice, RFC 9700 (January 2025): exact redirects, audience restriction, short-lived access tokens, refresh rotation or sender constraint, family lineage/replay handling, and inactive refresh expiry.
- MCP authorization and Streamable HTTP specifications. Spoonjoy must honestly preserve the client-proven 2025-06-18 path while adding an explicit 2026-07-28 stateless path; it must never claim either version without speaking that version's transport and authorization contracts, including RFC 9207 `iss`, issuer-bound client credentials, `application_type`, scope/resource rules, and the transition from DCR toward CIMD.
- OAuth Protected Resource Metadata, RFC 9728; Resource Indicators, RFC 8707; Authorization Server Metadata, RFC 8414; PKCE, RFC 7636.
- Cloudflare D1 `batch()` semantics: sequential statements in one SQLite transaction, with the full sequence aborted/rolled back when a statement fails.

Sender-constrained DPoP is not required in the first program because Spoonjoy cannot require an externally hosted client to support it. It remains an advertised capability only after Claude and other target clients prove support.

## Chosen architecture

### 1. A durable grant and token-family model

Add an `OAuthGrant` as the canonical user/client/resource/scope connection and make every authorization code, refresh generation, and access credential refer to it. Add immutable refresh lineage (`familyId`, `generation`, `rotatedFromId`) and explicit status/reason/timestamps. A grant owns at most one active refresh generation.

Database constraints—not only audits—enforce identity and uniqueness. Raw SQL migrations may add D1/SQLite partial unique indexes and triggers that Prisma cannot express. Foreign keys bind OAuth records to their client, user, grant, and issuing operation.

The migration is expand/contract:

1. Add nullable grant/lineage columns and new tables/indexes without changing old readers.
2. Dual-write and backfill deterministic grants for existing connections.
3. Audit and repair legacy ambiguity; do not guess when more than one active connection can own a credential.
4. Switch reads and invariant enforcement after the mixed-version rollback window passes.
5. Make fields required and remove legacy paths only in a later release.

### 2. One atomic token mutation boundary

Introduce a narrow `OAuthTokenStore` whose production implementation uses the native D1 binding and `D1Database.batch()`. Route handlers do validation and token generation; the store performs one atomic state transition:

- authorization exchange: create one unique issuance record from an eligible, unconsumed code; mark the code consumed; create access credential and refresh generation; commit all or none;
- refresh rotation: create one unique issuance from an eligible active parent; revoke the parent; create the replacement access and refresh records; commit all or none;
- disconnect/reuse: atomically transition the authoritative grant to `revoked` or `compromised`. Every access/refresh validation checks grant state. Until the rollback floor excludes all pre-grant-aware Workers, the same batch also synchronously revokes descendants; only after that floor advances may physical row marking/cleanup become idempotent housekeeping.

Unique issuance IDs, foreign keys, and guard triggers turn a failed precondition or concurrent winner into a database error so a D1 batch cannot silently continue after a zero-row conditional update. Active client, active grant, unexpired code/refresh, user, redirect, PKCE binding, resource, scope, and parent-generation eligibility are all revalidated inside the batch rather than trusted from route-side reads. The SQLite test implementation must use the same migration schema and transactional behavior; there is no permissive mock-only implementation.

Token responses are not persisted in plaintext. If a response is lost after a committed code exchange, the client must reauthorize, preserving OAuth one-time semantics. If a refresh response is lost, strict reuse detection may force reauthorization. Two honest concurrent refreshes are indistinguishable from theft for a public bearer client: one wins and the loser's replay compromises the family. Target clients and synthetics must serialize refresh; Spoonjoy documents this security-driven exception to “connected until explicit disconnect.” A replay receipt may return the same encrypted committed response only when the client supplies a stable, cryptographically bound idempotency key that distinguishes its retry from token theft; current public-client token possession alone is insufficient. No generic time-based replay grace is allowed.

### 3. Capability-aware token lifetime migration

Persistent bearer tokens are replaced with short-lived access tokens plus rotating refresh tokens, but only after refresh is continuously exercised in synthetic and real-client tests.

- First, measure and canary client refresh behavior while retaining current lifetimes.
- Then issue finite-lifetime tokens only to newly authorized canary grants, beginning at 24 hours.
- Reduce toward a one-hour target after at least two weeks without compatibility regressions and with successful browser, Claude web, and Desktop matrix results.
- Existing persistent credentials remain valid until their grant is reauthorized or explicitly revoked; a migration must never mass-disconnect users.
- Add inactive refresh expiry and absolute maximum lifetime with user-visible reauthorization semantics. Exact durations are configuration with documented security rationale and staged rollout, not hard-coded client-name branches.

### 4. A strict MCP protocol adapter

Put all `/mcp` methods through one transport boundary before application routing:

- POST supports the declared JSON response mode and validates the required `Accept` contract.
- GET with `Accept: text/html` preserves the human connector landing page; GET requesting unsupported SSE and unsupported DELETE behavior return explicit MCP/HTTP responses rather than falling through to unrelated HTML.
- Validate `Origin` when present against canonical trusted origins; reject invalid browser origins with 403 while preserving server-to-server clients that omit it.
- Accept only supported `MCP-Protocol-Version` values; apply the specification-defined default when absent; never echo arbitrary versions.
- Return the protected-resource challenge and audience consistently on every 401.
- Preserve request IDs and safe structured errors across all early exits.

Build a versioned conformance fixture suite from the dated specs, plus captured privacy-scrubbed request shapes from successful real clients. The adapter has an honest 2025 handshake path and a separate 2026 stateless path (`server/discover`, per-request identity/capabilities, routing headers, deterministic/cacheable lists), plus the 2026 OAuth changes: RFC 9207 issuer response/validation contract, issuer-bound credentials, DCR `application_type`, scope step-up/resource validation, and CIMD discovery with explicitly deprecated DCR compatibility. Client-name heuristics may only select a documented compatibility adapter; they may not weaken resource, redirect, token, or origin checks. The 2025 path remains until measured traffic and real-Claude validation meet the protocol's deprecation window.

### 4a. Retry-safe tools and stable client errors

Inventory mutations by side-effect domain. D1-only mutations accept a required durable operation ID and atomically store canonical input hash and result with the mutation. R2, AI/generation, and other external effects use deterministic resource keys plus a persisted pending/completed reconciliation state; they promise deduplication/resumption, not an impossible cross-system transaction. The idempotency key and unique lookup include user, grant, client, tool, scope, and operation ID; every replay reauthorizes the current grant and compares canonical input. Results are minimal/bounded or encrypted and expire under the retention policy. If a client cannot provide stable operation identity, the tool advertises that the mutation is not automatically retry-safe rather than pretending it is.

Return a bounded error taxonomy—invalid input, unauthenticated, forbidden, conflict, rate limited, transient dependency, and internal—with controlled `retryable`, `retryAfterSeconds`, and correlation metadata. Do not expose raw exception messages. Add `outputSchema` and `structuredContent` while retaining the legacy text representation during compatibility rollout; filter `tools/list` to tools the grant can actually use.

### 5. Remove incidental writes from the request path

Authentication returns after its required credential/client reads. `lastUsedAt` becomes a best-effort, rate-capped background update through `waitUntil`, at most once per credential per observation window. Its failure emits telemetry but cannot fail the MCP request. The same rule applies to analytics and non-security audit metadata.

Security state—authoritative grant revocation/compromise, token rotation, and grant status—is never deferred. Descendant-row cleanup may be deferred only after the rollback floor guarantees every eligible Worker rejects on grant state first; it remains synchronous during the mixed-version window.

### 6. Defense in depth with visible degradation

Keep rate limiting fail-open for authenticated reads where availability wins, because it is not the credential boundary, but expose three distinct states: enforced, binding missing, backend error/timeout. Use fail-closed/503 policy for unauthenticated or expensive issuance/mutation surfaces where a missing global limiter would be unsafe. Add per-isolate concurrency/body-size admission plus Cloudflare platform quotas; per-isolate admission is defense in depth, not a system-wide ceiling. A true global ceiling requires the remote limiter or another global coordination primitive. Token, code, verifier, and credential hashes never become limiter or telemetry payloads in reversible form.

### 7. Independent, heartbeat-monitored production proof

Use three complementary checks:

1. Release canary: mandatory in every deployment mode, branch-candidate/staging proof before merge and exact deployed source-SHA proof after merge, full OAuth code exchange + authenticated MCP initialize/discover/list/call + refresh rotation + disconnect, with a required structured result and disposable data cleanup. Deployment success alone can never close a canary incident.
2. Platform-local minute synthetic: a Cloudflare Cron Trigger/Workflow checks metadata, token lifecycle, MCP conformance, and D1 invariants at high cadence with bounded retries.
3. Platform-independent synthetic: a separately hosted monitor hits the public surface every minute. GitHub Actions remains a secondary deep diagnostic, never the primary pager.

Each monitor emits an authenticated, timestamped, nonce/run-ID-bound heartbeat tied to source and target identity. Missing credentials, replayed/forged heartbeat, missing/malformed result artifacts, cleanup failure, no heartbeat, or skipped execution is failure. Execution credentials and incident-management credentials are separate and rotated. One monitor can open/escalate but cannot suppress or close an incident alone; closure requires independent healthy evidence from two monitor classes or an operator. Alerts route to at least two independent delivery paths and are tested quarterly. Synthetic identities are least-privilege, separately revocable, and never share production-user data.

Use separate synthetic lanes: disposable fresh authorization; a long-lived sentinel grant that is never silently reauthorized and proves survival across deploys/days; and a persistent real browser profile with the production service worker enabled. The long-lived sentinel performs a harmless read-only tool call. The browser lane proves login return and storage behavior across separate processes. A real-Claude lane proves the hosted boundary on a controlled test account but is not conflated with server availability.

### 8. Observable state, not event soup

Create low-cardinality metrics and SLO views for:

- request count/error/latency by OAuth stage, MCP method, client family, protocol version, and deployed source SHA;
- grant issuance, refresh, reuse, revoke, atomic rollback, and invariant violation outcomes;
- rate-limit enforced/degraded state;
- synthetic phase, heartbeat age, cleanup result, and source SHA;
- D1 query failure/latency and deferred `lastUsedAt` outcome.

No metric labels use user IDs, token material, raw URLs, recipe content, or unbounded client IDs. Logs share the request/issuance/grant correlation IDs needed to reconstruct one failure without joining on secrets.

### 9. Release-safe schema and recovery

Every migration declares:

- the old and new Worker versions that can safely read/write the expanded schema;
- forward repair and rollback behavior;
- a pre-migration Time Travel bookmark and post-migration invariant audit;
- the point after which contract/drop steps are allowed.

Deploy progression becomes: expand migration → old-code compatibility proof → candidate → synthetic → limited traffic if supported → full promotion → post-deploy synthetic. A failed post-deploy synthetic automatically stops promotion and selects the last compatible Worker; it never automatically restores D1.

Quarterly game days rehearse Worker rollback, bad-secret rotation, limiter outage, D1 write failure, partial synthetic outage, expired refresh, replay, and Time Travel restore in a non-production copy/staging database. Production D1 restore always remains an explicit, two-person destructive operation with a preserved undo bookmark.

### 10. Linearizable disconnect and in-flight work

Revocation linearizes at the guarded grant-state commit. A D1-only mutation revalidates the active grant and its authorization epoch inside the same transaction as its write: if revocation commits first the mutation fails; if the mutation commits first it is an operation accepted before disconnect. Cross-system R2/generation work first commits an authorized operation intent containing the grant epoch; an intent accepted before revocation may finish or compensate according to its tool contract, while no new intent may be accepted afterward. Already-authorized reads may finish. The UI/runbook says “disconnect prevents new operations immediately; an operation already accepted may complete,” which is the strongest honest distributed guarantee without destructive cancellation.

## Delivery sequence

### P0 — prove and preserve connection state

1. Fix the proven false-green deployment path: require the full canary and validated checks/cleanup artifact in every deployment mode; never infer recovery from job success.
2. Freeze a dated client/protocol compatibility matrix and add missing MCP boundary contract tests, including honest 2025 vs 2026 negotiation.
3. Add deterministic D1 fault injection around every OAuth mutation step; demonstrate the current stranded-code, revoked-without-replacement, orphan-access, and partial-disconnect failures.
4. Expand the grant/family schema and implement atomic authorization exchange, refresh rotation, replay-family revocation, and disconnect.
5. Add invariant constraints, backfill/audit/repair tooling, and mixed-version migration tests.
6. Make release and independent synthetics exact-SHA, non-skippable, heartbeat monitored, cleanup enforced, and alerting capable; add the long-lived and service-worker lanes.
7. Add SLO dashboards, paging rules, and an operator incident runbook; test alert delivery.

Engineering exit: injected failure at every pre-commit point leaves no state change; every post-commit point leaves one valid grant; concurrent exchange has one winner; concurrent refresh has the explicitly tested security outcome and reference clients serialize it; rollback compatibility and the complete monitor/alert interface are proven in staging. Production-activation exit: the selected external monitor, paging destinations, and controlled real-Claude account are configured; alert delivery and real-client compatibility pass; production outage detection is observed under five minutes.

### P1 — shrink blast radius and remove request-path fragility

7. Defer/rate-cap `lastUsedAt` and add D1 latency/error metrics.
8. Stage finite-lived MCP access tokens, inactive refresh expiry, and strict token-family reuse response through canary grants.
9. Add grant-scoped connection visibility and atomic user disconnect/reconnect diagnostics to account settings.
10. Add limiter degradation metrics, local concurrency ceilings, and abusive-input/fuzz coverage.
11. Add durable idempotency, safe typed failures, scope-filtered tools, and structured output contracts for every mutating/client-facing tool.
12. Add a real-client matrix for Claude web, browser app, Desktop, and official TypeScript/Python MCP clients across supported 2025 and 2026 revisions; run it on protocol/auth changes and on a fixed cadence.

Exit: no non-security write is required for an authenticated read; compromised access-token lifetime is bounded for newly authorized compatible clients; users and operators can name and revoke one connection without collateral damage.

### P2 — continuous resilience

13. Add load/soak tests for concurrent OAuth exchange, refresh storms, reconnect loops, and representative tool mixes; publish capacity envelopes and alert thresholds.
14. Add property/model tests for the grant state machine and protocol fuzzing for headers, JSON-RPC batches/notifications/errors, body boundaries, cancellation, and duplicate delivery.
15. Add indexed retention/janitor policies for codes, registrations, receipts, idempotency rows, revoked credentials, and replay tombstones, with dry-run evidence and size/age alerts.
16. Add expand/contract migration policy enforcement and automated last-compatible-version selection.
17. Run and record disaster-recovery/game-day exercises; verify Time Travel tier/retention and longer-term encrypted export policy if business RPO requires it.
18. Turn production incidents and client incompatibilities into permanent regression fixtures with an owner and removal criteria for every compatibility shim.

Exit: stated SLO/RTO/RPO and capacity limits have measured evidence, and every runbook has succeeded in rehearsal.

## Verification strategy

Every production change follows strict TDD and records the actual red failure before implementation. Required layers:

- pure state-machine/property tests for legal and illegal grant transitions;
- integration tests against migrated SQLite and local D1, including foreign keys, triggers, partial indexes, batches, and concurrent calls;
- fault-injection tests before/after each statement and before/after response serialization;
- protocol contract tests generated from the pinned MCP/OAuth cases;
- security tests for replay, cross-client/resource mix-up, redirect/origin confusion, secret redaction, and abusive inputs;
- release-workflow tests for missing secrets, wrong source SHA, skipped jobs, stale heartbeats, cleanup failures, rollback compatibility, and alert opening/closing;
- full repository tests with 100% coverage and zero warnings, production build, migration validation, live synthetic, and real-client smoke where the boundary changed.

No production OAuth test may leave a user, client, grant, credential, recipe, or cookbook behind. Cleanup failure fails the run and pages separately from product failure.

## Rollout and rollback

- All behavioral changes have kill switches that select old vs new issuance/transport policy; switches do not bypass security validation.
- Shadow/audit mode precedes enforcement for schema backfill, finite token lifetime, origin/version enforcement, and new monitor alerts.
- Roll out by synthetic grant, internal account, small cohort, then all new grants. Existing grants are never silently rewritten into a stricter state.
- Any rise in `invalid_grant`, reconnect, 401, protocol negotiation, or synthetic failure beyond the declared threshold halts rollout automatically.
- Rollback chooses the last Worker version declared compatible with the current schema. Contract migrations wait until the rollback window and error budget are healthy.

## Non-goals and boundaries

- Spoonjoy will not attempt to persist or modify Claude's private connector state, automate a personal Claude account in ordinary CI, or claim that closing a local UI disconnects a hosted connector.
- The program does not add DPoP, SSE streaming, resumability, or Durable Objects merely for architectural prestige. Add them only when a supported client capability or measured bottleneck requires them.
- It does not weaken one-time authorization codes or refresh replay detection to hide network response loss.
- It does not automatically perform a destructive production D1 restore.
- It does not rewrite the existing SHA-pinned release orchestrator; it hardens its evidence and migration contract incrementally.

## Decisions resolved by this plan

- Canonical connection ownership lives in `OAuthGrant`, not inferred from client name or coincident token fields.
- Native D1 transactional batches are the initial consistency primitive. Durable Objects are a measured escalation, not the starting point.
- Security mutations are synchronous and atomic; analytics/usage metadata is asynchronous and disposable.
- Short-lived access tokens are the destination, reached through capability proof and staged issuance rather than mass expiry.
- GitHub scheduled Actions are diagnostic redundancy, not the primary production monitor.
- Compatibility claims require a real hosted-client check at the external boundary.

## Remaining human-only decisions

These do not block provider-neutral engineering through P0, but they are explicit production-activation gates and the overall reliability program cannot be called operationally complete until resolved:

- Which independent monitoring/paging vendor and on-call destinations Spoonjoy will pay for/use.
- Whether the D1 account tier's Time Travel retention satisfies the business recovery policy or requires encrypted long-term R2 export.
- Which non-personal Claude test organization/account may hold a persistent least-privilege canary connector.

Engineering must present the measured requirements and cost before activating a paid service. Until then, build the monitor interface, heartbeat semantics, and a free/staging implementation without representing it as complete production paging.

## Primary references

- https://www.rfc-editor.org/rfc/rfc9700.html
- https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- https://modelcontextprotocol.io/specification/2026-07-28
- https://blog.modelcontextprotocol.io/posts/2026-07-28/
- https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://docs.github.com/en/actions/how-tos/troubleshoot-workflows
- https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
