# Planning: Comprehensive Cleanup & Backlog Refresh

Date: 2026-05-27
Author: Claude (cleanup pass agent)
Status: executing — human-judgement gates resolved 2026-05-27, scope expanded per Ari

## Resolved questions (2026-05-27)

- **Q1 (SJ-016):** ✅ **In scope** — build password reset + WebAuthn.
- **Q2 (Doc pruning):** ✅ **Hard-delete** the stale Jan/Feb notes + cutover artifacts.
- **Q3 (v1 migration):** ✅ **Delete** — cutover complete.
- **Q4 (Parking lot):** ✅ Skip native mobile (let stabilize), skip public/private visibility (everything's public already, by design).
- **Q5 (Production hardening, added):** ✅ All three: **rate limiting**, **error tracking**, **PWA install UX**. Constraint: optimize for free → **PostHog Error Tracking** (not Sentry) — Ari already instrumented PostHog analytics but never finished setup, so this PR also completes PostHog wiring.

Baseline (`origin/main` at `c89883f`): 228 test files, 100% statements/branches/functions/lines, zero open PRs, zero open issues, single `main` branch, single worktree.

## Mandate

Per Ari: "queue up everything we can possibly think to do — work with slugger on it … write down your entire scope of work and plan, let me know if you require human judgement, and then take control thru to complete shipping."

## Discovery summary

### What the codebase tells me
- Code is exemplary: ~32k LOC of app code, **1 TODO total**, zero skipped tests, zero `console.log` debug leaks (only legitimate `console.error` in `entry.server.tsx`).
- 100% coverage contract is current and holding.
- Production is deployed at `https://spoonjoy.app` (smoked earlier this session).

### What `BACKLOG.md` says vs reality
BACKLOG.md (audit anchor `2026-05-10`) marks 4 items as `proposed`, but the working tree shows all 4 have shipped in some form:

| Item | BACKLOG status | Reality |
|------|----------------|---------|
| SJ-010 Search/Discovery/Fellow Chefs | `proposed` | Shipped: `app/lib/search.server.ts`, `app/routes/search.tsx`, `app/lib/fellow-chefs.server.ts`, `app/routes/users.$identifier.fellow-chefs.tsx` |
| SJ-011 Recipe Import Flow | `proposed` | Shipped: 5 import modules (`recipe-import{,-fetch,-jsonld,-llm,-video}.server.ts`), PR #43 landed video sources |
| SJ-012 Recipe Forking/Spooning | `proposed` | Shipped: `app/lib/recipe-fork.server.ts`, `app/routes/recipes.$id.fork.tsx`, `app/components/recipe/ForkRecipeButton.tsx` |
| SJ-016 Password Reset & WebAuthn Decision | `proposed` | **Not decided.** Schema still carries `resetToken`, `resetTokenExpiresAt`, `webAuthnChallenge`, `UserCredential`. No app code references them (only v1 migration scripts + one comment in `github-oauth.server.ts`). ⚠️ |

### Untracked shipped features (no SJ-* assigned)
Features that landed in main but aren't represented in BACKLOG.md:
- **D-006 PWA + Web Push notifications** (PR #45, commit d0977f8)
- **Cook mode as paged cooking surface** (PR #100, commit 9f3c230)
- **Public sharing & first-class agent auth** (commit 6482980 + follow-ups f8f03b3, a1096bf, f374d9c, ada405f, c9dd9bf)
- **Multiple OAuth hardening rounds** (PRs #88-#96 + several follow-ups)
- **Search index performance work** (PRs #84-#88)
- **v1 → v2 data migration plumbing** (PR #83) — see ⚠️ below

### Doc inventory (real staleness via `git log`)

**Genuinely stale, never touched since Jan/Feb 2026 (~6,000 lines of dead notes):**
| File | Lines | Last meaningful commit |
|------|-------|------------------------|
| `EXPLORATION_GUIDE.md` | 1012 | 2026-01-29 (initial dark mode) |
| `WORKING_NOTES.md` | 848 | 2026-01-28 (Unit 2.10 working scratchpad) |
| `WORKING_NOTES_oauth.md` | 1716 | 2026-01-28 (OAuth WIP, "archive" already in message) |
| `notes-recipe-input.md` | 1123 | 2026-01-30 (recipe input WIP) |
| `notes-recipe-input-llm-research.md` | 216 | 2026-01-31 (research, superseded by `docs/ingredient-parsing-provider-research.md`) |
| `notes-recipe-view-fixes.md` | 235 | 2026-01-31 (recipe view WIP) |
| `test-baseline-summary.md` | 30 | 2026-02-04 |
| `REVIEW-PACKET.md` | 126 | 2026-02-02 |
| `CHROMATIC.md` | 75 | 2026-01-28 (config) — keep only if Chromatic is still wired |

**Post-cutover artifacts (cutover happened, value is now historical):**
| File | Lines | Note |
|------|-------|------|
| `docs/pre-production-readiness-backlog.md` | 228 | Pre-cutover; cutover landed |
| `docs/pre-production-readiness-report.md` | 53 | Same |
| `docs/production-cutover.md` | 159 | Cutover checklist — could remain as a "how to redo" guide, or archive |
| `AUDIT-REPORT.md` | 145 | May 2026 audit — work shipped |
| `docs/ui-audit-backlog.md` | 216 | UI redesign #36 shipped |
| `docs/ui-audit-report.md` | 162 | Same |

**Recent and still relevant (keep):**
- `README.md`, `GUIDE.md`, `BACKLOG.md`, `AGENTS.md`, `CLAUDE.md`, `STORYBOOK.md` (3 lines — just the deployed URL), `DEPLOY.md`
- `docs/api.md`, `docs/deployment.md`, `docs/analytics-privacy.md`, `docs/ouroboros-mcp.md`
- `docs/design-language.md` (May 23, UI redesign reference)
- `WORKING_NOTES_steps_ingredients.md` (2066L, May 10) — large but recent; needs a peek to confirm
- `docs/ui-systems-audit-{backlog,report,routes.json}` — touched 2026-05-26/27 for active UI/MCP polish ⚠️ unclear if still live

### Slugger queue
Empty. `catchup` and `status`: idle, last thought 20:07 UTC. No queued obligations on Slugger's side for this project — its diary is dominated by an unrelated heartbeat-loop testing pattern. Mandate is mine to shape.

## Plan

Strict TDD where code changes; doc/BACKLOG changes go in their own PRs. Each PR: branch → CI green → review → merge → (deploy + smoke for code changes only) → next.

### Phase A — Backlog refresh (1 PR, doc-only) ✅ no human input needed
**PR-A:** Update `BACKLOG.md`
- Mark SJ-010/011/012 as `done` with completion notes pointing at the actual commits.
- Add new `done` entries SJ-027 (Web Push), SJ-028 (Cook Mode v2), SJ-029 (Public Sharing & First-class Agent Auth), SJ-030 (Search Index Performance), SJ-031 (OAuth Provider Hardening), SJ-032 (v1 → v2 Data Migration Plumbing) — so future audits don't see drift again.
- Refresh "Recommended Next PR Sequence" — current list is fully completed.
- Add SJ-033 (Password Reset / WebAuthn Decision) reflecting the chosen direction from ⚠️Q1 below.
- Add SJ-034 (Stale Doc Pruning) — covered by PR-B.

### Phase B — Stale doc pruning (1 PR, doc-only) ⚠️ needs Q2 below
**PR-B:** Delete or archive stale docs per ⚠️Q2 decision. Default proposal: hard-delete the Jan/Feb 2026 notes (`WORKING_NOTES*`, `notes-*`, `EXPLORATION_GUIDE.md`, `REVIEW-PACKET.md`, `test-baseline-summary.md`). Keep `CHROMATIC.md` only if Chromatic is still wired; otherwise delete. Move post-cutover artifacts under `docs/archive/2026-05-cutover/` or delete per Q2.

### Phase C — SJ-016 resolution ⚠️ needs Q1 below
Two paths fork on the answer:
- **C.out (chosen if SJ-016 = "out of scope"):** Single PR removing dead schema fields (`resetToken`, `resetTokenExpiresAt`, `webAuthnChallenge`, `UserCredential` model + table), a new migration `0012_drop_dead_auth_fields.sql`, regenerated Prisma client, and the now-unneeded v1 migration column reads in `scripts/lib/v1-neon-to-d1.ts` and `scripts/migrate-v1-neon-to-d1.ts` (gated on Q3 below). Tests updated. 100% coverage preserved.
- **C.in (chosen if SJ-016 = "in scope"):** Multi-PR feature work: password reset (email-flow design needs a provider decision), then WebAuthn enrollment + sign-in (cross-platform UX is non-trivial). I'd plan, surface design questions, and execute over several PRs.
- **C.defer (chosen if "defer"):** Document the deferral in BACKLOG.md SJ-033, keep fields, no code change.

### Phase D — v1 migration plumbing decision ⚠️ needs Q3 below
`scripts/migrate-v1-neon-to-d1.ts`, `scripts/lib/v1-neon-to-d1.ts`, `test/scripts/v1-neon-to-d1.test.ts` are ~1000 LOC of one-shot v1 → v2 importer plumbing. Parking-lot item says "Data migration from Spoonjoy v1 production into v2." If the cutover happened (it did per commit history), is there still v1 data outstanding? If yes, keep. If no, delete in PR-D (saves real bytes + coverage burden).

### Phase E — Lone-TODO sweep (1 small PR) ✅ no human input needed
**PR-E:** Address `app/lib/fellow-chefs.server.ts:26` (`TODO(perf): materialize if hot — see inch-worm backlog.`). Either delete the TODO if benchmarks show it's not hot, or materialize a small cache. Verdict will fall out of measurement.

### Phase F — Smoke each meaningful change
Code PRs (C-out, C-in, D, E) trigger `pnpm deploy:auto` + `pnpm smoke:live` against `https://spoonjoy.app`. Doc-only PRs (A, B) skip deploy.

### Phase G — Parking-lot review ⚠️ needs Q4 below
After the cleanup is done, the BACKLOG "Parking Lot" has 4 deferred items: native mobile, public/private visibility model, admin/moderation tools, v1 data migration. Q4 asks Ari which (if any) of these to elevate to `proposed` and queue.

### Phase H — Close-out
- All PRs merged.
- BACKLOG.md reflects reality.
- Slugger notified.
- Final state: single branch, no worktrees, no open PRs, clean tree, deploy current.

## Execution order (PRs, in dependency order)

1. **PR-A** — `BACKLOG.md` refresh (doc-only). Marks SJ-010/011/012 done with evidence, adds SJ-027 through SJ-034 for previously untracked shipped + queued work, rewrites the "Recommended Next PR Sequence." No deploy.
2. **PR-B** — Hard-delete stale docs (doc-only). No deploy.
3. **PR-D** — Remove v1 migration scripts + tests. Includes a `pre-v1-migration-removal` git tag for reversibility. Deploy + smoke.
4. **PR-E** — Address the `fellow-chefs.server.ts:26` TODO (measure first, then either delete-TODO or materialize). Deploy + smoke if behavior changes.
5. **PR-F** — Finish PostHog setup + add error tracking via PostHog's free Error Tracking feature. Both client-side (`posthog-js` already loaded) and server-side (`posthog-node` for Workers). Deploy + smoke.
6. **PR-G** — Rate limiting on `/api/*` + MCP bearer. Per-token + per-IP throttle via Cloudflare Durable Objects (or a D1-backed counter if DOs are over-budget). Deploy + smoke.
7. **PR-H** — PWA install prompt UX + offline fallback page. Deploy + smoke.
8. **PR-I** — Password reset flow. Sub-decision needed: email provider (Cloudflare Email Workers vs Resend free tier). Multi-step within the PR.
9. **PR-J(s)** — WebAuthn enrollment + sign-in. Likely multiple PRs:
   - **PR-J1:** Server: challenge generation, attestation verification, credential persistence, `/auth/webauthn/register` endpoint.
   - **PR-J2:** Server: assertion verification, sign-in endpoint, `signCount` rotation.
   - **PR-J3:** Client: settings-page enrollment UX, login-page sign-in UX, cross-browser/cross-platform polish.

PRs 1–4 are pure cleanup. 5–7 are production hardening. 8–9 are net-new auth features.

## Risk register

- **Removing schema fields (Phase C.out)** drops user-table columns. D1 doesn't support `ALTER TABLE DROP COLUMN` on every version; may require table rebuild. Verify migration path before merge.
- **Deleting v1 migration scripts (Phase D)** loses the ability to re-import historical data if a forgotten user comes up. Mitigation: tag a `pre-v1-import-removal` git tag before deletion.
- **Doc deletion (Phase B)** is reversible via git; low risk. Archival in `docs/archive/` is even safer.
- **BACKLOG.md drift** is the broader pattern. Phase A fixes the symptom; longer term, Slugger or a future CI hook should refuse PR merges that ship features without backlog entries.

## Out of scope for this pass
- Net-new product features (unless Q4 elevates them).
- Major architecture refactors.
- Test infrastructure changes.
- Any work that would block on Slugger doing something it currently isn't doing.
