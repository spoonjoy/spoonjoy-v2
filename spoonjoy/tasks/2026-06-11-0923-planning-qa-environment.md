# Dedicated QA Environment

Status: `APPROVED`
Created: 2026-06-11 09:23 America/Los_Angeles
Branch: `spoonjoy/qa-environment`
Backlog IDs: `SJ-043`

## Goal

Add a real Spoonjoy QA deployment target with separate Cloudflare state so live/manual/e2e verification can create disposable users, recipes, images, and spoons without touching production data.

## Upstream Work Items

- `BACKLOG.md` `SJ-043`: Build a dedicated QA/test environment with separate Cloudflare state.
- `spoonjoy/tasks/2026-06-10-1521-planning-next-work-queue.md`: Current next-work queue and thin-slice handoff.

## Scope

### In Scope

- Add a `qa` Wrangler environment that deploys as a distinct Worker target.
- Configure QA to use separate D1, R2, rate-limit namespaces, and base URL values from production.
- Add package scripts for QA preflight, migration application, deploy, and live smoke entrypoints.
- Add an idempotent QA seed command/data set that runs against `--env qa`, uses disposable/demo names, and refuses production.
- Extend deployment preflight checks to verify the QA environment contract without weakening production checks.
- Add the minimal QA-aware smoke targeting needed so a QA smoke cannot accidentally clean production D1 or run production-only Apple OAuth assertions.
- Document QA resource creation, secret setup, migration, deploy, smoke, and cleanup expectations.
- Create/apply the actual QA Cloudflare D1/R2 resources when Wrangler authentication permits it.
- Run a QA deploy/smoke where the environment has enough secrets to support the existing smoke path.
- Preserve the existing production auto-deploy path and verify production after merge.

### Out Of Scope

- Broad environment-aware cleanup refactor beyond the minimum QA smoke safety layer; that is `SJ-044`.
- MCP/API image and cover e2e smokes; that is `SJ-045`.
- Image provider benchmark/canary work; that is `SJ-046`.
- Changing the current Mendelow-style editorial image prompt.
- Building a custom email notification system.

## Completion Criteria

- `wrangler.json` has a `qa` environment with distinct QA D1/R2/rate-limit/base URL settings.
- `pnpm run qa:preflight` proves QA config exists, is not aliased to production resources, resolves to the QA Worker URL, verifies QA secret presence with `wrangler secret list --env qa` when authenticated, and checks QA migrations with `--env qa`.
- QA D1 migrations can be listed/applied with `--env qa` without touching production.
- QA R2 bucket exists and `pnpm run qa:preflight` or QA smoke performs an actual QA R2 write/read/delete verification.
- QA seed command is idempotent, creates only disposable/demo data, runs with `--env qa`, and refuses production resources.
- QA deploy command builds and deploys `spoonjoy-v2-qa`.
- QA smoke command targets the QA base URL, requires the QA Wrangler environment for remote cleanup, and does not default to production.
- QA smoke skips or adapts the production-only Apple OAuth guard instead of hitting production as part of QA verification.
- QA smoke creates disposable QA data and verifies that cleanup removed that data from QA D1.
- QA docs cover telemetry defaults, image-provider policy, OAuth callback expectations, WebAuthn/RP-origin expectations, QA seed data, and disposable data naming.
- Docs make it clear future agents should verify QA before production-risky live flows.
- `pnpm run deploy:preflight`, `pnpm test:coverage`, and `pnpm typecheck` pass.
- Work is merged to `main`, auto-deployment is verified, production smoke passes, and disposable test data is cleaned.

## Code Coverage Requirements

- Add or update unit coverage for QA-specific deployment preflight parsing and validation.
- Cover failure cases where QA env is missing, QA D1/R2 aliases production, QA base URL is absent, and QA scripts are absent.
- Cover the smoke cleanup argument builder so remote QA cleanup includes `--env qa` and production cleanup is explicit.
- Cover the QA seed/refusal path so production-targeted seed attempts fail closed.
- Keep total coverage at 100% statements, branches, functions, and lines with zero warnings.

## Open Questions

- None. Human judgment is cleared: QA isolation is desired, the current image prompt stays, and broad cleanup belongs to the next queued slice.

## Decisions Made

- Use Wrangler named environment `qa`; Cloudflare will deploy it as `spoonjoy-v2-qa`.
- Use QA resource names `spoonjoy-qa` for D1 and `spoonjoy-photos-qa` for R2.
- Use distinct rate-limit namespace IDs from production for all QA limiter bindings.
- Require QA smoke callers to pass an explicit target environment; non-local remote cleanup must include a Wrangler `--env` value unless it is intentionally production.
- Treat production Apple OAuth callback validation as production-smoke-only; QA smoke should not use a production OAuth assertion as a proxy for QA readiness.
- Keep production deploy automation unchanged and verify it after merge.
- Keep the current Mendelow Cooking editorial cover prompt unchanged.

## Context/References

- Cloudflare Wrangler environments create environment-specific Workers named `<top-level-name>-<environment-name>` and are selected with `--env` / `-e`.
- Wrangler config treats bindings such as D1, R2, vars, and ratelimits as environment-specific when present under `env`.
- Current production Worker: `spoonjoy-v2`.
- Current production D1: `spoonjoy` / `32cb0e04-c45b-4cd2-a798-556556ae288d`.
- Current production R2: `spoonjoy-photos`.
- QA D1 created during planning: `spoonjoy-qa` / `c6c99e80-bd51-4cf2-b7c7-b7a6e27d3f34`.
- QA R2 created during planning: `spoonjoy-photos-qa`.
- Current smoke script defaults to `https://spoonjoy-v2.mendelow-studio.workers.dev` and currently treats any non-localhost URL as remote D1 cleanup; this is intentionally left for `SJ-044`.

## Notes

- Do not use production D1/R2 as a fake QA environment.
- Do not make `smoke:qa` silently fall back to production if QA vars are missing.
- If QA secret setup blocks a full smoke, land the environment contract and document the exact missing secret state, then continue into `SJ-044` harness work rather than touching production data.
- Do not claim `SJ-043` complete from docs alone; the QA resources must exist and be verified.
- Do not treat R2 create/list as enough; verify an object round trip in the QA bucket.

## Progress Log

- 2026-06-11 09:23 - Created planning doc after checking the next-work queue, Wrangler config, deployment preflight, production readiness, and live smoke scripts.
- 2026-06-11 09:32 - Incorporated reviewer findings: QA smoke must be minimally environment-aware, QA preflight must prove secrets/migrations/base URL/resource isolation, and resource creation cannot be doc-only.
- 2026-06-11 09:39 - Added reviewer-required QA seed, R2 round-trip, and smoke-create-cleanup completion criteria.
- 2026-06-11 09:44 - Reviewer converged; plan approved for autonomous execution.
