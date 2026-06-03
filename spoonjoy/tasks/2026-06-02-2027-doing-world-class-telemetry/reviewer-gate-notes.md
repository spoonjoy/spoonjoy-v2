# Reviewer Gate Notes

## 2026-06-03 07:16

- Earlier doing-doc review passes converged for granularity, validation, ambiguity, quality, and Tinfoil scrutiny.
- The final fresh Stranger With Candy retry repeatedly failed with provider-side `429 Too Many Requests` errors, including after cooldown and smaller-model retries.
- Slugger fallback review timed out without a pending response.
- Local fallback checks completed before execution:
  - All explicitly cited implementation/test/doc files checked for Unit 0 and the doing doc exist.
  - Every work-unit header in the doing doc uses the required status emoji format.
  - Planning and doing completion criteria remain unchecked because no implementation evidence exists yet.
  - The developer docs/playground client telemetry gap found locally was added to both planning and doing docs before execution.
- User repeatedly approved continuing with "go on" on 2026-06-03, so execution proceeded with this limitation recorded rather than blocking indefinitely on reviewer-service rate limits.

## 2026-06-03 07:42

- Unit 3b fresh reviewer returned `FINDINGS`.
- Major finding: Unit 3b public/discovery telemetry already emitted authenticated principal metadata on optional public routes, while Unit 3c/3d reserve authenticated metadata for a later red-test gate.
- Remediation path:
  - Constrain Unit 3b public/discovery telemetry to anonymous/public metadata while preserving authorization behavior and response wire format.
  - Add supplemental Unit 3c red coverage for authenticated optional public reads.
  - Reintroduce authenticated metadata in Unit 3d under the now-explicit test contract.

## 2026-06-03 08:02

- Unit 3f fresh reviewer returned `FINDINGS`.
- Blocker finding: method-mismatch telemetry could fall back to a raw request path and leak actual path ids, for example `POST /api/v1/shopping-list/items/{actualItemId}`.
- Remediation path:
  - Unit 3h now derives `route_template` from a method-matching resource, then a path-matching resource, then `/api/v1/{unknown}`.
  - Unit 3g added explicit unknown-path telemetry coverage asserting arbitrary path text is not emitted.
  - Unit 3h keeps method-not-allowed routes on the controlled resource template rather than the raw path.

## 2026-06-03 08:13

- Unit 3h fresh reviewer returned `FINDINGS` after the path-template fix.
- Blocker finding: lifecycle telemetry still emitted `origin_host`/`referrer_host` for IP-literal `Origin`/`Referer` headers.
- Remediation path:
  - `headerHost` now drops IPv4 and IPv6 literal hosts before analytics capture.
  - `test/routes/api-v1-telemetry.test.ts` includes explicit IPv4/IPv6 host regression coverage and verifies those addresses do not appear in serialized lifecycle telemetry.
  - Focused API v1 telemetry tests pass after commit `0573848`.

## 2026-06-03 08:28

- Unit 4b fresh reviewer returned `FINDINGS`.
- Blocker finding: `POST /api/tools/:name` could promote a raw path segment to the legacy `operation` telemetry property before validating it against known operations.
- Major finding: `X-Request-Id` was copied verbatim into legacy telemetry, allowing client-supplied secrets or free text to ship as `request_id`.
- Minor finding: the real `Error(/not found/)` response mapping did not assert configured PostHog lifecycle telemetry.
- Remediation path:
  - Legacy tool operations are now allowlisted against `listSpoonjoyApiOperations()` before any path segment is promoted to `operation`; unknown tool paths emit `/api/{unknown}` without the raw segment.
  - Legacy `request_id` now accepts only short `req_...` ids or UUIDs; anything else falls back to `unknown`.
  - `test/routes/api.test.ts` covers unsafe request-id fallback and unknown tool-path privacy.
  - `test/routes/route-shell-coverage.test.ts` now asserts `error_code: "not_found"` lifecycle telemetry for real operation not-found responses and verifies the exception message is not in the event.
  - Focused legacy coverage, API v1 telemetry tests, typecheck, and build pass after commit `a5e779b`.
  - Round 2 reviewer response: `CONVERGED`.

## 2026-06-03 08:39

- Unit 5b fresh reviewer returned `CONVERGED`.

## 2026-06-03 08:51

- Units 5c-5g fresh reviewer returned `CONVERGED`.

## 2026-06-03 09:01

- Units 6a-6b fresh reviewer returned `FINDINGS`.
- Major finding: `/oauth/register` parsed JSON `null` could throw before the guarded OAuth validation response path, skipping safe 400 telemetry.
- Minor finding: register telemetry tests asserted `captureEvent` calls but not Worker `waitUntil` scheduling.
- Remediation path:
  - `handleOAuthRegister` now rejects top-level non-object JSON, including `null` and arrays, with a CORS-preserved 400 `invalid_request` response before metadata access.
  - `test/routes/oauth-register-telemetry.test.ts` now covers null/array bodies and asserts every success, error, method, and rate-limit capture promise is handed to `waitUntil`.
  - Focused register telemetry tests, existing OAuth route tests, typecheck, and build pass after the remediation.
  - Round 2 reviewer response: `CONVERGED`.

## 2026-06-03 09:11

- Unit 6c fresh reviewer returned `CONVERGED`.
- Unit 6d fresh reviewer returned `CONVERGED`.

## 2026-06-03 09:17

- Unit 6e fresh reviewer returned `FINDINGS`.
- Major finding: token telemetry tests covered oversized form bodies but not invalid content-type/malformed form bodies, while the red artifact claimed both.
- Minor finding: raw IP exclusion was only asserted on the rate-limit branch.
- Remediation path:
  - `test/routes/oauth-token-telemetry.test.ts` now covers an `application/json` token request as an invalid form body and asserts safe `invalid_request` telemetry.
  - A success-path request now carries `CF-Connecting-IP`, and the shared assertion forbids raw IP literals in every token telemetry event.
  - The red artifact now distinguishes token values/prefixes from the controlled `refresh_token` grant class.
  - Round 2 reviewer response: `CONVERGED`.

## 2026-06-03 09:22

- Unit 6f fresh reviewer returned `CONVERGED`.

## 2026-06-03 09:26

- Unit 6g fresh reviewer returned `FINDINGS`.
- Major finding: revoke telemetry tests claimed cookie/auth-header exclusion but did not send or forbid those values.
- Remediation path:
  - `test/routes/oauth-revoke-telemetry.test.ts` now sends raw `Authorization` and `Cookie` values on success and invalid-body paths, and explicitly forbids those values in lifecycle telemetry.
  - The shared revoke telemetry assertion also forbids `Cookie`, `Authorization`, raw IP literals, and raw body markers across events.
  - The strengthened contract still fails red against pre-implementation code because `spoonjoy.oauth.revoke` is missing.

## 2026-06-03 09:40

- Unit 6i fresh reviewer returned `CONVERGED`.
- Reviewer reran the focused OAuth suite successfully: 9 files, 73 tests, no warning output.
- Reviewer confirmed Unit 6i is tests/docs only, the doing doc status and completion log are present, the coverage caveat is honest, and privacy assertions remain meaningful across raw redirect/body/token/state/header/IP cases.

## 2026-06-03 09:45

- Unit 7a fresh reviewer returned `CONVERGED`.
- Reviewer confirmed the diff is tests/artifacts only, targeted tests pass (2 files, 10 tests), and the bootstrap contract covers missing/blank key, true-ish disabled flag, custom host, manual pageview mode, exception capture gated by init, masked session recording, hydration without init, and query/hash-free page URLs.
- Reviewer accepted the immediate-green note because Unit 7b explicitly allows recording existing bootstrap behavior as sufficient when Unit 7a exposes no implementation gap.

## 2026-06-03 09:47

- Unit 7b fresh reviewer returned `CONVERGED`.
- Reviewer confirmed no app-code changes landed in `app/lib/analytics.ts`, `app/entry.client.tsx`, or `app/vite-env.d.ts`.
- Reviewer reran the focused bootstrap tests successfully: 2 files, 10 tests.
- Reviewer confirmed the no-op implementation decision is valid because existing code already gates on `VITE_POSTHOG_KEY`, honors `VITE_POSTHOG_DISABLED`, configures host, disables automatic pageviews, enables pageleave/exceptions, and masks session recordings.

## 2026-06-03 09:48

- Unit 7c fresh reviewer returned `CONVERGED`.

## 2026-06-03 09:58

- Unit 7d fresh reviewer returned `CONVERGED`.
- Reviewer confirmed Unit 7d was tests/docs only and that the red tests assert safe helper behavior, controlled event names, generated manifest counts/metadata, status/latency bucketing, and privacy exclusions for tokens, OAuth values, URLs, queries, request/response bodies, headers, request IDs, examples, and `clientMutationId`.

## 2026-06-03 10:02

- Unit 7e fresh reviewer returned `CONVERGED`.

## 2026-06-03 10:06

- Unit 7f fresh reviewer returned `CONVERGED`.
- Reviewer confirmed focused developer telemetry tests pass, `app/lib/analytics.ts` remains 100% covered, typecheck/build pass, and the global coverage caveat is limited to unrelated existing route-module gaps.

## 2026-06-03 10:12

- Unit 8a fresh reviewer returned `CONVERGED`.
- Reviewer confirmed Unit 8a landed as tests/artifact/doing-doc only, the focused suite failed red for intended docs/config gaps, and the assertions avoid demanding or leaking real PostHog secret values.

## 2026-06-03 10:17

- Unit 8b fresh reviewer returned `FINDINGS`.
- Major finding: `DEPLOY.md` listed `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, and `VITE_POSTHOG_DISABLED` under `Secrets (set via wrangler secret put)`, which could lead operators to set public build-time Vite values as Worker secrets and miss client analytics during `pnpm run build`.
- Minor finding: `README.md` put optional `wrangler secret put POSTHOG_KEY` inside the main required-looking secret command block.
- Remediation in Unit 8c:
  - `DEPLOY.md` now separates Worker secrets, optional Worker telemetry variables, and public build-time variables.
  - `README.md` now keeps `POSTHOG_KEY` out of the main secret command block and describes it as optional telemetry setup.
  - `test/scripts/deployment-preflight.test.ts` now asserts that `VITE_POSTHOG_*` values are not documented as `wrangler secret put` secrets and are present in the public build-time section.

## 2026-06-03 10:20

- Unit 8c fresh reviewer returned `FINDINGS`.
- Major finding: the regression coverage excluded `VITE_POSTHOG_KEY` and `VITE_POSTHOG_DISABLED` from the `wrangler secret put` summary but forgot `VITE_POSTHOG_HOST`.
- Remediation:
  - `test/scripts/deployment-preflight.test.ts` now checks all three `VITE_POSTHOG_*` names for `wrangler secret put` absence, secrets-section absence, and public build-time section presence.
  - The Unit 8c artifact wording now names all three variables instead of using an overbroad wildcard claim.
