// @vitest-environment node
// The QA error log line (app/lib/qa-error-logs.server.ts) and the Worker tail summary
// (scripts/summarize-worker-tail.jq) scrub with the same rules. These tests run the same fake
// secrets through both, so the two scrubbers cannot drift apart, and pin that only per-run QA
// Workers turn the console line on.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatQaErrorLog,
  QA_ERROR_LOGS_VAR,
  qaErrorLogsEnabled,
  reduceQaError,
  scrubText,
} from "~/lib/qa-error-logs.server";
import { expectNoSecrets, FAKE_SECRETS, secretLine, secretMessage } from "../fixtures/fake-secrets";

const ROOT = resolve(__dirname, "../..");
const PROGRAM = resolve(ROOT, "scripts/summarize-worker-tail.jq");

type Summary = {
  serverErrorInvocations: Array<{ exceptions: Array<{ message: string }>; errorLogs: Array<{ name: string | null; message: string; stack: string[] }> }>;
};

// Each argument becomes one 500 invocation with that error-level log line and that exception message.
function jqSummary(logArguments: unknown[], exceptionMessages: string[] = []): Summary {
  const events = logArguments.map((argument, index) => ({
    outcome: "ok",
    eventTimestamp: index,
    logs: [{ level: "error", message: [argument] }],
    exceptions: exceptionMessages[index] === undefined ? [] : [{ name: "Error", message: exceptionMessages[index] }],
    event: { request: { url: "https://qa.example/login.data", method: "POST" }, response: { status: 500 } },
  }));
  const output = execFileSync(
    "jq",
    ["-s", "--argjson", "tailAliveAtStop", "true", "--argjson", "keepErrorLogs", "true", "-f", PROGRAM],
    { input: events.map((event) => JSON.stringify(event)).join("\n"), encoding: "utf8" },
  );
  return JSON.parse(output);
}

// Text samples with no "Name:" prefix and no "at" frame lines, so the jq program keeps each one
// whole as the message. The bare `name is secret` samples only compare the two scrubbers: a bare
// value with no header, prefix or URL around it is not recognizable as a secret.
const SAMPLES = [
  secretMessage,
  secretLine,
  ...Object.entries(FAKE_SECRETS).map(([name, secret]) => `${name} is ${secret} here`),
  `Cookie: a=${FAKE_SECRETS.cookieHeader}`,
  `authorization: token ${FAKE_SECRETS.bearer}`,
  `bearer ${FAKE_SECRETS.bearer}`,
  `got theme=dark; lang=en; end and __oauth=${FAKE_SECRETS.agentCodeCookie}`,
  `Unexpected token 'c', "${FAKE_SECRETS.sessionCookie}" is not valid JSON`,
  `see issue #123 at https://${FAKE_SECRETS.userinfo}@host.example/a/b?c=${FAKE_SECRETS.query}#${FAKE_SECRETS.fragment}`,
  "plain failure with spaces\n  and a second line",
  "word ".repeat(150),
  `long ${"é".repeat(600)}`,
];

describe("scrubText matches the jq scrubber", () => {
  it("gives the same result as the tail summary for every fake secret sample, at both caps", () => {
    const summary = jqSummary(SAMPLES, SAMPLES);

    SAMPLES.forEach((sample, index) => {
      const entry = summary.serverErrorInvocations[index];
      expect(entry.errorLogs[0].message, `log line ${index}`).toBe(scrubText(sample, 500));
      expect(entry.exceptions[0].message, `exception ${index}`).toBe(scrubText(sample, 200));
    });
    // The samples that give each secret its context (a header, a prefix, a URL) lose every secret.
    expectNoSecrets(JSON.stringify([secretMessage, secretLine].map((sample) => scrubText(sample, 500))));
  });

  it("produces a console line that the tail summary reduces to the same class, message and frames", () => {
    const error = new TypeError(`lookup failed: ${secretMessage}`);
    error.stack = [
      `TypeError: lookup failed: ${secretMessage}`,
      `    at action (https://chef:${FAKE_SECRETS.userinfo}@qa.example.test/build/server.js?v=${FAKE_SECRETS.query}:1:2)`,
      ...Array.from({ length: 6 }, (_, index) => `    at frame${index} (index.js:${index + 1}:7)`),
    ].join("\n");
    class PrismaClientKnownRequestError extends Error {
      override name = "PrismaClientKnownRequestError";
    }
    const errors: unknown[] = [error, new PrismaClientKnownRequestError("no row"), `thrown ${FAKE_SECRETS.apiToken}`, { code: FAKE_SECRETS.hex }, 42, null];

    const summary = jqSummary(errors.map(formatQaErrorLog));

    errors.forEach((thrown, index) => {
      expect(summary.serverErrorInvocations[index].errorLogs[0], `error ${index}`).toEqual(reduceQaError(thrown));
    });
    expect(reduceQaError(error).stack).toHaveLength(5);
    expectNoSecrets(JSON.stringify(errors.map(formatQaErrorLog)));
  });
});

describe("reduceQaError", () => {
  it("keeps an identifier class name, scrubs any other name, and reduces non-errors to a message", () => {
    const tokenNamed = new Error("x");
    tokenNamed.name = FAKE_SECRETS.apiToken;
    const prefixedError = new Error("x");
    prefixedError.name = "sj_LooksLikeAnError";
    const noStack = new RangeError("out of range");
    noStack.stack = undefined;

    expect(reduceQaError(new RangeError("bad")).name).toBe("RangeError");
    expect(reduceQaError(tokenNamed).name).toBe("[token]");
    expect(reduceQaError(prefixedError).name).toBe("[token]");
    expect(reduceQaError(noStack)).toEqual({ name: "RangeError", message: "out of range", stack: [] });
    expect(reduceQaError("just text")).toEqual({ name: null, message: "just text", stack: [] });
    expect(reduceQaError({ code: "E1" })).toEqual({ name: null, message: '{"[redacted]":"[redacted]"}', stack: [] });
    expect(reduceQaError(undefined)).toEqual({ name: null, message: "undefined", stack: [] });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(reduceQaError(circular)).toEqual({ name: null, message: "[object Object]", stack: [] });
  });

  it("writes one line", () => {
    expect(formatQaErrorLog(new Error("a\nb"))).not.toContain("\n");
  });
});

describe("QA error log switch", () => {
  it("is on only when the per-run QA variable is exactly 1", () => {
    expect(QA_ERROR_LOGS_VAR).toBe("SPOONJOY_QA_ERROR_LOGS");
    expect(qaErrorLogsEnabled({ SPOONJOY_QA_ERROR_LOGS: "1" })).toBe(true);
    for (const env of [{ SPOONJOY_QA_ERROR_LOGS: "0" }, { SPOONJOY_QA_ERROR_LOGS: "true" }, { SPOONJOY_QA_ERROR_LOGS: "" }, {}, null, undefined]) {
      expect(qaErrorLogsEnabled(env)).toBe(false);
    }
  });

  it("is not set by the production wrangler config or by any committed env block, including shared QA", () => {
    const wrangler = JSON.parse(readFileSync(resolve(ROOT, "wrangler.json"), "utf8"));

    expect(wrangler.vars).not.toHaveProperty(QA_ERROR_LOGS_VAR);
    for (const [name, env] of Object.entries(wrangler.env ?? {})) {
      expect((env as { vars?: Record<string, string> }).vars ?? {}, `env.${name}`).not.toHaveProperty(QA_ERROR_LOGS_VAR);
    }
    expect(readFileSync(resolve(ROOT, "wrangler.json"), "utf8")).not.toContain(QA_ERROR_LOGS_VAR);
  });
});
