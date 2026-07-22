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

## Work Suite Autopilot

### Default Planning/Execution Workflow
- Use `$work-planner` for planning and planning-to-doing conversion.
- Use `$work-doer` for execution.
- Before invoking planner/doer, verify local skill files are up to date with source-of-truth files in the current repo when available (`subagents/work-planner.md`, `subagents/work-doer.md`).
  - If those files are absent, continue with the installed local skills and note that the repo-local source files were unavailable.
  - If those files exist and differ from the installed local skills, update the installed local skills first, then continue.
- Re-invoke `$work-planner`/`$work-doer` on each turn where that behavior is required.

### Human Gates Are Waived By Default
- Do not stop for human approval at planning or doing gates unless the user explicitly asks for a human review checkpoint.
- Do not self-approve. When planner/doer needs approval, use unbiased sub-agent reviewers as the approval gate.
- Use harsh reviewer sub-agents by default for plans, doing docs, implementation review, design review, test review, and merge readiness.
- Ask the human only for true human-only blockers: credentials, billing/subscription changes, private account actions, unavailable hardware, secrets, destructive production operations with no safe staged path, or product decisions the user has not already delegated.

### Full-Moon Completion Standard
- When a task scope is accepted, carry it through to complete, validated implementation. Do not defer known required work just because it is large, cross-cutting, or would require multiple PRs.
- Prefer many atomic PRs over a partial finish. Keep working until every required follow-up is either completed or blocked by a true human-only blocker.
- Use stay-in-turn/autopilot patterns for long-running work such as CI, deploys, multi-PR chains, audits, and validation loops.
- Use sub-agents as implementors and reviewers where parallelism improves completeness or quality.
- If an autopilot/support skill needed for this workflow is unavailable, install or update it from `ouroboros-skills` before falling back.

### Final Response Gate
- Never send a final completion response while an implementation PR is merely open. An accepted coding task is not done until every required PR is merged or an explicit human-only blocker prevents merging.
- Before final response, verify the merged commit's required checks, deployment workflow, and production/QA smoke path appropriate to the change. If deployment is not required for the change, say why in the final response.
- Before final response, clean task-owned remote branches, local branches, worktrees, temporary smoke artifacts, and disposable smoke data. Leave unrelated user or other-agent work untouched.
- If a repository disables the preferred merge strategy, use the next enabled PR merge strategy and continue through the same post-merge verification and cleanup gate.
- If any part of merge, deploy, smoke, or cleanup is blocked by a true human-only blocker, state the exact blocker and leave clear continuation instructions. Do not treat an open PR as a completed handoff.

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

### Manual/Smoke Data Hygiene
- Never leave Codex-created smoke, manual QA, or browser-test recipes/users/cookbooks in local, staging, or production Spoonjoy data.
- Prefer automated tests with `cleanupDatabase()` over manual app flows. When a live/manual flow is necessary, use clearly disposable names such as `codex-smoke-*` or `e2e *` and clean them in the same run before reporting completion.
- Run `pnpm cleanup:qa` before and after manual/e2e cleanup work to inspect local disposable residue; use `pnpm cleanup:qa -- --apply` only for local D1 cleanup. Never use this cleanup path against remote D1.
- `scripts/smoke-live.mjs` cleans its disposable user by default; pass `--keep-smoke-data` only when the human explicitly asks to preserve debugging data, and remove that data before the task is done.

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

Include this only after the Final Response Gate is satisfied. Example:
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

6. **Canonical domain**: Spoonjoy's canonical domain is `spoonjoy.app`; do not assume ownership of `spoonjoy.com`.

## Key Files to Know

- `app/lib/db.server.ts` — Database client setup
- `app/lib/session.server.ts` — Auth session handling
- `prisma/schema.prisma` — Data models
- `test/utils.ts` — Test data helpers
- `vitest.config.ts` — Test configuration
- `wrangler.toml` — Cloudflare deployment config
