import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const [outputDir] = process.argv.slice(2);
if (!outputDir) throw new Error("Expected an output directory.");

const fixtureDir = path.resolve("test/fixtures/product-cutover");
const repoDir = path.resolve(outputDir);
await rm(repoDir, { recursive: true, force: true });
await mkdir(repoDir, { recursive: true });

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_EMAIL: "release-topology@spoonjoy.test",
  GIT_AUTHOR_NAME: "Spoonjoy Release Topology",
  GIT_COMMITTER_EMAIL: "release-topology@spoonjoy.test",
  GIT_COMMITTER_NAME: "Spoonjoy Release Topology",
  GIT_CONFIG_NOSYSTEM: "1",
  TZ: "UTC",
};
const runGit = (args, options = {}) => execFileSync("git", args, {
  cwd: repoDir,
  encoding: "utf8",
  env: gitEnv,
  ...options,
}).trim();
const writeRepoFile = async (relativePath, contents) => {
  const destination = path.join(repoDir, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents, "utf8");
};
const copyFixture = async (fixtureName, relativePath) => {
  const destination = path.join(repoDir, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(fixtureDir, fixtureName), destination);
};
const workflow = (mode) => `name: release-topology\nenv:\n  SPOONJOY_RELEASE_MODE: ${mode}\n`;
let timestampIndex = 0;
const commit = (message, allowEmpty = false) => {
  runGit(["add", "--all"]);
  const minute = String(timestampIndex).padStart(2, "0");
  timestampIndex += 1;
  const env = {
    ...gitEnv,
    GIT_AUTHOR_DATE: `2000-01-01T00:${minute}:00Z`,
    GIT_COMMITTER_DATE: `2000-01-01T00:${minute}:00Z`,
  };
  const args = ["-c", "commit.gpgsign=false", "commit", "-m", message];
  if (allowEmpty) args.push("--allow-empty");
  execFileSync("git", args, { cwd: repoDir, env, stdio: "ignore" });
  return runGit(["rev-parse", "HEAD"]);
};

runGit(["init", "--initial-branch=main"]);
runGit(["config", "user.name", gitEnv.GIT_AUTHOR_NAME]);
runGit(["config", "user.email", gitEnv.GIT_AUTHOR_EMAIL]);

await copyFixture("exact-40b8f4c8-compatibility-worker.ts", "workers/app.ts");
await copyFixture("exact-40b8f4c8-durable-object.ts", "workers/cook-session.ts");
await writeRepoFile(".github/workflows/production-deploy.yml", workflow("atomic-bootstrap"));
await writeRepoFile("evidence/release-topology", "compatibility\n");
const compatibility = commit("compatibility runtime");

await copyFixture("exact-8ec4cb1d-product-worker.ts", "workers/app.ts");
await copyFixture("exact-8ec4cb1d-product-durable-object.ts", "workers/cook-session.ts");
await writeRepoFile(
  ".github/workflows/production-deploy.yml",
  workflow("atomic-product-activation"),
);
await writeRepoFile("evidence/release-topology", "exact product runtime\n");
const productTarget = commit("exact product runtime snapshot");

await copyFixture("topology-product-worker-v1.ts", "workers/app.ts");
await copyFixture("topology-product-durable-object-v1.ts", "workers/cook-session.ts");
await writeRepoFile("workers/cook-session-protocol-v1-boundary", "protocol-v1\n");
await writeRepoFile("evidence/release-topology", "protocol boundary\n");
const protocolBoundary = commit("introduce protocol-v1 runtime boundary");

await writeRepoFile("evidence/release-topology", "accepted product floor\n");
const runtimeFloor = commit("accept product runtime floor");

runGit(["switch", "--create", "qa-alias", runtimeFloor]);
const qaAlias = commit("qa byte-identical alias", true);

runGit(["switch", "--create", "ordinary-worker", runtimeFloor]);
await copyFixture("topology-worker-v2.ts", "workers/app.ts");
const ordinaryWorkerRepair = commit("ordinary Worker repair");

runGit(["switch", "--create", "ordinary-do", runtimeFloor]);
await copyFixture("topology-durable-object-v2.ts", "workers/cook-session.ts");
const ordinaryDoRepair = commit("ordinary Durable Object repair");

runGit(["switch", "--create", "ordinary-both", runtimeFloor]);
await copyFixture("topology-worker-v2.ts", "workers/app.ts");
await copyFixture("topology-durable-object-v2.ts", "workers/cook-session.ts");
const ordinaryBothRepair = commit("ordinary Worker and Durable Object repair");

runGit(["switch", "--create", "post-restoration", runtimeFloor]);
await copyFixture("topology-worker-v2.ts", "workers/app.ts");
await copyFixture("topology-durable-object-v2.ts", "workers/cook-session.ts");
await writeRepoFile(
  ".github/workflows/production-deploy.yml",
  workflow("protocol-v1-canary"),
);
await writeRepoFile("evidence/release-topology", "failed restoration\n");
const failedRestoration = commit("failed protocol restoration");

runGit(["switch", "--create", "post-worker", failedRestoration]);
await copyFixture("topology-product-worker-v1.ts", "workers/app.ts");
await writeRepoFile(
  ".github/workflows/production-deploy.yml",
  workflow("atomic-product-activation"),
);
await writeRepoFile("evidence/release-topology", "post-restoration Worker repair\n");
const postRestorationWorkerRepair = commit("post-restoration Worker repair");

runGit(["switch", "--create", "post-both", failedRestoration]);
await writeRepoFile(
  ".github/workflows/production-deploy.yml",
  workflow("atomic-product-activation"),
);
await writeRepoFile("evidence/release-topology", "post-restoration combined repair\n");
const postRestorationBothRepair = commit("post-restoration combined repair");

runGit(["switch", "post-restoration"]);
await copyFixture("topology-product-durable-object-v1.ts", "workers/cook-session.ts");
await writeRepoFile(
  ".github/workflows/production-deploy.yml",
  workflow("atomic-product-activation"),
);
await writeRepoFile("evidence/release-topology", "post-restoration repair\n");
const postRestorationRepair = commit("post-restoration product repair");

await writeRepoFile("evidence/release-topology", "failed post-restoration repair\n");
const failedPostRestorationRepair = commit("failed post-restoration repair evidence");

runGit(["switch", "--create", "qa-post-alias", failedPostRestorationRepair]);
const qaPostAlias = commit("qa post-restoration byte-identical alias", true);

runGit(["switch", "post-restoration"]);
await copyFixture("topology-product-worker-v1.ts", "workers/app.ts");
await writeRepoFile("evidence/release-topology", "next post-restoration repair\n");
const nextPostRestorationRepair = commit("next post-restoration repair evidence");

const identities = {
  compatibility,
  failedPostRestorationRepair,
  failedRestoration,
  nextPostRestorationRepair,
  ordinaryBothRepair,
  ordinaryDoRepair,
  ordinaryWorkerRepair,
  postRestorationBothRepair,
  postRestorationRepair,
  postRestorationWorkerRepair,
  protocolBoundary,
  productTarget,
  qaAlias,
  qaPostAlias,
  runtimeFloor,
};
const records = {};
for (const [name, sourceSha] of Object.entries(identities)) {
  const parentLine = runGit(["rev-list", "--parents", "-n", "1", sourceSha]).split(" ");
  const workflowSource = runGit([
    "show",
    `${sourceSha}:.github/workflows/production-deploy.yml`,
  ]);
  const changedPaths = parentLine.length === 1
    ? []
    : runGit(["diff", "--name-only", `${parentLine[1]}..${sourceSha}`])
        .split("\n")
        .filter(Boolean);
  let descendsFromRuntimeFloor = false;
  try {
    runGit(["merge-base", "--is-ancestor", runtimeFloor, sourceSha]);
    descendsFromRuntimeFloor = true;
  } catch {
    // Pre-floor records have no floor-relative diff.
  }
  let protocolBoundaryBlobOid = null;
  try {
    protocolBoundaryBlobOid = runGit([
      "rev-parse",
      `${sourceSha}:workers/cook-session-protocol-v1-boundary`,
    ]);
  } catch {
    // Compatibility and the exact product snapshot predate the marker.
  }
  records[name] = {
    changedPaths,
    durableObjectBlobOid: runGit(["rev-parse", `${sourceSha}:workers/cook-session.ts`]),
    firstParentSha: parentLine[1] ?? null,
    mode: workflowSource.match(/SPOONJOY_RELEASE_MODE: ([^\s]+)/)?.[1] ?? null,
    protocolBoundaryBlobOid,
    runtimeFloorChangedPaths: descendsFromRuntimeFloor
      ? runGit(["diff", "--name-only", `${runtimeFloor}...${sourceSha}`])
          .split("\n")
          .filter(Boolean)
      : null,
    sourceSha,
    treeSha: runGit(["rev-parse", `${sourceSha}^{tree}`]),
    workerBlobOid: runGit(["rev-parse", `${sourceSha}:workers/app.ts`]),
  };
}

process.stdout.write(`${JSON.stringify(records, null, 2)}\n`);
