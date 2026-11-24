// @vitest-environment node
// What tells one backup file from another when an upload resumes.
import { describe, expect, it } from "vitest";
import { isFileHead, uploadFingerprint } from "~/domains/move-in/model/backup-upload";

describe("a backup file's fingerprint", () => {
  it("is its name, size and the SHA-256 of its first MiB, and nothing else", () => {
    const head = "0123456789abcdef".repeat(4);
    expect(uploadFingerprint("mealie.zip", 512, head)).toBe(JSON.stringify(["mealie.zip", 512, head]));
    expect(uploadFingerprint("mealie.zip", 512, head)).not.toBe(uploadFingerprint("mealie.zip", 513, head));
    expect(uploadFingerprint("mealie.zip", 512, head)).not.toBe(uploadFingerprint("other.zip", 512, head));
    expect(uploadFingerprint("mealie.zip", 512, head)).not.toBe(uploadFingerprint("mealie.zip", 512, "f".repeat(64)));
  });

  it("takes a head only as SHA-256 in lowercase hex", () => {
    expect([isFileHead("a".repeat(64)), isFileHead("A".repeat(64)), isFileHead("a".repeat(65)), isFileHead("g".repeat(64)), isFileHead(1), isFileHead(undefined)]).toEqual([
      true, false, false, false, false, false,
    ]);
  });
});
