import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error -- plain ESM module shipped in the image, without types
import { makePushKeys, pushSubject, serverPushKeys } from "../../self-host/push-keys.mjs";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "spoonjoy-push-keys-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("makePushKeys", () => {
  it("makes a P-256 pair in the form web push signs with", async () => {
    const { publicKey, privateKey } = makePushKeys();
    const point = Buffer.from(publicKey, "base64url");
    expect(point).toHaveLength(65);
    expect(point[0]).toBe(4);
    // The same JWK the push library builds from VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.
    const jwk = { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") };
    const signer = await crypto.subtle.importKey("jwk", { ...jwk, d: privateKey }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const verifier = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const data = new TextEncoder().encode("a notification");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer, data);
    expect(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifier, signature, data)).toBe(true);
    expect(makePushKeys().publicKey).not.toBe(publicKey);
  });
});

describe("serverPushKeys", () => {
  it("makes the server's keys once, readable only by the server, and keeps them", () => {
    const file = path.join(dir, "push-keys.json");
    const first = serverPushKeys(file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(first);
    expect(serverPushKeys(file)).toEqual(first);
  });
});

describe("pushSubject", () => {
  it("is the server's https address, or a mailto address at its host name", () => {
    expect(pushSubject("https://kitchen.example.com/")).toBe("https://kitchen.example.com");
    expect(pushSubject("http://localhost:8080")).toBe("mailto:owner@localhost");
  });
});
