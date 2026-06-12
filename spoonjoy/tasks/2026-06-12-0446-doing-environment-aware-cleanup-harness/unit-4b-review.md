FINDINGS

MAJOR: `scripts/cleanup-local-qa-data.mjs` `buildQaR2CandidateSql()` unconditionally reads `SearchDocument`. If QA has not created the search FTS tables, candidate collection fails before D1 cleanup, so `--target-env qa --apply` becomes unusable in the absent-search-table state Unit 3b explicitly handled. The Unit 4b SQL test only string-checks the query and does not execute the absent-table path.

MINOR: blocker visibility is still not effectively fixed. The SQL selects `blocker,rowId`, then aborts via malformed `json_extract`, but Wrangler does not print the selected rows when the later statement errors, and `runCleanupCli()` only forwards `result.stdout` after successful `execFile` completion. Operators still get a generic failure instead of actionable blocker rows.

Evidence logs checked: focused tests/build/local dogfood logs are clean for warnings. No broad production cleanup path found in the scoped diff.
