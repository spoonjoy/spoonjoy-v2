import { describe, expect, it } from "vitest";
import { verifyRedwoodPassword } from "~/lib/legacy-password.server";

// The Node test lane proves the algorithms; this proves the Worker runtime (nodejs_compat's
// scrypt and WebCrypto's SHA-1 PBKDF2) computes the same bytes, since that is where chefs sign in.
const PASSWORD = "legacy-fixture-password-1";

describe("Redwood-era password hashes in the Worker runtime", () => {
  it("matches Redwood's legacy PBKDF2 and scrypt hashes", async () => {
    await expect(verifyRedwoodPassword(
      PASSWORD,
      "6aabd4c8297e401731e8465ae0ee07fb12c5c4293336a1990e72161bc79c2f9b",
      "cb0f339208c1fa86c59de334a45942fc",
    )).resolves.toBe(true);
    await expect(verifyRedwoodPassword(
      PASSWORD,
      "be8fc12a164f74027a009cdf9ee2ded19553c24fd522a9ee56baefc3cbc10db3|16384|8|1",
      "d8290982c4830090797b7ad1f5b890d68e9c7ee9c7ecab6722c137241f041bee",
    )).resolves.toBe(true);
    await expect(verifyRedwoodPassword(
      `${PASSWORD}x`,
      "be8fc12a164f74027a009cdf9ee2ded19553c24fd522a9ee56baefc3cbc10db3|16384|8|1",
      "d8290982c4830090797b7ad1f5b890d68e9c7ee9c7ecab6722c137241f041bee",
    )).resolves.toBe(false);
  });
});
