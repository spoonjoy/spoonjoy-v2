# AGENTS.md — Spoonjoy v2

This is Ari's recipe management platform, rebuilt with React Router v7 on Cloudflare.

## Feedback

Ongoing feedback and improvements are tracked in `feedback/YYYY-MM-DD.md` files. Check there for known issues and planned enhancements before making changes.

## Stack

- **Framework**: React Router v7 (Remix-style file-based routing)
- **Platform**: Cloudflare Pages + Workers + D1
- **Database**: SQLite locally, Cloudflare D1 in production (via Prisma)
- **Language**: TypeScript everywhere
- **Styling**: Tailwind CSS v4
- **Testing**: Vitest + Testing Library + @faker-js/faker
- **Icons**: Lucide React

**General rule**: Always prefer Cloudflare services when possible.

## Project Structure

```
app/
├── routes/          # Route modules (loaders, actions, components)
├── components/      # Shared React components
├── lib/             # Utilities and database client
│   ├── db.server.ts # Prisma client setup (D1 adapter)
│   └── session.server.ts
├── styles/          # Tailwind CSS entry
└── root.tsx         # Root layout

test/
├── utils.ts         # Test helpers (faker-based data generators)
├── setup.ts         # Vitest setup
└── *.test.ts        # Test files

prisma/
└── schema.prisma    # Database schema
```

## Development Commands

```bash
npm run dev          # Start dev server (localhost:5173)
npm run build        # Production build
npm run test         # Run tests (Vitest)
npm run test:ui      # Vitest UI mode
npm run test:coverage # Coverage report
npm run prisma:studio # Database GUI
```

## Code Style

### General Principles
- Keep it simple — don't over-engineer
- Follow existing patterns in the codebase
- Clear, descriptive naming over clever abbreviations
- TypeScript strict mode — no `any` unless absolutely necessary
- Prefer composition over inheritance

### File Naming
- Route files: `kebab-case.tsx` (e.g., `recipes.$id.edit.tsx`)
- Components: `PascalCase.tsx`
- Utilities: `camelCase.ts` with `.server.ts` suffix for server-only code

### React Patterns
- Loaders fetch data, actions handle mutations (React Router conventions)
- Keep components focused — extract when they get unwieldy
- Use existing components before creating new ones

## Testing

### Philosophy
- **100% TEST COVERAGE IS MANDATORY** — NO exceptions, NO edge case is minor. ALL edge cases MUST be tested (valid, invalid, boundary, null, empty, error paths). This is a hard rule.
- **NO WARNINGS ALLOWED** — Warnings are treated as errors. ALL warnings must be addressed before committing. Zero warnings during test runs is MANDATORY, same as 100% coverage.
- **Write tests alongside code** — not after, not "later", but as part of the same commit
- **Use tests to validate your work** — run tests frequently to catch issues early. Before every commit: verify zero warnings.
- **Tests are documentation** — they show how code is meant to be used
- **Both rules are MANDATORY** — 100% coverage AND zero warnings. No exceptions.

### Conventions
- Test files live alongside or in `test/` directory
- Use faker-based helpers from `test/utils.ts` for test data
- Use `getOrCreateUnit()` and `getOrCreateIngredientRef()` for idempotent data setup
- Clean up test data properly to avoid constraint violations

### Test Helpers (test/utils.ts)
```typescript
createTestUser()        // Unique user data
createTestRecipe(chefId) // Unique recipe data
createUnitName()        // Unique unit name
getOrCreateUnit(db, name)       // Idempotent unit
getOrCreateIngredientRef(db, name) // Idempotent ingredient
```

### Running Tests
```bash
npm test              # Watch mode
npm run test:coverage # With coverage
```

## Git Workflow

### Agent Branch Setup
- Work should happen on an agent-scoped branch whose first path segment identifies the active agent (for example, `<agent>/<task-slug>`).
- If the current branch is `main`, detached, or otherwise not agent-scoped, the agent has authority to create or switch to an appropriate agent-scoped branch without human approval.
- Choose the branch from the active agent identity and current task context. Ask the human only if automatic branch setup fails or if multiple valid agent identities are genuinely ambiguous.
- Do not use a `codex/` prefix when the branch is only being created to satisfy this repo's agent-scoped workflow.

### Atomic Commits
- **One commit per file** (or logical unit of work)
- **Push after every commit** — keep GitHub in sync immediately
- **Clear commit messages**: `"[action] [what] in [filename]"`
  - Example: `"Replace db.unit.create with getOrCreateUnit in recipe.test.ts"`

### One-Way Flow
Changes flow: Local → GitHub. Never pull from GitHub during active work sessions. This prevents merge conflicts and keeps history clean.

### Commit Message Format
```
feat: add shopping list checkoff functionality
fix: resolve unique constraint in user tests
refactor: extract ingredient helper to utils
test: add coverage for cookbook CRUD operations
```

## When You're Done

Always notify completion so Slugger (the Ouroboros agent) knows you're finished:

```bash
ouro msg --to slugger "Done: [brief summary of what was accomplished]"
```

Include this at the end of your task. Example:
```bash
ouro msg --to slugger "Done: Fixed all 21 ingredientRef test calls, all tests passing"
```

## Communication Style

When reporting status or issues:
- Be direct — name problems clearly without deflection
- No apologies or empty promises — just state facts and next steps
- If something failed, say what failed and what you'll try next
- If uncertain, say so rather than guessing

## Common Gotchas

1. **Server-only imports**: Files with `.server.ts` suffix are server-only. Don't import them in client code.

2. **D1 adapter**: Production uses `@prisma/adapter-d1`. Local dev uses SQLite file directly.

3. **Test database**: Tests use `test.db` (SQLite). Each test file should clean up its own data.

4. **Foreign key constraints**: When deleting test data, delete in correct order (children before parents).

5. **Unique constraints**: Always use unique suffixes (faker alphanumeric) for test data to avoid collisions.

## Key Files to Know

- `app/lib/db.server.ts` — Database client setup
- `app/lib/session.server.ts` — Auth session handling
- `prisma/schema.prisma` — Data models
- `test/utils.ts` — Test data helpers
- `vitest.config.ts` — Test configuration
- `wrangler.toml` — Cloudflare deployment config
