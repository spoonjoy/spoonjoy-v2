import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { collectFlags } from "~/domains/platform/flags/collect-flags";

const FLAG_FILES = readdirSync(join(process.cwd(), "app/domains/platform/flags/flags"))
  .filter((file) => file.endsWith(".ts"))
  .map((file) => basename(file, ".ts"))
  .sort();

function notUnderVite(): never {
  throw new TypeError("(intermediate value).glob is not a function");
}

describe("collectFlags", () => {
  it("finds every flag file when a plain Node script imports the flags, as the MCP bridge does under tsx", () => {
    const output = execFileSync(
      join(process.cwd(), "node_modules/.bin/tsx"),
      ["--eval", 'import { FLAG_NAMES } from "~/domains/platform"; console.log(JSON.stringify(FLAG_NAMES));'],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(JSON.parse(output.trim().split("\n").at(-1) ?? "")).toEqual(FLAG_FILES);
  }, 60_000);

  it("reads the ./flags folder with require when import.meta.glob is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "collect-flags-"));
    mkdirSync(join(root, "flags"));
    writeFileSync(join(root, "flags", "b-flag.ts"), 'exports.default = { name: "b-flag", description: "Second." };\n');
    writeFileSync(join(root, "flags", "a_flag.ts"), 'exports.default = { name: "a_flag", description: "First." };\n');
    writeFileSync(join(root, "flags", "README.md"), "Not a flag.\n");

    expect(collectFlags(notUnderVite, pathToFileURL(join(root, "flags.ts")).href)).toEqual({
      a_flag: { description: "First." },
      "b-flag": { description: "Second." },
    });
  });

  it("uses the glob's files when it runs", () => {
    const glob = () => ({ "./flags/x.ts": { name: "x", description: "X." } });
    expect(collectFlags(glob, "file:///nowhere/flags.ts")).toEqual({ x: { description: "X." } });
  });

  it("lets any other error from the glob through", () => {
    const glob = () => {
      throw new Error("broken flag file");
    };
    expect(() => collectFlags(glob, "file:///nowhere/flags.ts")).toThrow("broken flag file");
  });
});
