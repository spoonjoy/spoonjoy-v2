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
- [x] Unauthenticated request returns `401` + `WWW-Authenticate: Bearer resource_metadata="https://spoonjoy.app/.well-known/oauth-protected-resource"`
- [x] `GET /.well-known/oauth-protected-resource` → 200
- [x] `GET /.well-known/oauth-authorization-server` → 200, advertising `authorization_endpoint`, `token_endpoint`, and `registration_endpoint` (DCR)
- [x] Every tool carries a `title` + `readOnlyHint`/`destructiveHint` (surfaced via `tools/list`)
- [x] Public Privacy Policy + Terms of Service (linked from every auth/consent screen)
- [x] `server.json` present for the MCP Registry
- [ ] Reviewer demo account created + seeded (see below — needs Ari)
- [ ] Logo asset exported (see below — needs Ari)

---

## Shared listing assets (reuse across venues)

- **Name:** Spoonjoy
- **Tagline:** Your personal recipe kitchen.
- **Short description:** Spoonjoy keeps the recipes you actually cook. Search and
  open public recipes, save and fork them into your kitchen, build cookbooks,
  log cooks, and manage a shopping list — now from your AI assistant.
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
URLs. To save a recipe from the web, the assistant reads the page itself and
calls `Create recipe`. (The REST API still offers a server-side URL import that
the Spoonjoy web app uses, but it is not exposed as an MCP tool.)

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
| Test credentials | (demo account — see below) |

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
- A full-featured demo account with sample data (below).
- Country availability settings.

Note: OpenAI's Apps SDK adds an optional UI layer on top of MCP. The connector
works as a tools-only app today; a richer in-ChatGPT UI is a future enhancement,
not a submission blocker.

---

## Reviewer demo account

Both Anthropic and OpenAI test the connector end to end, so they need a working
login with sample data.

1. Sign up a dedicated account at https://spoonjoy.app/signup (e.g.
   `demo@spoonjoy.app` with a strong password).
2. Create an API token for it in Account Settings.
3. Seed sample content:
   ```bash
   SPOONJOY_API_TOKEN=sj_... node scripts/seed-demo-kitchen.mjs
   ```
   This adds three recipes, a "Weeknight Favorites" cookbook, and a few
   shopping-list items via the public API. Safe to re-run.
4. Hand the directory reviewers the email + password (not the API token). They
   sign in during the OAuth consent step to authorize the connector.

---

## Human-only steps (the full list for Ari)

1. Add the apex `spoonjoy.app` DNS TXT record for the MCP Registry namespace.
2. Run `mcp-publisher login dns` + `publish`.
3. Create the Anthropic + OpenAI developer accounts and accept their terms.
4. Create + seed the reviewer demo account (steps above).
5. Export a Spoonjoy logo asset (PNG/SVG) for the listings.
6. Read through `/privacy` + `/terms`, then click submit on each venue.
