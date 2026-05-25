# Spoonjoy v2 Pre-Production Readiness Backlog

Date: 2026-05-25
Branch: `slugger/pre-production-readiness`

Goal: reach the point where the only remaining dependency before switching `spoonjoy.app` to v2 is the legacy data migration plan and credentials/data that Ari must provide.

## PPR-001 — Make OAuth buttons reflect configured providers

**Source**: pre-production audit
**What**: Login and signup always render both Google and Apple buttons even when the deployed Worker lacks those secrets.
**Why it matters**: A production login screen should not advertise guaranteed-failing auth paths.
**Evidence**: `app/components/ui/oauth.tsx`; `wrangler secret list` only reports `SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`.
**Severity**: high
**Blast radius**: auth UI and OAuth start routes
**Recommended lane**: fix-now
**Verification**: Route/component tests for configured/unconfigured provider rendering; live smoke `/login` and `/signup`.
**Status**: fixed
**Linked work**: `b8ab11b fix: gate OAuth buttons by configured providers`
**Notes**: Login/signup loaders now derive configured providers from the Worker environment. Auth pages render OAuth divider/buttons only when at least one provider is configured.

---

## PPR-002 — Set available production secrets and document missing ones

**Source**: pre-production audit
**What**: Remote Worker is missing documented OAuth/OpenAI secrets. Local `.env` has Google OAuth credentials, but no Apple or OpenAI credentials were found locally.
**Why it matters**: Google OAuth, Apple OAuth, import LLM fallback, AI placeholder covers, and spoon cover stylization depend on these.
**Evidence**: `pnpm exec wrangler secret list`; `.env` redacted key scan; keychain checks for `OPENAI_API_KEY` and `APPLE_PRIVATE_KEY` were missing.
**Severity**: high
**Blast radius**: auth, import, AI image features
**Recommended lane**: fix-now for available Google secrets; external-prerequisite for missing Apple/OpenAI values
**Verification**: `wrangler secret list`; OAuth start smoke should show configured providers only; OpenAI-backed MCP import/image smoke after Ari provides key.
**Status**: in-progress
**Linked work**: `pnpm exec wrangler secret put GOOGLE_CLIENT_ID`; `pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET`; `pnpm production:readiness`
**Notes**: Google OAuth secrets were found in local `.env` and uploaded to the Worker. Apple OAuth and OpenAI credentials were not found in local env files or keychain. `pnpm production:readiness` reports those missing feature groups as WARN. This is an external credential dependency, not an unresolved design decision.

---

## PPR-003 — Persist cook-mode progress across reload/PWA relaunch

**Source**: product readiness audit
**What**: Cook mode checkmarks, active step, and scale reset on reload.
**Why it matters**: Kitchen use includes screen locks, accidental refreshes, PWA relaunches, and browser back/forward.
**Evidence**: `app/routes/recipes.$id.tsx` keeps `scaleFactor`, checked sets, and `activeCookStepIndex` in component state only.
**Severity**: high
**Blast radius**: recipe detail/cook mode
**Recommended lane**: fix-now
**Verification**: Route tests around localStorage persistence and storage migration; browser smoke reload in `#cook`.
**Status**: fixed
**Linked work**: `7bb1899 feat: persist cook mode progress and timers`
**Notes**: Cook mode now stores recipe-scoped progress in localStorage: active step, scale factor, checked ingredient IDs, and checked step-output IDs. Stored IDs are filtered against the current recipe shape.

---

## PPR-004 — Add cook-mode timers for step durations

**Source**: product readiness audit
**What**: Recipe steps support `duration`, but focused cook mode does not expose a timer/rest cue.
**Why it matters**: Timed steps are a core cooking-mode affordance and already exist in the data model.
**Evidence**: `RecipeStep.duration`; `CookModePanel` renders title/progress/checklist/description but no duration/timer UI.
**Severity**: medium
**Blast radius**: recipe detail/cook mode
**Recommended lane**: fix-now
**Verification**: Component/route tests for duration display, start/pause/reset/done states; browser smoke.
**Status**: fixed
**Linked work**: `7bb1899 feat: persist cook mode progress and timers`
**Notes**: Focused cook mode now shows a timer when `RecipeStep.duration` is present, with start/pause/reset/restart behavior.

---

## PPR-005 — Put UI audit tooling in the repo

**Source**: audit-skill dogfood
**What**: The UI audit report references inventory/crawl scripts that currently live only inside the local skill bundle.
**Why it matters**: Production readiness should be reproducible by any future agent or CI runner from the repo alone.
**Evidence**: `docs/ui-systems-audit-report.md` command history uses `/Users/arimendelow/.codex/skills/ui-systems-audit/scripts/...`; `scripts/` has no `inventory-ui.mjs` or `crawl-ui.mjs`.
**Severity**: medium
**Blast radius**: QA tooling
**Recommended lane**: fix-now
**Verification**: Add scripts/tests or smoke commands; rerun inventory and rendered crawl from repo paths.
**Status**: fixed
**Linked work**: `6a07a7d test: keep UI audit tooling repo-local`
**Notes**: Added repo-local `scripts/inventory-ui.mjs` and `scripts/crawl-ui.mjs`, plus `pnpm ui:inventory` and `pnpm ui:crawl`. Updated the UI audit report to use repo-local commands.

---

## PPR-006 — Add a production cutover runbook

**Source**: production readiness audit
**What**: Deploy docs cover staging Worker deployment, but there is no single cutover runbook for `spoonjoy.app` domain switch, data migration, DNS/custom-domain checks, OAuth callback updates, smoke tests, and rollback.
**Why it matters**: The stable-domain swap is an operational event, not just a deploy command.
**Evidence**: `DEPLOY.md` and `docs/deployment.md` mention custom domain steps but do not define the end-to-end production swap checklist.
**Severity**: high
**Blast radius**: operations/cutover
**Recommended lane**: fix-now
**Verification**: Durable runbook with preflight, migration placeholder, smoke, rollback, and owner-provided dependency list.
**Status**: fixed
**Linked work**: `docs/production-cutover.md`
**Notes**: Added a stable-domain cutover runbook covering hard gates, secrets, data migration placeholder, DNS/custom domain, OAuth callbacks, smoke tests, and rollback.

---

## PPR-007 — Add machine-checkable production readiness preflight

**Source**: production readiness audit
**What**: `deploy:preflight` checks deploy basics and migrations but not production-swap concerns such as remote schema sanity, required/optional secrets, custom-domain documentation, PWA assets, or MCP tool registration.
**Why it matters**: The final go/no-go needs a repeatable command instead of a hand-built checklist.
**Evidence**: `scripts/deployment-preflight.ts`; production readiness concerns found during this pass.
**Severity**: medium
**Blast radius**: operations/CI
**Recommended lane**: fix-now
**Verification**: Add script + tests; run locally against remote where safe.
**Status**: fixed
**Linked work**: `scripts/production-readiness.ts`; `pnpm production:readiness`
**Notes**: Added machine-checkable production readiness covering required runtime secrets, optional feature secret groups, PWA assets, production runbook coverage, and remote `User.photoUrl` schema.

---

## PPR-008 — Re-run full UI crawl after fixes

**Source**: UI systems audit
**What**: The prior crawl is good, but it predates this readiness branch.
**Why it matters**: UI proof must be against the code that will actually deploy.
**Evidence**: `docs/ui-systems-audit-report.md` records prior crawl artifact directories.
**Severity**: high
**Blast radius**: all user-visible routes
**Recommended lane**: fix-now
**Verification**: Repo-local crawl across mobile/tablet/desktop with 0 skipped, 0 console/page errors, 0 overflow, 0 clipped text, 0 small touch-target findings; manual review of contact sheets.
**Status**: fixed
**Linked work**: `node scripts/crawl-ui.mjs`; `/tmp/spoonjoy-preprod-ui-crawl-local`; `/tmp/spoonjoy-preprod-ui-crawl-live-auth`
**Notes**: Re-ran the repo-local UI crawl against final branch code locally and against the deployed Worker. Both authenticated crawls covered 54 route/viewport captures with 0 skipped routes, 0 console errors, 0 page errors, 0 overflow findings, 0 clipped-text findings, and 0 small touch-target findings.

---

## PPR-009 — Re-run full local and live verification

**Source**: production readiness audit
**What**: Full test/build/e2e/MCP/live smoke must be repeated after all readiness fixes.
**Why it matters**: Production-swap confidence must attach to final HEAD, not the prior deployed version.
**Evidence**: Last known full verification predates this branch.
**Severity**: high
**Blast radius**: whole app
**Recommended lane**: fix-now
**Verification**: `pnpm typecheck`, `pnpm test:coverage`, `pnpm build`, `pnpm test:e2e`, live smoke, MCP smoke.
**Status**: fixed
**Linked work**: `pnpm typecheck`; `pnpm test:coverage`; `pnpm build`; `pnpm test:e2e`; `pnpm deploy:auto`; live smoke script; Slugger MCP smoke
**Notes**: Final branch verification passed: typecheck, 4,639 Vitest tests with 100% statement/branch/function/line coverage, production build, and 34 Playwright e2e tests. Deployed to `https://spoonjoy-v2.mendelow-studio.workers.dev` as Worker version `823c2650-096a-43d6-b8bb-6cf77882cf5e`. Live smoke passed for `/`, `/login`, `/signup`, `/search?q=tomato&scope=all`, `/users/demo_chef/fellow-chefs`, `/users/demo_chef/kitchen-visitors`, authenticated demo login, `/recipes`, `/recipes/r_pizza#cook`, `/shopping-list`, `/account/settings`, and `/api/push/public-key`.

---

## PPR-010 — Confirm remote schema and migrations against final HEAD

**Source**: production readiness audit
**What**: Known `User.photoUrl` and migration-state concerns should be explicitly verified against remote D1 at final HEAD.
**Why it matters**: Production swap cannot inherit silent schema drift.
**Evidence**: Remote `PRAGMA table_info('User')` currently includes `photoUrl`; remote migrations currently report no pending migrations.
**Severity**: medium
**Blast radius**: D1 data layer
**Recommended lane**: fix-now
**Verification**: Record final remote migration and schema checks in readiness report.
**Status**: fixed
**Linked work**: `pnpm exec wrangler d1 migrations list DB --remote`; `pnpm exec wrangler d1 execute DB --remote --command "PRAGMA table_info('User');"`
**Notes**: Final remote pass is clean: `pnpm deploy:preflight` and `pnpm exec wrangler d1 migrations list DB --remote` both reported no pending migrations, and remote `PRAGMA table_info('User')` confirms `photoUrl` is present.

---

## PPR-011 — Validate upload metadata stripping remains covered

**Source**: prior backlog re-evaluation
**What**: EXIF/GPS stripping was a known privacy risk; current code strips JPEG APP1 metadata, but production readiness should verify tests cover it.
**Why it matters**: Spoon photos and profile photos can leak GPS metadata.
**Evidence**: `app/lib/image-storage.server.ts` strips JPEG APP1 segments before R2/data URL storage.
**Severity**: high
**Blast radius**: photo uploads/privacy
**Recommended lane**: fix-now
**Verification**: Focused tests for JPEG APP1 stripping and non-JPEG passthrough; full coverage.
**Status**: fixed
**Linked work**: existing `app/lib/image-storage.server.ts`; verified with `pnpm test test/lib/image-storage.server.test.ts -- --run`
**Notes**: Existing coverage verifies JPEG APP1 metadata is stripped before R2 upload and local data URL fallback, malformed JPEGs are left unchanged, and scan-data APP1-like bytes are not stripped.

---

## PPR-012 — Refresh Slugger/Ouro MCP after schema changes and smoke all first-class tools

**Source**: MCP integration audit
**What**: Slugger’s current MCP schema cache previously missed newly added `delete_recipe`.
**Why it matters**: The Ouro harness must treat Spoonjoy v2 as first-class before production.
**Evidence**: Raw MCP exposed `delete_recipe`; current-session Slugger needed schema refresh.
**Severity**: high
**Blast radius**: agent workflows
**Recommended lane**: fix-now
**Verification**: Slugger can create/search/update/delete recipe, add/list cookbook, add/read/check shopping list, and import dry-run after required secrets are present.
**Status**: fixed
**Linked work**: Slugger `send_message` smoke; raw `pnpm --silent mcp:serve` `tools/list`/`health`
**Notes**: Slugger verified first-class Ouro tools for health, recipe search, recipe create, recipe update, cookbook add, recipe-to-shopping-list add, shopping-list read, recipe delete, and shopping-list cleanup. Initial Slugger schema cache missed delete, then refreshed and exposed `spoonjoy_delete_recipe`; Slugger deleted the temp recipe `cmpljkamm0001mupc99yvwujl` and removed the added shopping-list item. Raw MCP `tools/list` also exposes `delete_recipe`, cookbook, shopping-list, fork, import, and spoon tools; raw `health` returned authenticated/writable for `demo@spoonjoy.com`.

---

## PPR-013 — Route large non-blocking architecture cleanup after cutover

**Source**: full-system audit carry-forward
**What**: `app/lib/spoonjoy-api.server.ts` remains a large multipurpose module.
**Why it matters**: It is maintainability debt, but splitting it now risks destabilizing production swap.
**Evidence**: `app/lib/spoonjoy-api.server.ts` is ~1,971 lines.
**Severity**: medium
**Blast radius**: MCP/API internals
**Recommended lane**: defer until after cutover
**Verification**: Backlog entry retained with rationale; no production blocker.
**Status**: deferred
**Linked work**: post-cutover architecture backlog
**Notes**: This remains real maintainability debt, but it is intentionally deferred until after production swap because broad MCP/API module splitting would add risk without improving cutover confidence.

---

## PPR-014 — Patch audit-skill blindspots found while dogfooding

**Source**: user request
**What**: If the audit skills assume unavailable repo scripts or under-spec production-swap checks, patch the skill docs/scripts.
**Why it matters**: The next agent should inherit the sharper audit process.
**Evidence**: Current UI skill points to scripts without saying whether to use bundled scripts or repo-local copies; production-readiness concerns are broader than UI/full-system audit templates.
**Severity**: low
**Blast radius**: local agent skill library
**Recommended lane**: fix-now
**Verification**: Skill patch applied and, if applicable, validated.
**Status**: fixed
**Linked work**: `/Users/arimendelow/.codex/skills/ui-systems-audit/SKILL.md`
**Notes**: Patched the UI audit skill to require repo-local or explicitly documented reproducible audit tooling, and to pair UI audits with operational checks for stable-domain production swaps. `quick_validate.py` passes.
