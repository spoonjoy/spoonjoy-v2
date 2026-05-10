# Ouroboros MCP Integration

Spoonjoy v2 ships a stdio MCP server so Ouroboros agents can use Spoonjoy as their first-class recipe memory and shopping-list substrate.

## Tools

When registered under the server name `spoonjoy`, the harness exposes these first-class tools as `spoonjoy_health`, `spoonjoy_search_recipes`, and so on:

| Tool | Purpose |
| --- | --- |
| `health` | Check server readiness and whether write tools have a default owner email. |
| `search_recipes` | Search recipes by text and optional chef email. |
| `get_recipe` | Fetch a recipe by id or title with ordered steps and ingredients. |
| `create_recipe` | Create a recipe for the configured owner, including steps and ingredients. |
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

Cookbook tools are deliberately owner-scoped: agents can only list, fetch, create, and mutate cookbooks owned by `SPOONJOY_MCP_USER_EMAIL` or an explicit `ownerEmail`. Recipe membership adds require an active `recipeId`; deleted recipes are excluded from cookbook payloads and cannot be newly added.

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
        "SPOONJOY_MCP_USER_EMAIL": "vault:runtime/config/spoonjoyUserEmail"
      }
    }
  }
}
```

For local development without vault injection, replace the env value with a local test email. If `SPOONJOY_MCP_USER_EMAIL` is missing, read tools still work and write tools return a configuration error unless `ownerEmail` is provided in the tool call.

## Local Smoke

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' | pnpm --silent mcp:serve
```

The server uses the same local database resolution as the app: Cloudflare D1 via Wrangler when available, with SQLite fallback in restricted local contexts.
