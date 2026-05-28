import { describe, expect, it, vi } from "vitest";
import {
  buildAuthenticationOptions,
  buildRegistrationOptions,
  credentialFromRegistration,
  parseTransports,
  resolveWebAuthnConfig,
  verifyAuthentication,
  verifyRegistration,
  type StoredCredential,
  type WebAuthnConfig,
} from "~/lib/webauthn.server";

const config: WebAuthnConfig = {
  rpName: "Spoonjoy",
  rpID: "spoonjoy.app",
  origin: "https://spoonjoy.app",
};

function storedCredential(overrides: Partial<StoredCredential> = {}): StoredCredential {
  return {
    id: "cred_123",
    publicKey: new Uint8Array([1, 2, 3]),
    counter: 5n,
    transports: "internal,hybrid",
    ...overrides,
  };
}

describe("resolveWebAuthnConfig", () => {
  it("derives rpID + origin from a production base URL", () => {
    expect(resolveWebAuthnConfig("https://spoonjoy.app")).toEqual({
      rpName: "Spoonjoy",
      rpID: "spoonjoy.app",
      origin: "https://spoonjoy.app",
    });
  });

  it("derives localhost rpID for dev", () => {
    expect(resolveWebAuthnConfig("http://localhost:5173")).toEqual({
      rpName: "Spoonjoy",
      rpID: "localhost",
      origin: "http://localhost:5173",
    });
  });
});

describe("parseTransports", () => {
  it("returns undefined for null/empty", () => {
    expect(parseTransports(null)).toBeUndefined();
    expect(parseTransports("")).toBeUndefined();
  });

  it("splits and validates known transports", () => {
    expect(parseTransports("internal,hybrid,usb")).toEqual(["internal", "hybrid", "usb"]);
  });

  it("drops unknown transport values", () => {
    expect(parseTransports("internal,bogus,nfc")).toEqual(["internal", "nfc"]);
  });

  it("returns undefined when nothing valid remains", () => {
    expect(parseTransports("bogus,nonsense")).toBeUndefined();
  });

  it("trims whitespace around values", () => {
    expect(parseTransports(" internal , usb ")).toEqual(["internal", "usb"]);
  });
});

describe("buildRegistrationOptions", () => {
  it("passes user + exclude credentials to the generator", async () => {
    const generate = vi.fn().mockResolvedValue({ challenge: "abc" });
    const result = await buildRegistrationOptions(
      config,
      { id: "user_1", username: "chef", email: "chef@example.com" },
      [storedCredential({ id: "existing_1", transports: "internal" })],
      generate,
    );

    expect(result).toEqual({ challenge: "abc" });
    const opts = generate.mock.calls[0][0];
    expect(opts.rpName).toBe("Spoonjoy");
    expect(opts.rpID).toBe("spoonjoy.app");
    expect(opts.userName).toBe("chef@example.com");
    expect(opts.userDisplayName).toBe("chef");
    expect(new TextDecoder().decode(opts.userID)).toBe("user_1");
    expect(opts.attestationType).toBe("none");
    expect(opts.excludeCredentials).toEqual([
      { id: "existing_1", transports: ["internal"] },
    ]);
    expect(opts.authenticatorSelection).toEqual({
      residentKey: "preferred",
      userVerification: "preferred",
    });
  });

  it("handles a user with no existing credentials", async () => {
    const generate = vi.fn().mockResolvedValue({ challenge: "abc" });
    await buildRegistrationOptions(
      config,
      { id: "u", username: "n", email: "e@example.com" },
      [],
      generate,
    );
    expect(generate.mock.calls[0][0].excludeCredentials).toEqual([]);
  });
});

describe("verifyRegistration", () => {
  it("forwards challenge + origin + rpID to the verifier", async () => {
    const verify = vi.fn().mockResolvedValue({ verified: true });
    const result = await verifyRegistration(config, { id: "x" } as never, "chal_1", verify);
    expect(result).toEqual({ verified: true });
    expect(verify).toHaveBeenCalledWith({
      response: { id: "x" },
      expectedChallenge: "chal_1",
      expectedOrigin: "https://spoonjoy.app",
      expectedRPID: "spoonjoy.app",
      requireUserVerification: false,
    });
  });
});

describe("credentialFromRegistration", () => {
  it("returns null when not verified", () => {
    expect(credentialFromRegistration({ verified: false })).toBeNull();
  });

  it("maps a verified registration into a stored credential", () => {
    const result = credentialFromRegistration({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred_abc",
          publicKey: new Uint8Array([9, 8, 7]),
          counter: 0,
          transports: ["internal", "hybrid"],
        },
      },
    } as never);

    expect(result).toEqual({
      id: "cred_abc",
      publicKey: new Uint8Array([9, 8, 7]),
      counter: 0n,
      transports: "internal,hybrid",
    });
  });

  it("stores null transports when absent", () => {
    const result = credentialFromRegistration({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred_abc",
          publicKey: new Uint8Array([1]),
          counter: 3,
        },
      },
    } as never);

    expect(result?.transports).toBeNull();
    expect(result?.counter).toBe(3n);
  });
});

describe("buildAuthenticationOptions", () => {
  it("passes allowCredentials with parsed transports", async () => {
    const generate = vi.fn().mockResolvedValue({ challenge: "auth_chal" });
    const result = await buildAuthenticationOptions(
      config,
      [storedCredential({ id: "c1", transports: "internal" })],
      generate,
    );
    expect(result).toEqual({ challenge: "auth_chal" });
    const opts = generate.mock.calls[0][0];
    expect(opts.rpID).toBe("spoonjoy.app");
    expect(opts.userVerification).toBe("preferred");
    expect(opts.allowCredentials).toEqual([{ id: "c1", transports: ["internal"] }]);
  });

  it("handles an empty credential list (username-first, no passkeys)", async () => {
    const generate = vi.fn().mockResolvedValue({ challenge: "x" });
    await buildAuthenticationOptions(config, [], generate);
    expect(generate.mock.calls[0][0].allowCredentials).toEqual([]);
  });
});

describe("verifyAuthentication", () => {
  it("forwards the stored credential as a fresh ArrayBuffer-backed key", async () => {
    const verify = vi.fn().mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 6 } });
    const cred = storedCredential({ id: "c9", counter: 5n, transports: "usb" });
    const result = await verifyAuthentication(config, { id: "c9" } as never, "chal", cred, verify);

    expect(result).toMatchObject({ verified: true });
    const opts = verify.mock.calls[0][0];
    expect(opts.expectedChallenge).toBe("chal");
    expect(opts.expectedOrigin).toBe("https://spoonjoy.app");
    expect(opts.expectedRPID).toBe("spoonjoy.app");
    expect(opts.credential.id).toBe("c9");
    expect(opts.credential.counter).toBe(5);
    expect(opts.credential.transports).toEqual(["usb"]);
    expect(Array.from(opts.credential.publicKey)).toEqual([1, 2, 3]);
  });
});

// Exercise the default @simplewebauthn implementations (the DI seams) so the
// default-parameter branches are covered. The generators run fully in-env;
// the verifiers reject on bogus input, which is enough to hit the seam.
describe("default @simplewebauthn integration", () => {
  it("buildRegistrationOptions uses the real generator when none injected", async () => {
    const options = await buildRegistrationOptions(
      config,
      { id: "user_real", username: "chef", email: "chef@example.com" },
      [],
    );
    expect(typeof options.challenge).toBe("string");
    expect(options.challenge.length).toBeGreaterThan(0);
    expect(options.rp).toMatchObject({ id: "spoonjoy.app", name: "Spoonjoy" });
  });

  it("buildAuthenticationOptions uses the real generator when none injected", async () => {
    const options = await buildAuthenticationOptions(config, []);
    expect(typeof options.challenge).toBe("string");
    expect(options.rpId).toBe("spoonjoy.app");
  });

  it("verifyRegistration uses the real verifier when none injected (rejects bogus input)", async () => {
    await expect(
      verifyRegistration(config, { id: "bogus", response: {} } as never, "chal"),
    ).rejects.toBeDefined();
  });

  it("verifyAuthentication uses the real verifier when none injected (rejects bogus input)", async () => {
    await expect(
      verifyAuthentication(config, { id: "bogus", response: {} } as never, "chal", storedCredential()),
    ).rejects.toBeDefined();
  });
});
