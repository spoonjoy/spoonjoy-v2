# Planning: Storybook Wrangler Action Migration

**Status**: approved
**Created**: 2026-06-11 20:39

## Goal
Remove the deprecated Cloudflare Pages GitHub Action from the Storybook deployment workflow so the verification pipeline stays warning-free and does not depend on the Node 20 action runtime cutoff.

## Upstream Work Items
- None

## Scope

### In Scope
- Replace `.github/workflows/storybook.yml` usage of `cloudflare/pages-action@v1` with Cloudflare's current Wrangler action pattern.
- Preserve the existing Storybook build artifact, Cloudflare account/token secrets, project name, main-branch-only deploy behavior, and GitHub deployment permission.
- Validate workflow syntax and Storybook build locally.
- Merge the fix, wait for Storybook workflow success on `main`, and verify no stale branch or PR remains.

### Out of Scope
- Changing the Spoonjoy app production deploy workflow.
- Changing the Cloudflare Pages project, token, or account secrets.
- Broad CI release-verifier automation; that remains covered by `SJ-048`.
- Environment-aware smoke and cleanup harness work; that remains the next queued seed, `SJ-044`.

## Completion Criteria
- [ ] `.github/workflows/storybook.yml` no longer references `cloudflare/pages-action@v1`.
- [ ] Storybook deployment uses `cloudflare/wrangler-action@v4` with `pages deploy storybook-static --project-name=spoonjoy-storybook`.
- [ ] Existing secret names and main-branch deploy behavior are preserved.
- [ ] Existing `deployments: write` permission is preserved for GitHub deployment records.
- [ ] Workflow syntax is validated before merge.
- [ ] Local Storybook build passes with no warnings caused by this change.
- [ ] Merged `main` Storybook workflow passes after the change.
- [ ] 100% test coverage on all new code
- [ ] All tests pass
- [ ] No warnings

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No `[ExcludeFromCodeCoverage]` or equivalent on new code
- All branches covered (if/else, switch, try/catch)
- All error paths tested
- Edge cases: null, empty, boundary values
- This slice changes workflow configuration only; no application code coverage delta is expected.

## Open Questions
- None.

## Decisions Made
- Use `cloudflare/wrangler-action@v4` because the action source shows `v4.0.0` runs on `node24`, while `v3` still runs on `node20`.
- Keep `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` unchanged to avoid secret churn.
- Run this as a small pre-`SJ-044` autopilot slice because it surfaced during terminal verification and has a dated runtime cutoff.

## Context / References
- `.github/workflows/storybook.yml`
- `package.json` script `build-storybook`
- Cloudflare Pages "Use Direct Upload with continuous integration" docs: Wrangler action plus `pages deploy`.
- `cloudflare/wrangler-action@v4.0.0` `action.yml` uses `node24`; `v3` uses `node20`.
- Storybook verification run `27392454076` succeeded but warned that `cloudflare/pages-action@v1` uses the Node 20 action runtime.

## Notes
This is a workflow-only migration. Keep the deploy job scoped to `refs/heads/main` exactly as it is today, and keep `permissions.deployments: write`.

## Progress Log
- 2026-06-11 20:39 Created
- 2026-06-11 20:39 Planning review Round 1 found `wrangler-action@v3` still on Node 20, timestamp drift, and missing explicit workflow permission/syntax criteria.
- 2026-06-11 20:47 Planning review Round 2 converged; status set to approved.
