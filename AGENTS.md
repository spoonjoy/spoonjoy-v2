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

## Validation

Spoonjoy is built for agentic developers end to end, and so is its validation.

- **App behaviour is validated only in CI, against the QA mirror.** The `Journeys` workflow (`.github/workflows/journeys.yml`) deploys each pull request to `spoonjoy-v2-qa` (its own Worker, D1 `spoonjoy-qa`, R2 `spoonjoy-photos-qa`, cook-session Durable Object, production mode), seeds it, and runs the journeys in `e2e/journeys/` on iPhone WebKit and desktop Chrome. Do not run the app, `wrangler dev` or Playwright on your machine to check behaviour; it is not the real stack and it wastes time. Unit tests may run locally for a fast red/green loop.
- **Journeys test outcomes, not renders.** A step passes only when its result survives a reload or shows up on another page. Tests that change data are tagged `@mutates` and must call `verifyAfterReload`. `pnpm run check:journeys` enforces this and also forbids retries, clicks inside loops, array callbacks or `toPass`, assertions inside `if`, and skipped, `fixme`, `fail` or `only` journeys. Flaky is failing, and a skipped journey is a hidden failure.
- **QA has permanent personas** seeded by `scripts/seed-qa-kitchen.mjs`: `qa_kitchen_chef` (recipes, cookbooks, shopping list), `qa_kitchen_friend` (public recipes to search, save and fork) and `qa_kitchen_newbie` (empty). Their passwords are regenerated on every run and never stored; CI signs in with them. Add data a journey needs to the seed rather than creating it ad hoc.
- **Data-changing journeys use a per-run scratch user's stored session, not `/signup`.** QA allows only 20 sign-in/sign-up attempts per minute per IP, shared across the whole run. `scripts/seed-qa-kitchen.mjs` also creates `SCRATCH_USER_COUNT` (6) throwaway scratch users per run — same `codex-e2e-*` / `codex_e2e_*` disposable namespace `scripts/cleanup-local-qa-data.mjs` already removes, own no data, unique per run so concurrent/leftover runs never collide. `personas.setup.ts` signs each one in once and stores its session; a data-changing journey calls `scratch(n)` from `support/personas.ts` for `test.use({ storageState: ... })` instead of signing up a throwaway user through the UI. Each scratch index is owned by exactly one journey area, so two journeys never race on the same account — this is the assignment as milestone 3's journeys land (a journey file not listed yet hasn't been written; when it is, it takes its area's index rather than creating a new one):

  | Scratch index | Area | Journey file (once written) |
  | --- | --- | --- |
  | 1 | Recipe editing | `recipe-editing.journey.ts` |
  | 2 | Cookbooks | `cookbooks.journey.ts` |
  | 3 | Shopping list | `shopping-list.journey.ts` |
  | 4 | Social (spoons/forks) | `social.journey.ts` |
  | 5 | Account settings | `account-settings.journey.ts` |
  | 6 | Sessions (revocation) | `sessions.journey.ts` |

  Only the New user journey signs up through `/signup` — every other data-changing journey uses its assigned scratch index. `cooking.mobile.journey.ts`'s existing throwaway `/signup` user predates this scheme and is a candidate to move onto a scratch index in a follow-up. See `personas.setup.ts` for the full sign-in budget accounting (personas + scratch users + the journeys' own sign-ins, against the 20/minute cap).
- **Every bug becomes a failing journey step first**, then a fix. Read failures from the workflow's `journeys-report` artifact (traces, video, screenshots).
- **Coverage is not validation.** The 100% unit-coverage rule below still applies, but green coverage says nothing about whether a user can use the app.

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

Local commands are for writing code and running unit tests. App behaviour is validated only by the `Journeys` workflow in CI (see Validation above), so do not start the app locally to check it.

```bash
npm run test          # Run unit tests (Vitest, watch mode)
npm run test:ui       # Vitest UI mode
npm run test:coverage # Unit test coverage report
npm run typecheck     # Type-check the code
npm run build         # Production build, to check the app compiles
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

### Disposable Data Hygiene
- Never leave agent-created recipes, users or cookbooks in QA or production outside the `qa-kitchen` personas. Throwaway users use the `codex-e2e-*` / `codex_e2e_*` naming so cleanup can find them.
- The `Journeys` workflow runs `pnpm run cleanup:remote:qa:apply` after every run. Never run cleanup with `--apply` against production.
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
