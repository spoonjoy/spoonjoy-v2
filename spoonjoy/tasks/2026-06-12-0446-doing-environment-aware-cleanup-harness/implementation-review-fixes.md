Unit 10 Review Fixes

- Tightened QA R2 spoon deletion so note-matched spoons only delete `spoons/{chefId}/...` keys when `chefId` is a disposable user; non-disposable-user spoon namespaces are retained.
- Added generated cover cleanup for the app's real `covers/...` R2 namespace on hard-delete recipe cover URLs, plus planner coverage for generated cover keys.
- Replaced the dry-run hardcoded blocker zero with a read-only blocker count computed from the same target predicates used by apply.
- Replaced mutating D1 blocker preflight SQL with read-only target CTEs and individual blocker detail SELECTs, avoiding helper/search table creation before refusal and avoiding D1 compound-select limits.
- Normalized committed task artifacts so branch-level whitespace checks are clean.

Verification:
- `unit-10-review-fixes-red.log`: focused tests failed for the review findings before implementation.
- `unit-10-review-fixes-green.log`: focused cleanup tests passed.
- `unit-10-review-fixes-coverage.log`: `scripts/cleanup-local-qa-data.mjs` reached 100% statements, branches, functions, and lines.
- `unit-10-review-fixes-build.log`: production build passed.
- `unit-10-cleanup-local.log`: local dry-run passed with real blocker count.
- `unit-10-cleanup-qa-dry-run.log`: QA dry-run passed with real blocker count.
- `unit-10-cleanup-production-readonly.log`: production read-only dry-run passed.
- `unit-10-cleanup-production-apply-refusal.log`: production broad apply refused with exit code 1.
