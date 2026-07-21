# Clem Feedback Source And Disposition

**Captured**: 2026-07-15
**Revised**: 2026-07-21 after exhaustive architecture audit
**Source**: Ari's transcription of Clem's WhatsApp feedback in this Codex task

## Feedback

1. Navigation had a pass yesterday; iterate only if another change is warranted.
2. Decide where recipe/cook progress lives. Choose all-local or server-canonical; if server-canonical, use a Cloudflare Durable Object and make cross-device continuation easy.
3. Do not add a first-party import flow. Import stays agentic unless there is a materially better idea.
4. Consider a tagging system for categories, with light AI assistance for categorization if useful.
5. Do nothing Pebble-specific; Spoonjoy is only the API provider for that project.
6. Recipe progress does not belong in D1. The reason to use a Durable Object is live cross-device synchronization.
7. Keep neutral recipe metadata and read-time scaling useful to both REST clients and agents using Spoonjoy through MCP.
8. Restore checked shopping items correctly when they are re-added, with one behavior across web, REST, and agent surfaces.
9. Provide a private saved-recipe state distinct from cookbook membership and social activity.

## Disposition

| Feedback | Decision | Delivery proof |
| --- | --- | --- |
| Navigation | Preserve the current broad shape; change only concrete accessibility defects found on touched surfaces. | Existing nav tests plus Units 4.3, 5.4, 6.5, and 8.6 visual/accessibility QA. |
| Cook progress ownership | Authenticated state is canonical in one SQLite-backed Durable Object per owner. The object owns active discovery, snapshots, progress, receipts, sockets, alarms, retention, and deletion. Anonymous state remains local-only. | Units 7.1-7.5 and 8.1-8.5; direct owner-list tests; two-client QA/production smoke. |
| Cross-device continuation | Accept. One owner object supports recipe-ID-free active discovery and recipe-tagged live sockets across devices. | Units 7.4, 8.1-8.3, and 8.5 plus live smoke. |
| Import flow | Reject first-party UI. Preserve the existing legacy agent/API `import_recipe_from_url` contract and docs; it is not an MCP tool. | Unit 2.1 persisted/dry-run shape shields; Unit 4.3 no-entry-point and docs regression. |
| Categories/tags | Accept one controlled course plus owner-authored recipe tags. | Units 2.1-2.4, 4.1, and 6.1-6.5. |
| AI categorization | Reject for this release. A later implementation may propose non-canonical suggestions, but only with explicit review, confidence/provenance, and normalization boundaries. | Unit 4.3 asserts no AI table, endpoint, source field, or UI while preserving a neutral suggestion boundary. |
| Pebble-specific work | Reject new scope and preserve existing behavior untouched; this task neither adds nor removes Pebble-specific classification, fixtures, docs, or runtime code. | Unit 4.3 exact-baseline regression and task-diff allowlist. |
| D1 for progress | Reject completely. D1 supplies the authorized recipe snapshot on receipt-miss start/restart only; it contains no cook state, metadata index, receipt, registry, or projection. | Unit 2 no-cook-schema tests; Units 7.1-7.5 direct owner-SQLite tests; D1 smoke query. |
| Neutral metadata/scaling | Accept for REST v1 and existing MCP recipe-read tools without persistence or personalized save enrichment. | Units 4.1-4.2 and Unit 9 REST/MCP smoke. |
| Shopping restoration/parity | Accept one atomic add/restore service for every existing add path. | Units 2.3 and 3.1-3.3 plus live smoke. |
| Private recipe saves | Accept canonical private SavedRecipe state independent of cookbooks/social activity. | Units 2.2 and 5.1-5.4 plus live smoke. |

## Product Boundary

This task ships Spoonjoy primitives: owner-scoped live cook continuity, correct shopping mutations, private saves, manual tags, and neutral metadata/read-time scaling. It does not create a first-party importer, an AI tagging workflow, a D1 cook registry, end-user account deletion UI, or any new/removed Pebble-specific behavior.
