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
