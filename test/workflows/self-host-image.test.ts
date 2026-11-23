// The Self-host Image workflow builds ghcr.io/spoonjoy/spoonjoy for amd64 and arm64, boots each
// image on a clean runner, runs the Journeys sign-in and round-trip smoke set against it, and
// publishes only from main, after both arches pass.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { PLAYWRIGHT_CONTAINER } from "../../scripts/deployment-preflight";
import { SMOKE_SPECS } from "../../scripts/journeys-scope.mjs";

type Step = { name?: string; if?: string; run?: string; uses?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = {
  "runs-on": string;
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  strategy?: { matrix: { include: { arch: string; runner: string }[] } };
  steps: Step[];
};
type Workflow = { on: { push: unknown; pull_request: { paths: string[] }; workflow_dispatch?: unknown }; permissions: Record<string, string>; jobs: Record<string, Job> };

const workflow = parse(readFileSync(".github/workflows/self-host-image.yml", "utf8")) as Workflow;
const image = workflow.jobs.image;
const publish = workflow.jobs.publish;
const runs = (job: Job) => job.steps.map((step) => step.run ?? "").join("\n");
const stepNamed = (job: Job, pattern: RegExp) => {
  const found = job.steps.find((step) => pattern.test(step.name ?? ""));
  if (!found) throw new Error(`No step named ${pattern}`);
  return found;
};
const ON_MAIN = "github.event_name == 'push' && github.ref == 'refs/heads/main'";

describe("Self-host Image workflow", () => {
  it("runs on main, on pull requests that touch the image, and by hand", () => {
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    expect(workflow.on.pull_request.paths).toEqual(
      expect.arrayContaining(["self-host/**", ".github/workflows/self-host-image.yml", "migrations/**", "pnpm-lock.yaml"]),
    );
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("builds and checks the image natively on amd64 and arm64", () => {
    expect(image.strategy?.matrix.include).toEqual([
      { arch: "amd64", runner: "ubuntu-24.04" },
      { arch: "arm64", runner: "ubuntu-24.04-arm" },
    ]);
    expect(image["runs-on"]).toBe("${{ matrix.runner }}");
    expect(runs(image)).toMatch(/docker build [^\n]*-f self-host\/Dockerfile/);
  });

  it("builds the app with analytics off", () => {
    const build = stepNamed(image, /Build the app/);
    expect(build.env?.VITE_POSTHOG_DISABLED).toBe("1");
    expect(build.run).toContain("pnpm run build");
  });

  it("times docker run to the first page, and waits for the image's own health check", () => {
    expect(stepNamed(image, /Cold boot/).run).toMatch(/docker run -d/);
    expect(stepNamed(image, /health check/i).run).toContain(".State.Health.Status");
  });

  it("signs in on the fresh server, with a password, a passkey and the apps' Sign in with Apple, before seeding", () => {
    const names = image.steps.map((step) => step.name ?? "");
    const fresh = stepNamed(image, /fresh server/).run ?? "";
    expect(fresh).toContain(PLAYWRIGHT_CONTAINER.image);
    expect(fresh).toContain("-c playwright.self-host-fresh.config.ts");
    expect(names.findIndex((name) => /fresh server/.test(name))).toBeLessThan(names.findIndex((name) => /Seed/.test(name)));
    expect(workflow.on.pull_request.paths).toEqual(expect.arrayContaining(["e2e/self-host/**", "app/lib/session.server.ts"]));
  });

  it("signs in through a real OpenID Connect provider, Dex pinned by digest, before seeding", () => {
    const names = image.steps.map((step) => step.name ?? "");
    const oidc = stepNamed(image, /OpenID Connect/).run ?? "";
    expect(oidc).toMatch(/ghcr\.io\/dexidp\/dex@sha256:[0-9a-f]{64}/);
    expect(oidc).toContain("e2e/self-host/dex.yaml");
    expect(oidc).toContain("SPOONJOY_OIDC_ISSUER=http://localhost:5556/dex");
    // The server and the browser both reach Dex at localhost:5556, the issuer its ID tokens name.
    expect(oidc).toMatch(/docker run -d --name sj --network host/);
    expect(oidc).toContain(PLAYWRIGHT_CONTAINER.image);
    expect(oidc).toContain("e2e/self-host/oidc.spec.ts");
    expect(names.findIndex((name) => /OpenID Connect/.test(name))).toBeLessThan(names.findIndex((name) => /Seed/.test(name)));
    expect(stepNamed(image, /Stop the server/).run).toContain("docker stop dex");
    expect(workflow.on.pull_request.paths).toEqual(expect.arrayContaining(["e2e/self-host/**"]));
  });

  it("seeds the kitchen through the image's sql command, and masks every password", () => {
    const seed = stepNamed(image, /Seed/).run ?? "";
    expect(seed).toContain("node scripts/self-host-smoke-seed.mjs");
    expect(seed).toMatch(/server\.mjs sql -/);
    expect(seed).toMatch(/server\.mjs photos \/covers samples\/covers\//);
    expect(seed).toContain("assets/sample-covers:/covers:ro");
    expect(seed).toContain("::add-mask::");
  });

  it("runs the Journeys smoke set in Playwright's pinned image, against the container", () => {
    const smoke = stepNamed(image, /smoke set/).run ?? "";
    expect(smoke).toContain(PLAYWRIGHT_CONTAINER.image);
    expect(smoke).toContain("-c playwright.self-host.config.ts");
    expect(smoke).toContain("e2e/journeys/personas.setup.ts");
    for (const spec of SMOKE_SPECS) expect(smoke).toContain(spec);
  });

  it("checks the kitchen survives a restart", () => {
    expect(stepNamed(image, /restart/i).run).toContain("docker restart");
  });

  it("removes credentials and strips traces before uploading screenshots", () => {
    const names = image.steps.map((step) => step.name ?? "");
    const upload = image.steps.findIndex((step) => step.uses?.startsWith("actions/upload-artifact@"));
    const remove = names.findIndex((name) => /Remove credentials/.test(name));
    const sanitize = image.steps.findIndex((step) => /sanitize-journey-traces\.mjs/.test(step.run ?? ""));
    expect(remove).toBeGreaterThan(-1);
    expect(sanitize).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(Math.max(remove, sanitize));
    expect(image.steps[upload].if).toBe("always()");
  });

  it("pushes only from main, and publishes the multi-arch tags only after both arches pass", () => {
    for (const step of image.steps.filter((candidate) => /docker (push|login)/.test(candidate.run ?? ""))) {
      expect(step.if).toBe(ON_MAIN);
    }
    expect(publish.needs).toBe("image");
    expect(publish.if).toBe(ON_MAIN);
    expect(publish.permissions).toEqual({ contents: "read", packages: "write" });
    const create = runs(publish);
    expect(create).toContain("docker buildx imagetools create");
    expect(create).toContain('-t "$IMAGE:latest"');
    expect(create).toContain('-t "$IMAGE:$VERSION"');
  });

  it("gives the package write permission only to the jobs that push", () => {
    expect(image.permissions).toEqual({ contents: "read", packages: "write" });
    expect(Object.keys(workflow.jobs).sort()).toEqual(["image", "publish"]);
  });
});

describe("self-host/Dockerfile", () => {
  const dockerfile = readFileSync("self-host/Dockerfile", "utf8");

  it("starts from a Node base pinned by digest", () => {
    expect(dockerfile).toMatch(/^FROM node:22[\w.-]*-slim@sha256:[0-9a-f]{64}$/m);
  });

  it("installs the system CA certificates workerd trusts for the Worker's outbound HTTPS", () => {
    expect(dockerfile).toMatch(/apt-get install -y --no-install-recommends ca-certificates/);
  });

  it("installs the runtime from its lockfile", () => {
    expect(dockerfile).toContain("npm ci --omit=dev");
  });

  it("runs as an unprivileged user, with one volume, one port and a health check", () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^VOLUME \/data$/m);
    expect(dockerfile).toMatch(/^EXPOSE 8080$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK .*healthcheck\.mjs/m);
    expect(dockerfile).toMatch(/^CMD \["node", "\/app\/self-host\/server\.mjs"\]$/m);
  });
});
