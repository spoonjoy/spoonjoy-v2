#!/usr/bin/env node
// node scripts/move-in-proof/manifest-cli.mjs write <file> [--sizes small,large]
//   writes the manifest.
// node scripts/move-in-proof/manifest-cli.mjs check <dir>
//   checks <dir>/manifest.json against every <dir>/<source>/<size>/fixture.json, prints a counts
//   table (also to the job summary), and exits 1 on any problem.
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildManifest, checkFixtures, manifestJson } from "./manifest.mjs";

function readFixtures(dir) {
  const fixtures = [];
  for (const version of readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    for (const size of readdirSync(path.join(dir, version.name), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      const file = path.join(dir, version.name, size.name, "fixture.json");
      if (existsSync(file)) fixtures.push(JSON.parse(readFileSync(file, "utf8")));
    }
  }
  return fixtures;
}

function summary(manifest, fixtures) {
  const columns = fixtures.map((fixture) => `${fixture.version} ${fixture.size}`);
  const lines = [
    "## Move-in proof fixtures",
    "",
    `| Count | ${columns.join(" | ")} |`,
    `| --- | ${columns.map(() => "---").join(" | ")} |`,
  ];
  const flat = (counts, prefix = "") =>
    Object.entries(counts).flatMap(([key, value]) => (value && typeof value === "object" ? flat(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]]));
  const names = [...new Set(Object.values(manifest.kitchens).flatMap((kitchen) => flat(kitchen.counts).map(([key]) => key)))].sort();
  for (const name of names) {
    const cells = fixtures.map((fixture) => {
      const expected = flat(manifest.kitchens[fixture.size]?.counts ?? {}).find(([key]) => key === name)?.[1];
      const observed = flat(fixture.observed).find(([key]) => key === name)?.[1];
      if (expected === undefined && observed === undefined) return "-";
      return observed === expected ? String(observed) : `**${observed} (expected ${expected})**`;
    });
    lines.push(`| ${name} | ${cells.join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}

const [command, target, ...rest] = process.argv.slice(2);
const { values } = parseArgs({ args: rest, options: { sizes: { type: "string", default: "small,large" } } });
if (command === "write" && target) {
  writeFileSync(target, manifestJson(buildManifest({ sizes: values.sizes.split(",") })));
} else if (command === "check" && target) {
  const manifest = JSON.parse(readFileSync(path.join(target, "manifest.json"), "utf8"));
  const fixtures = readFixtures(target).sort((a, b) => `${a.size}${a.version}`.localeCompare(`${b.size}${b.version}`));
  const table = summary(manifest, fixtures);
  console.log(table);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
  const problems = checkFixtures(manifest, fixtures);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exitCode = 1;
} else {
  console.error("Usage: manifest-cli.mjs write <file> [--sizes small,large] | check <dir>");
  process.exitCode = 2;
}
