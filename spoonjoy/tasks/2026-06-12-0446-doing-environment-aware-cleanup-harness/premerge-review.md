Pre-Merge Sanity Review

FINDINGS

MAJOR: Cleanup apply still touched or created search tables when absent, contradicting Unit 3b's promised absent-search behavior. `buildApplySql()` unconditionally created `SearchDocument` / `SearchIndexMetadata` and deleted from `SearchDocument`, so apply could fail or mutate schema in an environment without those tables.

Fix:
- Added read-only `sqlite_master` search-table detection before apply.
- Made `buildApplySql()` omit all `SearchDocument` / `SearchIndexMetadata` references by default.
- Included search cleanup only for tables proven to exist, without creating either table.
- Logged skipped search cleanup when app search tables are absent.

Verification:
- `unit-11-premerge-search-red.log`: focused cleanup tests failed before the repair.
- `unit-11-premerge-search-green.log`: focused cleanup tests passed after the repair.
- `unit-11-premerge-search-coverage.log`: `scripts/cleanup-local-qa-data.mjs` reached 100% statements, branches, functions, and lines.
- `unit-11-premerge-search-build.log`: production build passed.
- `unit-11-premerge-search-cleanup-local.log`: local cleanup dry-run passed with zero blockers.
- `unit-11-premerge-search-cleanup-qa-dry-run.log`: QA cleanup dry-run passed.
- `unit-11-premerge-search-cleanup-production-readonly.log`: production read-only cleanup passed.
- `unit-11-premerge-search-cleanup-production-apply-refusal.log`: broad production apply refused with exit code 1.
