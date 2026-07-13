# Unit 0 Research

- Current route: `app/routes/mcp.ts` has no default component. `loader` and `action` both call the shared handler, so `GET /mcp` currently returns the handler's 405.
- Protocol owner: `app/lib/mcp/http-mcp.server.ts` handles stateless Streamable HTTP MCP over JSON-RPC for `POST /mcp`.
- Auth posture: every MCP JSON-RPC request, including `initialize`, requires a bearer token. Unauthenticated requests get `401` with `WWW-Authenticate` pointing at `/.well-known/oauth-protected-resource/mcp`.
- Published endpoint: `server.json` advertises `https://spoonjoy.app/mcp` as the Streamable HTTP remote.
- Human docs source: `docs/claude-connector.md` describes OAuth/PCKE clients, Claude Code bearer-token setup, supported methods, and no-SSE/no-batching caveats.
- Route registration: `app/routes.ts` currently points at `routes/mcp.ts`; `app/lib/web-route-manifest.server.ts` also lists `routes/mcp.ts`.
- Test targets: `test/routes/mcp.test.ts` currently expects GET 405 and exercises POST behavior; `test/routes/route-shell-coverage.test.ts` currently checks GET 405 for Worker-context shell coverage.
