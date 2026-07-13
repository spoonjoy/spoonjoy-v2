# Doing: MCP Landing Page

**Status**: done
**Execution Mode**: direct
**Created**: 2026-07-13 14:09
**Planning**: ./2026-07-13-1404-planning-mcp-landing-page.md
**Artifacts**: ./2026-07-13-1404-doing-mcp-landing-page/

## Execution Mode

- **pending**: Awaiting user approval before each unit starts only when the user explicitly requested interactive per-unit approval; otherwise convert this to `spawn` or `direct` unless a hard exception is present
- **spawn**: Spawn sub-agent for each unit (parallel/autonomous)
- **direct**: Execute units sequentially in current session (default)

## Objective
Make `https://spoonjoy.app/mcp` useful for humans by rendering a clear landing page on GET while preserving the existing Streamable HTTP MCP JSON-RPC endpoint on POST.

## Upstream Work Items
- None

## Completion Criteria
- [x] GET `/mcp` renders a human-facing landing page with title, description, endpoint, auth guidance, and a practical setup path.
- [x] POST `/mcp` still delegates to the existing MCP HTTP handler.
- [x] Route tests cover the new GET page behavior and existing POST auth/tool behavior still passes.
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
**What**: Confirm current `/mcp` route behavior, connector docs, route config, route classification, and test targets.
**Output**: Execution context recorded in this doing doc and artifacts directory created.
**Acceptance**: Existing route files and docs are read; copy caveats from review are reflected in Unit 1b.

### ✅ Unit 1a: MCP Landing Page — Tests
**What**: Update tests before implementation. `test/routes/mcp.test.ts` must render the default route component and assert durable human-facing content: heading, `/mcp`, `POST`, `Authorization: Bearer`, `/.well-known/oauth-protected-resource/mcp`, and setup guidance. Preserve existing POST action auth/tool tests. Update `test/routes/route-shell-coverage.test.ts` so MCP shell plumbing is still exercised through `action` with a POST Workers context instead of a GET 405.
**Output**: Failing tests that describe the new GET page and preserved POST shell behavior.
**Acceptance**: Targeted test run fails for the expected missing page/component assertions before implementation.

### ✅ Unit 1b: MCP Landing Page — Implementation
**What**: Rename the MCP route module to `app/routes/mcp.tsx`, export a page component and metadata for GET, keep `action` delegating to `handleMcpHttpRequest`, and update `app/routes.ts` plus `app/lib/web-route-manifest.server.ts` to point at `routes/mcp.tsx`. Page copy must say MCP calls are authenticated `POST` JSON-RPC over stateless Streamable HTTP, no SSE, no batching, and every request including `initialize` requires auth. OAuth wording must be limited to clients that support protected-resource discovery, dynamic registration, and PKCE. Claude Code bearer-token setup stays separate. Token lifecycle tools must be described as requiring token scopes. Do not imply arbitrary URL import or AI cover generation are MCP tools.
**Output**: Working `/mcp` page and preserved MCP POST endpoint.
**Acceptance**: Targeted tests pass without warnings.

### ✅ Unit 1c: MCP Landing Page — Coverage & Build
**What**: Run targeted coverage for the modified route tests, then run build/typegen validation because the route module extension changes.
**Output**: Test, coverage, and build logs in `./2026-07-13-1404-doing-mcp-landing-page/`.
**Acceptance**: 100% coverage on new/modified route code, all targeted tests pass, `pnpm run build` passes with no warnings.

### ✅ Unit 1d: MCP Landing Page — Visual QA Dogfood
**What**: Start the app locally, inspect `/mcp` at desktop and mobile widths, capture screenshots, and keep an absurdity ledger. Check for mobile-safe code blocks, no text overlap, no nested cards, and readable first viewport.
**Output**: Screenshots and absurdity ledger in `./2026-07-13-1404-doing-mcp-landing-page/`.
**Acceptance**: Visual evidence captured and all in-scope ready items fixed or explicitly closed.

## Execution
- **TDD strictly enforced**: tests → red → implement → green → refactor
- Commit after each phase (1a, 1b, 1c)
- Push after each unit complete
- Run full test suite before marking unit done
- For UI/rendering/layout units, run `visual-qa-dogfood` before declaring the unit or task complete
- **All artifacts**: Save outputs, logs, data to `./[task-name]/` directory
- **Fixes/blockers**: Spawn sub-agent immediately — don't ask, just do it
- **Decisions made**: Update docs immediately, commit right away

## Progress Log
- 2026-07-13 14:09 Created from planning doc
- 2026-07-13 14:11 Unit 0 complete: recorded route, protocol, docs, registration, and test targets in `unit-0-research.md`
- 2026-07-13 14:12 Unit 1a complete: added route data, rendered-page, and POST shell tests; red run saved to `unit-1a-red.log`
- 2026-07-13 14:16 Unit 1b complete: implemented GET landing page, preserved POST MCP action, updated route registration/classification, and saved green targeted test output to `unit-1b-green.log`
- 2026-07-13 14:48 Unit 1c complete: refreshed Browserslist data to clear stale warnings, verified full coverage at 100%, and ran production build with clean logs
- 2026-07-13 14:59 Unit 1d complete: captured desktop/mobile screenshots, fixed mobile grid overflow, passed visual reviewer gate, reran targeted tests, full coverage, and build with clean logs
