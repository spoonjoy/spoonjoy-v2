# Doing: Native Search Telemetry

**Status**: READY_FOR_EXECUTION
**Execution Mode**: direct
**Created**: 2026-07-21 14:01
**Planning**: ./2026-07-21-1353-planning-native-search-telemetry.md
**Artifacts**: ./2026-07-21-1353-doing-native-search-telemetry/

## Execution Mode

- **direct**: Execute the narrow backend units in this worktree and use Slugger as the independent hostile reviewer.

## Objective

Extend the existing closed-schema native telemetry endpoint with privacy-safe search lifecycle events and bounded aggregate metadata, update the generated API contract, and open a reviewed ready PR without merging or deploying it.

## Completion Criteria

- [ ] Three new search lifecycle events and four approved metadata fields are accepted and mapped to analytics.
- [ ] Raw query keys, unrecognized fields, invalid scopes, malformed numbers, and out-of-range numbers are rejected before analytics capture.
- [ ] OpenAPI and generated API playground artifacts expose the exact closed schema and privacy language.
- [ ] Focused tests, generated-contract verification, full app and Worker coverage, both typechecks, and build pass with zero warnings.
- [ ] A hostile final review converges with no BLOCKER or MAJOR findings.
- [ ] Atomic commits are pushed and a ready, unmerged PR is open.

## Code Coverage Requirements

**MANDATORY: 100% coverage on all new code.** Exercise every new enum member, accepted field, null/omitted value, lower/upper boundary, type error, unsupported scope, raw-query rejection, and unknown-field rejection without exclusions.

## TDD Requirements

1. Add tests before implementation and prove an expected red failure.
2. Implement only after the red result is recorded.
3. Keep tests unchanged during the green step unless a reviewer identifies a test defect.
4. Run focused and complete repository gates with zero warnings.

## Work Units

### Legend

⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

### ✅ Unit 0: Baseline And Contract Freeze
**What**: Record exact base/branch state and run the current focused native telemetry and OpenAPI tests before changing code.
**Output**: `unit-0-baseline.md` and baseline test log in the artifacts directory.
**Acceptance**: Worktree provenance is exact, no non-task dirty state exists, and focused baseline tests pass.

### ⬜ Unit 1a: Privacy-Safe Search Telemetry Tests
**What**: Add failing route and OpenAPI tests for the three event names, canonical scope enum, four analytics mappings, numeric boundaries, omitted/null values, unsupported scopes, malformed numbers, raw-query spellings, unknown fields, and no-capture-on-rejection.
**Output**: Red tests in `test/routes/api-v1-native-telemetry.test.ts` and `test/lib/api-v1-openapi.server.test.ts`, plus the red log.
**Acceptance**: The focused command fails because search events/fields are absent while existing tests remain healthy; tests capture analytics output and prove forbidden text is absent.

### ⬜ Unit 1b: Endpoint And OpenAPI Implementation
**What**: Extend `app/lib/api-v1.server.ts` using canonical `SEARCH_SCOPES`, bounded field parsers, and privacy-safe analytics keys; extend `NativeTelemetryRequest` and its example in `app/lib/api-v1-openapi.server.ts`; regenerate `app/lib/generated/api-v1-playground.ts`.
**Output**: Passing focused tests and current generated artifact.
**Acceptance**: Focused tests pass unchanged; raw query remains unrecognized; generated-contract verification, typechecks, and build pass with zero warnings.

### ⬜ Unit 1c: Full Verification And Hostile Review
**What**: Run app coverage, Worker coverage, both typechecks, build, generated-contract verification, diff/privacy scans, and an independent hostile review of the exact pushed head. Repair and rerun on substantive findings.
**Output**: Validation logs and reviewer verdict in the artifacts directory.
**Acceptance**: All local gates pass, coverage remains 100%, warnings are zero, no raw-query field/logging path exists, and review converges.

### ⬜ Unit 2: Ready Pull Request
**What**: Push the exact reviewed head and open a ready PR to `main` with scope, privacy guarantees, and validation evidence. Do not merge or deploy.
**Output**: Ready PR URL and exact branch/head metadata.
**Acceptance**: PR is open and non-draft at the reviewed SHA; no deployment/release/provider/native mutation occurred.

## Progress Log

- 2026-07-21 14:01 Doing doc created after planning review convergence.
- 2026-07-21 14:06 Unit 0 complete: exact provenance recorded and 23 focused baseline tests passed after local test database initialization.
