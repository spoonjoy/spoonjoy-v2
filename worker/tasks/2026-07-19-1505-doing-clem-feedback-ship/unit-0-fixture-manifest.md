# Unit 0 Fixture Manifest

## Authority Hashes

- Feedback source SHA-256: `56faebccabf1fed71e83beab0aab7c966b09324fba6c3e655c42b2bc13a86d7b`
- Planning SHA-256: `e68520fc534d9a92eeaf6892f31f20ef0fefa074bd52ee71532ace62337da0ef`
- Doing SHA-256 before Unit 0 status updates: `86606107de013519cdeb540fe88ad77dc65fb62effffe4487eff47c7068822c5`
- Raw fixture SHA-256: `939e3b114a37c2bebe7a7cabec6080350d3ba7a9991c281d71134f6716f38a03`
- Migration-set SHA-256: `c02ec62398314380f36f3df0812ce3749c2ce3349ca35c9035aeacb25661f120`

The migration-set digest streams migration files in bytewise filename order as UTF-8 filename, NUL, raw file bytes, NUL.

## Migration Set

`0000_init.sql`, `0002_seed.sql`, `0003_shopping_list_item_option2.sql`, `0004_reseed.sql`, `0005_add_recipe_step_duration.sql`, `0006_search_document_fts.sql`, `0007_api_credentials.sql`, `0008_s1_spoon_foundation.sql`, `0009_d006_push_notifications.sql`, `0010_search_index_metadata.sql`, `0011_agent_connection_requests.sql`, `0012_passkey_metadata.sql`, `0013_oauth_server.sql`, `0014_oauth_refresh_tokens.sql`, `0015_api_credential_scopes.sql`, `0016_api_idempotency_keys.sql`, `0017_oauth_access_audience.sql`, `0018_recipe_cover_lifecycle.sql`, `0019_oauth_connection_keys.sql`, `0020_native_push_devices.sql`, `0020_recipe_box_indexes.sql`, `0021_api_mutation_tombstones.sql`, `0022_native_sync_tombstones.sql`, `0023_recipe_cover_prompt_lineage.sql`.

## Fixture Validation

The numeric migration set was applied to a new SQLite database, then `test/fixtures/clem-feedback-pre-feature.sql` was applied with foreign keys enabled.

- Users: 2
- Recipes: 3
- Cookbook memberships: 5
- Shopping items: 3
- Active unitless duplicate identities: 3
- `PRAGMA foreign_key_check`: zero rows
- `recipe-r3.deletedAt`: `2026-01-10T00:00:00.000Z`
- `membership-2.updatedAt`: `2026-01-03T00:00:00.000Z`
- Shopping order: `item-b` at 1, `item-a` at 2, `item-c` at 3
- Shopping quantities: 2, 1, null
- Shopping checked flags: 1, 0, 0; all optional metadata is null

Migration `0024` must later yield four SavedRecipe rows, use Jan 3 for user-a/recipe-r1, retain `item-b` as the active survivor with quantity 3 at sort 1 and unchecked, and tombstone `item-a`/`item-c`.
