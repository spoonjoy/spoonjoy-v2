import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const published = readFileSync("self-host/Dockerfile", "utf8");
const source = readFileSync("self-host/Dockerfile.source", "utf8");

/** A Dockerfile's last stage: everything after its last FROM line, comments and all. */
function lastStage(dockerfile: string): string {
  const lines = dockerfile.split("\n");
  const from = lines.findLastIndex((line) => line.startsWith("FROM "));
  return lines.slice(from + 1).join("\n");
}

describe("self-host/Dockerfile.source", () => {
  it("builds on the published image's base, in a first stage named app", () => {
    const base = published.split("\n").find((line) => line.startsWith("FROM "));
    expect(source).toContain(`${base} AS app\n`);
    expect(source.split("\n").filter((line) => line.startsWith("FROM "))).toEqual([`${base} AS app`, base]);
  });

  it("makes the production build with analytics off, from the locked dependencies", () => {
    expect(source).toContain("RUN pnpm install --frozen-lockfile && VITE_POSTHOG_DISABLED=1 pnpm run build\n");
  });

  it("finishes with the published image's own stage, reading the build from the first stage", () => {
    const fromApp = lastStage(published)
      .replace("COPY self-host/package.json self-host/package-lock.json ./", "COPY --from=app /src/self-host/package.json /src/self-host/package-lock.json ./")
      .replace("COPY build ./build", "COPY --from=app /src/build ./build")
      .replace("COPY migrations ./migrations", "COPY --from=app /src/migrations ./migrations")
      .replace("COPY self-host/*.mjs ./self-host/", "COPY --from=app /src/self-host/*.mjs ./self-host/");
    expect(lastStage(source)).toBe(fromApp);
  });
});
