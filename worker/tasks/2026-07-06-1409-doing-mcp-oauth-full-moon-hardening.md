# Doing: MCP OAuth Full-Moon Hardening

**Status**: COMPLETE
**Execution Mode**: direct
**Created**: 2026-07-06 14:09
**Planning**: ./2026-07-06-1409-planning-mcp-oauth-full-moon-hardening.md
**Artifacts**: ./2026-07-06-1409-doing-mcp-oauth-full-moon-hardening/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts only when the user explicitly requested interactive per-unit approval; otherwise convert this to `spawn` or `direct` unless a hard exception is present
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Make MCP/OAuth regressions impossible to miss, easy to diagnose, and hard to reintroduce after the baseline canary has landed.

## Upstream Work Items
- None

## Completion Criteria
- [x] Canary workflows write useful GitHub step summaries.
- [x] Canary failures open/update a canonical GitHub issue and recovery closes/comments on it.
- [x] Canary artifacts are redaction-checked for OAuth tokens, codes, bearer headers, and raw callback query leaks.
- [x] A readonly MCP/OAuth D1 invariant audit runs locally and in scheduled/manual GitHub Actions.
- [x] Ops docs cover canary triage, support refs, D1 audit interpretation, and real-Claude manual smoke.
- [x] Repo hygiene tests pin the new workflow/script/doc wiring.
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
**What**: Verify branch, existing canary workflow/script, telemetry docs, OAuth schema, and helper test patterns.
**Output**: Confirmed implementation targets.
**Acceptance**: Relevant files read and no unrelated dirty state modified.

### ✅ Unit 1a: Canary Report Helpers — Tests
**What**: Add failing tests for step-summary rendering, issue body rendering, recovery/failure issue decisions, and artifact secret scanning.
**Acceptance**: Tests exist and fail before helper implementation.

### ✅ Unit 1b: Canary Report Helpers — Implementation
**What**: Implement helper/script support for GitHub summaries, issue automation decisions, redaction, and artifact leak detection.
**Acceptance**: Tests pass; script can run locally against synthetic artifacts without network side effects.

### ✅ Unit 2a: D1 Invariant Audit — Tests
**What**: Add failing tests for readonly SQL generation, Wrangler output parsing, invariant classification, summary rendering, and target-env safeguards.
**Acceptance**: Tests exist and fail before audit implementation.

### ✅ Unit 2b: D1 Invariant Audit — Implementation
**What**: Implement readonly MCP/OAuth D1 invariant audit script and package script.
**Acceptance**: Tests pass; local audit can run against local D1 when available and produce redacted JSON/Markdown artifacts.

### ✅ Unit 3a: GitHub Actions Wiring — Tests
**What**: Extend repo hygiene tests to pin scheduled/manual audit workflow, canary report steps, issue permissions, and artifact uploads.
**Acceptance**: Tests fail before workflow/package/docs wiring.

### ✅ Unit 3b: GitHub Actions Wiring — Implementation
**What**: Wire summaries and issue automation into canary/deploy workflows; add scheduled/manual D1 audit workflow.
**Acceptance**: Repo hygiene tests pass and workflow syntax is structurally checked by tests.

### ✅ Unit 4a: Ops Documentation — Tests
**What**: Add docs hygiene tests for MCP OAuth ops runbook content.
**Acceptance**: Tests fail before docs exist.

### ✅ Unit 4b: Ops Documentation — Implementation
**What**: Add `docs/mcp-oauth-ops.md` covering triage, support refs, artifact interpretation, D1 audit, PostHog monitor guidance, and real-Claude manual smoke.
**Acceptance**: Docs tests pass.

### ✅ Unit 5: Verification
**What**: Run focused tests, typecheck, build, full coverage, PR CI, merge, and production deploy canary.
**Acceptance**: All required verification commands and GitHub workflows pass with no warnings.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- For UI/rendering/layout units, run `visual-qa-dogfood` before declaring the unit or task complete
- **All artifacts**: Save outputs, logs, data to `./2026-07-06-1409-doing-mcp-oauth-full-moon-hardening/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-07-06 14:09 Created from planning doc.
- 2026-07-06 14:37 Completed implementation and local verification:
  - `pnpm exec vitest run test/scripts/smoke-live-helpers.test.ts --reporter=default`
  - `pnpm exec vitest run test/scripts/smoke-live-helpers.test.ts test/repo-hygiene.test.ts --reporter=default`
  - `node --check scripts/report-mcp-oauth-canary.mjs`
  - `node --check scripts/audit-mcp-oauth-d1.mjs`
  - Synthetic canary report smoke confirmed artifact redaction and leak detection.
  - `node scripts/audit-mcp-oauth-d1.mjs --base-url http://localhost:5173 --out worker/tasks/2026-07-06-1409-doing-mcp-oauth-full-moon-hardening/local-d1-audit`
  - `pnpm run typecheck:scripts`
  - `pnpm run typecheck`
  - `pnpm run build`
  - `pnpm run test:coverage` (344 files, 6711 tests, 100% statements/branches/functions/lines)
