import { hashIdempotencyRequest, IDEMPOTENCY_TTL_MS } from "~/lib/api-idempotency.server";
import { d1EpochMsSql, type D1Query } from "~/lib/d1-read.server";
import { d1Timestamp } from "~/lib/d1-write.server";

// A write that adds to what is there, such as a shopping item's quantity, cannot simply run again
// after a transient D1 error: if the first try committed and only its answer was lost, a second
// run adds the quantity twice. A write-once key makes it safe. Each try's batch first claims the
// key, with an id that try chose, in the idempotency key table (ApiIdempotencyKey, under the
// chef's own client key, so API reservations never see it), and every statement that adds is
// guarded by "this try's claim is the one in the table". A batch is one SQLite transaction, so
// exactly one try's adds apply: the first to commit claims the key, and every later try, whether
// a retry in the same request or a resubmit of the same form, finds the key taken and adds
// nothing.
//
// The key comes from the form's write token and the request itself, so a resubmit of the same
// form after a 503, or a double tap, adds once, while a changed form is a new add. Without a token
// (a submit before the page's script ran), the key is the request's own, so retries within the
// request are still safe. Keys last 24 hours; each claim deletes the chef's expired keys for the
// same operation, so the table holds about a day of adds per chef.

const CLIENT_KEY_PREFIX = "chef:";

export interface D1WriteOnceKey {
  userId: string;
  /** A fixed label, such as "shopping_list.add_item". */
  operation: string;
  key: string;
  requestHash: string;
}

/** The key for one add: the form's token and the request, or the request alone without a token. */
export async function d1WriteOnceKey(input: {
  userId: string;
  operation: string;
  token: string | null;
  request: unknown;
}): Promise<D1WriteOnceKey> {
  const requestHash = await hashIdempotencyRequest({ method: "WRITE", path: input.operation, body: input.request });
  const key = input.token
    ? `${input.operation}:token:${input.token}:${requestHash}`
    : `${input.operation}:request:${crypto.randomUUID()}`;
  return { userId: input.userId, operation: input.operation, key, requestHash };
}

export interface D1WriteOnceClaim {
  /** Runs first in the try's batch: drops the chef's expired keys, then claims this one unless it is taken. */
  statements: [D1Query, D1Query];
  /** An SQL condition, with `guardValues`, that holds only when this try's claim is the one in the table. */
  guard: string;
  guardValues: unknown[];
  /** Reads the note of whichever try holds the key (null when none does), as a "note" column. */
  readNote: D1Query;
}

/**
 * One try's claim of the key. Build a new one for each try, so each has its own id. `note` is
 * kept with the claim, so a later try that finds the key taken can read what the winning try
 * wrote (such as the ids of the items it created).
 */
export function d1WriteOnceClaim(key: D1WriteOnceKey, now: Date, note = "{}"): D1WriteOnceClaim {
  const id = crypto.randomUUID();
  const clientKey = `${CLIENT_KEY_PREFIX}${key.userId}`;
  return {
    statements: [
      [
        `DELETE FROM "ApiIdempotencyKey"
         WHERE "userId" = ? AND "clientKey" = ? AND "operation" = ? AND ${d1EpochMsSql('"expiresAt"')} <= ?`,
        key.userId,
        clientKey,
        key.operation,
        now.getTime(),
      ],
      [
        `INSERT INTO "ApiIdempotencyKey"
           ("id", "userId", "credentialId", "clientKey", "key", "operation", "requestHash",
            "responseStatus", "responseBody", "expiresAt", "createdAt", "updatedAt")
         VALUES (?, ?, NULL, ?, ?, ?, ?, 200, ?, ?, ?, ?)
         ON CONFLICT ("userId", "clientKey", "key") DO NOTHING`,
        id,
        key.userId,
        clientKey,
        key.key,
        key.operation,
        key.requestHash,
        note,
        d1Timestamp(new Date(now.getTime() + IDEMPOTENCY_TTL_MS)),
        d1Timestamp(now),
        d1Timestamp(now),
      ],
    ],
    guard: `EXISTS (SELECT 1 FROM "ApiIdempotencyKey" WHERE "id" = ?)`,
    guardValues: [id],
    readNote: [
      `SELECT "responseBody" AS "note" FROM "ApiIdempotencyKey" WHERE "userId" = ? AND "clientKey" = ? AND "key" = ?`,
      key.userId,
      clientKey,
      key.key,
    ],
  };
}
