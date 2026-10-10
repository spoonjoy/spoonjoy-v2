import { env } from "cloudflare:test";
import type { PrismaClient } from "@prisma/client";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { D1ReadDatabase } from "../../../app/lib/d1-read.server";
import { getDb } from "../../../app/lib/db.server";
import { finishAuthentication, WebAuthnError } from "../../../app/lib/webauthn-route.server";
import { action as authenticateVerifyAction } from "../../../app/routes/auth.webauthn.authenticate.verify";
import { applyRepositoryMigrations } from "./repository-migrations";

// A passkey sign-in rotates the credential's signature counter and consumes the user's
// one-time challenge. Prisma's D1 adapter runs those as separate writes, so a failure
// between them, or a second submission of the same assertion racing the first, could leave
// one applied without the other or let both sign in. These tests sign real assertions
// (ES256 through WebCrypto, verified by @simplewebauthn/server) and run the sign-in against
// Wrangler's real D1.

const ORIGIN = "https://spoonjoy.test";
const CONFIG = { rpName: "Spoonjoy", rpID: "spoonjoy.test", origin: ORIGIN };
const OLD = "2026-01-01T00:00:00.000Z";
const PREFIX = "webauthn-atomic";
const FAILURE = "webauthn_atomic_injected_failure";
const TRIGGER = "WebAuthnAtomic_injected_failure";

let prisma: PrismaClient;

function database(): D1Database {
  return env.DB as D1Database;
}

async function run(sql: string, ...values: unknown[]) {
  await database().prepare(sql).bind(...values).run();
}

/** Makes the next matching write abort, as a failing statement late in a batch would. */
async function failOn(event: "UPDATE", table: string, when: string) {
  await run(`DROP TRIGGER IF EXISTS "${TRIGGER}"`);
  await run(`CREATE TRIGGER "${TRIGGER}" BEFORE ${event} ON "${table}" WHEN ${when}
    BEGIN SELECT RAISE(ABORT, '${FAILURE}'); END`);
}

/** The binding, but `before` runs once just ahead of the first batch: another request's writes. */
function interleaved(before: () => Promise<unknown>): D1ReadDatabase {
  let pending = true;
  return {
    prepare: (sql) => database().prepare(sql) as never,
    async batch(statements) {
      if (pending) {
        pending = false;
        await before();
      }
      return database().batch(statements as never);
    },
  };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => {
    throw new Error("expected the sign-in to fail");
  }, (error: unknown) => error);
}

function base64url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/** WebCrypto signs ECDSA as raw r||s; WebAuthn carries the ASN.1 DER form. */
function derSignature(raw: Uint8Array): Uint8Array {
  const integer = (value: Uint8Array) => {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) start++;
    const trimmed = value.slice(start);
    const body = trimmed[0] & 0x80 ? concat(new Uint8Array([0]), trimmed) : trimmed;
    return concat(new Uint8Array([0x02, body.length]), body);
  };
  const sequence = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
  return concat(new Uint8Array([0x30, sequence.length]), sequence);
}

interface Passkey {
  userId: string;
  email: string;
  credentialId: string;
  challenge: string;
  sign(counter: number): Promise<AuthenticationResponseJSON>;
}

/** A user mid sign-in (challenge issued) with one ES256 passkey whose stored counter is `counter`. */
async function seedPasskey(name: string, counter: number): Promise<Passkey> {
  const userId = `${PREFIX}-${name}`;
  const email = `${userId}@example.com`;
  const credentialId = base64url(new TextEncoder().encode(`${userId}-credential`));
  const challenge = base64url(new TextEncoder().encode(`${userId}-challenge`));
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const point = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey) as ArrayBuffer);
  // COSE_Key {1: 2 (EC2), 3: -7 (ES256), -1: 1 (P-256), -2: x, -3: y}, CBOR-encoded.
  const coseKey = concat(
    new Uint8Array([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    point.slice(1, 33),
    new Uint8Array([0x22, 0x58, 0x20]),
    point.slice(33, 65),
  );

  await run(
    `INSERT INTO "User" ("id", "email", "username", "webAuthnChallenge", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?)`,
    userId, email, userId.replace(/-/g, "_"), challenge, OLD, OLD,
  );
  await run(
    `INSERT INTO "UserCredential" ("id", "userId", "publicKey", "counter") VALUES (?, ?, ?, ?)`,
    credentialId, userId, coseKey.buffer, counter,
  );

  return {
    userId,
    email,
    credentialId,
    challenge,
    async sign(assertionCounter: number) {
      const counterBytes = new Uint8Array(4);
      new DataView(counterBytes.buffer).setUint32(0, assertionCounter);
      // rpIdHash || flags (user present + user verified) || signCount
      const authenticatorData = concat(
        await sha256(new TextEncoder().encode(CONFIG.rpID)),
        new Uint8Array([0x05]),
        counterBytes,
      );
      const clientDataJSON = new TextEncoder().encode(JSON.stringify({
        type: "webauthn.get",
        challenge,
        origin: ORIGIN,
        crossOrigin: false,
      }));
      const signed = concat(authenticatorData, await sha256(clientDataJSON));
      const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, signed));
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        response: {
          authenticatorData: base64url(authenticatorData),
          clientDataJSON: base64url(clientDataJSON),
          signature: base64url(derSignature(raw)),
        },
        clientExtensionResults: {},
      };
    },
  };
}

async function signInState(passkey: Passkey) {
  const user = await database().prepare(`SELECT "webAuthnChallenge" FROM "User" WHERE "id" = ?`)
    .bind(passkey.userId).first<{ webAuthnChallenge: string | null }>();
  const credential = await database().prepare(`SELECT "counter" FROM "UserCredential" WHERE "id" = ?`)
    .bind(passkey.credentialId).first<{ counter: number }>();
  return { challenge: user!.webAuthnChallenge, counter: Number(credential!.counter) };
}

/**
 * Prisma, except that each sign-in's credential read waits until `contenders` sign-ins have
 * all read: every one of them has then read the same challenge and counter before any writes.
 */
function readInLockstep(contenders: number): () => PrismaClient {
  let arrived = 0;
  let releaseAll!: () => void;
  const allRead = new Promise<void>((resolve) => {
    releaseAll = resolve;
  });
  return () => new Proxy(prisma, {
    get(target, prop, receiver) {
      if (prop !== "userCredential") return Reflect.get(target, prop, receiver);
      const model = target.userCredential;
      return new Proxy(model, {
        get(modelTarget, modelProp, modelReceiver) {
          if (modelProp !== "findUnique") return Reflect.get(modelTarget, modelProp, modelReceiver);
          return async (args: Parameters<typeof model.findUnique>[0]) => {
            const row = await modelTarget.findUnique(args);
            arrived += 1;
            if (arrived === contenders) releaseAll();
            await allRead;
            return row;
          };
        },
      });
    },
  });
}

function verifyRequest(passkey: Passkey, response: AuthenticationResponseJSON) {
  return new Request(`${ORIGIN}/auth/webauthn/authenticate/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.77" },
    body: JSON.stringify({ identifier: passkey.email, response }),
  });
}

describe("passkey sign-in writes on D1", () => {
  beforeAll(async () => {
    await applyRepositoryMigrations(database());
    prisma = await getDb({ DB: database() });
    // The sign-in loads the WebAuthn library on first use; load it here so a cold load on a
    // busy runner is not charged to the first test's timeout.
    await import("@simplewebauthn/server");
  }, 60_000);

  afterEach(async () => {
    await run(`DROP TRIGGER IF EXISTS "${TRIGGER}"`);
  });

  afterAll(async () => {
    await run(`DELETE FROM "UserCredential" WHERE "userId" LIKE '${PREFIX}-%'`);
    await run(`DELETE FROM "User" WHERE "id" LIKE '${PREFIX}-%'`);
  });

  it("rotates the counter and consumes the challenge together", async () => {
    const passkey = await seedPasskey("rotates", 4);

    const result = await finishAuthentication(prisma, passkey.email, CONFIG, await passkey.sign(5), undefined, database());

    expect(result).toEqual({ verified: true, userId: passkey.userId, sessionVersion: 0 });
    expect(await signInState(passkey)).toEqual({ challenge: null, counter: 5 });
  });

  it("applies neither the counter nor the challenge clear when a late statement fails", async () => {
    const passkey = await seedPasskey("partial-failure", 4);
    await failOn("UPDATE", "User", `OLD."id" = '${passkey.userId}'`);

    const error = await rejection(
      finishAuthentication(prisma, passkey.email, CONFIG, await passkey.sign(5), undefined, database()),
    );

    expect(String(error)).toContain(FAILURE);
    expect(await signInState(passkey)).toEqual({ challenge: passkey.challenge, counter: 4 });
  });

  it("signs in exactly once when the same assertion is submitted twice at the same time", async () => {
    // A zero counter (as many synced passkeys report) leaves the one-time challenge as the
    // only thing that stops a replay.
    const passkey = await seedPasskey("replayed", 0);
    const assertion = await passkey.sign(0);
    const client = readInLockstep(2);

    const results = await Promise.allSettled([
      finishAuthentication(client(), passkey.email, CONFIG, assertion, undefined, database()),
      finishAuthentication(client(), passkey.email, CONFIG, assertion, undefined, database()),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const [failed] = results.filter((result) => result.status === "rejected");
    expect((failed as PromiseRejectedResult).reason).toBeInstanceOf(WebAuthnError);
    expect((failed as PromiseRejectedResult).reason).toMatchObject({ status: 400 });
    expect(await signInState(passkey)).toEqual({ challenge: null, counter: 0 });
  });

  it("rejects a counter that another sign-in moved past it, leaving the stored state alone", async () => {
    const passkey = await seedPasskey("regressed-in-flight", 4);
    // The assertion verifies against the counter read (4), but before its write lands another
    // sign-in with the same authenticator stores 9: writing 5 would move the counter backwards.
    const d1 = interleaved(() => run(`UPDATE "UserCredential" SET "counter" = 9 WHERE "id" = ?`, passkey.credentialId));

    const error = await rejection(finishAuthentication(prisma, passkey.email, CONFIG, await passkey.sign(5), undefined, d1));

    expect(error).toBeInstanceOf(WebAuthnError);
    expect(error).toMatchObject({ status: 400 });
    expect(await signInState(passkey)).toEqual({ challenge: passkey.challenge, counter: 9 });
  });

  it("rejects an assertion whose counter is behind the stored one, leaving the stored state alone", async () => {
    const passkey = await seedPasskey("regressed", 6);

    const error = await rejection(finishAuthentication(prisma, passkey.email, CONFIG, await passkey.sign(5), undefined, database()));

    expect(error).toBeInstanceOf(WebAuthnError);
    expect(await signInState(passkey)).toEqual({ challenge: passkey.challenge, counter: 6 });
  });

  it("answers a failed sign-in batch through the route with a 400 and no session", async () => {
    const passkey = await seedPasskey("route-failure", 4);
    await failOn("UPDATE", "User", `OLD."id" = '${passkey.userId}'`);

    const response = await authenticateVerifyAction({
      request: verifyRequest(passkey, await passkey.sign(5)),
      context: { cloudflare: { env } },
      params: {},
    } as never);

    expect(response.status).toBe(400);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(await signInState(passkey)).toEqual({ challenge: passkey.challenge, counter: 4 });
  });
});
