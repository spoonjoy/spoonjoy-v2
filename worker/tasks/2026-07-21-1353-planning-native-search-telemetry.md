# Native Search Telemetry

Status: approved

## Goal

Extend the existing native telemetry endpoint with privacy-safe search lifecycle diagnostics so native clients can report search start, completion, and failure without sending or logging search text.

## Scope

### In Scope

- Add `search_started`, `search_completed`, and `search_failed` to the existing native telemetry event allowlist.
- Accept only bounded metadata fields `searchScope`, `searchQueryLength`, `searchResultCount`, and `durationMilliseconds` through the existing closed request schema.
- Constrain `searchScope` to the canonical API search scopes: `all`, `recipes`, `cookbooks`, `chefs`, and `shopping-list`.
- Map accepted metadata to privacy-safe analytics properties without recording raw search text.
- Update the OpenAPI schema, example, and generated API playground artifact.
- Add comprehensive route and OpenAPI tests for accepted values, boundaries, malformed values, unsupported scopes, raw-query rejection, unknown-field rejection, and analytics redaction.
- Run focused tests, generated-contract verification, full coverage, worker coverage, both typechecks, build, and an independent hostile review.
- Push an atomic implementation and open a ready PR after all local gates and review converge.

### Out of Scope

- Native app source changes.
- Search endpoint behavior or search-result ranking changes.
- Production/provider deployment, release state, or TestFlight work.
- Database schema or migrations.
- Merging the PR.

## Completion Criteria

- `POST /api/v1/native/telemetry` accepts all three new event names and the four approved metadata fields.
- Accepted telemetry maps to `search_scope`, `search_query_length`, `search_result_count`, and `duration_milliseconds` analytics properties.
- The endpoint rejects raw-query spellings and every unrecognized body field before `captureEvent` runs.
- Scope and numeric field validation covers valid, null/omitted, type, lower-bound, and upper-bound behavior.
- OpenAPI advertises the exact event/scope enums, numeric bounds, and closed-schema privacy contract; the committed generated playground artifact is current.
- `pnpm exec vitest run test/routes/api-v1-native-telemetry.test.ts test/lib/api-v1-openapi.server.test.ts --fileParallelism=false` passes.
- `pnpm run verify:clean:generated-contract`, `pnpm run verify:clean:test:coverage`, `pnpm run verify:clean:test:workers:coverage`, `pnpm run verify:clean:typecheck`, `pnpm run typecheck:scripts`, and `pnpm run verify:clean:build` pass with zero warnings.
- A fresh hostile reviewer reports no BLOCKER or MAJOR findings.
- The branch is pushed and a ready, unmerged PR is open.

## Code Coverage Requirements

- Maintain the repository's mandatory 100% statement, branch, function, and line coverage.
- Exercise every new event, field, validation error, omitted/null branch, and privacy rejection path.
- Do not add coverage exclusions.

## Open Questions

- None. The user fixed the public field names and prohibited raw query handling; existing endpoint/search contracts determine the remaining implementation details.

## Decisions Made

- Extend `handleNativeTelemetryRequest` in `app/lib/api-v1.server.ts`; do not add a parallel endpoint.
- Reuse canonical scopes from `SEARCH_SCOPES` so telemetry and search cannot drift.
- Keep all four search fields optional and nullable, matching the endpoint's existing forward-compatible diagnostic shape; clients may emit the subset meaningful to each lifecycle event.
- Bound query length and result count at `100000`, consistent with existing native count telemetry; bound duration at `86400000` milliseconds to reject nonsensical day-plus samples.
- Never add a raw query field, hash, prefix, token, or derived text. Query length is the only query-derived value accepted.
- Use the existing `objectSchema` helper so OpenAPI continues to publish `additionalProperties: false`.

## Context / References

- `/Users/arimendelow/Projects/spoonjoy-v2-native-search-telemetry/app/lib/api-v1.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-native-search-telemetry/app/lib/search.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-native-search-telemetry/app/lib/api-v1-openapi.server.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-native-search-telemetry/app/lib/generated/api-v1-playground.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-native-search-telemetry/test/routes/api-v1-native-telemetry.test.ts`
- `/Users/arimendelow/Projects/spoonjoy-v2-native-search-telemetry/test/lib/api-v1-openapi.server.test.ts`

## Notes

- The endpoint calls `assertKnownFields` before building or scheduling the PostHog payload, so rejection tests can prove forbidden fields never reach `captureEvent`.
- The generated playground file is produced by `pnpm run api:playground:generate` and verified by `pnpm run verify:clean:generated-contract`.
- Source fidelity was checked at branch commit `4442b2513df18fccfdac0f251b6c2c14c24a8e53`, whose only delta from base is this planning document. The cited generated path exists at that commit.

## Progress Log

- Planning doc created from exact `origin/main` commit `d50b8ff5730c68597f6b80077df799927a56e3bf`.
- 2026-07-21 13:55 Initial hostile review found no document defect but could not certify source fidelity after exhausting its read quota; exact validation commands and branch provenance added for the second pass.
- 2026-07-21 13:59 Round 2 hostile planning review converged with no findings.
