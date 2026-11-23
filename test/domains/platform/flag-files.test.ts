import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { FLAGS, FLAG_NAMES, isFlagOn } from "~/domains/platform";

const FOLDER = join(process.cwd(), "app/domains/platform/flags/flags");
const files = readdirSync(FOLDER).filter((file) => file.endsWith(".ts"));

describe("flag files", () => {
  it("declare exactly one flag each, named after the file", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const name = basename(file, ".ts");
      const source = readFileSync(join(FOLDER, file), "utf8");
      expect(source.match(/defineFlag\(/g), file).toHaveLength(1);
      expect(source, file).toContain(`defineFlag(${JSON.stringify(name)},`);
      expect([...source.matchAll(/^\s*"?([\w-]+)"?: true;?\s*$/gm)].map((match) => match[1]), file).toEqual([name]);
    }
  });

  it("are the whole list of flags", () => {
    expect(FLAG_NAMES).toEqual(files.map((file) => basename(file, ".ts")).sort());
    for (const name of FLAG_NAMES) expect(FLAGS[name].description.trim()).not.toBe("");
  });

  it("keep flag names typed", () => {
    // @ts-expect-error a name no file declares is a type error, not a silently-off flag.
    expect(isFlagOn("no-such-flag", { SPOONJOY_FLAGS: "all" }, null)).toBe(false);
  });
});
