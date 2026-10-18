// The readonly repair's real CLI runs only in Actions, never inherited Mac providers.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const acceptedHead = "2b0a6dffbe7ef4fa61e2fc8f7de4837b8775b706";
const tag = "v1.0.2";
const tagCommit = "22f0b72388250d475bf8a34c60f8a164a0c3e932";
// Hashes from the parent's qualified public manifest, not regenerated from local edits.
const expected = {
  "app/components/ouro/checkbox/checkbox-group.test-d.ts": "ea747fe60e8c5cde8c4f449701b0af3fd351d67fe04d11311e040d04f088405c",
  "app/components/ouro/checkbox/checkbox-group.tsx": "ae8063b0413905ca057b3da2d798238a38d43da329ac5a769ef4f54c954cbd88",
  "app/components/ouro/checkbox/checkbox.test-d.ts": "e261fb63263ce17fef5412a4efa079e354022d03093079d616c2bb7c41b3c959",
  "app/components/ouro/checkbox/checkbox.tsx": "236b756304e45538f2725c2e904b22283df91af311e9d7fa3111ca4aa435a00a",
  "app/components/ouro/combobox/combobox.test-d.ts": "54d61170cd76134a644b55b730ae855b27ce0e5341a73137d37aa2ce7d08f609",
  "app/components/ouro/combobox/combobox.tsx": "80cd97cc86800180f4b995b385bfcda94a351eca568b57624eeca6494433da42",
  "app/components/ouro/field/field.test-d.ts": "caafcb1194f284bf24334eb2716c78891365a54c8744318cd333345ae5c3c288",
  "app/components/ouro/field/field.tsx": "887f8f41820efa3fc7782e2bcc47884c9d6be0f01845042cf86b88a1a2f87558",
  "app/components/ouro/form/form.test-d.ts": "0d61c4621232a16de96ed262517cac2415d560197ed7d4662bff31c4d4b38739",
  "app/components/ouro/form/form.tsx": "be8dd189e666a7a2853334bbfdf0c1a0dcccba288206e07f4c5aba766028060c",
  "app/components/ouro/radio-group/radio-group.test-d.ts": "bb207eec8d6a7aa246b0a3a0296a54431e2c291a82e8e578bef99265ac531e44",
  "app/components/ouro/radio-group/radio-group.tsx": "7ba91819ebda573c2c4921c91b5b0020ff1ef42276d6e6517cb56daf239a0d6d",
  "app/components/ouro/select/native-select.test-d.ts": "0b896ec32a55394292c3e08bb9b33dc4db3accb32a92a06167aaa176580af516",
  "app/components/ouro/select/native-select.tsx": "b2ec9109ea81910eb1f265e2eb5c0335a42e826fe0155185c4dd2e92d79ccb8d",
  "app/components/ouro/select/select.test-d.ts": "77cb2461dad6946ff4b036d04ae835a018ee610e6171d8215262006b968e8f37",
  "app/components/ouro/select/select.tsx": "0abef3fd1403d98b0c5c13f137b3426eb650eb7717992465e1b82ae1aab99bbc",
  "app/components/ouro/switch/switch.test-d.ts": "6f16fada873f963fc46eec19fd9860fbbae513d82cd6c3e062fc1d2d3a0eb551",
  "app/components/ouro/switch/switch.tsx": "31d30d47bee434ae1084846fac79fcdddd3b2a58a16ae49c7be2eddd10da8efc",
  "app/components/ouro/text-field/text-area.test-d.ts": "c27ecba0eb1343294c426e31f8fb1245080faea6b25078fab462c6ddafe6edf1",
  "app/components/ouro/text-field/text-area.tsx": "a009026a8e14467cad1485bb9e225e4feb53d4478e7df730942186291ec8b8f8",
  "app/components/ouro/text-field/text-field.test-d.ts": "f8f49dc6539cb6f234321f0979431863a3b840b53ed12f7248c242db37079ed2",
  "app/components/ouro/text-field/text-field.tsx": "7fb200fffa7ad01b52e699dea65530168f2490152e1b3c91261332327c212af6",
  "app/lib/ouro/dev.test.ts": "94f4ab823bb7d1fe60bdd3d84b8120140406d63a6ce60071ce73b380f881cefa",
  "app/lib/ouro/dev.ts": "7f320bdb0d05dd0dc097cd79574a947138e7a0e3a19e81021dc75c415dab630d",
  "app/lib/ouro/form-answer.test.ts": "60a4254b4e4c0661594b966f2b7e74faf4a91a6a7eff5006433b5c441a53c26d",
  "app/lib/ouro/form-answer.ts": "b0a40e58765ff860c3767c90658243b11a813869c2f1f0ef15ee128f6a7dcca7",
  "app/lib/ouro/use-field.ts": "d1c1a06cb5c96a53b5d06474bc24b69863c70777ff952d4ba2277d65da28807c",
};
const expectedChanges = Object.keys(expected).sort();
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
  const directory = join(process.env.RUNNER_TEMP, mode === "upgrade" ? "task24-v102-cli" : "task24-v102-strict");
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
    const items = [
      "checkbox", "checkbox-group", "checkbox-group-tests", "checkbox-tests",
      "combobox", "combobox-tests", "field", "field-tests", "form", "form-tests",
      "lib-dev", "lib-dev-tests", "lib-form-answer", "lib-form-answer-tests",
      "lib-use-field", "native-select", "native-select-tests", "radio-group",
      "radio-group-tests", "select", "select-tests", "switch", "switch-tests",
      "text-area", "text-area-tests", "text-field", "text-field-tests",
    ]
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
    assert.deepEqual(changed, expectedChanges, "Only the 27 qualified installed paths may change");
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
