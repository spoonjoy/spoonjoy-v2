# OAuth action-origin reliability

Status: READY

## Objective

Make browser-submitted OAuth consent reliable on the canonical Spoonjoy custom domain when Cloudflare presents React Router with an internal Worker transport URL, then prove the real Claude connector remains usable across reload and browser restart without reconnecting.

## Grounded source

- Base: `origin/main` at `3d12caf32fc8735daf953a5b4f2938f08d46717f`.
- A real Claude consent POST with `Origin: https://spoonjoy.app` returned React Router's literal 400 response; the identical request without `Origin` reached `app/routes/oauth.authorize.tsx` and returned the expected callback redirect.
- React Router compares the request URL host to the browser `Origin` host before every route action. Production's custom-domain request can carry an internal `workers.dev` URL even though the browser is on `spoonjoy.app`.
- `react-router.config.ts` currently allows only Apple's required `appleid.apple.com` form-post origin.
- The existing MCP OAuth canary already submits consent in a browser, but its page navigations use `waitUntil: "load"`; this has produced unrelated load timeouts and weakens the reliability signal.

## Chosen design

Add only the exact host pattern `spoonjoy.app` to React Router's global action-origin allowlist, retaining `appleid.apple.com`. React Router deliberately discards the scheme, does not consult `X-Forwarded-Host`, and applies this exception to all actions. That global host-only trust is accepted because Spoonjoy exclusively controls the apex, production emits two-year preload HSTS with subdomains, production sessions are Secure, and a public `workers.dev` host neither owns Spoonjoy cookies nor receives an exception. Do not add wildcards, `www`, QA, or Worker hosts: QA's public and transport hosts match, `www` is canonically redirected before React Router, and internal hosts are not legitimate browser origins. Keep React Router's guard in place for every other host.

Strengthen the existing live browser canary instead of creating a second OAuth harness: use commit/DOM readiness for initial navigation, explicitly assert the consent action response is a redirect, and preserve its existing callback/code, refresh rotation, replay rejection, D1 cleanup, and version-routing checks.

## Slice 1: exact origin regression

1. Freeze a config test expecting both exact approved host patterns; run it first and record the expected red because `spoonjoy.app` is absent.
2. Add `spoonjoy.app` to `allowedActionOrigins` with a concise proxy-boundary explanation. No request rewriting or custom CSRF implementation.
3. Add a real React Router request-handler test with an action sentinel. Prove internal transport plus Spoonjoy or Apple reaches the action; same-origin QA continues to work; `www`, the public Worker, lookalike suffixes, an attacker host, and malformed origins all return literal 400 before the action. Include `http://spoonjoy.app` to make the framework's scheme-agnostic host semantics explicit rather than accidentally claiming origin-level matching.
4. Run focused config/request-handler proof and inspect `build/server/assets/server-build-*.js` to prove the exact allowlist is embedded.

## Slice 2: canary reliability

1. Freeze behavior tests for successful redirect validation plus non-302 body reporting, failed body reads, 200-character truncation, callback abandonment ordering, and commit-based signup/authorize navigation. Run them first and record the expected red.
2. Make the minimum smoke-script change: avoid waiting for every subresource during navigation and screenshots, and fail immediately with the action status/bounded body when consent is not a redirect.
3. Run focused smoke-helper tests. After `pnpm run verify:clean:migrations` and `pnpm run verify:clean:build`, start the local built Worker with `pnpm exec wrangler dev --port 8790 --local --var SESSION_SECRET:local-origin-smoke-session-secret-1234567890`; in a second process run `node scripts/smoke-mcp-oauth-live.mjs --target-env local --base-url http://localhost:8790 --skip-legacy-db-probe --out /tmp/spoonjoy-mcp-origin-local`, then stop Wrangler and prove the report's cleanup count is zero. Never use `pnpm smoke:mcp:oauth` for this local step because that script intentionally targets production.

## Slice 3: hostile review and delivery

1. Run `pnpm exec vitest run test/react-router-action-origin.test.ts test/react-router-config.test.ts test/scripts/smoke-live-helpers.test.ts --fileParallelism=false`, `pnpm run verify:clean:generated-contract`, `pnpm run verify:clean:typecheck`, `pnpm run verify:clean:build`, `pnpm run verify:clean:test:coverage`, `pnpm run verify:clean:test:workers:coverage`, and `pnpm run verify:clean:test:e2e`, all with zero warnings and 100% modified-production coverage. Inspect `build/server/assets/server-build-*.js` for `allowedActionOrigins = ["appleid.apple.com", "spoonjoy.app"]`.
2. Run a cold Tinfoil Hat review of the branch, fix blocker/major findings, and repeat affected proof.
3. Push, open a PR, wait for exact-head checks, merge, verify the landed commit, and follow the production deployment to its exact source SHA. Run the deployment's candidate/version-pinned MCP canary, then the explicit production commands `pnpm run smoke:mcp:oauth` and `node scripts/smoke-live.mjs --target-env production --base-url https://spoonjoy.app --out /tmp/spoonjoy-origin-production-live` so both MCP consent and Apple navigation are covered.
4. Before any production canary/manual step, query and snapshot the legitimate Claude client `cmtdejryo0000qz0nbse4bbsi`, its connection keys, active refresh-token IDs, and active OAuth API-credential IDs. Cleanup may physically delete only the exact disposable canary email, returned client ID, and generated connection key; it must never match the legitimate client. Keep that legitimate grant connected.
5. Before and after deployment/manual validation, query reported client `cmt723pe00000tx0nap6unplp` and prove `revokedAt` remains set plus zero authorization codes, active refresh tokens, OAuth API credentials, agent connection requests, and API idempotency keys. Repeat the post-deploy dependent-state sweep/proof after a delay to catch an in-flight write.
6. Use the existing legitimate grant for normal read-only Spoonjoy tool calls after page reload, a new Claude chat, and a full browser-process restart. Only initiate a fresh connection if production state proves the legitimate grant itself was revoked or deleted; the operator's earlier Connect authorization covers restoring that exact Claude connector, not creating extra grants. Confirm refresh/credential state remains active and no reconnect prompt appears.
7. Clean task-owned worktree, branch, artifacts, and disposable data; update Desk and notify Slugger. Do not contact the reporter.

## Acceptance

- A browser POST whose Origin host is `spoonjoy.app` reaches React Router actions even when the transport URL is internal; the scheme-agnostic and app-wide scope is explicitly tested and accepted under HSTS/Secure-cookie assumptions.
- Apple's cross-site form-post callback remains allowed, while arbitrary origins and broad wildcards remain disallowed.
- The live OAuth canary fails quickly and diagnostically on a consent-action error rather than hanging on page load.
- Required tests and coverage pass at 100% with zero warnings.
- The fix is merged, deployed, and verified through the normal production OAuth form submission.
- The legitimate Claude connector works after reload, a new chat, and browser restart without reconnecting and remains connected at handoff.
- Reported client `cmt723pe00000tx0nap6unplp` remains revoked with no active grant or credential state in two post-deploy proofs, legitimate client `cmtdejryo0000qz0nbse4bbsi` remains connected, and no reporter message is sent.

## Execution evidence

- Strict TDD red: focused config/canary tests failed because `spoonjoy.app`, commit navigation, and explicit action-status validation were absent. Behavior tests then failed because the extracted redirect validator did not yet exist.
- Focused green: 101 request-handler/config/canary tests pass with zero warnings.
- Built-handler proof: local generated Worker returned 200 for Spoonjoy, Apple, and same-origin requests, while an attacker origin returned literal 400. The generated server contains the exact two host patterns.
- Complete local OAuth canary passed signup, DCR, browser consent, code exchange, MCP initialization/tools, refresh rotation, replay rejection, refreshed MCP use, and exact cleanup with zero disposable users remaining.
- The exact declared artifact `/tmp/spoonjoy-mcp-origin-local/mcp-oauth-canary-results.json` was rerun after supplying the production-shaped local `SESSION_SECRET`; `failure` is null, its ordered check-name set contains all nine expected lifecycle checks, and `cleanup.remaining` is zero.
- Pre-deploy production snapshot: legitimate client `cmtdejryo0000qz0nbse4bbsi` is active with refresh token `cmtdeqo3y0003sa0nkeoresvd`, connection key `ocn_I8uxXsdY_6_TYjqfRttwdw`, and active OAuth credential `cmtdeqo0v0001sa0nq6djiwox`. Reported client `cmt723pe00000tx0nap6unplp` remains revoked at `2026-08-28 05:11:23` with zero authorization codes, active refresh tokens, credentials, agent connections, or idempotency keys; `PRAGMA foreign_key_check` is empty.
- Clean gates: generated contract, typecheck, and production build pass. Final repository coverage passes 386 files / 8,385 tests at exactly 100% statements, branches, functions, and lines. Worker coverage passes 43 tests at exactly 100%. The complete 64-test Playwright suite passes after the required local baseline seed was installed; the initial fresh-worktree run correctly failed only the eight named-public-recipe fixtures because that baseline was absent.
- Final hostile review found and reproduced a dual-waiter timeout as two unhandled rejections. `completeConsentSubmission` now observes both Playwright waiters before submit; its success and simultaneous-rejection paths are frozen, the reviewer returned clear, and the full local canary still passes all nine checks with cleanup zero.
