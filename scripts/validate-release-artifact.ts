import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  assertReleaseArtifactLifecycle,
  validateProductCutoverStateFile,
  type ReleaseArtifact,
} from "./deploy-production-canary";

function requireOption(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index < 0 ? undefined : argv[index + 1];
  if (!value || value.startsWith("--") || argv.indexOf(name, index + 1) >= 0) {
    throw new Error(`Release artifact validator requires one ${name}.`);
  }
  return value;
}

export async function validateReleaseArtifactCli(argv: readonly string[]): Promise<void> {
  const allowed = new Set([
    "--kind", "--file", "--source-sha", "--expected-mode", "--state-file",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    if (!allowed.has(argv[index]) || !argv[index + 1] || argv[index + 1].startsWith("--")) {
      throw new Error("Release artifact validator options are invalid.");
    }
  }
  const kind = requireOption(argv, "--kind");
  const filePath = requireOption(argv, "--file");
  if (kind === "product-cutover-state") {
    if (argv.length !== 4) throw new Error("Product cutover state options are invalid.");
    await validateProductCutoverStateFile(filePath, "production");
    return;
  }
  if (kind !== "production-release" || (argv.length !== 8 && argv.length !== 10)) {
    throw new Error("Release artifact validator kind is invalid.");
  }
  const expectedSourceSha = requireOption(argv, "--source-sha");
  const expectedReleaseMode = requireOption(argv, "--expected-mode");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    throw new Error("Production release artifact is not valid JSON.");
  }
  assertReleaseArtifactLifecycle(parsed as ReleaseArtifact);
  const artifact = parsed as ReleaseArtifact;
  if (artifact.sourceSha !== expectedSourceSha || artifact.releaseMode !== expectedReleaseMode) {
    throw new Error("Production release artifact identity does not match the workflow.");
  }
  const stateOptionPresent = argv.includes("--state-file");
  if (expectedReleaseMode === "atomic-product-activation") {
    if (!stateOptionPresent) {
      throw new Error("Production product release requires durable cutover state.");
    }
    const state = await validateProductCutoverStateFile(
      requireOption(argv, "--state-file"),
      "production",
    );
    if (!isDeepStrictEqual(state, artifact.cutover)) {
      throw new Error("Production product release and durable cutover state differ.");
    }
  } else if (stateOptionPresent) {
    throw new Error("Non-product release cannot bind product cutover state.");
  }
}

/* istanbul ignore if -- @preserve the CLI boundary delegates to the tested validator. */
if (import.meta.url === `file://${process.argv[1]}`) {
  validateReleaseArtifactCli(process.argv.slice(2)).catch(() => {
    console.error("Release artifact validation failed.");
    process.exitCode = 1;
  });
}
