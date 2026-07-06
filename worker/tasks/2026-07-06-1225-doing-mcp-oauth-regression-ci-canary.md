# Doing: MCP OAuth Regression CI Canary

**Status**: IMPLEMENTED_LOCAL_VERIFIED
**Execution Mode**: direct
**Created**: 2026-07-06 12:25
**Planning**: ./2026-07-06-1225-planning-mcp-oauth-regression-ci-canary.md
**Artifacts**: ./2026-07-06-1225-doing-mcp-oauth-regression-ci-canary/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts only when the user explicitly requested interactive per-unit approval; otherwise convert this to `spawn` or `direct` unless a hard exception is present
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Protect the Spoonjoy MCP OAuth connection from regressions by making the critical Claude-style consent, token, refresh, MCP, and legacy-token paths run in CI and after deploy.

## Upstream Work Items
- None

## Completion Criteria
- [x] CI runs local OAuth/MCP contract and consent-page tests on PRs.
- [x] GitHub Actions runs a post-deploy MCP OAuth canary after production deploy.
- [x] GitHub Actions has a scheduled/manual MCP OAuth canary workflow with artifact upload.
- [x] Live canary verifies auth-code exchange, refresh rotation, MCP `initialize`, MCP `tools/list`, and legacy Claude refresh promotion.
- [x] Live canary cleans up exact disposable user/client/token state.
- [x] 100% test coverage on all new code
- [x] All tests pass
- [x] No warnings
- [x] If UI/rendering/layout changed: `visual-qa-dogfood` evidence captured, absurdity ledger closed, and automated visual metrics still pass

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## TDD Requirements
**Strict TDD — no exceptions:**
1. **Tests first**: Write failing tests BEFORE any implementation
2. **Verify failure**: Run tests, confirm they FAIL (red)
3. **Minimal implementation**: Write just enough code to pass
4. **Verify pass**: Run tests, confirm they PASS (green)
5. **Refactor**: Clean up, keep tests green
6. **No skipping**: Never write implementation without failing test first

## Work Units

### Legend
⬜ Not started · 🔄 In progress · ✅ Done · ❌ Blocked

**CRITICAL: Every unit header MUST start with status emoji (⬜ for new units).**

### ✅ Unit 0: Setup/Research
**What**: Verify branch, current tests, OAuth/MCP helpers, smoke-script patterns, and GitHub workflow structure.
**Output**: Confirmed implementation targets and constraints.
**Acceptance**: Relevant files read and no dirty unrelated state modified.

### ✅ Unit 1a: Local OAuth/MCP Regression Tests
**What**: Add failing local e2e/contract assertions for resource-bound consent, token exchange, refresh rotation, MCP calls, and authorize-page layout/button behavior.
**Acceptance**: Targeted tests fail before implementation where helper/workflow support is absent or assert current behavior for contract lock-in.

### ✅ Unit 1b: Live Canary Script
**What**: Implement reusable live MCP OAuth canary script and tested helper functions for D1 cleanup/query/legacy-token insertion.
**Acceptance**: Script signs up a disposable user, drives consent, exchanges/refreshes tokens, calls MCP, verifies legacy promotion, writes artifacts, and cleans up.

### ✅ Unit 1c: GitHub Actions Wiring
**What**: Add scheduled/manual canary workflow and post-production-deploy canary step with credential guards and artifact upload.
**Acceptance**: Workflow syntax is valid, canary runs only when required secrets are available, and production deploy blocks on canary failure after deploy.

### ✅ Unit 1d: Coverage & Verification
**What**: Run targeted tests, e2e OAuth tests, typecheck, build, and coverage; fix warnings/failures.
**Acceptance**: All required verification commands pass with no warnings.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- For UI/rendering/layout units, run `visual-qa-dogfood` before declaring the unit or task complete
- **All artifacts**: Save outputs, logs, data to `./2026-07-06-1225-doing-mcp-oauth-regression-ci-canary/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-07-06 12:25 Created from planning doc.
- 2026-07-06 12:34 Added PR-local OAuth/MCP e2e assertions covering consent approval, auth-code token exchange, durable MCP access tokens, refresh rotation/replay rejection, MCP `initialize`, MCP `tools/list`, and desktop no-scroll layout.
- 2026-07-06 12:39 Added live MCP OAuth canary script with disposable signup, Claude redirect interception, metadata-derived resource binding, token exchange/refresh checks, MCP calls, legacy null-resource refresh-token promotion probe, artifact output, and exact cleanup.
- 2026-07-06 12:42 Added scheduled/manual `mcp-oauth-canary` workflow and post-production-deploy canary gate with artifact upload.
- 2026-07-06 12:45 Local canary passed against `http://localhost:5173` and local D1; artifact written under `./2026-07-06-1225-doing-mcp-oauth-regression-ci-canary/local-mcp-canary/`; report verified cleanup count `0` and no raw token/code leakage.
- 2026-07-06 13:01 Validation passed: focused helper/repo tests, OAuth Playwright e2e, local live canary, focused OAuth/MCP/server tests, typecheck, build, and full coverage (`344` files, `6700` tests, `100%` statements/branches/functions/lines).
