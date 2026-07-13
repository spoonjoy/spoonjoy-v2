# Unit 0 Research

- Before this change: `app/routes/mcp.ts` had no default component. `loader` and `action` both called the shared handler, so `GET /mcp` returned the handler's 405.
- Protocol owner: `app/lib/mcp/http-mcp.server.ts` handles stateless Streamable HTTP MCP over JSON-RPC for `POST /mcp`.
- Auth posture: every MCP JSON-RPC request, including `initialize`, requires a bearer token. Unauthenticated requests get `401` with `WWW-Authenticate` pointing at `/.well-known/oauth-protected-resource/mcp`.
- Published endpoint: `server.json` advertises `https://spoonjoy.app/mcp` as the Streamable HTTP remote.
- Human docs source: `docs/claude-connector.md` describes OAuth/PCKE clients, Claude Code bearer-token setup, supported methods, and no-SSE/no-batching caveats.
- Route registration before implementation: `app/routes.ts` pointed at `routes/mcp.ts`; `app/lib/web-route-manifest.server.ts` also listed `routes/mcp.ts`.
- Test targets before implementation: `test/routes/mcp.test.ts` expected GET 405 and exercised POST behavior; `test/routes/route-shell-coverage.test.ts` checked GET 405 for Worker-context shell coverage.
