# D1 write retry

Every production write to D1 runs under `retryD1Write` (`app/lib/d1-write-retry.server.ts`), and each write is shaped so that running it a second time ends exactly as running it once. When a connection drops (`Network connection lost`, `D1_ERROR: internal error`), the write is retried or found to have committed. When the database stays unavailable, the caller gets a retryable answer that keeps the user's input. This page lists how each write is made safe, and the few cases that cannot be.

## Why a dropped connection needs care

A transient D1 error does not say whether the write ran. There are three outcomes, and the `flakyD1` and `flakyPrisma` test helpers (`test/helpers/flaky-d1.ts`, `test/helpers/flaky-prisma.ts`) can produce each one:

| Outcome | What happened | What a careless retry does |
| --- | --- | --- |
| `lost` | The try never reached storage | Nothing wrong; the retry writes once |
| `lost-answer` | The try committed, and its answer was lost | Writes a second row, or adds a quantity twice |
| `late` | The try committed after the caller gave up on it | Same as `lost-answer`, and can also trip a guard the first try already satisfied |

The binding-level wrapper (`withTransientD1Retry`) retries only when storage never started. Everything else is the operation's job, through `retryD1Write`.

## How a write is made safe

Each write uses one of these shapes. `retryD1Write({ scope, applied }, write)` retries a transient failure. After an ambiguous try, it first runs `applied` to ask whether that try committed, and treats a guard failure that the try's own late commit caused the same way. When the tries run out, it throws `D1WriteUnavailableError`.

| Shape | Use it for | Example |
| --- | --- | --- |
| Id chosen before the first try, with `applied` reading that id | Creating a row | `spoon.create`, `cover.create_from_spoon`, `recipe.create` |
| Id derived from a form token or a client key (`idForWriteToken`) | A create that the user or a client may resubmit after a 503 or a lost answer | New cookbook, new step, fork, the cook dialog, MCP `create_spoon` with `idempotencyKey` |
| Set the target value, never flip it | Toggles and status changes | Check a shopping item, set the active cover |
| Write-once claim in the same batch (`d1-write-once.server.ts`) | Writes that add up, such as quantities | Shopping adds on the web, API v1 and MCP |
| API v1 idempotency reservation, recovered before a 503 | Every API v1 mutation with `clientMutationId` | Recipe, cookbook and spoon creates |
| Guarded batch whose `applied` check reads this try's own marker | Single-use or fenced writes | OAuth code burn, refresh rotation, agent connection claim |

## How callers answer when D1 stays unavailable

- **Web forms:** a 503 with `Retry-After: 1` and a friendly message shown where the user acted, with their input kept (`d1UnavailableWebResponse`).
- **API v1:** a 503 with `Retry-After: 1` and `error.code: "temporarily_unavailable"`, listed in the status table, the OpenAPI error lists and the generated contracts. Before answering, the runner checks whether the write committed. If it did, it answers the committed result; if not, it releases the idempotency key so the client's retry with the same `clientMutationId` runs again.
- **MCP and the tools API:** JSON-RPC error `-32002` `temporarily_unavailable`, only when a second call cannot apply the write twice (the error is `D1WriteUnavailableError`, or the tool is read-only or idempotent).
- **OAuth endpoints:** a JSON 503 with `error: "temporarily_unavailable"`.
- **The Apple app:** treats `temporarily_unavailable` as retryable. Its offline queue keeps the same `clientMutationId` and honours `Retry-After`.

## Classification

The `scope` names below are the labels `retryD1Write` reports to the Worker tail. "Checked" means `applied` decides whether an ambiguous try committed.

| Area | Scopes | How it is safe |
| --- | --- | --- |
| Recipes (web, API v1, MCP, import, fork) | `recipe.create`, `recipe.create.mcp`, `recipe.edit`, `recipe.update`, `recipe.update.mcp`, `recipe.delete`, `api_v1.recipe_delete_tombstone`, `recipe.fork`, `recipe.import`, `recipe.import_activate_cover`, `recipe_write_key.*` | Ids chosen before the first try, or derived from the form or fork token; edits guarded by `expectedUpdatedAt` with `applied` reading the new `updatedAt`; checked |
| Steps and ingredients | `recipe.create_step`, `recipe.update_step`, `recipe.delete_step`, `recipe.swap_steps`, `recipe.add_step_ingredients`, `recipe.delete_step_ingredient`, `recipe.*.api` | New step id derived from the step form's token; moves and deletes set target positions; checked |
| Cooks | `spoon.create`, `spoon.create.prisma`, `spoon.update`, `spoon.delete`, `spoon.delete.prisma` | Id from the cook dialog's token, the API reservation, or MCP's `idempotencyKey`, and a replay sends no second notification or cover; edits set the patch's values; a delete sets one deletion time |
| Covers and their jobs | `cover.create.prisma`, `cover.create_first_photo`, `cover.create_from_spoon`, `cover.create_placeholder`, `cover.regenerate`, `cover.regenerate_in_place.prisma`, `cover.activate`, `cover.activate_spoon`, `cover.auto_seed_spoon`, `cover.link_spoon`, `cover.clear`, `cover.archive`, `cover.fail_stuck`, `cover.placeholder_finish`, `cover.placeholder_fail`, `cover.stylization_update` | Cover ids chosen before the first try and checked, and derived from the page's form token so a resubmit starts no second job; activation and status writes set fixed values; a failure mark never overwrites a cover that succeeded |
| Cooking now | `cooking_now.record` | An upsert keyed by (user, recipe) that sets values taken from the cook session's state, plus a delete of that cook's expired rows; a write from an older revision of the same attempt changes nothing, so a late try never undoes a newer one |
| Image generation quota | `image_gen.consume` | A marker row keyed by the spend's id is written in the same batch, so a second run spends nothing |
| Uploads | `upload.release_*`, `upload.cleanup_*` | Release and cleanup set fixed values, and a photo is never deleted from under a write that may have committed |
| Cookbooks | `cookbook.create`, `cookbook.create.mcp`, `api_v1.cookbook_create`, `api_v1.cookbook_update`, `cookbook.create_with_recipe`, `cookbook.rename`, `cookbook.delete`, `cookbook.add_recipe`, `cookbook.remove_recipe`, `cookbook.touch`, `*.compat` | New cookbook id derived from the form token, the API reservation or MCP's `idempotencyKey`; membership is set, not toggled; a save notifies only when it added the recipe |
| Shopping list | `shopping_list.ensure`, `shopping_list.create_on_read`, `shopping_list.create.mcp`, `api_v1.shopping_list_create`, `shopping_list.add_item`, `shopping_list.add_recipe`, `shopping_list.set_checked`, `shopping_list.remove_item`, `shopping_list.clear`, `shopping_list.clear_completed`, `shopping_list.set_checked.mcp`, `shopping_list.remove_item.mcp`, `api_v1.shopping_item_check`, `api_v1.shopping_item_delete`, `api_v1.shopping_clear`, `api_v1.shopping_clear_completed`, `unit.create.mcp`, `ingredient_ref.create.mcp`, `api_v1.unit_create`, `api_v1.ingredient_ref_create`, `api_v1.shopping_item_create`, `api_v1.shopping_add_from_recipe`, `mcp.add_shopping_list_item`, `mcp.add_recipe_to_shopping_list` | Adds claim a write-once key (form token, `clientMutationId` plus body, or MCP `idempotencyKey`); checks send the target state; units and ingredients are unique by name and read back |
| API idempotency | `idempotency.reserve`, `idempotency.resume`, `idempotency.complete`, `idempotency.release`, `idempotency.release.mcp`, `api_v1.idempotency_release_after_error`, `api_marker.unmark` | Reservation ids chosen before the first try; completion and release set fixed values |
| API tokens | `api_credential.create`, `api_credential.create_fenced`, `api_credential.revoke`, `api_credential.touch_last_used`, `api_auth.bind_*` | Id and secret chosen before the first try and checked by id and hash, so a lost answer never mints a second live token that the client never saw |
| OAuth | `oauth.register_client`, `oauth.code_create`, `oauth.consume_code`, `oauth.grant_create`, `oauth.refresh_create`, `oauth.rotate_refresh`, `oauth.consent_*`, `oauth.code_withdraw`, `oauth.disconnect_*`, `oauth.revoke_connection`, `oauth.converge_*`, `oauth.bind_*`, `oauth.promote_legacy_issuer`, `oauth.grant_fence_revoke`, `oauth.promote_legacy_issuer.settings`, `oauth.ensure_native_client` | Refresh rotation is one guarded batch whose new pair is derived from the parent, so every try and the client's retry get the same pair and the client always holds a valid token; a code burn is checked by its own `consumedAt` |
| Sign-in and accounts | `user.create`, `oauth_user.*`, `webauthn.*`, `account.*` | Ids chosen before the first try; profile, password and photo writes set fixed values; checked |
| Agent connections | `agent_connection.*` | The claim is checked against this request's credential; state changes set fixed values |
| Push and notifications | `apns.*`, `push_subscription.*`, `notification_preference.save`, `notification.enqueue`, `notification.mark_delivered` | Upserts keyed by device or endpoint; preferences set fixed values; an event id is chosen before the first try |

## Writes that stay not retried, and why

`notRetriedWrites` in `scripts/summarize-worker-tail.jq` counts transient write failures on the production binding that no `retryD1Write` handled. These cases remain, and each is deliberate:

| Write | Why it is not made fully safe |
| --- | --- |
| A client that repeats a whole OAuth dynamic client registration after a 503 | The protocol gives the server nothing to tie the two requests together. The extra client is unused and harmless. Within one request the registration is retried and checked. |
| A recipe edit resubmitted after a 503 whose last try committed late | The edit is saved once. The resubmit carries an old `expectedUpdatedAt`, so it answers the edit-conflict message instead of writing again. |
| A sign-up resubmitted after a 503 whose last try committed late | The account exists once, and the resubmit says the email is taken. The person can sign in. |
| A new recipe resubmitted after a 503 whose last try committed late | The recipe is written once and the resubmit goes to it. The first submit's cover job never started, and the stuck-cover sweep settles that cover. |
| The Cooking now row a cook-session start or progress write records | The progress is already saved in the CookSession object, so the cook-session answer never waits on D1: when every try is lost, the row misses that one write (logged as `cooking_now_record_skipped`) and the cook's next write puts it right. |
| The `lastUsedAt` touch on an API token, and expiring an agent request | Best effort. When every try is lost, the touch is skipped with a warning and the request is answered as expired; neither fails the caller. |
| Regenerating a cover in place, resubmitted after a lost answer | There is no new row to key on, so the resubmit starts the stylization job again. The job writes the same cover; the cost is one more image generation. |
| A double tap on a cover job that reaches the server before the first job marks its start, or a placeholder resubmitted while it is still processing (the placeholder job records no start time) | The cover stays one row, but a second job can start on it and spend one more image generation. |
| The Prisma branches used when there is no D1 binding | They run only in unit tests and scripts. Production always has the binding. |

## Adding a new write

1. Pick a shape from the table above. A create gets an id before the first try. A toggle sends the target state. Anything that adds up gets a write-once claim: a shopping-list batch built for D1 (`runCompatibleShoppingListBatch` with `native`) must also pass `writeOnce`, because the branch without it is not retried.
2. Wrap it: `retryD1Write({ scope: "<area>.<action>", applied }, write)`. Give `applied` a read that is true only if this try committed.
3. Let `D1WriteUnavailableError` reach the caller's 503 path. Never map it to a 400 or a 500.
4. Test it under `lost`, `lost-answer` and `late`, plus the give-up. Each case should end with the rows of one clean run.
