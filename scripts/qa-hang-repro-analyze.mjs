#!/usr/bin/env node
// Reduces one QA Hang Repro phase to counts, and compares the variants against the baseline.
//
//   analyze <label> <phase> <tailEvents.ndjson> <requests.ndjson> <sinceMs> <untilMs> <out.json>
//     Counts, for one variant and one phase: the client's requests (statuses, aborts, requests
//     with no response, wall time of the requests that were not aborted) and the Worker tail's
//     invocations in [sinceMs, untilMs) (outcomes, "code had hung" exceptions, other exceptions by
//     a fixed class, and invocations that ran over 30 s). Client 5xx responses are matched to
//     tail invocations by Cloudflare ray id. The output holds counts, routes and timings only:
//     no header, cookie, body, URL query or exception text is copied.
//   report <resultsDir> <variants.tsv> <out.md> <out.json>
//     Applies the decision rule to every <label>.<phase>.analysis.json and writes a Markdown
//     table and a verdict. A variant wins when, in every phase, it has no hung invocation, no
//     hung 1101 page, no request without a response, and a wall p95 no more than 1.5 times the
//     baseline's p95 in the same phase. The baseline is the first row of variants.tsv.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const HUNG = /had hung|would never generate a response/;
export const STALL_MS = 30_000;
export const P95_LIMIT = 1.5;

const EXCEPTION_CLASSES = [
  ["hung", HUNG],
  ["invalidArrayBufferLength", /Invalid array buffer length/i],
  ["memoryAccessOutOfBounds", /memory access out of bounds/i],
  ["unreachable", /\bunreachable\b/i],
  ["exceededResources", /exceeded (cpu|memory)|Worker exceeded resource limits/i],
];

export function exceptionClass(message) {
  const match = EXCEPTION_CLASSES.find(([, pattern]) => pattern.test(message ?? ""));
  return match ? match[0] : "other";
}

export function percentile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1)))];
}

function tally(counter, key) {
  counter[key] = (counter[key] ?? 0) + 1;
}

export function routeOf(url) {
  return String(url ?? "")
    .replace(/^https?:\/\/[^/]+/, "")
    .split("?", 1)[0]
    .replace(/\/users\/[^/.]+/, "/users/:id")
    .replace(/\/recipes\/[^/.]+/, "/recipes/:id")
    .replace(/\/api\/cook-sessions\/[^/]+/, "/api/cook-sessions/:id");
}

function rayOf(value) {
  return String(value ?? "").split("-", 1)[0];
}

export function parseLines(text) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

export function analyzeTail(events, sinceMs, untilMs) {
  const rows = events
    .filter((event) => event && typeof event === "object" && "outcome" in event)
    .filter((event) => (event.eventTimestamp ?? 0) >= sinceMs && (event.eventTimestamp ?? 0) < untilMs)
    .map((event) => {
      const request = event.event?.request ?? {};
      const classes = (event.exceptions ?? []).map((exception) => exceptionClass(exception?.message));
      return {
        outcome: event.outcome,
        cpu: event.cpuTime ?? 0,
        wall: event.wallTime ?? 0,
        route: `${request.method ?? "?"} ${routeOf(request.url)}`,
        ray: rayOf(request.headers?.["cf-ray"]),
        cls: classes.includes("hung") ? "hung" : (classes[0] ?? null),
      };
    });
  const outcomes = {};
  const exceptions = {};
  const hungByRoute = {};
  const stalledByOutcome = {};
  for (const row of rows) {
    tally(outcomes, row.outcome);
    if (row.cls) tally(exceptions, row.cls);
    if (row.cls === "hung") tally(hungByRoute, row.route);
    if (row.wall > STALL_MS) tally(stalledByOutcome, row.outcome);
  }
  const walls = rows.map((row) => row.wall);
  return {
    rows,
    summary: {
      invocations: rows.length,
      outcomes,
      hung: exceptions.hung ?? 0,
      hungByRoute,
      exceptions,
      stalledOver30s: rows.filter((row) => row.wall > STALL_MS).length,
      stalledByOutcome,
      lowCpuWallOver2s: rows.filter((row) => row.cpu < 5 && row.wall > 2000).length,
      wallP50: percentile(walls, 0.5),
      wallP95: percentile(walls, 0.95),
      wallMax: walls.length ? Math.max(...walls) : null,
    },
  };
}

export function analyzeClient(records) {
  const status = {};
  const byRoute = {};
  const unabortedMs = [];
  let noResponse = 0;
  let noResponseUnaborted = 0;
  let fetchErrors = 0;
  let hungPages = 0;
  for (const record of records) {
    if (record.status != null) tally(status, record.status);
    if (record.error === "no response") {
      noResponse += 1;
      if (record.abortAt == null) noResponseUnaborted += 1;
    }
    if (record.error === "fetch error") fetchErrors += 1;
    if (record.hungPage) hungPages += 1;
    const route = (byRoute[`${record.method} ${routeOf(record.path)}`] ??= { n: 0, s5xx: 0, noResponse: 0, ms: [] });
    route.n += 1;
    if (record.status >= 500) route.s5xx += 1;
    if (record.error === "no response") route.noResponse += 1;
    if (record.abortAt == null && record.status != null) {
      unabortedMs.push(record.ms);
      route.ms.push(record.ms);
    }
  }
  return {
    requests: records.length,
    aborted: records.filter((record) => record.abortAt != null).length,
    responses: records.filter((record) => record.status != null).length,
    status,
    s5xx: records.filter((record) => record.status >= 500).length,
    hungPages,
    noResponse,
    noResponseUnaborted,
    fetchErrors,
    wallP50: percentile(unabortedMs, 0.5),
    wallP95: percentile(unabortedMs, 0.95),
    byRoute: Object.fromEntries(
      Object.entries(byRoute)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, { ms, ...rest }]) => [key, { ...rest, p50: percentile(ms, 0.5), p95: percentile(ms, 0.95) }]),
    ),
  };
}

// Classifies each client 5xx by the tail invocation with the same ray id. Tail sampling means
// many are "not in tail"; the matched share is what the class counts describe.
export function join5xx(records, tailRows) {
  const byRay = new Map(tailRows.filter((row) => row.ray).map((row) => [row.ray, row.cls ?? row.outcome]));
  const classes = {};
  for (const record of records) {
    if (!(record.status >= 500)) continue;
    tally(classes, byRay.get(rayOf(record.ray)) ?? "not in tail");
  }
  return classes;
}

export function analyze({ label, phase, tailEvents, records, sinceMs, untilMs }) {
  const tail = analyzeTail(tailEvents, sinceMs, untilMs);
  return { label, phase, sinceMs, untilMs, client: analyzeClient(records), tail: tail.summary, client5xxByTailClass: join5xx(records, tail.rows) };
}

export function parseVariants(text) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const [index, label, ref, sha] = line.split("\t");
      return { index: Number(index), label, ref, sha };
    });
}

export function decide(variants, analyses) {
  const [baseline] = variants;
  const phases = [...new Set(analyses.map((analysis) => analysis.phase))].sort();
  const find = (label, phase) => analyses.find((analysis) => analysis.label === label && analysis.phase === phase);
  const rows = variants.map((variant) => {
    const perPhase = phases.map((phase) => {
      const own = find(variant.label, phase);
      const base = find(baseline.label, phase);
      if (!own) return { phase, missing: true, pass: false };
      const hung = own.tail.hung + own.client.hungPages;
      const ratio = own.client.wallP95 != null && base?.client.wallP95 ? own.client.wallP95 / base.client.wallP95 : null;
      const reasons = [];
      if (hung > 0) reasons.push(`${hung} hung`);
      if (own.client.noResponse > 0) reasons.push(`${own.client.noResponse} with no response`);
      if (variant !== baseline && (ratio == null || ratio > P95_LIMIT)) reasons.push(`p95 ${ratio == null ? "unknown" : `${ratio.toFixed(2)}x`} baseline`);
      if (own.tail.invocations === 0) reasons.push("no tail evidence");
      return {
        phase,
        requests: own.client.requests,
        s5xx: own.client.s5xx,
        hung,
        noResponse: own.client.noResponse,
        tailStalledOver30s: own.tail.stalledOver30s,
        wallP95: own.client.wallP95,
        p95Ratio: ratio,
        tailInvocations: own.tail.invocations,
        reasons,
        pass: reasons.length === 0,
      };
    });
    return { ...variant, baseline: variant === baseline, phases: perPhase, wins: variant !== baseline && perPhase.length > 0 && perPhase.every((phase) => phase.pass) };
  });
  const winners = rows.filter((row) => row.wins).map((row) => row.label);
  return { rule: `no hung, no request without a response, wall p95 <= ${P95_LIMIT}x baseline, in every phase`, phases, rows, winners };
}

export function markdown(verdict) {
  const lines = [
    "## QA Hang Repro",
    "",
    `Rule: ${verdict.rule}. Winners: ${verdict.winners.length ? verdict.winners.join(", ") : "none"}.`,
    "",
    "| Variant | Ref | Phase | Requests | 5xx | Hung | No response | Tail stalls >30 s | Wall p95 (ms) | p95 vs baseline | Tail invocations | Result |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const row of verdict.rows) {
    for (const phase of row.phases) {
      if (phase.missing) {
        lines.push(`| ${row.label} | \`${row.ref}\` | ${phase.phase} | | | | | | | | | missing |`);
        continue;
      }
      const ratio = phase.p95Ratio == null ? "" : `${phase.p95Ratio.toFixed(2)}x`;
      const result = row.baseline ? (phase.reasons.length ? `baseline: ${phase.reasons.join("; ")}` : "baseline") : phase.pass ? "pass" : phase.reasons.join("; ");
      lines.push(
        `| ${row.label} | \`${row.ref}\` | ${phase.phase} | ${phase.requests} | ${phase.s5xx} | ${phase.hung} | ${phase.noResponse} | ${phase.tailStalledOver30s} | ${phase.wallP95 ?? ""} | ${ratio} | ${phase.tailInvocations} | ${result} |`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function main(argv = process.argv.slice(2), { readFile = readFileSync, writeFile = writeFileSync, listDir = readdirSync, log = console.log } = {}) {
  const [command, ...args] = argv;
  if (command === "analyze" && args.length === 7) {
    const [label, phase, tailFile, requestsFile, sinceMs, untilMs, outFile] = args;
    const result = analyze({
      label,
      phase,
      tailEvents: parseLines(readFile(tailFile, "utf8")),
      records: parseLines(readFile(requestsFile, "utf8")),
      sinceMs: Number(sinceMs),
      untilMs: Number(untilMs),
    });
    writeFile(outFile, `${JSON.stringify(result, null, 2)}\n`);
    log(JSON.stringify({ label, phase, requests: result.client.requests, s5xx: result.client.s5xx, noResponse: result.client.noResponse, hung: result.tail.hung, tailInvocations: result.tail.invocations }));
    return result;
  }
  if (command === "report" && args.length === 4) {
    const [resultsDir, variantsFile, outMarkdown, outJson] = args;
    const analyses = listDir(resultsDir)
      .filter((name) => name.endsWith(".analysis.json"))
      .map((name) => JSON.parse(readFile(join(resultsDir, name), "utf8")));
    const verdict = decide(parseVariants(readFile(variantsFile, "utf8")), analyses);
    writeFile(outJson, `${JSON.stringify(verdict, null, 2)}\n`);
    const text = markdown(verdict);
    writeFile(outMarkdown, text);
    log(text);
    return verdict;
  }
  throw new Error("Usage: qa-hang-repro-analyze.mjs analyze <label> <phase> <tail.ndjson> <requests.ndjson> <sinceMs> <untilMs> <out.json> | report <resultsDir> <variants.tsv> <out.md> <out.json>");
}

if (typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
