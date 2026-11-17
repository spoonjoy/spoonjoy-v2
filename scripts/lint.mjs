import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// oxlint (.oxlintrc.json) over the whole repo, held to oxlint.baseline.json: per file and rule,
// the number of hits must equal the baseline. New code adds none; after fixing old ones, lower
// the baseline with `pnpm lint --write-baseline`. A stale eslint-disable comment counts as a hit.
// With --base <ref> (pull requests), no rule's total may rise above that commit's baseline, so a
// pull request cannot raise the baseline to let its own hits in; a moved file keeps its totals.
//
//   node scripts/lint.mjs [--write-baseline] [--base <ref>]

const BASELINE = "oxlint.baseline.json";
const UNUSED_DIRECTIVE = /^Unused (?:eslint|oxlint)-disable directive/;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function ruleOf(diagnostic) {
  return diagnostic.code ?? (UNUSED_DIRECTIVE.test(diagnostic.message) ? "unused-disable-directive" : "oxlint");
}

export function countHits(diagnostics) {
  const counts = {};
  for (const d of diagnostics) {
    const rule = ruleOf(d);
    counts[d.filename] ??= {};
    counts[d.filename][rule] = (counts[d.filename][rule] ?? 0) + 1;
  }
  return sortKeys(Object.fromEntries(Object.entries(counts).map(([file, rules]) => [file, sortKeys(rules)])));
}

// Each file and rule whose count differs from the baseline, as { file, rule, baseline, now }.
export function compare(baseline, current) {
  const changes = [];
  for (const file of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    const was = baseline[file] ?? {};
    const now = current[file] ?? {};
    for (const rule of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if ((was[rule] ?? 0) !== (now[rule] ?? 0)) changes.push({ file, rule, baseline: was[rule] ?? 0, now: now[rule] ?? 0 });
    }
  }
  return changes.sort((a, b) => byCodeUnit(a.file, b.file) || byCodeUnit(a.rule, b.rule));
}

// Each rule whose total across the repo rose from one baseline to the next, as { rule, base, now }.
export function rises(base, next) {
  const totals = (counts) => {
    const sums = {};
    for (const rules of Object.values(counts)) for (const [rule, n] of Object.entries(rules)) sums[rule] = (sums[rule] ?? 0) + n;
    return sums;
  };
  const was = totals(base);
  return Object.entries(totals(next))
    .filter(([rule, n]) => n > (was[rule] ?? 0))
    .map(([rule, n]) => ({ rule, base: was[rule] ?? 0, now: n }))
    .sort((a, b) => byCodeUnit(a.rule, b.rule));
}

function sortKeys(object) {
  return Object.fromEntries(Object.entries(object).sort(([a], [b]) => byCodeUnit(a, b)));
}

function main(args) {
  const result = spawnSync("node_modules/.bin/oxlint", ["--format", "json", "--report-unused-disable-directives"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const { diagnostics } = JSON.parse(result.stdout);
  const current = countHits(diagnostics);

  if (args.includes("--write-baseline")) {
    writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`lint: wrote ${BASELINE} (${diagnostics.length} hits)`);
    return 0;
  }

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  let failed = false;
  const baseRef = args.includes("--base") ? args[args.indexOf("--base") + 1] : undefined;
  if (baseRef) {
    const base = spawnSync("git", ["show", `${baseRef}:${BASELINE}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    // A base without a baseline is the commit that adds the linter: nothing to ratchet against.
    if (base.status !== 0 && !/does not exist|exists on disk, but not in/.test(base.stderr)) throw new Error(base.stderr);
    for (const { rule, base: was, now } of base.status === 0 ? rises(JSON.parse(base.stdout), baseline) : []) {
      failed = true;
      console.error(`${BASELINE}: ${rule} rose from ${was} to ${now} against ${baseRef}. Fix the new hits instead of baselining them.`);
    }
  }

  for (const { file, rule, baseline: was, now } of compare(baseline, current)) {
    failed = true;
    if (now < was) {
      console.error(`${file}: ${rule} fell from ${was} to ${now}. Lower the baseline: pnpm lint --write-baseline`);
      continue;
    }
    console.error(`${file}: ${rule} rose from ${was} to ${now}. Fix the new hit:`);
    for (const d of diagnostics) {
      if (d.filename !== file || ruleOf(d) !== rule) continue;
      const { line, column } = d.labels?.[0]?.span ?? {};
      console.error(`  ${file}:${line}:${column} ${d.message}${d.help ? ` ${d.help}` : ""}`);
    }
  }
  if (failed) return 1;
  console.log(`lint: ${diagnostics.length} hits, all in ${BASELINE}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
