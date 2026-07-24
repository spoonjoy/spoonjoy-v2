# Cook Session Protocol V1

**Status**: frozen for the 2026-07-21 audited revision
**Authority**: this file supersedes every earlier per-recipe-DO or D1-projection cook contract

## Ownership

- Anonymous progress is browser-local and never enters this protocol.
- Authenticated progress uses one SQLite-backed `CookSession` Durable Object per owner.
- The Worker derives it only with `COOK_SESSIONS.idFromName("owner:v1:" + userId)`.
- User IDs are never reused. A deleted owner's DO tombstone permanently prevents resurrection even if an ID is accidentally presented again.
- D1 stores recipe source data only. It stores no cook session, discovery row, receipt, status, timestamp, or cleanup projection.

## Public Routes

| Method | Path | Scope | Origin | Success |
| --- | --- | --- | --- | --- |
| GET | `/api/cook-sessions` | `kitchen:read` | not required | 200 `{sessions}` |
| DELETE | `/api/cook-sessions` | reserved account-deletion intent bearer with `account:write` | exact configured origin | 204 with deletion proof headers |
| POST | `/api/cook-sessions/:recipeId/start` | `kitchen:write` | exact configured origin | 201 created or 200 resumed `{session}` |
| GET | `/api/cook-sessions/:recipeId` | `kitchen:read` | not required | 200 `{state}` |
| PATCH | `/api/cook-sessions/:recipeId` | `kitchen:write` | exact configured origin | 200 `{session}` |
| DELETE | `/api/cook-sessions/:recipeId` | `kitchen:write` | exact configured origin | 204 |
| POST | `/api/cook-sessions/:recipeId/complete` | `kitchen:write` | exact configured origin | 200 `{session}` |
| POST | `/api/cook-sessions/:recipeId/abandon` | `kitchen:write` | exact configured origin | 200 `{session}` |
| POST | `/api/cook-sessions/:recipeId/restart` | `kitchen:write` | exact configured origin | 200 `{session}` |
| GET | `/api/cook-sessions/:recipeId/socket` | `kitchen:read` | exact configured origin | raw 101 WebSocket upgrade |

Session principals have first-party access equivalent to the named scope except owner deletion. Bearer principals must contain the exact named scope. `kitchen:write` does not imply `account:write`.

Owner deletion is not an ordinary account mutation. It rejects sessions and ordinary bearer/OAuth/personal tokens. The only accepted principal is a non-expired bearer with `account:write`, a credential ID, and exact `oauthResource === "urn:spoonjoy:account-delete-intent:v1"`. Public token/OAuth/agent-connection flows must reject that reserved resource; only the server-side future account-deletion workflow and target-scoped operator cleanup may create it through the existing D1 admin channel. Cleanup credentials additionally carry `kitchen:read` solely for the later 410 proof and never carry `kitchen:write`.

Recipe mutations, recipe purge, socket upgrade, and owner delete require `Origin === new URL(env.SPOONJOY_BASE_URL).origin` for cookie and bearer principals. Missing/invalid base URL fails closed.

Every non-upgrade public response uses `Cache-Control: private, no-store`. A successful 101 response bypasses normal response reconstruction/security-header cloning so its WebSocket handle is preserved; an end-to-end Worker-to-DO test must assert the handle survives. Failed upgrades use the normal private error response.

Public recipe IDs are decoded once, reject `/`, controls, empty values, exact reserved value `__owner__`, and values over 64 Unicode code points. Mutation and server attempt IDs are canonical lowercase RFC 4122 UUID strings of exactly 36 characters. HTTP mutation bodies are at most 65,536 UTF-8 bytes and reject extra keys.

The socket route requires an inbound `Upgrade` header whose trimmed ASCII-lowercase value is exactly `websocket`; otherwise it returns 400 `invalid_request`. The Worker validates but never forwards the inbound hop-by-hop headers. It synthesizes exact internal `Upgrade: websocket` itself.

Public precedence is total and normative:

1. Canonical-host redirect remains the outer Worker concern.
2. Match exact cook method/path and decode/validate the recipe ID. Unknown method/path is 404; a recognized route with a query string or invalid/reserved recipe ID is 400.
3. Authenticate without reading the body. A malformed Authorization header is 400; missing/invalid credentials are 401; an authentication-store/infrastructure failure is 503 `cook_session_unavailable`.
4. Enforce the named scope or exact owner-deletion intent principal; failure is 403 `insufficient_scope`.
5. Enforce Origin when required; failure is 403 `origin_forbidden`.
6. On the socket route validate the exact inbound Upgrade value; failure is 400.
7. Enforce body absence or the 65,536-byte limit, then parse and validate exact JSON/schema; oversize is 413 and other body failure is 400.
8. Only then call the owner DO. `deleting`/`deleted` returns 410 before receipt/state lookup. An unexpected DO/storage/transaction/alarm failure maps to the exact retryable private 503 below; owner deletion cleanup failure uses its dedicated 503.

This order decides combined-invalid cases: for example unauthenticated malformed JSON is 401, wrong-Origin oversized mutation is 403, and an otherwise valid request to a deleted owner is 410.

## Public Bodies

Start body:

```json
{"mutationId":"00000000-0000-4000-8000-000000000000"}
```

PATCH body:

```json
{
  "attemptId":"11111111-1111-4111-8111-111111111111",
  "expectedRevision":0,
  "mutationId":"00000000-0000-4000-8000-000000000000",
  "changes":{
    "activeStepIndex":1,
    "scaleFactor":2,
    "checkedIngredientIds":["ingredient-id"],
    "checkedStepOutputIds":["step-output-id"]
  }
}
```

`changes` must contain at least one key and may contain only the four listed keys. Missing keys preserve current values. Arrays contain unique IDs from the pinned snapshot and are canonicalized in UTF-16 code-unit order. `activeStepIndex` is an integer within the step array. Cook-mode `scaleFactor` is finite and inclusive `0.25..50`.

Every public/internal revision and owner-epoch integer is additionally bounded to `0..9007199254740991` (`Number.MAX_SAFE_INTEGER`); an increment at the maximum fails before mutation. Every stored/public Unix-millisecond time is an integer in `0..8640000000000000`, JavaScript Date's inclusive range, and every conversion must round-trip through `new Date(ms).toISOString()`. Snapshot step numbers and every other D1 integer entering JSON must also be a safe integer. Values outside those bounds are invalid input or private corruption, never lossy Numbers.

Complete, abandon, and restart body:

```json
{
  "attemptId":"11111111-1111-4111-8111-111111111111",
  "expectedRevision":1,
  "mutationId":"00000000-0000-4000-8000-000000000000"
}
```

List, detail, recipe DELETE, owner DELETE, and socket upgrade accept no body. Query strings are rejected on all cook routes.

## Public Shapes

`CookSessionSummary` is exactly:

```ts
interface CookSessionSummary {
  recipeId: string;
  attemptId: string;
  status: "active" | "completed" | "abandoned";
  revision: number;
  updatedAt: string;
  terminalAt: string | null;
}
```

Mutation responses are exactly `{session: CookSessionSummary}`. The client obtains full state from detail or the initial socket snapshot.

`CookSessionListItem` is exactly:

```ts
interface CookSessionListItem {
  recipeId: string;
  attemptId: string;
  status: "active";
  revision: number;
  title: string;
  startedAt: string;
  updatedAt: string;
}
```

List returns `{sessions: CookSessionListItem[]}` ordered by `updatedAt DESC, recipeId DESC` directly from owner SQLite.

`CookState` is exactly:

```ts
interface CookState {
  version: 1;
  recipeId: string;
  attemptId: string;
  status: "active" | "completed" | "abandoned";
  revision: number;
  snapshotHash: string;
  snapshot: CookSnapshotV1;
  progress: CookProgress;
  startedAt: string;
  updatedAt: string;
  terminalAt: string | null;
}

interface CookProgress {
  activeStepIndex: number;
  scaleFactor: number;
  checkedIngredientIds: string[];
  checkedStepOutputIds: string[];
}

interface CookSnapshotV1 {
  version: 1;
  recipe: { id: string; title: string; servings: string | null };
  steps: Array<{
    id: string;
    stepNum: number;
    stepTitle: string | null;
    description: string;
    duration: number | null;
    ingredients: Array<{
      id: string;
      name: string;
      quantity: number;
      unit: { id: string; name: string };
    }>;
    usingSteps: Array<{ id: string; inputStepNum: number; outputStepNum: number }>;
  }>;
}
```

Snapshot steps sort by numeric `stepNum`, then ID. Ingredients sort by ID. Uses sort by numeric `inputStepNum`, numeric `outputStepNum`, then ID. ID comparison is `(a < b ? -1 : a > b ? 1 : 0)` on JavaScript UTF-16 code units. `snapshotHash` is lowercase SHA-256 of UTF-8 `JSON.stringify(snapshot)` with the displayed key order. Snapshot JSON may not exceed 262,144 UTF-8 bytes.

All public timestamps are ISO-8601 UTC strings. Stored times are Unix milliseconds.

## Errors

Errors are exactly:

```ts
interface CookErrorEnvelope {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    session?: CookSessionSummary;
  };
}
```

| Status | Code | Message | Retryable |
| --- | --- | --- | --- |
| 400 | `invalid_request` | `Cook session request is invalid.` | false |
| 401 | `authentication_required` | `Authentication required.` | false |
| 403 | `insufficient_scope` | `This credential does not include the required cook-session scope.` | false |
| 403 | `origin_forbidden` | `Request origin is not allowed.` | false |
| 404 | `not_found` | `Cook session was not found.` | false |
| 409 | `mutation_id_conflict` | `Mutation ID was already used for different cook-session intent.` | false |
| 409 | `stale_attempt` | `Cook session attempt is stale.` | false |
| 409 | `stale_revision` | `Cook session revision is stale.` | false |
| 409 | `recipe_changed` | `Recipe changed after this cook session started.` | false |
| 409 | `session_terminal` | `Cook session is already terminal.` | false |
| 409 | `cook_session_epoch_changed` | `Cook session ownership changed while the request was in flight.` | false |
| 410 | `owner_deleted` | `Cook-session owner data has been permanently deleted.` | false |
| 413 | `cook_request_too_large` | `Cook session request is too large.` | false |
| 413 | `cook_snapshot_too_large` | `Recipe snapshot is too large for cook mode.` | false |
| 422 | `recipe_not_cookable` | `Recipe does not contain a cookable step.` | false |
| 429 | `cook_session_limit_reached` | `Cook session limit reached.` | false |
| 429 | `mutation_receipt_limit_reached` | `Cook mutation receipt limit reached.` | false |
| 429 | `cook_socket_limit_reached` | `Cook session connection limit reached.` | false |
| 503 | `cook_recipe_unavailable` | `Recipe is temporarily unavailable for cook mode.` | true |
| 503 | `cook_session_protocol_unavailable` | `Cook session protocol is temporarily unavailable.` | true |
| 503 | `cook_session_unavailable` | `Cook session is temporarily unavailable.` | true |
| 503 | `owner_delete_incomplete` | `Cook-session owner deletion is incomplete.` | true |

Conflict responses include the canonical `session` summary when one exists. Missing or soft-deleted recipes return 404 `not_found`; a start/restart snapshot with zero steps returns 422 `recipe_not_cookable`; D1 read/serialization failures return 503 `cook_recipe_unavailable`; snapshot size overflow returns 413. Unexpected authentication-store, DO fetch, schema/corruption, SQLite, transaction, serialization, alarm-repair, or post-commit delivery/transition-close failures never escape as platform 500: the Worker/DO boundary returns `cook_session_unavailable`, except owner-delete reconciliation failures return `owner_delete_incomplete`. A failure before the state/receipt transaction commits is never newly receipted. If state and its successful receipt commit but post-commit `ensureAlarm`, required snapshot delivery, or terminal/restart quarantine-close fails, the public response is indeterminate 503 `cook_session_unavailable`; the committed receipt remains authoritative. An identical same-ID retry repairs scheduling, runs the operation-specific lagging-ready snapshot/terminal catch-up or restart quarantine-close without resending to current/pending handles, and only then replays the stored 200/201 response exactly. An existing same-recipe receipt mismatch returns `mutation_id_conflict`; an existing matching receipt with no repair work replays its stored successful status/body exactly.

## Internal Boundary

- Internal origin is exactly `https://cook-session.internal` with no query.
- Owner sentinel path is `/api/cook-sessions/__owner__`.
- Every Worker-created request carries `X-Spoonjoy-Cook-Protocol: 1` and exactly one `X-Spoonjoy-Cook-Operation: owner-list|owner-delete|recipe`.
- The Worker constructs a fresh header allowlist and never forwards inbound `X-Spoonjoy-*`, `CF-*`, `Authorization`, `Cookie`, or hop-by-hop headers to the DO. Internal non-socket requests carry only the two protocol headers plus platform-generated headers; the socket request additionally carries only synthesized `Upgrade: websocket`.
- Exact method/path/operation combinations are required; mismatch returns 404 without storage access.
- `ctx.id.name` must start with `owner:v1:` for owner/recipe operations. Only `bootstrap:*` may run `POST /__bootstrap/probe`. Undefined/mismatched names return 404 before storage access.
- The immutable #283 old DO recognizes new owner sentinel GET/DELETE and recipe paths as protocol requests and returns its frozen retryable 503 without mutation. Exact #283 public Worker source historically returns 404 for owner DELETE; the Unit 1.9 pre-product compatibility Worker adds that public route and returns the same authenticated retryable 503 before product activation. The new DO retains the private bootstrap probe for old-Worker/new-DO overlap. Cross-version acceptance uses exact #283 DO source for new-Worker/old-DO and the exact deployed Unit 1.9 compatibility Worker for the full old-Worker/new-DO public matrix.

For start/restart only, the Worker first sends an internal receipt lookup using the public recipe path/method and exact fixed-key body `{phase:"receipt_lookup",operation,recipeId,mutationId,requestHash}`. A hit returns the stored public response. A miss returns internal 204 with `X-Spoonjoy-Cook-Receipt: miss` and decimal `X-Spoonjoy-Cook-Owner-Epoch`. Only then may the Worker read/authorize the recipe from D1, build/size-check the canonical snapshot, and send the exact apply body below. Apply rechecks the receipt under the owner mutex, then requires the lookup epoch to equal current `owner_meta.cook_epoch` before mutation. Mismatch returns unreceipted public 409 `cook_session_epoch_changed`; the Worker never automatically repeats D1 lookup/apply. This makes every recipe purge a linearization barrier for already-running two-phase start/restart work.

Every internal apply body uses this fixed key order and no extra key:

```ts
{
  phase: "apply";
  operation: "start" | "patch" | "complete" | "abandon" | "restart";
  recipeId: string;
  mutationId: string;
  requestHash: string;
  expectedOwnerEpoch: number | null;
  expectedAttemptId: string | null;
  expectedRevision: number | null;
  payload: Record<string, unknown>;
  snapshot: CookSnapshotV1 | null;
}
```

Start and restart use the exact non-negative lookup epoch. Start uses null attempt/revision, `{}` payload, and a non-null snapshot. Restart uses its public attempt/revision, `{}` payload, and a non-null current snapshot. PATCH/complete/abandon use `expectedOwnerEpoch:null` because they do not release the mutex for D1 work. PATCH uses null snapshot and payload with all four keys in exact order: `activeStepIndex`, `scaleFactor`, `checkedIngredientIds`, `checkedStepOutputIds`; an omitted public field is encoded as null and a supplied array is sorted/deduped. Complete/abandon use their public attempt/revision, `{}` payload, and null snapshot. Internal bodies are validated exactly and never trust a Worker-supplied snapshot hash; the DO canonicalizes/hashes the snapshot.

PATCH/complete/abandon use one internal apply request; the DO checks receipts before validating state. Detail/list/purge/delete/socket use direct internal requests. Internal 204 receipt misses never escape publicly.

The cross-version test fixture is a committed executable bundle of exact #283 Worker/DO source plus the exact deployed Unit 1.9 compatibility Worker source. Its manifest pins each merge SHA, tree SHA, source blob OID, source SHA-256, bundle SHA-256, and deterministic build command. Before committing the fixture, a full-history verification command compares sources to `git show <exact-merge>:<path>`. CI verifies the committed hashes and executes the bundle without requiring repository history. A hand-written behavioral facsimile is not acceptable.

Every later forward repair or canary candidate that changes the Worker or DO bundle must add the same exact-source manifest and execute both candidate-Worker/active-predecessor-DO and active-predecessor-Worker/candidate-DO protocol matrices before QA/merge, because nominally atomic deployment still has edge-propagation overlap. A workflow-only candidate may reuse the prior matrix only after proving both Worker and DO bundle hashes are byte-identical. Deployment gates reject a runtime-changing candidate without this predecessor/candidate skew receipt.

## SQLite Schema

The DO initializes these exact user tables in one transaction; all values are explicit and there is no `pending_projection`.

```sql
CREATE TABLE owner_meta (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  state TEXT NOT NULL CHECK (state IN ('active','deleting','deleted')),
  cook_epoch INTEGER NOT NULL CHECK (cook_epoch BETWEEN 0 AND 9007199254740991),
  created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  updated_at INTEGER NOT NULL CHECK (updated_at BETWEEN created_at AND 8640000000000000),
  deleted_at INTEGER NULL CHECK (deleted_at IS NULL OR deleted_at BETWEEN created_at AND 8640000000000000),
  CHECK ((state = 'deleted' AND deleted_at IS NOT NULL) OR (state != 'deleted' AND deleted_at IS NULL))
) STRICT;

CREATE TABLE cook_session (
  recipe_id TEXT PRIMARY KEY NOT NULL,
  version INTEGER NOT NULL CHECK (version = 1),
  attempt_id TEXT NOT NULL CHECK (length(attempt_id) = 36),
  status TEXT NOT NULL CHECK (status IN ('active','completed','abandoned')),
  revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991),
  title TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL CHECK (length(snapshot_hash) = 64),
  snapshot_json TEXT NOT NULL,
  active_step_index INTEGER NOT NULL CHECK (active_step_index BETWEEN 0 AND 9007199254740991),
  scale_factor REAL NOT NULL CHECK (scale_factor >= 0.25 AND scale_factor <= 50),
  checked_ingredient_ids_json TEXT NOT NULL,
  checked_step_output_ids_json TEXT NOT NULL,
  socket_generation TEXT NOT NULL CHECK (length(socket_generation) = 36),
  started_at INTEGER NOT NULL CHECK (started_at BETWEEN 0 AND 8640000000000000),
  updated_at INTEGER NOT NULL CHECK (updated_at BETWEEN started_at AND 8640000000000000),
  terminal_at INTEGER NULL CHECK (terminal_at IS NULL OR terminal_at BETWEEN started_at AND 8640000000000000),
  purge_at INTEGER NULL CHECK (purge_at IS NULL OR purge_at BETWEEN started_at AND 8640000000000000),
  CHECK ((status = 'active' AND terminal_at IS NULL AND purge_at IS NULL) OR
         (status != 'active' AND terminal_at IS NOT NULL AND purge_at = terminal_at + 86400000))
) STRICT;

CREATE UNIQUE INDEX cook_session_attempt_id_key ON cook_session (attempt_id);
CREATE INDEX cook_session_active_list_idx ON cook_session (status, updated_at DESC, recipe_id DESC);
CREATE INDEX cook_session_purge_idx ON cook_session (purge_at, recipe_id);

CREATE TABLE mutation_receipt (
  recipe_id TEXT NOT NULL,
  mutation_id TEXT NOT NULL CHECK (length(mutation_id) = 36),
  attempt_id TEXT NOT NULL CHECK (length(attempt_id) = 36),
  operation TEXT NOT NULL CHECK (operation IN ('start','patch','complete','abandon','restart')),
  request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
  result_attempt_id TEXT NOT NULL CHECK (length(result_attempt_id) = 36),
  result_revision INTEGER NOT NULL CHECK (result_revision BETWEEN 0 AND 9007199254740991),
  response_status INTEGER NOT NULL CHECK (response_status IN (200,201)),
  response_json TEXT NOT NULL CHECK (length(CAST(response_json AS BLOB)) <= 4096),
  created_at INTEGER NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  expires_at INTEGER NULL CHECK (expires_at IS NULL OR expires_at BETWEEN created_at AND 8640000000000000),
  PRIMARY KEY (recipe_id, mutation_id)
) STRICT;

CREATE INDEX mutation_receipt_attempt_idx ON mutation_receipt (recipe_id, attempt_id);
CREATE INDEX mutation_receipt_expiry_idx ON mutation_receipt (expires_at, recipe_id, mutation_id);
```

All three tables are `STRICT`, so their stored values have the declared storage classes. SQLite STRICT intentionally losslessly coerces numeric text such as `'1'` into stored INTEGER `1`; tests assert that stored type and reject non-losslessly-convertible text/real values rather than claiming input storage-class preservation. Canonical UUID syntax, safe-integer semantics, JSON columns, and fixed-key payloads are validated before use in addition to the raw length/range checks. Schema initialization is idempotent and migrations are versioned in `PRAGMA user_version`.

## State Transitions

- Missing `owner_meta` initializes `active` with `cook_epoch=0` before ordinary work. `deleting`/`deleted` precedence is checked before receipt lookup.
- Start with no unexpired recipe row creates a server UUID attempt, private server UUID socket generation, revision 0, default progress, and returns 201.
- Start with active same-snapshot row returns its existing attempt/revision with 200 and inserts the caller's own replay receipt.
- Start with active different snapshot returns unreceipted 409 `recipe_changed` plus summary.
- Start with unexpired terminal row returns unreceipted 409 `session_terminal`.
- Socket admission requires an unexpired active row. An unexpired terminal row returns 409 `session_terminal` with summary before socket quota/admission; an expired or missing row returns 404. No terminal socket receives 101 or counts toward quota.
- Concurrent starts with different mutation IDs serialize: first creates; later calls resume that exact attempt and each receives its own receipt.
- PATCH validates attempt/revision/IDs, applies every supplied field, increments revision by one even if normalized values equal current values, updates time, inserts receipt, commits once, then fans out.
- Complete/abandon require active matching attempt/revision, increment revision, set terminal/purge deadlines, insert terminal receipt, assign the same expiry to all null-expiry receipts for that attempt, commit once, fan out terminal state, then close attempt sockets.
- Restart requires an existing matching active or terminal attempt/revision, sets all old-attempt null-expiry receipts to `now+24h`, creates a new server attempt and private socket-generation UUID at revision 0 with the current D1 snapshot/default progress, inserts the restart receipt attached to the new attempt with null expiry, commits once, then closes old-attempt sockets without sending the new snapshot.
- Recipe DELETE transactionally increments `owner_meta.cook_epoch` by one and deletes that recipe row plus all its receipts, then closes only its sockets. It returns idempotent 204 even when no row existed; every call is an observable no-op barrier that invalidates a lookup epoch captured before it and explicitly ends exactly-once retention for that recipe. Epoch overflow fails before mutation as 503 `cook_session_unavailable`.
- Owner DELETE explicitly ends exactly-once retention for the owner.

Receipt identity is recipe-scoped exactly as the primary key declares. Reusing one mutation UUID for another operation/payload on the same recipe conflicts; the same UUID on a different recipe is an independent key and is allowed. The normalized request hash is lowercase SHA-256 of UTF-8 `JSON.stringify` over exact fixed-key JSON `{operation,recipeId,expectedAttemptId,expectedRevision,payload}`. It excludes mutation ID, raw request bytes, and server snapshot. Start uses null/null and `{}`. Complete/abandon/restart use the supplied attempt/revision and `{}`. PATCH's payload always has all four keys in the exact order documented above, with null for omitted fields and sorted/deduped arrays.

These golden vectors are normative:

| Operation | Canonical JSON | SHA-256 |
| --- | --- | --- |
| start | `{"operation":"start","recipeId":"recipe-1","expectedAttemptId":null,"expectedRevision":null,"payload":{}}` | `f63618b75c62269e492bb1c3ffcfedab3abddfd3cae6c9ec53fca42cb43c4992` |
| patch | `{"operation":"patch","recipeId":"recipe-1","expectedAttemptId":"11111111-1111-4111-8111-111111111111","expectedRevision":7,"payload":{"activeStepIndex":2,"scaleFactor":null,"checkedIngredientIds":["ingredient-a","ingredient-b"],"checkedStepOutputIds":null}}` | `8052179388b27f5fb011494932999240cc73632149c8380d8f04c33c423d3450` |
| complete | `{"operation":"complete","recipeId":"recipe-1","expectedAttemptId":"11111111-1111-4111-8111-111111111111","expectedRevision":8,"payload":{}}` | `3094dbfdddd75ff9e14e41a98c38669854c0d7a85ff2bd1b463e2a89d248b70f` |
| abandon | `{"operation":"abandon","recipeId":"recipe-1","expectedAttemptId":"11111111-1111-4111-8111-111111111111","expectedRevision":8,"payload":{}}` | `1ec04a0dfc6c9d791372128bc035a6f1d6976b040da2ac4e34ec0c43404c0880` |
| restart | `{"operation":"restart","recipeId":"recipe-1","expectedAttemptId":"11111111-1111-4111-8111-111111111111","expectedRevision":8,"payload":{}}` | `f580d1111f3cc62a343bdf1ac60bd0d188084c907b5fbec10d82f5bfe3670423` |

## Receipt And Resource Limits

- Maximum active sessions per owner: 32. Terminal rows do not count.
- Maximum OPEN sockets: 8 per recipe and 32 per owner. No silent eviction.
- Maximum physical receipt rows: 4096.
- After bounded due cleanup, every successful active-session mutation maintains `receiptCount + activeSessionCount <= 4096`, reserving one terminal receipt per active session.
- An active attempt may have at most 511 nonterminal receipts. Its terminal mutation may insert the 512th because the active count decreases in the same transaction.
- Start/resume receipts attach to the active attempt with null expiry.
- Restart expires old-attempt null receipts at `now+24h`; its new-attempt receipt has null expiry.
- Complete/abandon insert their receipt, then set every null receipt for that attempt to the same `terminal_at+24h` deadline.
- A lookup at `expires_at <= now` deletes that exact key and treats it as a miss.
- All validation, auth, origin, size, D1, conflict, and quota failures are unreceipted.
- Quota failures return the named private 429 response and leave state/receipts unchanged.
- After bounded due cleanup and receipt replay/conflict checks, new work has one exact state/quota precedence: validate state, attempt, revision, and payload; when the operation would increase the active-session count, enforce the 32-active-session cap; enforce the receipt cap for the attempt that will own the new receipt; then enforce the physical 4096-row/reserved-terminal invariant. Start with no row and restart from terminal enforce active-session capacity before receipt capacity. Start/resume and PATCH on an existing active attempt reject its 512th nonterminal receipt; complete/abandon may insert the terminal receipt when that attempt already has 511 nonterminal receipts. Restart always assigns its receipt to the fresh attempt, whose pre-insert count is zero, so the old attempt's count cannot reject restart; restart from active does not increase active count, while restart from terminal does. Socket admission has its separate terminal/missing precedence and socket quota after these logical state checks. When more than one limit is exhausted, the first check in this order determines the 429 code.

## Logical Expiry And Alarm

Twenty-four hours is a logical deadline, not a promise that Cloudflare invokes an alarm at an exact wall-clock instant.

- Every list/detail/receipt lookup/mutation/socket/recipe-delete entrypoint applies logical expiry before returning. A terminal row with `purge_at <= now` is absent publicly even if physical cleanup remains. An expired receipt is never replayed. Unit 7.3 owns direct detail, receipt lookup, mutation, and scheduler expiry; Unit 7.4 owns socket-admission expiry; Unit 7.5 owns direct owner-list and recipe-DELETE expiry.
- Every owner entrypoint under the mutex runs bounded due cleanup and calls `ensureAlarm`. If physical due work remains it schedules `Date.now()`. Otherwise it reads the minimum future session/receipt deadline and sets that alarm, or deletes the alarm if none exists. If `getAlarm()` is unexpectedly null while a deadline exists, the entrypoint repairs it. Unit 7.3 tests this on its detail/receipt/mutation paths, Unit 7.4 adds the socket-entrypoint missing-alarm case, and Unit 7.5 adds the list and recipe-purge missing-alarm cases.
- An alarm invocation deletes at most 256 due receipts, then at most 32 due terminal sessions that have no remaining receipts. This avoids an unbounded receipt cascade. Remaining due work reschedules immediately.
- Alarm delivery is idempotent. Handler failures may use Cloudflare retries; after retries are exhausted, logical reads remain correct and the next owner entrypoint repairs scheduling.
- Alarm callbacks acquire the owner mutex and re-read state. In `deleting` they resume deletion. In `deleted` they reconcile deletion postconditions and return without ordinary scheduling.

## Owner Deletion And Proof

Owner deletion is crash-repairable and fail-closed:

1. Under the owner mutex, missing metadata initializes active; active commits `deleting` before destructive work.
2. Close every OPEN socket with 1000/`owner-deleted`, isolating close failures and rechecking that zero application-OPEN sockets remain. Cloudflare may continue returning CLOSING sockets; they are not represented as absent.
3. In one SQLite transaction delete all session/receipt rows and commit `owner_meta.state='deleted'`, `deleted_at=now`.
4. Call `deleteAlarm()`, then require `getAlarm() === null`.
5. Recount live rows and application-OPEN sockets. Only zero/zero/zero plus absent alarm may return 204.

`deleting` resumes steps 2-5. `deleted` does not return immediately: it defensively repeats steps 2-5 while preserving the original tombstone. A failure returns 503 `owner_delete_incomplete`; retry repairs it. An already-running alarm waits on the mutex, sees deleted, reconciles the same postconditions, and exits. Owner storage is never `deleteAll`'d.

Every successful owner DELETE, including idempotent replay, returns these exact 204 headers:

```text
X-Spoonjoy-Cook-Owner-State: deleted
X-Spoonjoy-Cook-Live-Sessions: 0
X-Spoonjoy-Cook-Live-Receipts: 0
X-Spoonjoy-Cook-Open-Sockets: 0
X-Spoonjoy-Cook-Alarm: absent
```

Remote cleanup verifies all five headers, repeats DELETE and verifies them again, then uses the same intent credential's `kitchen:read` scope to verify GET list and a recipe detail return 410 `owner_deleted`. These are the external proof mechanism; Workers-runtime tests fault-inject every internal boundary and prove header truthfulness. The socket header proves zero application-OPEN sockets, not that Cloudflare has already stopped returning CLOSING handles. Production D1 is separately checked for absence of cook tables. “Zero residue” means zero session/receipt rows, zero application-OPEN sockets, absent alarm, plus the expected minimal deleted tombstone.

## WebSockets

- Server accepts hibernatable sockets with tags `recipe:<recipeId>` and `attempt:<attemptId>`.
- Each socket serializes durable attachment `{version:1,recipeId,attemptId,socketGeneration,deliveryState:"ready"|"pending"|"quarantined",lastSentRevision,pendingRevision}`. `socketGeneration` is the recipe row's private canonical UUID at admission. `lastSentRevision` is an integer `-1..9007199254740991`, where `-1` means no snapshot was sent. A ready attachment has `pendingRevision:null`; a pending attachment has an integer `pendingRevision > lastSentRevision`; a quarantined attachment has `pendingRevision:null` and is permanently ineligible. Before sending revision `R`, the server persists pending state with the prior last-sent revision and `pendingRevision:R`; only then may it send. After a successful active-state send it persists ready state with `lastSentRevision:R` and `pendingRevision:null`. A first-persist failure sends no frame and leaves the old ready attachment truthful at its prior revision; a send or second-persist failure leaves durable pending state and can never be retried ambiguously. Any attachment/send persistence failure after a mutation transaction commits makes the public response indeterminate 503 while its successful receipt remains authoritative. Same-ID retry first excludes/quarantines pending handles, retries the canonical snapshot only to ready matching-generation handles whose `lastSentRevision` is older, then replays the stored success. Successful handles already at that revision are skipped. The faulting socket is best-effort closed 1011/`attachment-persist-failed`; close failure is isolated, and a durable pending handle remains ineligible across eviction.
- Every retrieved handle is validated before quota or ordinary fan-out. Missing, malformed, unknown-version, pending, or quarantined attachments are excluded and closed 1011/`invalid-attachment`. A syntactically ready attachment is also checked against canonical owner/session state: owner must be active, and its recipe row must be unexpired active with the exact attempt and `socket_generation`. A missing/terminal/different-attempt/different-generation canonical row makes the handle ineligible and triggers best-effort durable quarantine followed by the transition's normal close. Thus a failed terminal/restart/purge/owner close or rotated invalid-message generation cannot survive eviction as valid or quota-counted even if its old ready attachment remains.
- Quota and fan-out count only `readyState === WebSocket.OPEN` handles with a valid ready attachment that matches canonical active state; CLOSING/CLOSED/pending/quarantined/invalid/stale sockets are ignored. Send/attachment/close failures are isolated per socket.
- The class implements explicit hibernation `webSocketMessage`, `webSocketClose`, and `webSocketError` handlers, so correctness does not depend on `web_socket_auto_reply_to_close`.
- Initial admission captures the current canonical socket generation, starts from `lastSentRevision:-1`, persists pending state for the current revision, sends, then persists ready state while the owner mutex is held. The raw 101 response returns only after the ready attachment is durably persisted; otherwise the socket is closed and the request returns retryable 503 `cook_session_unavailable` without counting an admitted handle. A failed first persist on this never-admitted handle cannot expose a valid ready attachment.
- Frames are exactly `{type:"snapshot",state:CookState}` or `{type:"error",error:{code,message,retryable}}`.
- PATCH transition delivery sends one strictly newer snapshot to OPEN ready sockets whose durable recipe/attempt/generation matches. Same/lower revision is skipped. A same-ID receipt replay runs this catch-up pass before returning the stored response, including when the original post-commit `ensureAlarm` failed before fan-out began.
- Complete/abandon use a transition-only catch-up pass after the terminal transaction commits and on same-ID receipt replay. It may select a ready attachment only when owner state is active and the canonical row is the exact just-committed terminal recipe/attempt/generation; general quota and ordinary retrieval still require an active row. For terminal revision `R`, it persists pending, sends the terminal snapshot, then persists `deliveryState:"quarantined"`, `lastSentRevision:R`, and `pendingRevision:null` directly rather than making the attachment ready again. A send or final-persist failure leaves durable pending state. It then closes matching attempt sockets 1000/`session-terminal`.
- Restart sends no new-attempt snapshot to old sockets, durably quarantines them, and closes them 4009/`stale-attempt`; same-ID receipt replay reruns that idempotent old-attempt quarantine-close before returning stored success.
- Recipe purge sends no frame, durably quarantines that recipe's sockets, and closes them 1000/`session-purged`. Owner deletion durably quarantines all owner sockets before closing them 1000/`owner-deleted`. Canonical-state validation is the fallback when quarantine persistence or close fails.
- Before handling any oversized or otherwise unsupported client message, the mutex transactionally replaces that recipe row's `socket_generation` with a fresh UUID. This durably invalidates the sender and every peer attachment from the old generation before any fallible attachment/send/close work; all old-generation recipe handles are then best-effort quarantined and closed so healthy peers reconnect. Oversized messages close 1009/`message-too-large`. Other messages receive one best-effort `client_messages_unsupported` error frame outside snapshot revision bookkeeping, then close 1003/`client-messages-unsupported`. Quarantine/send/close failure cannot make an old-generation handle eligible after eviction. A generation-rotation storage failure sends no application frame and fail-closes the current instance's retrieved handles.
- In owner `deleting` or `deleted` state, `webSocketMessage` never parses or mutates ordinary cook state: it closes the sender 1000/`owner-deleted`. `webSocketClose` and `webSocketError` perform no ordinary state transition. Thus a CLOSING socket returned after deletion cannot revive data or receive an application frame.

## Client Reconciliation

Reconnect delay for failure index `n` is `[1000,2000,5000,10000][min(n,3)]` milliseconds and remains capped at 10 seconds. Opening a socket does not immediately reset the index: reset to zero only after 30 seconds continuously open, or after a later strictly-newer valid snapshot proves useful progress. A close before stability advances the existing index, preventing endless one-second open/close churn. Offline state pauses timers; `online` retries immediately without resetting the index.

Every authenticated transport instance has a monotonically increasing principal/transport epoch, and every socket within it has a monotonically increasing connection generation. Auth principal change, logout, or transport replacement increments the epoch before clearing state. Every asynchronous continuation captures its epoch plus the relevant connection generation/attempt: list/detail fetches, mutation requests and reconciliation fetches, WebSocket events, and reconnect/online timers all discard their result before any state replacement, retry, or new request when that capture is no longer current. A snapshot frame is accepted only when its epoch/generation is current, its recipe and attempt equal the hook's current canonical pair, and its revision is strictly greater than the highest accepted revision. A different-attempt frame is ignored and that socket is closed 4009/`stale-attempt`; a same/lower-revision frame is ignored without state replacement. A terminal snapshot that passes those guards is accepted once, then transport stops and discovery revalidates. A valid current-generation `error` frame stops transport and surfaces its exact error without automatic mutation retry. Malformed or unlisted frame shapes stop with a protocol error. Tests resolve user A/user B and old-attempt/new-attempt promises in adversarial order so no stale continuation can replace current principal or attempt state.

- Clean 1000: stop and revalidate active list.
- 4009: fetch detail. Different active attempt adopts/reopens; same active attempt stops with `stale_attempt_reconciliation_failed`; terminal/404 stops and revalidates; 401/403 stops auth error; 409 adopts canonical active or stops terminal; 5xx/network uses capped reconnect; other 4xx stops.
- 1006/1011/1012/1013: fetch detail. Active reconnects with capped delay; terminal/404 stops/revalidates; 401/403/other 4xx stops; 409 adopts active or stops terminal; 5xx/network retries.
- Any unlisted close code stops with a protocol error.
- HTTP 503 `cook_session_protocol_unavailable` honors `Retry-After: 1`; other retryable 5xx uses the same capped delay.

HTTP mutation reconciliation is exact:

- Network failure or retryable 5xx retries the identical method/path/body with the same mutation ID after the capped delay; a 503 `cook_session_protocol_unavailable` uses `Retry-After: 1`.
- 409 `mutation_id_conflict` stops as a non-retryable client/protocol error and never substitutes a new mutation ID automatically.
- 409 `stale_attempt` fetches detail. A different active attempt is adopted and surfaced as the explicit resume/restart mismatch choice; a terminal state or 404 stops and refreshes discovery. The same attempt is a protocol error.
- 409 `stale_revision` fetches detail. The same active attempt adopts canonical state and returns `needsReapply:true` without silently replaying the user's discarded change; a different active attempt uses the mismatch choice; terminal/404 stops and refreshes discovery.
- 409 `recipe_changed` fetches/adopts the pinned active detail and exposes the explicit continue-pinned versus purge/start-new choice. It never silently remaps progress.
- 409 `session_terminal` fetches terminal detail when available, stops transport, and refreshes discovery.
- Any conflict follow-up 401/403 stops as auth error; 410 stops as permanently deleted; retryable 5xx/network uses capped delay; other 4xx stops as protocol/application error.
- Direct 400/401/403/404/410/413/422/429 mutation responses do not retry. Successful mutation responses fetch detail unless the socket has already delivered an equal-or-newer revision; the newer canonical state wins.

Recipe DELETE has a separate bodyless retry contract. Network failure or retryable 5xx retries the identical DELETE path after the capped delay; 204 is final even when it is a repeat purge, and any 4xx stops. Because purge explicitly ends receipt retention and advances the owner epoch, it has no mutation ID and makes no exactly-once claim. The recipe-changed "purge and start current" choice waits for 204, then issues start with a fresh mutation ID; it never starts after an indeterminate purge response.

The 410 guarantee applies only after route, authentication, scope/deletion-intent, Origin, body, and upgrade validation succeed and the request reaches the owner DO. Invalid or unauthorized requests retain their earlier 400/401/403/404 responses.

## Protocol Boundary And Release

Unit 7.1b adds `workers/cook-session-protocol-v1-boundary` in the same atomic commit that first replaces inert stubs with real protocol-v1 routing. The file is added exactly once. Its addition commit SHA is recorded in handoff/evidence and later set as `SPOONJOY_PROTOCOL_V1_BOUNDARY_SHA` for canary restoration. Both the active product source and canary-restoration source must descend from that commit. No restoration PR may create or move the marker.

`SPOONJOY_PRODUCT_ROLLBACK_FLOOR_SHA` is a one-shot restoration proof, not a permanent pin. With full history checked out, the deploy script reads the active runtime source's checked-in release mode by exact source SHA. Only when transitioning from an active source whose mode is `atomic-product-activation` to a candidate whose mode is `protocol-v1-canary` must active runtime and every rollback target equal final `acceptedProductSourceSha`. The first restoration candidate has that floor as exact base/first parent. If a merged restoration deployment fails, runtime is reconciled back to the floor but main has advanced; a repair candidate therefore must descend from both the floor and latest failed restoration and must retain a workflow-only full diff from the floor, but it is not required to have the floor as direct parent. Once a restoration source is active, its checked-in mode is already `protocol-v1-canary`; later canary releases use boundary ancestry plus the normal immediate-previous-compatible-version rollback rule and do not require equality with the historical product floor. Contract tests cover initial and repair ancestry plus a synthetic protocol-v1-canary successor that stages and rolls back to its immediate predecessor while the historical floor remains immutable evidence.
