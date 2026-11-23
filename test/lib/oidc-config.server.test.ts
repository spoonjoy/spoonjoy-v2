import { describe, expect, it } from "vitest";
import { getConfiguredOAuthProviders, getOidcButtonLabel, getOidcConfig } from "~/lib/env.server";

const oidcEnv = {
  SPOONJOY_OIDC_ISSUER: "https://auth.example.test/application/o/spoonjoy/",
  SPOONJOY_OIDC_CLIENT_ID: "spoonjoy",
  SPOONJOY_OIDC_CLIENT_SECRET: "test-only-secret",
};

describe("getOidcConfig", () => {
  it("reads the issuer without its trailing slash, the client, and the default label and scopes", () => {
    expect(getOidcConfig(oidcEnv)).toEqual({
      issuer: "https://auth.example.test/application/o/spoonjoy",
      clientId: "spoonjoy",
      clientSecret: "test-only-secret",
      label: "Continue with single sign-on",
      scopes: ["openid", "email", "profile"],
    });
  });

  it("uses the owner's button label and scopes, and always asks for openid", () => {
    const config = getOidcConfig({ ...oidcEnv, SPOONJOY_OIDC_NAME: "Sign in with Authentik", SPOONJOY_OIDC_SCOPES: "email  groups,profile" });
    expect(config.label).toBe("Sign in with Authentik");
    expect(config.scopes).toEqual(["openid", "email", "groups", "profile"]);
    expect(getOidcConfig({ ...oidcEnv, SPOONJOY_OIDC_SCOPES: "openid email" }).scopes).toEqual(["openid", "email"]);
  });

  it.each(["SPOONJOY_OIDC_ISSUER", "SPOONJOY_OIDC_CLIENT_ID", "SPOONJOY_OIDC_CLIENT_SECRET"] as const)("needs %s", (key) => {
    expect(() => getOidcConfig({ ...oidcEnv, [key]: "" })).toThrow(`Missing required environment variable: ${key}`);
  });

  it.each(["not a url", "ftp://auth.example.test", "https://auth.example.test/?x=1", "https://auth.example.test/#top"])(
    "refuses the issuer %s",
    (issuer) => {
      expect(() => getOidcConfig({ ...oidcEnv, SPOONJOY_OIDC_ISSUER: issuer })).toThrow(/SPOONJOY_OIDC_ISSUER/);
    },
  );
});

describe("the OpenID Connect sign-in button", () => {
  it("shows only when the issuer, client and secret are all set", () => {
    expect(getConfiguredOAuthProviders(oidcEnv)).toEqual(["oidc"]);
    expect(getConfiguredOAuthProviders({ ...oidcEnv, SPOONJOY_OIDC_CLIENT_SECRET: "" })).toEqual([]);
    expect(getConfiguredOAuthProviders({ GITHUB_CLIENT_ID: "a", GITHUB_CLIENT_SECRET: "b", ...oidcEnv })).toEqual(["github", "oidc"]);
  });

  it("carries the owner's label when configured, and none otherwise", () => {
    expect(getOidcButtonLabel({ ...oidcEnv, SPOONJOY_OIDC_NAME: "Sign in with Authelia" })).toBe("Sign in with Authelia");
    expect(getOidcButtonLabel(oidcEnv)).toBe("Continue with single sign-on");
    expect(getOidcButtonLabel({})).toBeUndefined();
    expect(getOidcButtonLabel({ ...oidcEnv, SPOONJOY_OIDC_ISSUER: "not a url" })).toBeUndefined();
  });
});
