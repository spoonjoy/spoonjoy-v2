# Spoonjoy v2

Recipe management platform rebuilt with React Router v7 on Cloudflare.

## Links

- **Storybook**: https://spoonjoy-storybook.pages.dev/
- **Getting Started Guide**: [GUIDE.md](./GUIDE.md) — comprehensive walkthrough from clone to delighted

## Tech Stack

- **Framework**: React Router v7 (Remix)
- **Platform**: Cloudflare Pages/Workers
- **Database**: Cloudflare D1 (local & production) via Prisma
- **Language**: TypeScript
- **Styling**: Tailwind CSS

## Quick Start

```bash
# Clone and install
git clone https://github.com/arimendelow/spoonjoy-v2.git
cd spoonjoy-v2
pnpm install

# Generate Prisma client
pnpm prisma:generate

# Set up local D1 database
pnpm exec wrangler d1 migrations apply DB --local

# Optional: seed demo data into local D1
pnpm db:seed

# Start dev server
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) — no additional setup required!

> **Note:** For a detailed walkthrough including creating recipes, exploring Storybook, and running tests, see [GUIDE.md](./GUIDE.md).

## Configuration

All configuration lives in `wrangler.json`:

| Setting | Purpose |
|---------|---------|
| `d1_databases` | D1 database bindings |
| `r2_buckets` | R2 image storage binding for profile and recipe photos |
| `vars` | Environment variables (NODE_ENV, OAuth credentials, etc.) |

**Local development uses sensible defaults** — no configuration required to get started.
When the `PHOTOS` R2 binding is unavailable locally, uploaded images are stored as data URLs so recipe/profile image flows still work.

For OAuth (Google/Apple login), provide credentials through Cloudflare secrets in production or `.dev.vars` locally:

```bash
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
APPLE_CLIENT_ID=your-apple-client-id
APPLE_TEAM_ID=your-apple-team-id
APPLE_KEY_ID=your-apple-key-id
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
```

For production, use `wrangler secret put` for sensitive values.

For Ouroboros agent integration, see [`docs/ouroboros-mcp.md`](docs/ouroboros-mcp.md).

## Development Commands

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Start dev server |
| `pnpm storybook` | Component explorer |
| `pnpm test` | Run test suite |
| `pnpm test:ui` | Tests with visual UI |
| `pnpm test:coverage` | Coverage report |
| `pnpm test:e2e` | Run Playwright e2e tests |
| `pnpm test:storybook` | Run Storybook interaction tests |
| `pnpm prisma:generate` | Regenerate Prisma client |
| `pnpm db:seed` | Seed local D1 via Wrangler platform proxy |
| `pnpm dev:sync` | Generate Prisma client, run the legacy option2 idempotent migration helper, then start dev |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript validation |

## E2E Testing

End-to-end tests use [Playwright](https://playwright.dev/) and live in the `e2e/` folder.

```bash
# Install Playwright browsers (first time)
pnpm exec playwright install

# Run all e2e tests
pnpm test:e2e

# Run specific test file
pnpm test:e2e e2e/flows/recipes.spec.ts

# Run with UI mode (interactive)
pnpm test:e2e --ui

# Run headed (see browser)
pnpm test:e2e --headed
```

**Test structure:**
- `e2e/auth.setup.ts` — Authentication fixture (logs in as demo user)
- `e2e/flows/auth.spec.ts` — Login, logout, protected routes
- `e2e/flows/recipes.spec.ts` — Recipe list, detail, navigation
- `e2e/flows/cookbooks.spec.ts` — Cookbook CRUD
- `e2e/flows/shopping-list.spec.ts` — Shopping list operations

**Note:** Tests run against `http://localhost:5173`. Start the dev server first with `pnpm dev`.

## Database Management

Local development uses D1 via the Cloudflare Vite plugin (stored in `.wrangler/`).

```bash
# Apply schema to local D1
pnpm exec wrangler d1 migrations apply DB --local

# Seed demo data
pnpm db:seed

# Regenerate migration from Prisma schema (if schema changes)
pnpm exec prisma migrate diff --from-empty --to-schema-datamodel=./prisma/schema.prisma --script > migrations/000X_descriptive_name.sql
```

## Deployment to Cloudflare

1. Login to Cloudflare:
   ```bash
   wrangler login
   ```

2. Create a D1 database (first time only):
   ```bash
   wrangler d1 create spoonjoy
   # Update wrangler.json with the returned database_id
   ```

3. Create the R2 bucket for uploaded photos (first time only):
   ```bash
   wrangler r2 bucket create spoonjoy-photos
   # wrangler.json binds this bucket as PHOTOS
   ```

4. Apply migrations to production D1:
   ```bash
   wrangler d1 migrations apply DB --remote
   ```

5. Set secrets:
   ```bash
   wrangler secret put SESSION_SECRET
   wrangler secret put GOOGLE_CLIENT_ID
   wrangler secret put GOOGLE_CLIENT_SECRET
   wrangler secret put APPLE_CLIENT_ID
   wrangler secret put APPLE_TEAM_ID
   wrangler secret put APPLE_KEY_ID
   wrangler secret put APPLE_PRIVATE_KEY
   wrangler secret put OPENAI_API_KEY
   ```

6. Deploy:
   ```bash
   pnpm deploy
   ```

## Project Structure

```
app/
├── routes/          # Route modules (loaders, actions, components)
├── components/      # Shared React components
├── lib/             # Utility functions and database client
├── entry.client.tsx # Client entry point
├── entry.server.tsx # Server entry point
├── root.tsx         # Root layout
└── routes.ts        # Route configuration

prisma/
└── schema.prisma    # Database schema

migrations/
├── 0000_init.sql    # Initial D1 migration
└── 0005_*.sql       # Ordered follow-up migrations
```

## Features

- **Authentication**: Email/password plus Google/Apple OAuth initiation, callback, login, signup, and account-linking routes
- **Recipes**: Full CRUD with steps, ingredients, and step dependencies
- **Step Dependencies**: Steps can reference outputs from previous steps
- **Cookbooks**: Organize recipes into collections
- **Shopping List**: Personal shopping list with check-off
- **Ouroboros MCP**: Stdio MCP server for agent recipe/search/create/shopping-list tools

## Database Schema

Key models:

- `User` - Accounts with authentication
- `Recipe` - Recipe metadata and ownership
- `RecipeStep` - Step-by-step instructions with optional titles
- `StepOutputUse` - Dependencies between steps (the killer feature!)
- `Ingredient` - Ingredients linked to specific steps
- `Cookbook` - Recipe collections
- `ShoppingList` - Personal shopping lists

## Feedback

Ongoing feedback is tracked in `feedback/YYYY-MM-DD.md` files. Check there for known issues and planned improvements.

## Backlog

The canonical proposed backlog lives in [`BACKLOG.md`](./BACKLOG.md). Historical task snapshots under `.tasks/` are not the source of truth unless they explicitly reference a current `SJ-*` backlog item.

## License

ISC
