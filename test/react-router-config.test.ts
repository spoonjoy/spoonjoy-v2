import { describe, expect, it } from "vitest";
import config from "../react-router.config";

describe("react-router config", () => {
  it("loads the route manifest up front to avoid background manifest patch failures", () => {
    expect(config.routeDiscovery).toEqual({ mode: "initial" });
  });

  it("allows Apple's required cross-site form_post OAuth callback", () => {
    expect(config.allowedActionOrigins).toEqual(["appleid.apple.com"]);
  });
});
