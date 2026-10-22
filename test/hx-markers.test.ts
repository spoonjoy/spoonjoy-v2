import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A TODO(ouro-hx: …) marker names what will replace the code it sits on, and where that happens:
// the open Ouro HX issue the code waits on (ourostack/ouro-ui#N), or the Spoonjoy pull request in
// this stack that adopts an item the installed release already has (spoonjoy/spoonjoy-v2#N).
const MARKER = /TODO\(ouro-hx[^)]*\)/g;
const NAMED = /^TODO\(ouro-hx: [a-z0-9][a-z0-9 -]*(?:, [a-z0-9][a-z0-9 -]*)*, (?:ourostack\/ouro-ui|spoonjoy\/spoonjoy-v2)#\d+\)$/;
// The markers HX's installed folders carry are HX's own.
const HX_FOLDERS = ["app/components/ouro/", "app/lib/ouro/", "e2e/ouro/", "e2e/ouro-census/"];
const ROOTS = ["app", "e2e", "scripts", "stories", "test"];

function sourceFiles(dir: string): string[] {
  return readdirSync(resolve(process.cwd(), dir)).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(resolve(process.cwd(), path)).isDirectory()) return sourceFiles(path);
    return /\.(?:[cm]?[jt]sx?|css)$/.test(entry) ? [path] : [];
  });
}

export function markerProblems(file: string, source: string): string[] {
  return source.split("\n").flatMap((line, index) => [...line.matchAll(MARKER)].flatMap(([marker]) => {
    const problems: string[] = [];
    if (!NAMED.test(marker)) problems.push(`${file}:${index + 1} ${marker} names no issue or pull request`);
    if (/once (?:it|they|that) ships?/.test(line)) problems.push(`${file}:${index + 1} waits for an item the release already has`);
    return problems;
  }));
}

describe("TODO(ouro-hx) markers", () => {
  it("name the open HX issue or the stack pull request behind them, and never wait for a shipped item", () => {
    const problems = ROOTS.flatMap(sourceFiles)
      .filter((file) => !HX_FOLDERS.some((folder) => file.startsWith(folder)))
      .filter((file) => file !== "test/hx-markers.test.ts")
      .flatMap((file) => markerProblems(file, readFileSync(resolve(process.cwd(), file), "utf8")));
    expect(problems).toEqual([]);
  });

  it("accepts an issue or a pull request, and refuses a bare item or one that waits for a release", () => {
    expect(markerProblems("a.tsx", "// TODO(ouro-hx: tabs, ourostack/ouro-ui#128): Tabs over links.")).toEqual([]);
    expect(markerProblems("a.tsx", "// TODO(ouro-hx: tab-bar, spoonjoy/spoonjoy-v2#563): Adopted there.")).toEqual([]);
    expect(markerProblems("a.tsx", "// TODO(ouro-hx: item description, ourostack/ouro-ui#183): Described links.")).toEqual([]);
    expect(markerProblems("a.tsx", "// TODO(ouro-hx: tab-bar): The tab bar.")).toHaveLength(1);
    expect(markerProblems("a.tsx", "// TODO(ouro-hx: tabs link mode): Tabs over links.")).toHaveLength(1);
    expect(markerProblems("a.tsx", "// TODO(ouro-hx: tab-bar, ourostack/ouro-ui#121): HX's tab bar once it ships.")).toHaveLength(1);
  });
});
