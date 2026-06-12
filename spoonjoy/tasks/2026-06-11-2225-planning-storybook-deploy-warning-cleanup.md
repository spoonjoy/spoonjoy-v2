# Planning: Storybook Deploy Warning Cleanup

**Status**: approved
**Created**: 2026-06-11 22:25

## Goal
Remove the remaining controllable warnings from the Storybook build/deploy workflow after the Wrangler action migration, while preserving main-only Cloudflare Pages deployment and keeping PR Storybook validation intact.

## Upstream Work Items
- Follow-up from PR #188 (`03f1a854`) terminal verification.

## Scope

### In Scope
- Update `.github/workflows/storybook.yml` so the main Storybook Pages deploy no longer depends on upload/download artifact actions.
- Deploy from a generated clean Pages deploy directory with a minimal `wrangler.json` containing `pages_build_output_dir`, so Wrangler Pages does not inspect the app Worker `wrangler.json`.
- Preserve main-only Storybook deployment, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `deployments: write`, and `GITHUB_TOKEN` wiring.
- Pass explicit commit metadata and dirty-state intent to `wrangler pages deploy`.
- Ignore the generated Storybook Pages deploy wrapper directory so local and CI worktrees do not retain generated deploy files.
- Set workflow-level Git config environment to suppress checkout's default-branch hint.
- Add root `pnpm-workspace.yaml` `allowBuilds` configuration for the complete known set of dependency install scripts that current CI already skips successfully, using `false` values so `pnpm install --frozen-lockfile` stops emitting ignored-build-script warnings without newly trusting unnecessary install scripts.
- Update deployment preflight and tests to enforce the warning-clean Storybook workflow contract.
- Merge, wait for main Storybook/CI/Production Deploy, inspect Storybook logs for the targeted warning strings, smoke production health, smoke Storybook Pages, clean branch/PR state, and continue to `SJ-044` if no newer obvious blocker remains.

### Out of Scope
- Replacing `actions/checkout@v6`, `pnpm/action-setup@v6`, `actions/setup-node@v6`, or `cloudflare/wrangler-action@v4`.
- Eliminating warning text from third-party actions that remains after the workflow no longer uses upload/download artifacts, no longer deploys from a dirty repo root, no longer triggers checkout default-branch hints, and no longer emits pnpm ignored-build-script warnings.
- Changing the production Worker deploy workflow.
- Changing the Cloudflare Pages project name or secrets.
- Broad release-verifier automation; that remains covered by `SJ-048`.
- Environment-aware smoke and cleanup harness work; that remains queued as `SJ-044`.

## Completion Criteria
- [ ] `.github/workflows/storybook.yml` uses a single Storybook build job with main-only deploy steps after `pnpm build-storybook`.
- [ ] Storybook workflow no longer uses `actions/upload-artifact@` or `actions/download-artifact@`.
- [ ] Storybook deploy uses `cloudflare/wrangler-action@v4` from a generated clean Pages deploy directory, with `packageManager: npm` and command `pages deploy --project-name=spoonjoy-storybook --branch=${{ github.ref_name }} --commit-hash=${{ github.sha }} --commit-dirty=true`.
- [ ] Generated Pages deploy directory contains a minimal `wrangler.json` with `pages_build_output_dir: storybook-static`.
- [ ] `.gitignore` ignores the generated Storybook Pages deploy directory.
- [ ] Main-only deploy behavior, Cloudflare token/account secrets, `deployments: write`, and `gitHubToken: ${{ secrets.GITHUB_TOKEN }}` are preserved.
- [ ] Workflow-level Git config environment suppresses checkout default-branch hints.
- [ ] Root `pnpm-workspace.yaml` encodes `allowBuilds: false` for the complete known pnpm ignored build dependency set: `@prisma/client`, `@prisma/engines`, `@swc/core`, `core-js`, `esbuild`, `prisma`, `protobufjs`, `sharp`, `unrs-resolver`, and `workerd`.
- [ ] Deployment preflight rejects Storybook workflows that reintroduce artifact actions, repo-root Wrangler Pages deploy, missing clean deploy directory preparation, missing generated deploy-directory ignore rule, missing npm package manager, missing commit metadata, missing `--commit-dirty=true`, missing Git config env, or missing root `pnpm-workspace.yaml` `allowBuilds` config.
- [ ] Local verification passes: focused red/green Storybook deploy warning-cleanup tests, targeted `scripts/deployment-preflight.ts` coverage at 100%, `pnpm install --frozen-lockfile`, `pnpm run deploy:preflight`, `pnpm run qa:preflight`, `pnpm run typecheck`, `pnpm run build`, `pnpm build-storybook`, Ruby Psych workflow parse, `git diff --check`, and full `pnpm run test:coverage`.
- [ ] Merged `main` Storybook workflow passes and its log has no matches for `node 20`, `cloudflare/pages-action`, checkout default-branch hint text, `actions/download-artifact`, `actions/upload-artifact`, `Ignored build scripts`, `Pages now has wrangler.json support`, or `uncommitted changes`.
- [ ] Production Deploy passes after merge and both production health endpoints return ok.
- [ ] Storybook Pages returns HTTP 200 after merge.
- [ ] No open PR, stale branch, or disposable QA residue remains from this slice.
- [ ] `spoonjoy/tasks/AUTOPILOT-STATE.md` records `SJ-044` as the next queued seed.

## Code Coverage Requirements
**MANDATORY: 100% coverage on all new code.**
- No coverage exclusions on new validation code
- All parser branches covered
- Error paths tested for each warning-regression shape
- Edge cases: missing job, missing deploy directory prep, wrong working directory, wrong package manager, missing commit metadata, and artifact action reintroduction

## Open Questions
- None. The implementation can make conservative workflow choices and use reviewer gates for any ambiguity.

## Decisions Made
- Collapse Storybook build and deploy into one job to remove artifact upload/download actions and their `actions/download-artifact@v8` Buffer deprecation warning from the deploy path.
- Generate a throwaway Pages deploy directory during the workflow instead of adding Storybook Pages fields to the app Worker `wrangler.json`.
- Use `cloudflare/wrangler-action@v4` with `workingDirectory: storybook-pages-deploy` and `packageManager: npm` because a temp-dir probe showed `npm i wrangler@4.90.0` completed without warning output, while pnpm-based action install emitted deprecated-subdependency and ignored-build-script warnings.
- Keep the existing app Worker `wrangler.json` unchanged.
- Encode the currently warned dependency build scripts as intentionally ignored in root `pnpm-workspace.yaml` with `allowBuilds: <package>: false`, matching current successful CI behavior rather than broadening script execution. The set comes from main Storybook run `27395969794`: `@prisma/client`, `@prisma/engines`, `@swc/core`, `core-js`, `esbuild`, `prisma`, `protobufjs`, `sharp`, `unrs-resolver`, and `workerd`.

## Context / References
- `.github/workflows/storybook.yml`
- `scripts/deployment-preflight.ts`
- `test/scripts/deployment-preflight.test.ts`
- `package.json`
- `.gitignore`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml` (new root pnpm settings file)
- PR #188: `https://github.com/arimendelow/spoonjoy-v2/pull/188`
- Main Storybook run `27395969794`
- `cloudflare/wrangler-action@v4.0.0` `action.yml` supports `workingDirectory`, `packageManager`, `quiet`, `command`, and `gitHubToken`.
- `wrangler pages deploy --help` supports `--project-name`, `--branch`, `--commit-hash`, `--commit-dirty`, `--no-bundle`, and optional positional directory.
- pnpm 10 Settings docs: `allowBuilds` in `pnpm-workspace.yaml` maps package matchers to `true` or `false` and replaces older `onlyBuiltDependencies` / `ignoredBuiltDependencies` settings.

## Notes
- Terminal verification for PR #188 showed the original Node 20 / deprecated Pages action warning was gone, but the Storybook log still contained controllable warnings: checkout default-branch hints, pnpm ignored-build-script warnings, `actions/download-artifact@v8` Buffer deprecation, Wrangler Pages config warning, and Wrangler dirty-worktree warning.
- The exact pnpm ignored-build-script warning in main Storybook run `27395969794` listed `@prisma/client@6.19.2`, `@prisma/engines@6.19.2`, `@swc/core@1.15.11`, `core-js@3.48.0`, `esbuild@0.27.2`, `esbuild@0.27.3`, `prisma@6.19.2`, `protobufjs@7.5.4`, `sharp@0.34.5`, `unrs-resolver@1.11.1`, `workerd@1.20260128.0`, and `workerd@1.20260507.1`; pnpm `allowBuilds` can be package-name based, so the config list uses package names rather than versions.
- The exact Wrangler dirty-worktree warning in main Storybook run `27395969794` said to pass `--commit-dirty=true` to silence it. Use that explicit flag for Pages deploys instead of claiming a generated directory can keep git clean by itself.
- This slice should not claim every possible third-party warning is eliminated until the merged main Storybook log proves it. If a third-party action still emits a warning after the controlled sources are removed, capture it precisely and route the next smallest follow-up instead of hand-waving it away.

## Progress Log
- 2026-06-11 22:25 Created.
- 2026-06-11 22:30 Planning review Round 1 found the pnpm warning-clean scope incomplete. Updated the plan to classify the full observed dependency build-script set as intentionally ignored and require preflight enforcement for that configuration.
- 2026-06-11 22:36 Planning review Round 2 found the pnpm config target should be root `pnpm-workspace.yaml`, not `package.json` or lockfile. Updated the plan to require `allowBuilds` false entries in `pnpm-workspace.yaml` for the full observed set.
- 2026-06-11 22:42 Planning review Round 3 found `--commit-dirty=false` would not silence Wrangler's dirty-worktree warning when generating deploy files in the repo. Updated the plan to require `.gitignore` coverage for the generated deploy directory and `--commit-dirty=true`.
- 2026-06-11 22:44 Planning review Round 4 converged; status set to approved.
