# Spoonjoy Claude Connector

Spoonjoy serves a remote [Model Context Protocol](https://modelcontextprotocol.io) endpoint so Claude can use your kitchen — recipes, cookbooks, shopping list, and search — as first-class tools.

The connector is the **same tool surface** as the [Ouroboros stdio MCP integration](./ouroboros-mcp.md) and the [HTTP API](./api.md): all three route through one shared operation layer (`app/lib/spoonjoy-api.server.ts`). The connector just exposes it over MCP's Streamable-HTTP transport.

## Endpoint

```
POST https://spoonjoy.app/mcp
```

- Transport: MCP **Streamable HTTP**, `application/json` responses (no SSE). Stateless — every request is a self-contained JSON-RPC message.
- Methods: `initialize`, `tools/list`, `tools/call`, and notifications (acked with `202`).
- `initialize` negotiates the protocol version (it echoes the client's requested `protocolVersion`).
- `initialize` and `tools/list` are open for discovery. `tools/call` is authenticated per-tool: public bootstrap tools (`health`, `auth_status`, `start_agent_connection`, `poll_agent_connection`) work unauthenticated; everything else requires a bearer token and acts only as that token's owner.
- Rate-limited per token and per IP (shared limiter with the REST API).

## Auth: delegated bearer token

The connector authenticates with an owner-scoped `sj_` API token via the standard `Authorization: Bearer …` header. Tokens are obtained through Spoonjoy's **delegated device-code flow** — you never paste a password into Claude:

1. Start a connection (unauthenticated): call the `start_agent_connection` tool, or `POST /api/tools/start_agent_connection` with `{ "agentName": "claude", "baseUrl": "https://spoonjoy.app" }`. You get an `authorizationUrl`.
2. Open the URL in a browser while signed in to Spoonjoy and approve the connection.
3. Poll `poll_agent_connection` with the returned `deviceCode`; after approval it returns a one-time `sj_…` token.
4. Configure the connector with that token (below). Store it like a password.

You can also mint a token directly from the API while signed in: `POST /api/tokens` with `{ "name": "Claude" }`.

## Auth: OAuth 2.1 (claude.ai / Claude Desktop one-click)

For connectors that expect OAuth, Spoonjoy is also a minimal OAuth 2.1 authorization server, so adding the connector in claude.ai runs a normal sign-in + consent instead of pasting a token.

- **Discovery:** `GET /.well-known/oauth-authorization-server` (RFC 8414) and `GET /.well-known/oauth-protected-resource` (RFC 9728). A `tools/call` for a protected tool without a valid token returns `401` with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`, which is the client's cue to start the flow.
- **Registration:** `POST /oauth/register` — Dynamic Client Registration (RFC 7591); public client, `token_endpoint_auth_method: none`.
- **Authorize:** `GET /oauth/authorize` — PKCE (S256) only. Signs the user into Spoonjoy if needed, then shows a consent screen for the `kitchen:read` / `kitchen:write` scopes.
- **Token:** `POST /oauth/token` — `authorization_code` grant. The issued access token is a normal Spoonjoy API credential (long-lived, revocable from account settings); there are no refresh tokens.

The access token is the same kind of bearer token used above, so it flows through the identical per-tool, owner-scoped authorization.

## Install in Claude Code

```bash
claude mcp add --transport http spoonjoy https://spoonjoy.app/mcp \
  --header "Authorization: Bearer sj_your_token_here"
```

Then `claude mcp list` shows `spoonjoy`, and the Spoonjoy tools become available (`tools/list`). A quick check:

```bash
# discovery (no auth needed)
curl -s -X POST https://spoonjoy.app/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'

# an owner-scoped call (needs the token)
curl -s -X POST https://spoonjoy.app/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sj_your_token_here' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_shopping_list","arguments":{}}}'
```

## Tools

The connector exposes the same tools as the [Ouroboros stdio MCP integration](./ouroboros-mcp.md#tools) — health, search, recipe CRUD, cookbook organization, shopping-list management, and the delegated-auth bootstrap tools. See that doc for the full table and owner-scoping semantics.

## Security posture

- Discovery is open; all mutation and private reads require the bearer token.
- A bearer-authenticated request can only act for its own owner — passing a different `ownerEmail` is rejected (`403`).
- The endpoint is rate-limited before authentication, so an invalid or leaked token cannot burn database/AI quota.
- Tokens are stored hashed (SHA-256); the secret is shown once.

## Not yet supported

- SSE streaming and JSON-RPC batching (not needed for request/response tool calls).
