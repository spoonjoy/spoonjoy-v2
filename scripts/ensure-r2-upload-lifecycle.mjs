#!/usr/bin/env node
// Makes sure an R2 bucket aborts unfinished move-in uploads within a day:
//
//   node scripts/retry-cloudflare.mjs -- node scripts/ensure-r2-upload-lifecycle.mjs spoonjoy-photos
//   node scripts/ensure-r2-upload-lifecycle.mjs spoonjoy-photos-qa --check
//
// A move-in backup goes to R2 as a multipart upload under pending-uploads/move-in/
// (app/domains/move-in/adapters/worker/backup-upload.server.ts). The app aborts the uploads it
// knows about, but one it loses track of keeps its parts until a lifecycle rule aborts it, and
// R2's default rule waits 7 days. The script reads the bucket's rules with `wrangler r2 bucket
// lifecycle list`. If no enabled rule covering that prefix aborts unfinished uploads within a day,
// it adds one with `wrangler r2 bucket lifecycle add`. With --check it only says what it would do.
// It logs rule counts and ids, never a rule's other settings.
//
// Running it again changes nothing once the rule is there. If a rule with the same id is there
// but no longer aborts within a day, someone changed it on purpose, so the script fails rather
// than undo that. Wrangler's error output passes through to stderr, so retry-cloudflare.mjs can
// tell a failure on Cloudflare's side, which it runs again, from a refusal such as a token
// without R2 rights, which fails at once.
import { execFile as nodeExecFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify, stripVTControlCharacters } from "node:util";

export const MOVE_IN_UPLOAD_PREFIX = "pending-uploads/move-in/";
export const MOVE_IN_UPLOAD_RULE_ID = "move-in-upload-abort";
export const ABORT_WITHIN_DAYS = 1;

// Parses `wrangler r2 bucket lifecycle list` output: one block of "label: value" lines per rule,
// with blank lines between the blocks (wrangler 4's tableFromLifecycleRulesResponse).
export function parseLifecycleRules(output) {
  const text = stripVTControlCharacters(output);
  if (/There are no lifecycle rules for bucket/.test(text)) return [];
  const rules = [];
  for (const block of text.split(/\n\s*\n/)) {
    const fields = {};
    for (const line of block.split("\n")) {
      const field = line.match(/^\s*(name|enabled|prefix|action):\s+(.*?)\s*$/);
      if (field) fields[field[1]] = field[2];
    }
    if (fields.name === undefined) continue;
    const abort = fields.action?.match(/Abort incomplete multipart uploads after (\d+(?:\.\d+)?) days/);
    rules.push({
      id: fields.name,
      enabled: fields.enabled === "Yes",
      prefix: fields.prefix === "(all prefixes)" ? "" : (fields.prefix ?? ""),
      abortDays: abort ? Number(abort[1]) : null,
    });
  }
  if (rules.length === 0) throw new Error("wrangler r2 bucket lifecycle list printed no rules in a form this script reads.");
  return rules;
}

export function abortsMoveInUploads(rule) {
  return rule.enabled &&
    MOVE_IN_UPLOAD_PREFIX.startsWith(rule.prefix) &&
    rule.abortDays !== null &&
    rule.abortDays <= ABORT_WITHIN_DAYS;
}

// What to do about a bucket with these rules: "keep" when a rule already aborts move-in uploads
// within a day, "add" when none does, and "refuse" when our own rule is there but changed.
export function lifecycleDecision(rules) {
  const covering = rules.filter(abortsMoveInUploads).map((rule) => rule.id);
  if (covering.length > 0) return { action: "keep", covering };
  if (rules.some((rule) => rule.id === MOVE_IN_UPLOAD_RULE_ID)) return { action: "refuse", covering };
  return { action: "add", covering };
}

export function listArgs(bucket) {
  return ["exec", "wrangler", "r2", "bucket", "lifecycle", "list", bucket];
}

export function addArgs(bucket) {
  return [
    "exec", "wrangler", "r2", "bucket", "lifecycle", "add", bucket, MOVE_IN_UPLOAD_RULE_ID, MOVE_IN_UPLOAD_PREFIX,
    "--abort-multipart-days", String(ABORT_WITHIN_DAYS), "--force",
  ];
}

export function parseArgs(argv) {
  const check = argv.includes("--check");
  const rest = argv.filter((arg) => arg !== "--check");
  if (rest.length !== 1 || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(rest[0])) {
    throw new Error("Usage: node scripts/ensure-r2-upload-lifecycle.mjs <bucket> [--check]");
  }
  return { bucket: rest[0], check };
}

/** The line of wrangler's error output that says what went wrong, such as "Authentication error [code: 10000]". */
export function errorSummary(text) {
  const lines = text.split("\n").map((line) => stripVTControlCharacters(line).trim()).filter(Boolean);
  return lines.find((line) => /\[code: \d+\]/.test(line)) ?? lines.find((line) => /\[ERROR\]/.test(line)) ?? lines[0] ?? "";
}

async function wrangler(exec, args, stderr) {
  try {
    return (await exec("pnpm", args, { maxBuffer: 1024 * 1024 })).stdout;
  } catch (error) {
    // Pass wrangler's error output on, for the log and for retry-cloudflare.mjs to classify. Its stdout is left out:
    // after an authentication error wrangler prints the token's account names and permissions there.
    const said = typeof error?.stderr === "string" ? error.stderr : "";
    if (said) stderr.write(said);
    const summary = errorSummary(said);
    throw new Error(`wrangler ${args.slice(2, 6).join(" ")} failed${summary ? `: ${summary}` : ""}`);
  }
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const {
    exec = promisify(nodeExecFile),
    log = console.log,
    stderr = process.stderr,
  } = deps;
  const { bucket, check } = parseArgs(argv);
  const rules = parseLifecycleRules(await wrangler(exec, listArgs(bucket), stderr));
  const ids = rules.map((rule) => rule.id).join(", ") || "none";
  log(`${bucket} has ${rules.length} lifecycle rule(s): ${ids}.`);
  const decision = lifecycleDecision(rules);
  if (decision.action === "keep") {
    log(`${decision.covering.join(", ")} already aborts unfinished uploads under ${MOVE_IN_UPLOAD_PREFIX} within ${ABORT_WITHIN_DAYS} day; nothing to change.`);
    return decision;
  }
  if (decision.action === "refuse") {
    throw new Error(`${bucket} has a rule named ${MOVE_IN_UPLOAD_RULE_ID} that no longer aborts unfinished uploads under ${MOVE_IN_UPLOAD_PREFIX} within ${ABORT_WITHIN_DAYS} day. Someone changed it, so it was left as it is.`);
  }
  if (check) {
    log(`No rule aborts unfinished uploads under ${MOVE_IN_UPLOAD_PREFIX} within ${ABORT_WITHIN_DAYS} day; without --check this adds ${MOVE_IN_UPLOAD_RULE_ID}.`);
    return decision;
  }
  await wrangler(exec, addArgs(bucket), stderr);
  log(`Added ${MOVE_IN_UPLOAD_RULE_ID} to ${bucket}: unfinished uploads under ${MOVE_IN_UPLOAD_PREFIX} are aborted after ${ABORT_WITHIN_DAYS} day.`);
  return decision;
}

export async function runCliIfEntry({
  moduleUrl = import.meta.url,
  argv1 = process.argv[1],
  runMain = () => main(),
  io = console,
  setExitCode = (code) => { process.exitCode = code; },
} = {}) {
  if (typeof argv1 !== "string" || moduleUrl !== pathToFileURL(argv1).href) return false;
  try {
    await runMain();
  } catch (error) {
    io.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    setExitCode(1);
  }
  return true;
}

await runCliIfEntry();
