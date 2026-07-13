# Planning: MCP Landing Page

**Status**: NEEDS_REVIEW
**Created**: 2026-07-13 14:04

## Goal
Make `https://spoonjoy.app/mcp` useful for humans by rendering a clear landing page on GET while preserving the existing Streamable HTTP MCP JSON-RPC endpoint on POST.

## Upstream Work Items
- None

## Scope

### In Scope
- Convert the existing `/mcp` route into a React route that renders a human-facing explainer page for GET requests.
- Preserve existing POST behavior through `handleMcpHttpRequest`.
- Explain what the Spoonjoy MCP connector is, which kitchen capabilities it exposes, and how a person can connect it from Claude-style MCP clients.
- Update route registration and route classification if the route module extension changes.
- Update tests that currently expect GET `/mcp` to return 405.
- Capture visual QA evidence for the new page.

### Out of Scope
- Changing the MCP JSON-RPC tool surface.
- Changing OAuth, API-token, delegated auth, or rate-limit behavior.
- Publishing to MCP registries or changing `server.json`.
- Adding new backend MCP operations.

## Completion Criteria
- [ ] GET `/mcp` renders a human-facing landing page with title, description, endpoint, auth guidance, and a practical setup path.
- [ ] POST `/mcp` still delegates to the existing MCP HTTP handler.
- [ ] Route tests cover the new GET page behavior and existing POST auth/tool behavior still passes.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings
- [ ] If UI/rendering/layout changed: `visual-qa-dogfood` evidence captured, absurdity ledger closed, and automated visual metrics still pass

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values

## Open Questions
- [x] None; the safe interpretation is GET for humans, POST for MCP protocol clients.

## Decisions Made
- Preserve `/mcp` as the canonical MCP endpoint because docs, OAuth resource binding, and `server.json` already point there.
- Use GET for the landing page instead of adding a separate docs URL so humans who visit the endpoint directly get guidance.
- Keep POST wired through `handleMcpHttpRequest` to avoid duplicating protocol logic in the route shell.
- Match existing Spoonjoy editorial developer-page styling and design tokens rather than introducing a new design system.

## Context / References
- `app/routes/mcp.ts` currently routes both loader and action through the MCP handler; GET returns 405 today.
- `app/lib/mcp/http-mcp.server.ts` owns MCP Streamable HTTP behavior.
- `docs/claude-connector.md` explains current remote MCP endpoint, auth modes, and setup flows.
- `server.json` advertises `https://spoonjoy.app/mcp`.
- `test/routes/mcp.test.ts` covers GET 405 and POST MCP behavior.
- `test/routes/route-shell-coverage.test.ts` covers the route shell's Workers `waitUntil` binding.

## Notes
Keep the implementation mostly static and route-local. The page should be readable to non-developers, but still concrete enough for someone configuring Claude Code, claude.ai, or another MCP client.

## Progress Log
- 2026-07-13 14:04 Created
