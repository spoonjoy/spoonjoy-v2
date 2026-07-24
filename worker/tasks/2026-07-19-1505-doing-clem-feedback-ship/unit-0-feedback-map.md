# Unit 0 Feedback Map

| Source item | Disposition | Execution proof |
| --- | --- | --- |
| Navigation | Preserve; iterate only for a demonstrated defect. | Unit 4.3 boundary tests; Units 5.4, 6.5, and 8.6 visual/accessibility QA. |
| Cook progress ownership | Authenticated state is canonical in one owner-scoped SQLite DO; anonymous stays local. | Units 7.1-7.5 and 8.1-8.5; QA/production two-client smoke. |
| Cross-device continuation | Ship direct active discovery and live synchronization. | Units 7.4, 8.1-8.3, and 8.5; Unit 9 smoke. |
| Import flow | Reject first-party UI; preserve legacy agent/API import, not MCP import. | Unit 2.1 persisted/dry-run shape shield and Unit 4.3 entry-point/docs oracle. |
| Categories/tags | Ship controlled course plus manual recipe tags. | Units 2.1-2.4, 4.1, and 6.1-6.5. |
| AI categorization | Reject canonical inference until proposal/review/provenance exists. | Unit 4.3 asserts no AI table, endpoint, source field, or UI. |
| Pebble-specific work | Reject new scope; preserve the exact existing behavior untouched. | Unit 4.3 exact-baseline regression and task-diff allowlist. |
| D1 for progress | Reject all cook state/index/projection in D1; read recipe source only on receipt-miss start/restart. | Units 2.1-2.4 no-cook-schema tests and Units 7.1-7.5 direct owner-DO tests. |
| Neutral metadata/scaling | Ship REST/MCP read parity without persistence. | Units 4.1-4.2 plus Unit 9 API/MCP smoke. |
| Shopping restoration/parity | Ship one database-enforced add/restore behavior. | Units 2.3 and 3.1-3.3 plus live smoke. |
| Private saved recipes | Ship canonical private state independent of cookbooks/social activity. | Units 2.2 and 5.1-5.4 plus live smoke. |

Every row in `2026-07-14-1313-clem-feedback-source.md` has implementation units or an executable rejection regression.
