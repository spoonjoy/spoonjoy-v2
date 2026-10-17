// Task21's real CLI runs only on an isolated Actions checkout, never inherited Mac providers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const acceptedHead = "8aeac43892cd99f9d3490b858c16dc693a52050e";
const tag = "v0.8.4";
const tagCommit = "636d72d39c7027a844f4645fbeca0594ec4f9c85";
// Hashes from the parent's qualified public manifest, not regenerated from local edits.
const expected = {
  "app/lib/ouro/testing/commands.touch.test.ts": "969a04f5612c72bde81b946320d8181bbf3bae54d8c816f20fd1b91955de5f65",
  "app/lib/ouro/testing/vitest.ts": "86ce4715db30baaeb5b058542df9de0adfe0bd09fcb366d7570a8194f8c5b4e2",
  "app/lib/ouro/dev.ts": "e502c37ed83132b21df88d2379f6f392dfa8483125e87ff44889f0865e340eb8",
  "app/lib/ouro/dev.test.ts": "d5cc5516d9b431afb88a1416e36495b62d18acd9d8ea921a9277e8138552b35a",
  "app/components/ouro/menu/menu.tsx": "1b9a76ab846b0f4bf2731432886e63a26978d1bd343312ec0f87c3ce4f8f466e",
  "app/components/ouro/menu/menu.test.tsx": "b5636ad57d89efe0d07b955f1438211a703f98105a2a79cae5feb2654823adc2",
  "app/components/ouro/swipe-actions/swipe-actions.touch.test.tsx": "a6cd3d782eb7c7d4fb229d4b7ccaa63fe3755a0e912d17a8a98869e575e626a4",
};
const expectedChanges = [
  "app/components/ouro/swipe-actions/swipe-actions.touch.test.tsx",
  "app/lib/ouro/dev.test.ts",
  "app/lib/ouro/dev.ts",
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const normalizedHash = (file) => sha(readFileSync(file, "utf8")
  .replaceAll("~/components/ouro/", "@/registry/ouro/components/ouro/")
  .replaceAll("~/lib/ouro/", "@/registry/ouro/lib/ouro/"));
const command = (name, args) => {
  const result = spawnSync(name, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, `${name} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};
const hashes = () => Object.fromEntries(Object.keys(expected).map((file) => [file, normalizedHash(file)]));
const mode = process.argv[2];
assert.equal(process.env.GITHUB_ACTIONS, "true", "CI-only: do not run against inherited local providers");

if (mode === "classify") {
  const current = hashes();
  const upgrade = Object.entries(expected).some(([file, hash]) => current[file] !== hash);
  appendFileSync(process.env.GITHUB_OUTPUT, `upgrade=${upgrade}\n`);
  console.log(JSON.stringify({ head: command("git", ["rev-parse", "HEAD"]).trim(), tag, upgrade, current }));
} else {
  assert.ok(mode === "upgrade" || mode === "binding");
  const directory = join(process.env.RUNNER_TEMP, mode === "upgrade" ? "task21-v084-cli" : "task21-v084-strict");
  mkdirSync(directory, { recursive: true });
  const receipt = {
    head: command("git", ["rev-parse", "HEAD"]).trim(),
    tree: command("git", ["rev-parse", "HEAD^{tree}"]).trim(),
    acceptedHead, tag, tagCommit, node: process.version,
    pnpm: command("pnpm", ["--version"]).trim(),
    packageSha256: sha(readFileSync("package.json")),
    lockSha256: sha(readFileSync("pnpm-lock.yaml")),
    before: hashes(),
  };
  writeFileSync(join(directory, "binding.json"), JSON.stringify(receipt, null, 2));
  if (mode === "upgrade") {
    assert.equal(command("git", ["status", "--porcelain"]), "");
    const protectedPaths = [
      "app", "test", "e2e", "package.json", "pnpm-lock.yaml", "components.json",
      "vitest.config.ts", "vitest.ouro.config.ts", "playwright.ouro.config.ts",
    ];
    assert.equal(command("git", ["diff", "--name-only", acceptedHead, "HEAD", "--", ...protectedPaths]), "",
      "Bootstrap must preserve the previously gated consumer source");
    const originalLock = readFileSync("pnpm-lock.yaml");
    const originalPackage = readFileSync("package.json");
    const items = ["swipe-actions-tests", "lib-dev-tests"]
      .map((item) => `ourostack/ouro-ui/${item}#${tag}`);
    const args = ["dlx", "shadcn@4.21.1", "add", ...items, "--yes", "--overwrite"];
    receipt.commands = [];
    for (const dryRun of [true, false]) {
      const argv = [...args, ...(dryRun ? ["--dry-run"] : [])];
      const result = spawnSync("pnpm", argv, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
      writeFileSync(join(directory, dryRun ? "cli-preview.log" : "cli-install.log"),
        `${result.stdout ?? ""}${result.stderr ?? ""}`);
      receipt.commands.push({ executable: "pnpm", args: argv, exitCode: result.status });
      writeFileSync(join(directory, "binding.json"), JSON.stringify(receipt, null, 2));
      assert.equal(result.status, 0, "Actual pinned shadcn command must succeed");
    }
    // PM mirror/integrity churn is evidence, never an equivalent replacement lock.
    const pmLock = readFileSync("pnpm-lock.yaml");
    writeFileSync(join(directory, "pm-produced-pnpm-lock.yaml"), pmLock);
    writeFileSync(join(directory, "pm-produced.diff"), command("git", ["diff", "--binary"]));
    receipt.pmLockSha256 = sha(pmLock);
    assert.deepEqual(readFileSync("package.json"), originalPackage, "Unexpected dependency-field mutation");
    writeFileSync("pnpm-lock.yaml", originalLock);
    assert.equal(sha(readFileSync("pnpm-lock.yaml")), receipt.lockSha256);
    assert.equal(command("git", ["ls-files", "--others", "--exclude-standard"]), "", "No unused new catalog files");
    const changed = command("git", ["diff", "--name-only"]).trim().split("\n").filter(Boolean).sort();
    assert.deepEqual(changed, expectedChanges, "Only three qualified installed paths may change");
    receipt.after = hashes();
    assert.deepEqual(receipt.after, expected, "CLI output must match the qualified public tag");
    const patch = command("git", ["diff", "--binary", "HEAD"]);
    receipt.generatedPatchSha256 = sha(patch);
    receipt.changedPaths = changed;
    writeFileSync(join(directory, "registry-generated.patch"), patch);
    writeFileSync(join(directory, "binding.json"), JSON.stringify(receipt, null, 2));
  } else {
    assert.deepEqual(receipt.before, expected, "Strict proof must consume the actual qualified CLI output");
  }
}
