# Ouroboros MCP Integration

Spoonjoy v2 ships a stdio MCP server so Ouroboros agents can use Spoonjoy as their first-class recipe memory and shopping-list substrate.

> For using Spoonjoy from Claude (Claude Code / claude.ai) over a remote MCP endpoint, see the [Claude Connector docs](./claude-connector.md). It exposes this same tool surface over MCP Streamable HTTP at `/mcp`.

For client developers building against Spoonjoy outside the local harness, use [`/api`](https://spoonjoy.app/api) as the human guide and [`/api/v1/openapi.json`](https://spoonjoy.app/api/v1/openapi.json) as the machine-readable REST contract.

## Tools

When registered under the server name `spoonjoy`, the harness exposes these first-class tools as `spoonjoy_health`, `spoonjoy_search_recipes`, and so on:

| Tool | Purpose |
| --- | --- |
| `health` | Check server readiness, auth source, and whether owner-scoped writes are available. |
| `start_agent_connection` | Create a browser approval link for delegated agent access. |
| `poll_agent_connection` | Poll a pending delegated connection and receive the one-time API token after approval. |
| `create_api_token` | Create an owner-scoped Spoonjoy API token; the secret is returned once and stored hashed. |
| `list_api_tokens` | List API token metadata for the owner; token secrets are never returned. |
| `revoke_api_token` | Revoke one owner-scoped API token. |
| `search_spoonjoy` | Full-text search recipes, cookbooks, chefs, and the configured owner's private shopping list. |
| `search_recipes` | Full-text search recipes by title, description, source URL, steps, ingredients, and optional chef email. |
| `search_shopping_list` | Full-text search the configured owner's private shopping list by ingredient, unit, category, icon, and checked state. |
| `get_recipe` | Fetch a recipe by id or title with ordered steps and ingredients. |
| `create_recipe` | Create a recipe for the configured owner, including steps and ingredients. |
| `update_recipe` | Update an owner-scoped recipe's title, optional metadata, and optionally replace its steps and ingredients. |
| `delete_recipe` | Soft-delete an owner-scoped recipe so agent-created drafts and test recipes can be cleaned up. |
| `add_recipe_to_shopping_list` | Add all recipe ingredients to the owner shopping list, merging duplicates. |
| `list_cookbooks` | List cookbooks owned by the configured owner, with active recipe counts and cover recipes. |
| `get_cookbook` | Fetch one owner-scoped cookbook by `cookbookId`, `title`, or `cookbookTitle`. |
| `create_cookbook` | Create or return an existing owner-scoped cookbook by exact title. |
| `add_recipe_to_cookbook` | Idempotently add an active recipe to an owner-scoped cookbook. |
| `remove_recipe_from_cookbook` | Idempotently remove a recipe from an owner-scoped cookbook. |
| `add_shopping_list_item` | Add or restore one manual shopping-list item, merging matching owner/unit/ingredient rows. |
| `set_shopping_list_item_checked` | Check or uncheck one active shopping-list item by id. |
| `remove_shopping_list_item` | Soft-remove one shopping-list item by id. |
| `get_shopping_list` | Fetch the owner shopping list. |

Search is backed by the same self-hosted SQLite/D1 FTS5 index as the UI and ranked with BM25. Shopping-list results are private: `search_spoonjoy` includes them only when an authenticated token, `SPOONJOY_MCP_USER_EMAIL`, or `ownerEmail` identifies the owner, and `search_shopping_list` always requires that owner identity.

Cookbook tools are deliberately owner-scoped: agents can only list, fetch, create, and mutate cookbooks owned by `SPOONJOY_MCP_USER_EMAIL` or an explicit `ownerEmail`. Recipe membership adds require an active `recipeId`; deleted recipes are excluded from cookbook payloads and cannot be newly added.

Recipe cleanup is owner-scoped too. `delete_recipe` sets `deletedAt` on the target recipe, hides it from normal `get_recipe`/search/cookbook payloads, and returns `deleted: false` if the same owner repeats cleanup for an already-deleted recipe.

## Authentication And Authorization

Spoonjoy supports three MCP auth modes:

- Preferred agent mode: call `start_agent_connection`, send the returned `authorizationUrl` to the human, then call `poll_agent_connection` after approval. The returned token is owner-scoped, stored hashed by Spoonjoy, returned once, and should be stored in the agent vault item `spoonjoy.app`.
- Preferred portable mode: set `SPOONJOY_MCP_API_TOKEN` to a Spoonjoy API token. This works for any MCP client that can pass environment variables to the stdio server. Tokens are owner-scoped, stored hashed, and can be revoked.
- Trusted local/Ouro bootstrap mode: set `SPOONJOY_MCP_USER_EMAIL`. This is useful for the Ouroboros harness and local development, especially when the value comes from Ouro vault. It is not a remote auth boundary by itself; it is a trusted local stdio identity assertion.

When a token is present, Spoonjoy derives ownership from the authenticated principal. Agents should omit `ownerEmail` after delegated auth; the token is the owner selector. Tool calls that try to override `ownerEmail` to another user are rejected with `403`. Without a token, owner-scoped tools require either `SPOONJOY_MCP_USER_EMAIL` or an explicit `ownerEmail`.

API token lifecycle is available through MCP itself (`create_api_token`, `list_api_tokens`, `revoke_api_token`) and through API v1 at `/api/v1/tokens`. The raw token is returned once; save it in the MCP client's secret store or in Ouro vault.

Remote OAuth clients can register with `POST /oauth/register`, complete PKCE consent at `GET /oauth/authorize`, and exchange or refresh credentials at `POST /oauth/token`. Delegated agent clients can also use `POST /api/tools/start_agent_connection` and `POST /api/tools/poll_agent_connection` to obtain a one-time owner-scoped API token without handling OAuth directly.

## Harness Config

Add this to an agent bundle's `agent.json`:

```json
{
  "mcpServers": {
    "spoonjoy": {
      "command": "pnpm",
      "args": ["--silent", "mcp:serve"],
      "cwd": "/Users/arimendelow/Projects/spoonjoy-v2",
      "env": {
        "SPOONJOY_MCP_API_BASE_URL": "https://spoonjoy.app",
        "SPOONJOY_MCP_API_TOKEN": "vault?:spoonjoy.app/password"
      }
    }
  }
}
```

`vault?:` is Ouro's optional vault reference: the MCP server still starts before the first token exists, so it can generate the browser approval link. After approval, store the returned token in `spoonjoy.app` as the password field with username `api-token`.

For local development without vault injection, use a literal `SPOONJOY_MCP_API_TOKEN` or a local test `SPOONJOY_MCP_USER_EMAIL`. If both are missing, public read tools still work and owner-scoped tools return an authentication/configuration error unless `ownerEmail` is provided in the tool call.

## Local Smoke

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' | pnpm --silent mcp:serve
```

The server uses the same local database resolution as the app: Cloudflare D1 via Wrangler when available, with SQLite fallback in restricted local contexts.

Some MCP clients cache tool schemas for the life of a session. If a newly added Spoonjoy operation is present in raw `tools/list` output but absent as a first-class `spoonjoy_*` tool, restart or refresh the harness MCP session.
