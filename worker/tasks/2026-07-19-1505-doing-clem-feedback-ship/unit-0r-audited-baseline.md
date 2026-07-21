# Unit 0R Audited Baseline

**Status**: complete at the Unit 1.7R baseline commit
**Supersedes**: contract authority in Unit 0 while retaining Unit 0 as historical evidence

## Repository Authority

- Worktree: `/Users/arimendelow/Projects/spoonjoy-v2-clem-feedback-product`
- Branch: `worker/clem-feedback-product`
- Verified bootstrap/product starting SHA: `d50b8ff5730c68597f6b80077df799927a56e3bf`
- `origin/main` and merge base at branch creation: `d50b8ff5730c68597f6b80077df799927a56e3bf`
- Product migration number: `0025_clem_feedback_product.sql`
- Feedback source SHA-256: `6cfb65216c4387c1ced9d1c42a68952502ef0966495980403d84fe51e346d5f3`
- Product/data contract SHA-256: `c0d1b4eb7f00315bafc293f71e0d223b066c3c8865fdcf613daf14c701ac8dcc`
- Cook-session protocol SHA-256: `5014c400570d79d09e5d20c168df4c14dccd705db2a140afc0a24abe684d6e8a`
- Feedback map SHA-256: `10d8c61cd755b1dc15d1303e46e0e83195ba35574fdd537f24e689484009de`

The four authority hashes above cover, respectively, `2026-07-14-1313-clem-feedback-source.md`, `product-data-contract.md`, `cook-session-protocol-v1.md`, and `unit-0-feedback-map.md`. Later implementation may update planning/doing progress but must not silently mutate these authorities; a required contract correction receives a new reviewed hash and explicit supersession record.

## Point-In-Time Execution Documents

- Planning SHA-256: `80dc69403ef0c8333c74b1383ccc9f8b2199de9e8db7127f56b3bd2dc679dd41`
- Doing SHA-256: `cf7328f6ea1887721c6003633fd631cca8132935f7be6a9f60408df7cd51dbb7`

These hashes identify the exact planning and doing bytes after Unit 1.7R was marked complete and before this manifest received the hashes. Adding them here does not mutate either execution document. Later unit status and progress edits are expected and do not invalidate the immutable authority hashes above.

## Fixture And Migration Hashes

- Raw fixture: `test/fixtures/clem-feedback-pre-feature.sql`
- Raw fixture SHA-256: `939e3b114a37c2bebe7a7cabec6080350d3ba7a9991c281d71134f6716f38a03`
- Raw fixture bytes: `3600`
- Wrangler D1 derivative SHA-256: `730e4bc479d8db917ed5ec96754b9c2a919b93fa88f191b7ba161f8350cb4f96`
- Wrangler D1 derivative bytes: `3575`
- Numeric migration count through 0024: `25`
- Last baseline migration: `0024_remove_legacy_demo_identities.sql`
- Migration-set SHA-256: `aa549c8e9bdbad2d78760da48a5e7149bce5931bf2e3929dd5a43367c066074d`

The migration-set digest streams each `0000`-through-`0024` SQL file in bytewise filename order as UTF-8 filename, NUL, raw file bytes, NUL. The D1 derivative is produced only by:

```bash
sed -e '/^BEGIN IMMEDIATE;$/d' -e '/^COMMIT;$/d' \
  test/fixtures/clem-feedback-pre-feature.sql
```

The derivative differs from the raw fixture only by those two complete lines. Wrangler D1 rejects explicit transaction-control statements because it manages the transaction for a file execution; native SQLite receives the raw fixture unchanged.

## Pebble Preservation Manifest

At exact source `d50b8ff5730c68597f6b80077df799927a56e3bf`, tracked case-insensitive `Pebble` hits outside this task's feedback/planning/evidence files are exactly:

| Path | Git blob | SHA-256 |
| --- | --- | --- |
| `app/lib/analytics-server.ts` | `cbf7d1a3b435054c5a2a395ccf2fe70d45b67e00` | `fed21ff9e057b3b113101fa15f364587d05d5671f3c81e60a4294e6f28f2dfaa` |
| `spoonjoy/tasks/2026-06-01-1830-doing-dev-platform-api-docs.md` | `bbdbed615dbaf151d38974156b8ba65f1bc35d41` | `072672e4ab96f02790d2959e7f52706366ca7804cbeef36700b6f1cabf407679` |
| `spoonjoy/tasks/2026-06-01-1830-planning-dev-platform-api-docs.md` | `4f3c8e894979be318e697a7160b68b86bf887668` | `096c0f06cbfd0a7844a3d9da31a86accb277fca2000fc9cee4047aedd57b8180` |
| `test/docs/developer-platform-guide.test.ts` | `d38c88299e61cc62bb2c236a2970b3b962a97d21` | `062adcab6ba33190e4501e6fc4bdfe00342f137eebb3b78b6f76beb1d437ffd8` |
| `test/lib/analytics-server.test.ts` | `c2406d8ae20ad3a58bda58679e4575eb2df59d88` | `73d024f37b28d4e8a3288fe3b679d47ac5e771638be76d5009d56ed3a8f23bc8` |
| `test/routes/agent-connect.test.tsx` | `d165576b76b6eea1c66c083e3b4e19297be34b98` | `2ae9e864c5976328d693533b40c19130ac2b94a31c36cf7b55dca1bde635841b` |
| `test/routes/api-v1-telemetry.test.ts` | `2cf8d93ff10f6219da24d61095333a3aa4025376` | `bc8ffdb002c161f768a84fc1d107c877806c2658336ebf1f67e77810a9fe64c0` |
| `test/routes/developers.test.tsx` | `34648e5eb5d52b91d1fded9f94ee129e477d9176` | `b0d7b2d0c0d2487604d53b3f6bd44ca06d3d383961c7408e2dbee032f6f369c0` |

The exact baseline/current no-new-hit oracle is:

```bash
git grep -Iil pebble <SOURCE_SHA> -- . \
  ':(exclude)worker/tasks/2026-07-14-1313-clem-feedback-source.md' \
  ':(exclude)worker/tasks/2026-07-19-1505-planning-clem-feedback-ship.md' \
  ':(exclude)worker/tasks/2026-07-19-1505-doing-clem-feedback-ship.md' \
  ':(exclude)worker/tasks/2026-07-19-1505-doing-clem-feedback-ship/**'
```

With `<SOURCE_SHA>` set to the frozen `d50b8ff...` source, it returns exactly the eight table paths, each prefixed by that source SHA and a colon. Unit 4.3 runs the same command at the product candidate SHA, strips only that exact treeish prefix, sorts bytewise, and requires the identical eight-path set before checking the narrower byte/snippet invariants.

These full-file hashes are immutable baseline provenance, not a ban on unrelated edits to shared analytics/developer-test files required by accepted features. Unit 4.3 requires the current product hit list to equal these eight paths, keeps the two unrelated historical task files byte-identical, freezes every Pebble-bearing analytics branch/test case/assertion and its behavior by exact snippet plus executable regression, and rejects any diff hunk that adds/removes/reinterprets a Pebble-bearing span. The current Clem feedback source/planning/doing/evidence paths are excluded only because they must state the explicit rejection; no runtime, public documentation, fixture, or unrelated historical task file is excluded.

## Migration Set

`0000_init.sql`, `0002_seed.sql`, `0003_shopping_list_item_option2.sql`, `0004_reseed.sql`, `0005_add_recipe_step_duration.sql`, `0006_search_document_fts.sql`, `0007_api_credentials.sql`, `0008_s1_spoon_foundation.sql`, `0009_d006_push_notifications.sql`, `0010_search_index_metadata.sql`, `0011_agent_connection_requests.sql`, `0012_passkey_metadata.sql`, `0013_oauth_server.sql`, `0014_oauth_refresh_tokens.sql`, `0015_api_credential_scopes.sql`, `0016_api_idempotency_keys.sql`, `0017_oauth_access_audience.sql`, `0018_recipe_cover_lifecycle.sql`, `0019_oauth_connection_keys.sql`, `0020_native_push_devices.sql`, `0020_recipe_box_indexes.sql`, `0021_api_mutation_tombstones.sql`, `0022_native_sync_tombstones.sql`, `0023_recipe_cover_prompt_lineage.sql`, `0024_remove_legacy_demo_identities.sql`.

## Native SQLite Replay

Node `node:sqlite` applied all 25 raw migrations in memory, then applied the raw fixture with foreign keys enabled.

- Users: `2`
- Recipes: `3`
- Cookbook memberships: `5`
- Shopping items: `3`
- Active unitless duplicate rows: `3` in one identity group
- `PRAGMA foreign_key_check`: zero rows
- Shopping order: `item-b` at 1, `item-a` at 2, `item-c` at 3
- Shopping quantities: `2`, `1`, `null`
- Shopping checked values: `1`, `0`, `0`; every `checkedAt` and `deletedAt` is null
- Persistent temporary state: none; the database was in memory

## Wrangler D1 Replay

Wrangler `4.90.0` applied the same 25 raw migrations into isolated local persistence, then applied the deterministic D1 fixture derivative.

- Users: `2`
- Recipes: `3`
- Cookbook memberships: `5`
- Shopping items: `3`
- Active unitless duplicate rows: `3`
- `PRAGMA foreign_key_check`: zero rows
- Shopping IDs/order/quantities/checked/timestamps: byte-for-value equal to the native replay above
- Remote flag: absent; no QA or production database was touched
- Temporary persistence and derivative file: removed after verification

Wrangler printed its ordinary CLI update-available notice. That notice is an allowed informational line under the already-shipped diagnostic policy, not a warning or failed gate.

## Review Authority

Six cold-review rounds followed the latest-model audit. The final corrected bytes above received these terminal receipts:

| Lane | Reviewer receipt | Final verdict |
| --- | --- | --- |
| Product/data and QA predecessor binding | `019f85f6-b153-76a2-b1ee-dc98a5aeacb4` | `CONVERGED` |
| Release/cleanup and repeatable repair chain | `019f85f6-b4b2-7430-ad5e-746e119a98dc` | `CONVERGED` |
| Durable Object/security cross-contract integration | `019f85f6-ae6c-7001-8003-a15363809bdb` | `CONVERGED` |

The final round explicitly rechecked initial-versus-repair ancestry, environment-specific QA same-build aliases, pre-activation post-restoration repair chaining, and the Unit 7.3/7.4/7.5 logical-expiry/alarm ownership split. No BLOCKER or MAJOR remained before Unit 1.8.
