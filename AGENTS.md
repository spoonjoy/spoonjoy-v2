# AGENTS.md: Spoonjoy

Spoonjoy is Ari's recipe app, built with React Router 7 on Cloudflare.[^stack]

## Feedback

Check `feedback/YYYY-MM-DD.md` for known issues and planned enhancements before making changes.

## Stack

- **Framework**: React Router 7, with routes listed in `app/routes.ts`[^stack]
- **Platform**: Cloudflare Workers and D1
- **Database**: SQLite locally, Cloudflare D1 in production (via Prisma)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4[^stack]
- **Testing**: Vitest, Testing Library and `@faker-js/faker`
- **Icons**: Lucide React

Prefer Cloudflare services when possible.

## Validation

Spoonjoy is built for agentic developers end to end, and so is its validation.

- **Validate app behaviour in CI, against QA.** The `Journeys` workflow (`.github/workflows/journeys.yml`) gives each run its own QA stack (`scripts/qa-run-scope.mjs`): a Worker `spoonjoy-v2-qa-run-<run>-<attempt>` at its own workers.dev URL, with its own cook-session Durable Object, and its own D1 `spoonjoy-qa-run-<run>-<attempt>`, created empty and migrated from the branch's `migrations/`, in production mode.[^qa-run] Runs share only QA's R2 bucket (`spoonjoy-photos-qa`) and rate-limit namespaces, so runs for different pull requests run at the same time instead of queueing. A run's database starts empty rather than as a copy of shared QA (D1 cannot export a database with the FTS5 search table), so a branch's migrations reach shared QA only after they merge.[^qa-run] Each run deploys there, seeds it, runs the journeys in `e2e/journeys/` on iPhone WebKit and desktop Chrome, and deletes its stack before it ends; each run's start and the hourly `QA Run Sweep` workflow delete any run stack older than three hours, and fail when more than 100 run Workers exist.[^qa-sweep] Each run's job summary reports how many Cloudflare API requests it made.[^cf-requests] A newer push to the same pull request cancels that pull request's run in progress; every other run (pushes to main, merge-queue groups, the schedule, manual runs) runs to the end.[^journeys-concurrency] The shared QA Worker `spoonjoy-v2-qa` (D1 `spoonjoy-qa`) mirrors main: the workflow deploys main there after main's journeys pass, if that commit is still main's tip, and native journeys and the QA Image Cover Smoke workflow run against it.[^shared-qa] QA, a run's Worker included, makes AI covers from sample images in QA's photo bucket instead of a paid generation call (`IMAGE_PROVIDER_PRIMARY=sample` in `wrangler.json`'s `env.qa`), and no journey asserts on one.[^sample-covers] Don't run the app, `wrangler dev` or Playwright on your machine to check behaviour: it is not the real stack, and it wastes time. Run unit tests locally for a fast red/green loop.
- **Test outcomes, not renders.** A step passes only when its result survives a reload or shows up on another page. Tag a test that changes data `@mutates`, and call `verifyAfterReload` in it. `pnpm run check:journeys` enforces this and also forbids retries, clicks inside loops, array callbacks or `toPass`, assertions inside `if`, and skipped, `fixme`, `fail` or `only` journeys.[^journey-rules] Treat a flaky journey as a failing one, and a skipped journey as a hidden failure. A journey's expectation waits up to 15 s, because a run's fresh D1 database and cook-session object sometimes hold a call for several seconds, and a page load whose connection was reset before any answer is loaded once more; neither lets an error answer or a wrong page pass.[^journey-waits]
- **Use QA's permanent personas**, seeded by `scripts/seed-qa-kitchen.mjs`: `qa_kitchen_chef` (recipes, cookbooks, shopping list), `qa_kitchen_friend` (public recipes to search, save and fork) and `qa_kitchen_newbie` (empty). Their passwords are regenerated on each run and never stored; CI signs in with them.[^persona-passwords] Add the data a journey needs to the seed rather than creating it ad hoc. QA (`spoonjoy-v2-qa`) has no `OPENAI_API_KEY`, so shopping-list items are parsed by the built-in fallback parser, and `shopping-list.journey.ts` asserts that parser's exact output ("2 lemons" is 2 whole, "salt" needs review).[^qa-parser] If that secret is ever added to QA, update those expected values.
- **Give a data-changing journey a per-run scratch user's stored session, not `/signup`.** QA's `AUTH_IP_RATE_LIMITER` (`wrangler.json`'s `env.qa`) allows 60 sign-in/sign-up attempts per minute per IP, shared across the whole run (and across concurrent runs that land on the same runner IP), raised from production's 20 a minute because CI's Journeys workflow exercises QA from shared GitHub-hosted runner IPs (see `docs/deployment.md`'s Dedicated QA Environment section).[^auth-limit] `scripts/seed-qa-kitchen.mjs` also creates 8 scratch indices per run, each as two throwaway accounts: a base account (`codex_e2e_s_<token>_<n>`) and a desktop twin (`codex_e2e_s_<token>_<n>d`), so 16 scratch users per run, in the `codex-e2e-*` / `codex_e2e_*` disposable namespace that `scripts/cleanup-local-qa-data.mjs` removes and `--rotate` invalidates.[^scratch-users] They own no data, and their names are unique per run, so concurrent or leftover runs never collide.[^scratch-users] `personas.setup.ts` signs each one in once and stores its session; a data-changing journey uses `scratchStorageStatePath(n)` from `support/personas.ts` for `test.use({ storageState: ... })`.[^scratch-sessions] The iPhone and desktop projects run at the same time, so a journey whose two devices must not share one account (for example because a user has only one shopping list) uses `test.use({ storageState: scratchStorageStateForProject(n) })` instead: the base account on iPhone, the desktop twin on desktop Chrome.[^scratch-sessions] Give each journey area its own scratch index, so two journeys never race on the same account; a new journey file takes its area's index rather than creating a new one:

  | Scratch index | Area | Journey file |
  | --- | --- | --- |
  | 1[^s1] | Recipe editing | `recipe-editing.journey.ts` |
  | 2[^s2] | Cookbooks | `cookbooks.journey.ts` |
  | 3[^s3] | Shopping list (per-device twins) | `shopping-list.journey.ts`, `shopping-list.mobile.journey.ts` |
  | 4[^s4] | Social (saves, forks, cooks; per-device twins) | `social.journey.ts` |
  | 5[^s5] | Account settings (per-device twins) | `account-settings.journey.ts` |
  | 6[^s6] | Sessions (revocation) | `sessions.desktop.journey.ts` |
  | 7[^s7] | Cooking progress (per-device twins) | `cooking.journey.ts` (its progress tests) |
  | 8[^s8] | Cook-session sync across devices (desktop twin only) | `cook-session-sync.desktop.journey.ts` |

  Cook progress is data too: on QA a signed-in cook's checklist, scale and step live in their account (cook-session sync, `COOK_SESSION_PROTOCOL=v1`).[^cook-sync] So a journey that changes progress uses its own scratch cook, resets that cook's progress with `support/cook-progress.ts` first (passing the cook's user id from `scratchForProject(n, testInfo.project.name)`, because cookie callers must name their user in `X-Spoonjoy-Cook-User`), and leaves the personas' progress alone. The reset's request shapes (`support/cook-progress-requests.ts`) also run against the real Worker in the Workers test lane.

  The New user journey (`new-user.journey.ts`) signs up through `/signup`, and so does `cooking.mobile.journey.ts`'s throwaway user, which predates scratch indices and is a candidate to move onto one.[^signup-journeys] `personas.setup.ts` keeps the full sign-in budget: 3 persona sign-ins and 16 scratch sign-ins per run up front, plus the journeys' own sign-ins, against QA's limit of 60 a minute.[^sign-in-budget]
- **Type passwords in journeys only as `Secret` values, with `fillSecret(locator, secret)`** (`e2e/journeys/support/secret.ts`). Playwright titles `fill()`/`type()` steps with the typed value and prints a failed `toHaveValue()`'s expected value, and the journeys report and job log are public. A `Secret` is not a string, so those calls don't typecheck (`tsc -p tsconfig.e2e.json`, part of `pnpm run typecheck` and also run by the Journeys workflow before it touches QA), and it prints as `[redacted]`.[^secret] Credentials come in as Secrets through `parseCredentialsJson`, throwaway users through `createDisposableJourneyUser`, new passwords from `Secret.generate()`; `pnpm run check:journeys` fails any other raw password source (rule `secret-boundary`) and any `fill()`/`type()`/`pressSequentially()` into a password field (rule `no-password-field-fill`).[^secret-rules] `scripts/sanitize-journey-traces.mjs` redacts password values from trace DOM snapshots and page snapshots (`error-context.md`) before upload.[^sanitize]
- **Turn a bug into a failing journey step first**, then fix it. Read failures from the workflow's `journeys-report` artifact (traces, video, screenshots).
- **Coverage is not validation.** The unit-coverage rule below still applies, but green coverage says nothing about whether a user can use the app.

### The HX census

The census measures, page by page and state by state, how many of the controls a person can reach are not yet Ouro HX controls. It is HX's own kit, `ouro-census`, installed from the release tag under `e2e/ouro-census/` like any HX item and pinned to the tag's bytes by the design-system hygiene test, which the coverage job runs on every pull request; Spoonjoy owns the list of journeys and the baseline.[^census-kit]

- **What it is.** `e2e/journeys/support/hx-census.ts` lists the routes in `app/routes.ts` that render a page on a GET, as the persona who sees it (`signed-out`, `chef`, `friend` or `newbie`; dynamic segments use the QA kitchen seed: Lemon Herb Rice, its steps, the Weeknight Dinners cookbook, `qa_kitchen_chef`), plus a state for each dialog, menu, sheet, popover and disclosure on it; `pnpm run check:journeys` fails when a journey visits a page the list lacks.[^census-coverage] A journey is `{ id, enrolled, persona, path, states }`, and `censusJourneys()` turns the persona into the stored session the kit visits with. Write a state's `action` to open things only, never to submit, save or confirm, so persona data stays as seeded. Routes whose GET renders nothing (OAuth redirects and callbacks, probes, images, feeds, APIs, layouts) are not pages.
- **What it measures.** `hx-census.journey.ts` hands the list to the kit's `censusTests`, which loads each state fresh on both device projects, fails unless the page stayed at the journey's `path` (path and query; a redirect, such as a signed-out visit to a signed-in page landing on `/login`, would measure some other page), waits for hydration and finite animations, and records the exact multiset of visible controls.[^census-page] A control's identity is its role, normalized accessible name, `data-ouro-control` and `data-ouro-part` (or `-`) and context: the nearest landmark, dialog or named group or region, else the nearest `data-testid`, never its position (`button "Save" [-/-] in dialog "Save to cookbook"`).[^census-identity] A relative time ("2 minutes ago") or a calendar date in a name becomes `<relative time>` or `<date>`, since those depend on when the run happened.[^census-identity]
- **The baseline.** A state's multiset must equal `e2e/ouro-census/census.baseline.json` exactly: an added, removed, renamed, re-marked or duplicated control fails with a diff, and a state missing from the baseline fails with "no baseline".[^census-baseline] The Journeys workflow uploads the merged census of each run that ran the suite as the `ouro-census-actual` artifact, pass or fail.[^census-upload] To accept a change, run `pnpm census:update <run-id>` (it downloads that artifact with `gh run download`; a local `census-actual.json` path works too) and commit the baseline, so each change is a reviewed diff. Keep the census deterministic, so that two runs of the same commit record the same multisets: measure a page that lists run-specific data (this run's scratch users, whose names carry the run's token, or anything another journey creates) in a state that cannot show it, as the census measures `/search?q=hxcensusnomatch` rather than the empty `/search` that browses the newest recipes. Before baselining new journeys, compare two runs of the same commit with `pnpm census:compare <run-id> <run-id>`; it names each project, journey and state whose multisets differ.
- **Enrolment and the ratchet.** An enrolled journey fails on a control without a marker, or with a marker naming a component not installed under `app/components/ouro/`.[^census-enrolled] An unenrolled journey's unmarked count may only fall, state by state on each project, so a fall in one state never pays for a rise in another: `pnpm census:update` refuses a rise unless you pass `--allow-regression "<reason>"`, which the baseline records under `$allowedRegressions` until the next update that raises nothing.[^census-ratchet] Review treats an allowed regression as a finding. A journey or state new to the baseline is measurement, not a rise. The update refuses to drop a project, journey or state the baseline has unless `--remove <journey>` or `--remove <project/journey/state>` names it and `--remove-reason "<reason>"` says why (a renamed journey or state is a drop plus a new one), and records each removal under `$removed`.[^census-remove] A renamed journey carries its count: the new one may not hold more unmarked controls than the one it replaces without `--allow-regression`.[^census-rename]
- **It runs first.** The census reads the seeded kitchen before the other journeys change QA data, so the workflow runs `pnpm run test:journeys:census` alone (report in `hx-census-report/`, results in `hx-census-test-results/`, both in the `journeys-report` artifact), then `pnpm run test:journeys:after-census`.[^census-first] Each census worker writes `hx-census/census-expected.json` (each journey and state in the census list, which each project must record) and `hx-census/census-actual.<project>.<worker>.json`, and the kit's `census-merge.mjs` merges them, failing, and writing nothing, on a journey or state recorded twice or on a project that does not record exactly the expected states.[^census-merge]
- **New pages join it.** `pnpm run check:journeys` fails (rule `census-missing-page`) when a `*.journey.ts` visits a page the census lacks. It reads each `.goto(...)` whose argument is a string, a template or a `const` declared once in the file, starting with a literal `/` (other interpolations are wildcards), matches it to `app/routes.ts` as React Router ranks routes, and requires that route among the census's `path:` routes.[^census-coverage] It does not read pages reached by clicking, so add their states by hand.

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
- Call `$work-planner`/`$work-doer` again on each turn where that behavior is required.

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
- Never send a final completion response while an implementation PR is merely open. Keep an accepted coding task open until every required PR is merged or an explicit human-only blocker prevents merging.
- Before final response, verify the merged commit's required checks, deployment workflow, and production/QA smoke path appropriate to the change. If deployment is not required for the change, say why in the final response.
- Before final response, clean task-owned remote branches, local branches, worktrees, temporary smoke artifacts, and disposable smoke data. Leave unrelated user or other-agent work untouched.
- If a repository disables the preferred merge strategy, use the next enabled PR merge strategy and continue through the same post-merge verification and cleanup gate.
- If any part of merge, deploy, smoke, or cleanup is blocked by a true human-only blocker, state the exact blocker and leave clear continuation instructions. Do not treat an open PR as a completed handoff.

## Code Style

### General Principles
- Keep it simple — don't over-engineer
- Follow existing patterns in the codebase
- Clear, descriptive naming over clever abbreviations
- Keep TypeScript's strict mode on, and avoid `any` unless it is truly necessary
- Prefer composition over inheritance

### File Naming
- Route files: `kebab-case.tsx` (e.g., `recipes.$id.edit.tsx`)
- Components: `PascalCase.tsx`
- Utilities: `camelCase.ts` with `.server.ts` suffix for server-only code

### React Patterns
- Loaders fetch data, actions handle mutations (React Router conventions)
- Keep components focused — extract when they get unwieldy
- Use existing components before creating new ones

### Building with Ouro HX
- Spoonjoy is the reference app for Ouro HX: read [`docs/building-with-ouro-hx.md`](docs/building-with-ouro-hx.md) before changing UI. It covers installing HX from a release tag, theming through tokens, composing HX directly rather than through local wrappers, and what to do when HX lacks a component (add it to HX first; mark app code waiting on an unreleased item with `TODO(ouro-hx: <item>)`).
- After changing which files a page imports, run `pnpm provenance:generate`: `app/generated/ouro-provenance.json` (served at `/ouro-provenance.json`, read by X-ray's Source links) must be current, and CI checks it with `--check`.

### The HX source rule
- Anything reusable in Spoonjoy is an Ouro HX component, installed under `app/components/ouro/**` (grow HX when it lacks one). The rule is HX's own kit, `ouro-source-rules`, installed from the release tag like any HX item as `scripts/ouro-source-rules.mjs` and pinned to the tag's bytes.[^source-rules-kit] It reads app code with the TypeScript compiler API and the app's stylesheets with PostCSS, and finds the controls still built by hand: raw `<button>`, `<a>` (and React Router's `Link`), visible `<input>`/`<select>`/`<textarea>`, `<details>`/`<summary>`, `contentEditable`, positive `tabIndex`, interactive `role=`, click/key/pointer/touch handlers on plain elements, any `data-ouro*` attribute, elements from other UI-control libraries, and control-state styling (`focus:`, `active:`, `aria-pressed:`, `data-[state=open]:` and the like in a `className`, or such selectors on `.sj-*` classes and `[data-sj-*]` hooks in `app/**/*.css`). Hidden inputs, HX calls, the anchor HX `Link` renders through `OuroProvider` and hover-only decoration are exempt. Read the kit's header comment in `scripts/ouro-source-rules.mjs` for the categories.
- Hand-rolled controls are counted where they are used too: each JSX use of an imported app component that is offending is a `uses-hand-rolled-control` at the call site, followed to a fixed point across files, so a wrapper cannot launder a control.[^source-rules-wrapper]
- Spoonjoy's settings are `ouro-source-rules.json`: it reads `app/`, skips the HX installs and `app/lib/generated/`, and its stylesheet hooks are `sj`. Each offender is a fingerprint (`file::component::category::tag::type,name,aria-label,role`, no line numbers), and the scan must equal `ouro-source-rules.baseline.json` exactly.[^source-rules-baseline] `pnpm hx:source-rules` checks. A new offender fails: use an HX component instead. A fixed one fails until you run `pnpm hx:source-rules --write-baseline`.
- **The ratchet.** On every pull request CI runs `pnpm hx:source-rules --base <base commit>`: no fingerprint may rise against the base's baseline unless the new baseline lists it under `allowedRegressions` with a reason and the `count` it permits, and the settings may only widen the scan (the base's own `ouro-source-rules.json` names its baseline).[^source-rules-ratchet] An entry belongs to the pull request that adds it: one already on the base is stale and allows nothing.[^source-rules-stale] Record a real rise with `pnpm hx:source-rules --write-baseline --base origin/main --allow-regression "<reason>"`; review treats it as a finding. When the base has no baseline yet, the ratchet is skipped.[^source-rules-first]

### Claims
- A factual sentence on a Spoonjoy surface is a claim: it carries the primary source it comes from and a check that it still holds, so the next agent can trust it without rebuilding the proof. The checker is HX's `lib-claims` (`app/lib/ouro/claims-check.mjs`, with `claim()` in `app/lib/ouro/claims.ts`), installed from the release tag like any HX item, and `claims.config.json` names the surfaces: this file, `README.md`, `docs/building-with-ouro-hx.md`, `/llms.txt` and the Test Kitchen and provenance pages.[^claims-surfaces]
- In Markdown, cite with a footnote (`[^id]` and `[^id]: <source> verify:<check>`) or a source link titled with its check. In app copy, wrap the text in `claim(text, { source, verify })`. Read [HX's claims guide](https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/docs/guides/claims.md "verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/docs/guides/claims.md)") for the sources and checks it takes. When a sentence cannot be sourced, correct it or remove it; don't reword a claim only to get past the check.
- `pnpm run claims:check` lints the surfaces and runs the claims' checks. The merge queue's coverage job runs it, and on a pull request `pnpm run claims:pr` (in unit-changed) also runs the ratchet against the base commit and lints the title and body: an entry `claims.config.json` adds (an allowed sentence, a surface, a required test) needs a reason and a mention in the pull request's description.[^claims-ci] After citing a new address, run `node app/lib/ouro/claims-check.mjs lint --network <file>` and commit `claims-urls.json`.

## Testing

### Philosophy
- **Cover every line, branch, function and statement.** The coverage job fails below 100% of each.[^coverage] Test every edge case: valid, invalid, boundary, null, empty and error paths.
- **Treat warnings as errors.** CI runs its commands through a warning gate that fails a command when it prints a warning.[^warnings] Fix each warning before committing.
- **Write tests alongside code** — not after, not "later", but as part of the same commit
- **Use tests to validate your work**: run tests frequently to catch issues early, and check for warnings before each commit.
- **Tests are documentation** — they show how code is meant to be used
- **Keep both rules, coverage and warnings, without exception.**

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
- Don't leave agent-created recipes, users or cookbooks in QA or production outside the `qa-kitchen` personas. Throwaway users use the `codex-e2e-*` / `codex_e2e_*` naming so cleanup can find them.
- The native (spoonjoy-apple) Journeys workflow creates its own `codex-native-*` / `codex_native_*` accounts per run; `scripts/cleanup-local-qa-data.mjs` leaves those alone while young so a concurrent native run is not swept mid-flight, then removes an account and everything it owns once it is at least 3 hours old.[^native-accounts]
- The `Journeys` workflow runs `pnpm run cleanup:remote:qa:apply` after its journeys.[^qa-cleanup] Never run cleanup with `--apply` against production.
- `scripts/smoke-live.mjs` cleans its disposable user by default; pass `--keep-smoke-data` only when the human explicitly asks to preserve debugging data, and remove that data before the task is done.

## Git Workflow

### Agent Branch Setup
- Work should happen on an agent-scoped branch whose first path segment identifies the active agent (for example, `<agent>/<task-slug>`).
- If the current branch is `main`, detached, or otherwise not agent-scoped, the agent has authority to create or switch to an appropriate agent-scoped branch without human approval.
- Choose the branch from the active agent identity and current task context. Ask the human only if automatic branch setup fails or if multiple valid agent identities are genuinely ambiguous.
- Do not use a `codex/` prefix when the branch is only being created to satisfy this repo's agent-scoped workflow.

### Atomic Commits
- **One commit per file** (or logical unit of work)
- **Keep GitHub in sync**: run `git push` after every commit
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

Tell Slugger (the Ouroboros agent) when you're finished:

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
- State facts and next steps, without apologies or empty promises
- If something failed, say what failed and what you'll try next
- If uncertain, say so rather than guessing

## Common Gotchas

1. **Server-only imports**: Files with `.server.ts` suffix are server-only. Don't import them in client code.

2. **D1 adapter**: Production uses `@prisma/adapter-d1`. Local dev uses SQLite file directly.

3. **Test database**: Tests use `test.db` (SQLite). Make each test file clean up its own data.

4. **Foreign key constraints**: When deleting test data, delete in correct order (children before parents).

5. **Unique constraints**: use unique suffixes (faker alphanumeric) for test data to avoid collisions.

6. **Canonical domain**: Spoonjoy's canonical domain is `spoonjoy.app`; do not assume ownership of `spoonjoy.com`.

## Key Files to Know

- `app/lib/db.server.ts` — Database client setup
- `app/lib/session.server.ts` — Auth session handling
- `prisma/schema.prisma` — Data models
- `test/utils.ts` — Test data helpers
- `vitest.config.ts` — Test configuration
- `wrangler.toml` — Cloudflare deployment config

[^qa-run]: scripts/qa-run-scope.mjs verify:fileLine(scripts/qa-run-scope.mjs, /export const RUN_WORKER_PREFIX = "spoonjoy-v2-qa-run-";/) verify:fileLine(scripts/qa-run-scope.mjs, /export const RUN_DATABASE_PREFIX = "spoonjoy-qa-run-";/) verify:fileLine(scripts/qa-run-scope.mjs, /its own D1 database, `spoonjoy-qa-run-<run id>-<attempt>`, created empty and migrated from/)
[^qa-sweep]: scripts/qa-run-scope.mjs; .github/workflows/qa-run-sweep.yml verify:fileLine(scripts/qa-run-scope.mjs, /export const STALE_AFTER_MS = 3 \* 60 \* 60_000;/) verify:fileLine(scripts/qa-run-scope.mjs, /export const MAX_RUN_WORKERS = 100;/) verify:fileLine(.github/workflows/qa-run-sweep.yml, /cron: "41 \* \* \* \*"/)
[^cf-requests]: .github/workflows/journeys.yml verify:fileLine(.github/workflows/journeys.yml, /count-cloudflare-requests\.mjs summary .* \| tee -a "\$GITHUB_STEP_SUMMARY"/)
[^journeys-concurrency]: .github/workflows/journeys.yml verify:fileLine(.github/workflows/journeys.yml, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/)
[^shared-qa]: .github/workflows/journeys.yml verify:fileLine(.github/workflows/journeys.yml, /name: deploy main to shared QA/) verify:fileLine(.github/workflows/journeys.yml, /The shared QA Worker \(spoonjoy-v2-qa, D1 spoonjoy-qa-2\) mirrors main/)
[^sample-covers]: wrangler.json; scripts/qa-run-scope.mjs verify:fileLine(wrangler.json, /"IMAGE_PROVIDER_PRIMARY": "sample"/) verify:fileLine(scripts/qa-run-scope.mjs, /QA makes covers from the sample images in QA's photo/)
[^journey-rules]: scripts/check-journey-rules.mjs verify:fileLine(scripts/check-journey-rules.mjs, /"no-retry-config" \| "no-click-in-loop" \| "no-assertion-in-if" \| "no-skipped-journeys" \| "mutation-needs-reload-check"/)
[^journey-waits]: playwright.journeys.config.ts; e2e/journeys/support/app-ready.ts verify:fileLine(playwright.journeys.config.ts, /expect: \{ timeout: 15_000 \},/) verify:fileLine(e2e/journeys/support/app-ready.ts, /export async function loadAgainAfterTransportFailure/)
[^persona-passwords]: scripts/seed-qa-kitchen.mjs verify:fileLine(scripts/seed-qa-kitchen.mjs, /with a fresh, per-run password for each persona/)
[^qa-parser]: docs/deployment.md; e2e/journeys/shopping-list.journey.ts verify:fileLine(docs/deployment.md, /QA has no `OPENAI_API_KEY`/) verify:fileLine(e2e/journeys/shopping-list.journey.ts, /"2 lemons" is 2 \/ whole \/ lemons, and "salt" \(no amount\) is ambiguous and needs review/)
[^auth-limit]: wrangler.json; docs/deployment.md verify:equals(wrangler.json#env.qa.ratelimits.2.simple.limit)=60 verify:equals(wrangler.json#ratelimits.2.simple.limit)=20 verify:fileLine(docs/deployment.md, /`AUTH_IP_RATE_LIMITER` \(namespace `2003`\) is 60\/minute in QA, vs\. production's 20\/minute/)
[^scratch-users]: scripts/seed-qa-kitchen.mjs verify:fileLine(scripts/seed-qa-kitchen.mjs, /export const SCRATCH_USER_COUNT = 8;/) verify:fileLine(scripts/seed-qa-kitchen.mjs, /codex_e2e_s_\$\{runToken\}_\$\{n\}\$\{suffix\}/)
[^scratch-sessions]: e2e/journeys/personas.setup.ts verify:fileLine(e2e/journeys/personas.setup.ts, /storageState\(\{ path: scratchStorageStatePath\(n\) \}\)/) verify:fileLine(e2e/journeys/personas.setup.ts, /storageState\(\{ path: scratchDesktopStorageStatePath\(n\) \}\)/)
[^s1]: e2e/journeys/recipe-editing.journey.ts verify:fileLine(e2e/journeys/recipe-editing.journey.ts, /scratchStorageStatePath\(1\)/)
[^s2]: e2e/journeys/cookbooks.journey.ts verify:fileLine(e2e/journeys/cookbooks.journey.ts, /scratchStorageStatePath\(2\)/)
[^s3]: e2e/journeys/shopping-list.journey.ts verify:fileLine(e2e/journeys/shopping-list.journey.ts, /scratchStorageStateForProject\(3\)/) verify:fileLine(e2e/journeys/shopping-list.mobile.journey.ts, /scratchStorageStateForProject\(3\)/)
[^s4]: e2e/journeys/social.journey.ts verify:fileLine(e2e/journeys/social.journey.ts, /scratchStorageStateForProject\(4\)/)
[^s5]: e2e/journeys/account-settings.journey.ts verify:fileLine(e2e/journeys/account-settings.journey.ts, /const SCRATCH_INDEX = 5;/)
[^s6]: e2e/journeys/sessions.desktop.journey.ts verify:fileLine(e2e/journeys/sessions.desktop.journey.ts, /const SCRATCH_INDEX = 6;/)
[^s7]: e2e/journeys/cooking.journey.ts verify:fileLine(e2e/journeys/cooking.journey.ts, /const SCRATCH_INDEX = 7;/)
[^s8]: e2e/journeys/cook-session-sync.desktop.journey.ts verify:fileLine(e2e/journeys/cook-session-sync.desktop.journey.ts, /const SCRATCH_INDEX = 8;/)
[^cook-sync]: wrangler.json verify:fileLine(wrangler.json, /"COOK_SESSION_PROTOCOL": "v1"/)
[^signup-journeys]: e2e/journeys/new-user.journey.ts; e2e/journeys/cooking.mobile.journey.ts verify:fileLine(e2e/journeys/new-user.journey.ts, /The signup test submits \/signup/) verify:fileLine(e2e/journeys/cooking.mobile.journey.ts, /page\.goto\("\/signup"\)/)
[^sign-in-budget]: e2e/journeys/personas.setup.ts verify:fileLine(e2e/journeys/personas.setup.ts, /alone performs 3 persona sign-ins \+ 16 scratch sign-ins/)
[^secret]: e2e/journeys/support/secret.ts verify:fileLine(e2e/journeys/support/secret.ts, /export const REDACTED = "\[redacted\]";/) verify:fileLine(package.json, /"typecheck": ".*tsc -p tsconfig\.e2e\.json"/)
[^secret-rules]: scripts/check-journey-rules.mjs verify:fileLine(scripts/check-journey-rules.mjs, /"secret-boundary" \| "no-password-field-fill"/)
[^sanitize]: scripts/sanitize-journey-traces.mjs verify:fileLine(scripts/sanitize-journey-traces.mjs, /Typed passwords\./)
[^census-kit]: test:test/components/ui/design-system-hygiene.test.ts::Spoonjoy UI design-system hygiene > pins every file the HX CLI installed, in every folder and of every type, to the tag's bytes verify:testExists(test/components/ui/design-system-hygiene.test.ts::Spoonjoy UI design-system hygiene > pins every file the HX CLI installed, in every folder and of every type, to the tag's bytes) verify:fileLine(.github/ouro-hx-installed.json, /"e2e\/ouro-census\/census-page\.mjs": "[0-9a-f]{64}"/) verify:fileLine(e2e/journeys/hx-census.journey.ts, /import \{ censusTests \} from "\.\.\/ouro-census\/census-page\.mjs";/)
[^census-coverage]: scripts/check-journey-rules.mjs; test/scripts/check-journey-rules.test.ts verify:fileLine(scripts/check-journey-rules.mjs, /rule: "census-missing-page"/) verify:fileLine(package.json, /"check:journeys": "node scripts\/check-journey-rules\.mjs e2e\/journeys --census e2e\/journeys\/support\/hx-census\.ts --routes app\/routes\.ts"/)
[^census-page]: e2e/ouro-census/census-page.mjs verify:fileLine(e2e/ouro-census/census-page.mjs, /a journey's path is where its page is/) verify:fileLine(e2e/journeys/hx-census.journey.ts, /prepare: waitForHydration/)
[^census-identity]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L75 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L75) verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L31) verify:fileLine(e2e/ouro-census/census.mjs, /export const RELATIVE_TIME = "<relative time>";/)
[^census-baseline]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L147 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L147) verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L138) verify:fileLine(e2e/ouro-census/census.mjs, /export const BASELINE_PATH = "e2e\/ouro-census\/census\.baseline\.json";/)
[^census-upload]: .github/workflows/journeys.yml verify:fileLine(.github/workflows/journeys.yml, /name: ouro-census-actual/) verify:fileLine(.github/workflows/journeys.yml, /if: always\(\) && env\.SUITE == 'journeys' && steps\.suite\.outcome != 'skipped'/)
[^census-enrolled]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L162 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L162)
[^census-ratchet]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L331 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L331) verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L365)
[^census-remove]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L457 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L457) verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L395)
[^census-rename]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L422 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L422)
[^census-first]: .github/workflows/journeys.yml verify:fileLine(.github/workflows/journeys.yml, /pnpm run test:journeys:census \|\| census=\$\?/) verify:fileLine(package.json, /"test:journeys:after-census": ".*--grep-invert @ouro-census"/)
[^census-merge]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L297 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L297) verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/census-update.test.mjs#L682) verify:fileLine(.github/workflows/journeys.yml, /node e2e\/ouro-census\/census-merge\.mjs hx-census census-actual\.json/)
[^stack]: package.json verify:fileLine(package.json, /"react-router": "7\./) verify:fileLine(package.json, /"tailwindcss": "\^4\./)
[^source-rules-kit]: test:test/components/ui/design-system-hygiene.test.ts::Spoonjoy UI design-system hygiene > pins every file the HX CLI installed, in every folder and of every type, to the tag's bytes verify:testExists(test/components/ui/design-system-hygiene.test.ts::Spoonjoy UI design-system hygiene > pins every file the HX CLI installed, in every folder and of every type, to the tag's bytes) verify:fileLine(.github/ouro-hx-installed.json, /"scripts\/ouro-source-rules\.mjs": "[0-9a-f]{64}"/) verify:fileLine(package.json, /"hx:source-rules": "node scripts\/ouro-source-rules\.mjs"/)
[^source-rules-wrapper]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L737 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L737)
[^source-rules-baseline]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L1271 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L1271) verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L1285) verify:fileLine(ouro-source-rules.json, /"hookPrefix": "sj"/)
[^source-rules-ratchet]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L1401 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L1401) verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L1408) verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L1469) verify:fileLine(.github/workflows/ci.yml, /pnpm run hx:source-rules --base "\$\(git rev-parse HEAD\^1\)"/)
[^source-rules-stale]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L1428 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L1428)
[^source-rules-first]: https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L1449 verify:urlOk(https://github.com/ourostack/ouro-ui/blob/96542d72b60b436dd6a60447d888a4c9e9d5edf7/scripts/kits/source-rules.test.mjs#L1449)
[^coverage]: vitest.config.ts verify:fileLine(vitest.config.ts, /statements: 100,/) verify:fileLine(vitest.config.ts, /branches: 100,/)
[^warnings]: scripts/warning-gate.ts; test/scripts/warning-gate.test.ts verify:fileLine(scripts/warning-gate.ts, /export function findUnexpectedDiagnosticOutput/) verify:fileLine(.github/workflows/ci.yml, /run: pnpm run verify.clean.test.coverage/)
[^native-accounts]: scripts/cleanup-local-qa-data.mjs verify:fileLine(scripts/cleanup-local-qa-data.mjs, /export const NATIVE_JOURNEY_STALE_AFTER_SECONDS = 3 \* 60 \* 60;/)
[^qa-cleanup]: .github/workflows/journeys.yml verify:fileLine(.github/workflows/journeys.yml, /pnpm run cleanup:remote:qa:apply/)
[^claims-surfaces]: claims.config.json verify:fileLine(claims.config.json, /"match": "\^\(README\|AGENTS\)\\\\\.md\$"/) verify:fileLine(claims.config.json, /building-with-ouro-hx/) verify:fileLine(claims.config.json, /llms-txt/)
[^claims-ci]: .github/workflows/ci.yml; scripts/claims-pr.mjs verify:fileLine(.github/workflows/ci.yml, /run: node scripts\/warning-gate\.ts -- pnpm run claims:check/) verify:fileLine(.github/workflows/ci.yml, /run: node scripts\/warning-gate\.ts -- pnpm run claims:pr/) verify:testExists(test/scripts/claims-pr.test.ts::main > runs the ratchet, the title and body lint and the full check against the base commit)
