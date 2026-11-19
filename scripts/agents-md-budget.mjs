#!/usr/bin/env node
// Holds a repository's always-loaded agent instructions to a byte budget, so they can only shrink unless a pull request
// raises the budget on purpose. Copy this file into any repository (it needs only Node 18+) and run it in CI:
//
//   node agents-md-budget.mjs           fail when an instruction file is over its budget, or has none
//   node agents-md-budget.mjs --set     write today's sizes as the budgets (to start, or to tighten after a cut)
//
// It reads AGENTS.md, CLAUDE.md, GEMINI.md and .github/copilot-instructions.md where they exist, and the budgets from
// .github/agents-md-budget.json ({ "AGENTS.md": 12345 }). Run it from the repository root, or pass --root <dir>.
// A file over budget fails with the fix: turn a rule into a check, or delete one. Raising a budget is a choice the pull
// request states, with its reason, by running --set; nothing raises one by itself.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

export const FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md"]
export const BUDGET_FILE = ".github/agents-md-budget.json"
const FIX = "Turn a rule into a check whose error names the fix, or delete a rule nothing could fail on (https://github.com/ourostack/.github/blob/main/agents/eng-system.md, step 2)."

/** Each instruction file's size against its budget: { file, bytes, budget, verdict } with verdict over, missing, under or at. */
export function judge(sizes, budgets) {
  return Object.entries(sizes).map(([file, bytes]) => {
    const budget = budgets[file]
    if (typeof budget !== "number") return { file, bytes, budget: null, verdict: "missing" }
    return { file, bytes, budget, verdict: bytes > budget ? "over" : bytes < budget ? "under" : "at" }
  })
}

/** The lines to print, and whether the check failed. */
export function report(results) {
  const lines = results.map(({ file, bytes, budget, verdict }) => {
    if (verdict === "missing") return `${file}: ${bytes} B and no budget. Add one with --set.`
    if (verdict === "over") return `${file}: ${bytes} B, ${bytes - budget} B over its ${budget} B budget. ${FIX} To raise the budget instead, run --set and say why in the pull request.`
    if (verdict === "under") return `${file}: ${bytes} of ${budget} B. Lock in the cut with --set.`
    return `${file}: ${bytes} B, at its budget.`
  })
  return { lines, failed: results.some((result) => result.verdict === "over" || result.verdict === "missing") }
}

function sizesIn(root) {
  const sizes = {}
  for (const file of FILES) if (existsSync(join(root, file))) sizes[file] = statSync(join(root, file)).size
  return sizes
}

export function main(argv, { log = console.log } = {}) {
  const root = argv.includes("--root") ? argv[argv.indexOf("--root") + 1] : process.cwd()
  const sizes = sizesIn(root)
  const path = join(root, BUDGET_FILE)
  if (argv.includes("--set")) {
    writeFileSync(path, `${JSON.stringify(sizes, null, 2)}\n`)
    log(`Wrote ${BUDGET_FILE}: ${Object.entries(sizes).map(([file, bytes]) => `${file} ${bytes} B`).join(", ") || "no instruction files"}.`)
    return 0
  }
  const budgets = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
  const { lines, failed } = report(judge(sizes, budgets))
  for (const line of lines) log(line)
  return failed ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = main(process.argv.slice(2))
