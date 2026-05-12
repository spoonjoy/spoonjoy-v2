import { describe, it, expect } from "vitest";
import {
  generateVapidKeyPair,
  formatVapidEnv,
  isBase64Url,
  base64UrlToUint8Array,
  DEFAULT_VAPID_SUBJECT,
} from "../../scripts/generate-vapid-keys";

describe("scripts/generate-vapid-keys", () => {
  describe("isBase64Url", () => {
    it("returns true for valid base64url (alphanumeric + - + _ + no padding)", () => {
      expect(isBase64Url("abcXYZ0123456789-_")).toBe(true);
    });

    it("returns false when string contains '+'", () => {
      expect(isBase64Url("abc+def")).toBe(false);
    });

    it("returns false when string contains '/'", () => {
      expect(isBase64Url("abc/def")).toBe(false);
    });

    it("returns false when string contains '='", () => {
      expect(isBase64Url("abcdef=")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isBase64Url("")).toBe(false);
    });

    it("returns false for whitespace", () => {
      expect(isBase64Url("abc def")).toBe(false);
    });
  });

  describe("base64UrlToUint8Array", () => {
    it("decodes a known base64url string round-trip with Uint8Array length match", () => {
      // 'A' base64 is "QQ", base64url no padding.
      const bytes = base64UrlToUint8Array("QQ");
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(1);
      expect(bytes[0]).toBe(0x41);
    });

    it("decodes a longer fixture (3 bytes -> 4 chars)", () => {
      // base64("Man") = "TWFu"
      const bytes = base64UrlToUint8Array("TWFu");
      expect(Array.from(bytes)).toEqual([0x4d, 0x61, 0x6e]);
    });

    it("handles base64url-specific characters (- and _) by converting to + and /", () => {
      // bytes [0xff, 0xfe] => base64 "//4=" => base64url "__4"
      const bytes = base64UrlToUint8Array("__4");
      expect(Array.from(bytes)).toEqual([0xff, 0xfe]);
    });
  });

  describe("generateVapidKeyPair", () => {
    it("produces base64url-encoded publicKey of correct raw P-256 length (65 bytes uncompressed)", async () => {
      const pair = await generateVapidKeyPair();
      const pubBytes = base64UrlToUint8Array(pair.publicKey);
      expect(pubBytes.length).toBe(65);
      // first byte of uncompressed P-256 point is 0x04
      expect(pubBytes[0]).toBe(0x04);
    });

    it("produces base64url-encoded privateKey 'd' of correct length (32 bytes)", async () => {
      const pair = await generateVapidKeyPair();
      const privBytes = base64UrlToUint8Array(pair.privateKey);
      expect(privBytes.length).toBe(32);
    });

    it("publicKey and privateKey are both base64url (no +/= chars)", async () => {
      const pair = await generateVapidKeyPair();
      expect(isBase64Url(pair.publicKey)).toBe(true);
      expect(isBase64Url(pair.privateKey)).toBe(true);
    });

    it("idempotent re-invocation generates DIFFERENT keypairs", async () => {
      const a = await generateVapidKeyPair();
      const b = await generateVapidKeyPair();
      expect(a.publicKey).not.toBe(b.publicKey);
      expect(a.privateKey).not.toBe(b.privateKey);
    });

    it("private key round-trips through crypto.subtle.importKey as PKCS8/JWK", async () => {
      const pair = await generateVapidKeyPair();
      // Roundtrip: import the JWK back to validate shape.
      const jwk = {
        kty: "EC",
        crv: "P-256",
        x: pair.publicKeyJwk.x,
        y: pair.publicKeyJwk.y,
        d: pair.privateKeyJwk.d,
        ext: true,
      };
      const imported = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign"],
      );
      expect(imported.algorithm.name).toBe("ECDSA");
    });

    it("public-key JWK has x and y components base64url-encoded with 32-byte raw length each", async () => {
      const pair = await generateVapidKeyPair();
      const x = base64UrlToUint8Array(pair.publicKeyJwk.x);
      const y = base64UrlToUint8Array(pair.publicKeyJwk.y);
      expect(x.length).toBe(32);
      expect(y.length).toBe(32);
    });
  });

  describe("formatVapidEnv", () => {
    it("emits dotenv-style block with the three required keys in stable order", () => {
      const out = formatVapidEnv({
        publicKey: "PUB_KEY_BASE64URL",
        privateKey: "PRIV_KEY_BASE64URL",
        subject: "mailto:test@example.com",
      });
      const lines = out.trim().split("\n");
      expect(lines).toEqual([
        "VAPID_PUBLIC_KEY=PUB_KEY_BASE64URL",
        "VAPID_PRIVATE_KEY=PRIV_KEY_BASE64URL",
        "VAPID_SUBJECT=mailto:test@example.com",
      ]);
    });

    it("uses default subject when none provided", () => {
      const out = formatVapidEnv({
        publicKey: "P",
        privateKey: "Q",
      });
      expect(out).toContain(`VAPID_SUBJECT=${DEFAULT_VAPID_SUBJECT}`);
    });

    it("trailing newline present so file can be concatenated cleanly", () => {
      const out = formatVapidEnv({ publicKey: "P", privateKey: "Q" });
      expect(out.endsWith("\n")).toBe(true);
    });
  });

  describe("DEFAULT_VAPID_SUBJECT", () => {
    it("is a mailto URL", () => {
      expect(DEFAULT_VAPID_SUBJECT.startsWith("mailto:")).toBe(true);
    });
  });
});
