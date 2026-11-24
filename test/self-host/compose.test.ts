import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Compose = {
  services: Record<string, { image: string; restart: string; ports: string[]; volumes: string[]; environment: Record<string, string> }>;
  volumes: Record<string, unknown>;
};

const compose = parse(readFileSync("self-host/compose.yaml", "utf8")) as Compose;
const spoonjoy = compose.services.spoonjoy!;

describe("self-host/compose.yaml", () => {
  it("runs the published image with its data in a named volume, restarting unless stopped", () => {
    expect(spoonjoy.image).toBe("${SPOONJOY_IMAGE:-ghcr.io/spoonjoy/spoonjoy:latest}");
    expect(spoonjoy.restart).toBe("unless-stopped");
    expect(spoonjoy.volumes).toEqual(["spoonjoy-data:/data"]);
    expect(compose.volumes).toHaveProperty("spoonjoy-data");
  });

  it("serves on 8080 at localhost unless SPOONJOY_PORT and SPOONJOY_BASE_URL say otherwise", () => {
    expect(spoonjoy.ports).toEqual(["${SPOONJOY_PORT:-8080}:8080"]);
    expect(spoonjoy.environment).toEqual({ SPOONJOY_BASE_URL: "${SPOONJOY_BASE_URL:-http://localhost:8080}" });
  });
});
