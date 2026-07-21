# Spoonjoy connector — directory submission packets

Everything needed to list the Spoonjoy MCP connector in the official directories.
The engineering is done and live; the remaining steps are the human-only ones
collected at the bottom.

- **Connector endpoint:** `https://spoonjoy.app/mcp` (remote, Streamable-HTTP)
- **Auth:** OAuth 2.1 with dynamic client registration (RFC 7591) + PKCE
- **Publisher:** Spoonjoy · **Support:** ari@spoonjoy.app
- **Privacy:** https://spoonjoy.app/privacy · **Terms:** https://spoonjoy.app/terms

---

## Pre-submission checklist (verified live 2026-05-29)

- [x] Remote MCP server reachable at `https://spoonjoy.app/mcp`
- [x] Unauthenticated request returns `401` + `WWW-Authenticate: Bearer resource_metadata="https://spoonjoy.app/.well-known/oauth-protected-resource/mcp"`
- [x] `GET /.well-known/oauth-protected-resource/mcp` → 200
- [x] `GET /.well-known/oauth-protected-resource` → 200 for compatibility
- [x] `GET /.well-known/oauth-authorization-server` → 200, advertising `authorization_endpoint`, `token_endpoint`, and `registration_endpoint` (DCR)
- [x] Every tool carries a `title` + `readOnlyHint`/`destructiveHint` (surfaced via `tools/list`)
- [x] Public Privacy Policy + Terms of Service (linked from every auth/consent screen)
- [x] `server.json` present for the MCP Registry
- [ ] Reviewer access plan confirmed (see below — needs Ari)
- [ ] Logo asset exported (see below — needs Ari)

---

## Shared listing assets (reuse across venues)

- **Name:** Spoonjoy
- **Tagline:** Your personal recipe kitchen.
- **Short description:** Spoonjoy keeps the recipes you actually cook. Use the
  app for fast finding and following; use an agent through MCP for complex
  kitchen work like authoring recipes, importing from messy sources, organizing
  cookbooks, and updating shopping lists.
- **Categories:** Productivity / Lifestyle / Food & cooking
- **Auth type:** OAuth 2.1 (authorization code + PKCE, dynamic client registration)
- **Scopes:** `kitchen:read` (view recipes, cookbooks, shopping list),
  `kitchen:write` (add/edit recipes, cookbooks, shopping list)
- **Support contact:** ari@spoonjoy.app
- **Privacy / Terms:** https://spoonjoy.app/privacy · https://spoonjoy.app/terms

### Tool list (titles + read/write)

Read-only: Health check, Authentication status, List API tokens, Search Spoonjoy,
Search recipes, Search shopping list, Get recipe, List cookbooks, Get cookbook,
Get shopping list, List cooks for recipe, List cooks by chef.

Writes (non-destructive): Start/Poll delegated connection, Create API token,
Create recipe, Update recipe, Fork recipe,
Add recipe to shopping list, Create cookbook, Add recipe to cookbook,
Add shopping-list item, Check shopping-list item, Log a cook, Update a cook.

The connector has no outbound web access: it never server-fetches arbitrary
URLs. To save a recipe from the web, the agent reads the source itself and
calls `Create recipe`. (The REST API still offers a server-side URL import that
the Spoonjoy web app uses, but it is not exposed as an MCP tool.)

The connector also exposes no AI image generation. The recipe-cover tools that
produce AI "editorial" images (`regenerate_recipe_cover`,
`create_recipe_cover_from_spoon`) are kept REST-only and excluded from the MCP
surface, so the connector does not fall under the "AI-generated images"
unsupported category. Plain cover uploads (`create_recipe_cover_from_upload`)
and cover management remain available.

Destructive: Revoke API token, Delete recipe, Remove recipe from cookbook,
Remove shopping-list item, Delete a cook.

---

## Venue 1 — Official MCP Registry (do this first)

Lowest effort, no human review, federates to Glama/Smithery/PulseMCP/mcp.so.
Full steps in [`mcp-registry-publishing.md`](./mcp-registry-publishing.md):
generate an Ed25519 key → add the apex `spoonjoy.app` TXT record →
`mcp-publisher login dns` → `mcp-publisher publish` (reads `server.json`).

---

## Venue 2 — Anthropic Connectors Directory

Submit at **https://clau.de/mcp-directory-submission**. Form answers:

| Field | Value |
| --- | --- |
| Server name | Spoonjoy |
| Server URL | `https://spoonjoy.app/mcp` |
| Tagline | Your personal recipe kitchen. |
| Description | (shared short description above) |
| Auth type | OAuth 2.0/2.1 + dynamic client registration |
| Protocol / transport | Remote MCP, Streamable HTTP |
| Capabilities | Tools (read + write) |
| Tools | (tool list above — all carry titles + read/destructive hints) |
| Data handling | See https://spoonjoy.app/privacy |
| Third-party connections | Cloudflare (hosting/DB/storage); analytics + error monitoring; OpenAI (only for recipe-cover image generation); OAuth providers (Apple/GitHub/Google) on user opt-in |
| Support / docs | ari@spoonjoy.app · https://spoonjoy.app/privacy · https://spoonjoy.app/terms |
| Logo | (export needed — see below) |
| Test credentials | (reviewer access — see below) |

Escalations / firewall issues: `mcp-review@anthropic.com`.

---

## Venue 3 — OpenAI ChatGPT App Directory

Submit at **https://platform.openai.com/apps-manage** (needs Owner role or
`api.apps.write`). Provide:

- App name + description (shared assets above), with clear, non-generic naming.
- Screenshots at the required dimensions (capture the kitchen, a recipe, the
  connector consent screen).
- Privacy policy URL: https://spoonjoy.app/privacy
- Support contact: ari@spoonjoy.app
- MCP connectivity: `https://spoonjoy.app/mcp`, OAuth 2.1.
- Tool annotations: already present (`readOnlyHint`/`destructiveHint`/`title`).
- Reviewer access details (below).
- Country availability settings.

Note: OpenAI's Apps SDK adds an optional UI layer on top of MCP. The connector
works as a tools-only app today; a richer in-ChatGPT UI is a future enhancement,
not a submission blocker.

---

## Reviewer access

Both Anthropic and OpenAI test the connector end to end, so they need a working
login. Do not seed demo fixture data into production.

1. Rehearse the review flow with a disposable account created through the normal
   QA/local product flow. Add only the minimum content needed for that run, then
   remove it with the environment-scoped cleanup command as soon as rehearsal ends.
2. If a directory absolutely requires production credentials, create a temporary
   real reviewer account by hand, give it only the content needed for review,
   and remove that account plus its content immediately after review closes.
3. Hand reviewers the email + password only. Never share API tokens.

---

## Human-only steps (the full list for Ari)

1. Add the apex `spoonjoy.app` DNS TXT record for the MCP Registry namespace.
2. Run `mcp-publisher login dns` + `publish`.
3. Create the Anthropic + OpenAI developer accounts and accept their terms.
4. Confirm the reviewer access plan (steps above).
5. Export a Spoonjoy logo asset (PNG/SVG) for the listings.
6. Read through `/privacy` + `/terms`, then click submit on each venue.
