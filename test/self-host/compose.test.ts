import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Compose = {
  services: Record<string, { image: string; build: { context: string; dockerfile: string; args: Record<string, string> }; restart: string; ports: string[]; volumes: string[]; environment: Record<string, string> }>;
  volumes: Record<string, unknown>;
};

const compose = parse(readFileSync("self-host/compose.yaml", "utf8")) as Compose;
const spoonjoy = compose.services.spoonjoy!;

describe("self-host/compose.yaml", () => {
  it("builds from the public repository's main branch until the published image is public, keeping its line beside", () => {
    expect(spoonjoy.build).toEqual({
      context: "https://github.com/spoonjoy/spoonjoy-v2.git#main",
      dockerfile: "self-host/Dockerfile.source",
      // Keeps the clone's .git, so the server reports the commit it was built from on /api/v1/health.
      args: { BUILDKIT_CONTEXT_KEEP_GIT_DIR: "1" },
    });
    expect(spoonjoy.image).toBe("${SPOONJOY_IMAGE:-spoonjoy-source}");
    expect(readFileSync("self-host/compose.yaml", "utf8")).toContain("    # image: ${SPOONJOY_IMAGE:-ghcr.io/spoonjoy/spoonjoy:latest}\n");
  });

  it("keeps its data in a named volume, restarting unless stopped", () => {
    expect(spoonjoy.restart).toBe("unless-stopped");
    expect(spoonjoy.volumes).toEqual(["spoonjoy-data:/data"]);
    expect(compose.volumes).toHaveProperty("spoonjoy-data");
  });

  it("serves on 8080 at localhost unless SPOONJOY_PORT and SPOONJOY_BASE_URL say otherwise", () => {
    expect(spoonjoy.ports).toEqual(["${SPOONJOY_PORT:-8080}:8080"]);
    expect(spoonjoy.environment).toEqual({ SPOONJOY_BASE_URL: "${SPOONJOY_BASE_URL:-http://localhost:8080}" });
  });
});
