# Clem Feedback Source And Disposition

**Captured**: 2026-07-15
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
9. Provide a private saved-recipe state that is distinct from cookbook membership and social activity.

## Disposition

| Feedback | Decision | Delivery proof |
| --- | --- | --- |
| Navigation | Accept as a regression constraint, not a redesign. Keep the current signed-in dock and pantry drawer unless implementation uncovers a concrete accessibility defect. | Existing nav tests remain green; changed My Kitchen surfaces receive mobile visual QA. |
| Cook progress ownership | Accept the server-canonical option for authenticated users. A SQLite-backed Durable Object owns live state and WebSocket fanout; D1 contains only private query/history metadata. Anonymous state remains local-only. | Real Workers-runtime DO tests, two-client QA smoke, owner-only My Kitchen resume cards, and production smoke. |
| Cross-device continuation | Accept. Starting cook mode atomically creates or resumes one active attempt per user and recipe. A second client discovers the same session and receives live snapshots. | Start/resume API tests, WebSocket runtime tests, and two-context smoke. |
| Import flow | Reject first-party UI for this release. Existing agent/API import remains the supported path. | Regression tests assert no new import entry point; developer-facing import docs remain agent/API-oriented. |
| Categories/tags | Accept a small canonical tagging system: one controlled course plus owner-authored custom tags. | Data/service, authoring, filter/search, API, and visual tests. |
| AI categorization | Reject for this release. Suggestions need a separate non-canonical proposal model, review UX, confidence/provenance, and normalization contract; adding inference before those exist would silently turn guesses into user data. | No AI suggestion table, endpoint, or UI; decision recorded in planning and API docs expose accepted tags only. |
| Pebble-specific work | Reject. Deliver only neutral Spoonjoy product and API primitives. | Changed product/API/docs surfaces contain no Pebble-specific contract or copy. |
| D1 for progress | Reject as canonical state. D1 is an owner-only index/history projection and may lag; the Durable Object remains authoritative. | Ownership boundaries and alarm-driven D1 projection tests. |
| Recipe metadata/scaling | Accept for REST v1 and the existing MCP recipe-read tools. Both surfaces share neutral metadata and exact read-only scaling math; private `isSaved` remains REST-only and requires a kitchen-read entitlement. | Units 3, 4, and 27.2 prove REST/MCP parity, MCP tool-schema behavior, no writes, and the explicit private-field boundary. |
| Shopping restoration/mutation parity | Accept. Re-adding a checked item restores it as unchecked at a fresh end position, while all other add/update/delete/clear cases follow one transactional state matrix shared by web, REST v1, and MCP. | Units 1-2 centralize the service, migration, sync replay, concurrency, and three-surface compatibility tests. |
| Private recipe saves | Accept. `SavedRecipe` is private canonical save state, separate from cookbook membership and RecipeSpoon/social activity, with compatibility bridges for existing cookbook writers. | Units 20-24 prove migration/backfill, viewer-scoped search, owner-only UI/REST, privacy/cache boundaries, and writer compatibility. |

## Product Boundary

This task ships Spoonjoy primitives, not partner customization: live cook continuity, correct shopping mutations, private saves, manual tags, and neutral recipe metadata/read-time scaling across REST v1 and MCP reads. It does not create a first-party importer, an AI tagging workflow, or any Pebble-specific behavior.
