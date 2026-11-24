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

  it("hands the OpenID Connect check an invite from the fresh server's admin, and runs it when a provider's sign-in changes", () => {
    expect(stepNamed(image, /fresh server/).run).toContain("SPOONJOY_SELF_HOST_INVITE_OUT=.self-host/oidc-invite.txt");
    expect(stepNamed(image, /OpenID Connect/).run).toContain("SPOONJOY_SELF_HOST_INVITE_FILE=.self-host/oidc-invite.txt");
    expect(stepNamed(image, /Remove credentials/).run).toContain("rm -rf .self-host");
    expect(workflow.on.pull_request.paths).toEqual(
      expect.arrayContaining([
        "app/lib/oauth-route.server.ts",
        "app/lib/oauth-callback-route.server.ts",
        "app/lib/oidc-callback.server.ts",
        "app/lib/oidc.server.ts",
        "app/components/oauth.tsx",
      ]),
    );
  });

  it("keeps the fresh server's screenshots when the OpenID Connect check runs Playwright again", () => {
    // Playwright empties its output folder when it starts, so the second run writes elsewhere.
    expect(stepNamed(image, /OpenID Connect/).run).toContain("--output test-results-self-host-oidc");
    expect(stepNamed(image, /Strip network logs/).run).toContain("test-results-self-host-oidc");
    expect(stepNamed(image, /Upload the report/).with?.path).toContain("test-results-self-host-oidc/");
  });

  it("runs the fresh server's sign-up and invite checks when the code that decides who may sign up changes", () => {
    expect(stepNamed(image, /fresh server/).name).toMatch(/sign-ups and invites/);
    expect(workflow.on.pull_request.paths).toEqual(
      expect.arrayContaining([
        "app/lib/server-access.server.ts",
        "app/routes/signup.tsx",
        "app/routes/account.server-settings.tsx",
        "app/lib/oauth-user.server.ts",
      ]),
    );
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

  it("restores a backup of the seeded kitchen into a fresh server and finds the recipe and its photo", () => {
    const step = stepNamed(image, /Back up the kitchen and restore it/);
    const run = step.run ?? "";
    expect(step.if).toBe("success()");
    const order = [
      "server.mjs backup /backups/kitchen.tar.gz",
      "docker volume create sj-restored",
      "-v sj-restored:/data -v \"$PWD/.self-host/backups:/backups:ro\"",
      "server.mjs restore /backups/kitchen.tar.gz",
      "grep -q \"Saffron Risotto\"",
      "cmp .self-host/penne-ragu.jpg assets/sample-covers/penne-ragu.jpg",
      "e2e/self-host/restored.spec.ts --output test-results-self-host-restored",
    ].map((text) => run.indexOf(text));
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(run).toContain("-e SPOONJOY_SELF_HOST_RESTORED=1");
  });

  it("checks the server's own web push key is there and survives a restart", () => {
    const restart = stepNamed(image, /Check the kitchen survives a restart/);
    expect(restart.run).toContain("/api/push/public-key");
    expect(restart.run).toContain('= "$push_key" ]');
  });

  it("runs when the admin's backups screen or its download changes", () => {
    expect(workflow.on.pull_request.paths).toEqual(
      expect.arrayContaining(["app/routes/account.server-settings.tsx", "app/routes/account.server-backups.$name.tsx", "app/lib/self-host-backups.server.ts"]),
    );
  });

  it("keeps the restore step's containers off Docker's bridge, so the browser never sees the network change", () => {
    const run = stepNamed(image, /Back up the kitchen and restore it/).run ?? "";
    const containers = run.match(/docker run [^\n]*/g) ?? [];
    expect(containers.length).toBeGreaterThan(0);
    for (const line of containers) expect(line, line).toMatch(/--network (none|host)/);
    expect(run).toContain("docker run -d --name sj-restored --network host");
  });

  it("shows a scheduled backup running on the restored server", () => {
    const run = stepNamed(image, /Back up the kitchen and restore it/).run ?? "";
    expect(run).toContain('-e "SPOONJOY_BACKUP_SCHEDULE=* * * * *" -e SPOONJOY_BACKUPS_KEPT=1');
    expect(run).toMatch(/grep '"event":"backup","kind":"auto"'\n\s*docker exec sj-restored ls \/data\/backups/);
  });

  it("keeps the restored server's screenshot and log, and stops it", () => {
    const upload = image.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(String(upload?.with?.path)).toContain("test-results-self-host-restored/");
    expect(runs(image)).toMatch(/sanitize-journey-traces\.mjs [^\n]*test-results-self-host-restored/);
    const stop = stepNamed(image, /Stop the server/);
    expect(stop.if).toBe("always()");
    expect(stop.run).toContain("docker stop sj-restored || true");
    expect(stop.run).toContain('docker logs sj-restored > "$OUT/restored.log"');
    expect(runs(image)).toContain('for (const file of ["image", "boot", "restart", "restore", "jobs", "compose"])');
  });

  it("moves a kitchen in on a server with move-in on, and checks its backup for move-in jobs done", () => {
    const step = stepNamed(image, /Move a kitchen in through the server's jobs queue/);
    const run = step.run ?? "";
    expect(step.if).toBe("success()");
    const order = [
      "docker run -d --name sj-jobs --network host -v sj-jobs:/data -e PORT=8082 -e SPOONJOY_FLAGS=move_in",
      "-e SPOONJOY_SELF_HOST_MOVE_IN=1",
      "e2e/self-host/move-in.spec.ts --output test-results-self-host-move-in",
      "docker stop sj-jobs",
      "server.mjs backup /backups/jobs.tar.gz",
      'jobs=$(docker run --rm --network none -v "$PWD/.self-host/backups:/backups:ro" "$LOCAL_IMAGE" node',
      'row[type] === "move-in.run" && row[status] === "done"',
      'echo "$jobs" | tee "$OUT/jobs.json"',
    ].map((text) => run.indexOf(text));
    expect(order.every((index) => index > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(run).toContain("docker run --rm --network none -v sj-jobs:/data");
    // The check is a single-quoted node -e script, so a quote inside it would end the script early.
    const script = run.slice(run.indexOf("node --input-type=module -e '") + "node --input-type=module -e '".length, run.indexOf("')\n"));
    expect(script).toContain("PlatformJobKey");
    expect(script).not.toContain("'");
    // It reads the backup inside the image, whose user owns the file, and fails when the table is missing.
    expect(script).toContain('readTarGz("/backups/jobs.tar.gz")');
    expect(script).toContain("if (!keys) throw");
    // A check piped into tee would lose its exit status.
    expect(run).not.toMatch(/-e '[\s\S]*' \| tee/);
    expect(stepNamed(image, /Stop the server/).run).toContain("docker stop sj-jobs || true");
    expect(runs(image)).toMatch(/sanitize-journey-traces\.mjs [^\n]*test-results-self-host-move-in/);
    expect(workflow.on.pull_request.paths).toEqual(expect.arrayContaining(["app/routes/move-in.tsx", "app/domains/move-in/adapters/worker/**"]));
  });

  it("starts the guide's Compose file with this image and waits for its health check, then takes it down", () => {
    const up = stepNamed(image, /Start it with Docker Compose/);
    expect(up.run).toContain('SPOONJOY_IMAGE="$LOCAL_IMAGE"');
    expect(up.run).toContain("docker compose -f self-host/compose.yaml -p sj-compose up -d --wait");
    expect(up.run).toContain("curl -sf http://localhost:8081/health/ready");
    expect(stepNamed(image, /Stop the server/).run).toContain("docker compose -f self-host/compose.yaml -p sj-compose down -v || true");
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

  it("tries a push three times, since GHCR sometimes answers a layer upload with \"unknown blob\"", () => {
    const push = stepNamed(image, /Push this arch/).run ?? "";
    expect(push).toMatch(/for attempt in 1 2 3/);
    expect(push).toContain('docker push "$IMAGE:$VERSION-$ARCH" && exit 0');
    expect(push).toMatch(/exit 1\s*$/);
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
