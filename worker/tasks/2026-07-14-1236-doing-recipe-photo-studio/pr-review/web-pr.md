PR URL: https://github.com/spoonjoy/spoonjoy-v2/pull/253

# Recipe Photo Studio: web, REST, MCP

## Summary
- Adds the owner-facing Recipe Photo Studio in recipe management: first-photo upload, optional Spoon fields, editorial-cover default, processing chip/autorefresh, placeholder generation, prompt-guided regeneration, activation, archive, and no-cover controls.
- Extends the backend cover lifecycle across REST API v1, OpenAPI/playground docs, MCP tools, and live smoke scripts, including prompt lineage, idempotency, owner validation, Spoon-original preservation, and cleanup paths.
- Replaces stale cover-copy surfaces so user-visible labels no longer say `Chef photo`, `Spoonjoy cookbook`, or `On the counter`.

## Validation
- Final web coverage: 100% statements/branches/functions/lines, 355 files / 6,865 tests, `worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/pnpm-test-coverage.log`.
- Final web build: `worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/pnpm-build.log`.
- Final cleanup QA: disposable residue removed, post-cleanup zero counts in `worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/pnpm-cleanup-qa-after.log`.
- Final warning scan: `worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/final-validation/web/warning-scan.log`.
- Visual QA ledger: `worker/tasks/2026-07-14-1236-doing-recipe-photo-studio/web-visual-qa-ledger.md`.

## Companion Work
- Native Apple companion branch: `spoonjoy-apple:worker/recipe-photo-studio`.
- Doing doc: `worker/tasks/2026-07-14-1236-doing-recipe-photo-studio.md`.
