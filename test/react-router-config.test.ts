import { describe, expect, it } from "vitest";
import config from "../react-router.config";

describe("react-router config", () => {
  it("loads the route manifest up front to avoid background manifest patch failures", () => {
    expect(config.routeDiscovery).toEqual({ mode: "initial" });
  });

  it("allows only the required OAuth and canonical proxy action origins", () => {
    expect(config.allowedActionOrigins).toEqual(["appleid.apple.com", "spoonjoy.app"]);
  });
});
