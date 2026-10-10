import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const WORKFLOW_PATH = ".github/workflows/d1-restore-point-check.yml";
const TOKEN = "fake-d1-token-value-that-must-never-print";
const ACCOUNT = "fake-account-id";
const BOOKMARK = "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683";

type Step = { name: string; env: Record<string, string>; run: string; uses?: string };
type Workflow = {
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  jobs: Record<string, { environment: string; permissions: Record<string, string>; steps: Step[] }>;
};

function workflow(): Workflow {
  return parseDocument(readFileSync(WORKFLOW_PATH, "utf8")).toJS() as Workflow;
}

function runStep(options: { ref?: string; status: string; body: string; curlExit?: number }) {
  const step = workflow().jobs.check.steps[0];
  const bin = mkdtempSync(path.join(tmpdir(), "d1-restore-point-"));
  const requestLog = path.join(bin, "requests.log");
  // Fake curl: logs its arguments, writes the canned body to --output and prints the status.
  writeFileSync(
    path.join(bin, "curl"),
    `#!/usr/bin/env bash
printf '%s\\n' "$@" >> "${requestLog}"
out=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--output" ]; then out="$2"; shift; fi
  shift
done
printf '%s' "$FAKE_BODY" > "$out"
printf '%s' "$FAKE_STATUS"
exit "\${FAKE_CURL_EXIT:-0}"
`,
  );
  chmodSync(path.join(bin, "curl"), 0o755);
  const env = {
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_REF: options.ref ?? "refs/heads/main",
    CLOUDFLARE_D1_API_TOKEN: TOKEN,
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    D1_DATABASE_ID: step.env.D1_DATABASE_ID,
    FAKE_STATUS: options.status,
    FAKE_BODY: options.body,
    FAKE_CURL_EXIT: String(options.curlExit ?? 0),
  };
  let output = "";
  let exitCode = 0;
  try {
    output = execFileSync("bash", ["-c", step.run], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    exitCode = failure.status;
    output = `${failure.stdout}${failure.stderr}`;
  }
  let requests = "";
  try {
    requests = readFileSync(requestLog, "utf8");
  } catch {
    requests = "";
  }
  return { output, exitCode, requests };
}

describe("D1 restore point check workflow", () => {
  it("runs only on manual dispatch, in the production environment, with read-only permissions and no actions", () => {
    const parsed = workflow();
    expect(Object.keys(parsed.on)).toEqual(["workflow_dispatch"]);
    expect(parsed.permissions).toEqual({ contents: "read" });
    expect(Object.keys(parsed.jobs)).toEqual(["check"]);
    expect(parsed.jobs.check.environment).toBe("production");
    expect(parsed.jobs.check.permissions).toEqual({ contents: "read" });
    expect(parsed.jobs.check.steps).toHaveLength(1);
    expect(parsed.jobs.check.steps[0].uses).toBeUndefined();
    expect(parsed.jobs.check.steps[0].env.CLOUDFLARE_D1_API_TOKEN).toBe("${{ secrets.CLOUDFLARE_D1_API_TOKEN }}");
  });

  it("targets the production D1 database from wrangler.json", () => {
    const wrangler = JSON.parse(readFileSync("wrangler.json", "utf8")) as {
      d1_databases: Array<{ binding: string; database_id: string }>;
    };
    const production = wrangler.d1_databases.find((database) => database.binding === "DB");
    expect(workflow().jobs.check.steps[0].env.D1_DATABASE_ID).toBe(production?.database_id);
  });

  it("sends one GET to the bookmark endpoint and prints only the status and whether a bookmark came back", () => {
    const result = runStep({ status: "200", body: JSON.stringify({ success: true, result: { bookmark: BOOKMARK } }) });
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("HTTP status: 200");
    expect(result.output).toContain("bookmark returned: yes");
    expect(result.output).not.toContain(TOKEN);
    expect(result.output).not.toContain(BOOKMARK);
    expect(result.output).not.toContain(ACCOUNT);
    expect(result.requests).toContain("GET");
    expect(result.requests).not.toMatch(/POST|PUT|PATCH|DELETE|restore/);
    expect(result.requests).toContain(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/32cb0e04-c45b-4cd2-a798-556556ae288d/time_travel/bookmark`,
    );
  });

  it("fails without echoing the response body when the token is refused", () => {
    const body = JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error secret-detail" }] });
    const result = runStep({ status: "403", body });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("HTTP status: 403");
    expect(result.output).toContain("bookmark returned: no");
    expect(result.output).not.toContain("secret-detail");
    expect(result.output).not.toContain(TOKEN);
  });

  it("fails on a malformed bookmark or a network error", () => {
    const malformed = runStep({ status: "200", body: JSON.stringify({ success: true, result: { bookmark: "nope" } }) });
    expect(malformed.exitCode).toBe(1);
    expect(malformed.output).toContain("bookmark returned: no");
    const network = runStep({ status: "000", body: "", curlExit: 28 });
    expect(network.exitCode).toBe(1);
    expect(network.output).toContain("curl exit: 28");
    expect(network.output).toContain("bookmark returned: no");
  });

  it("refuses to use production credentials off main", () => {
    const result = runStep({ ref: "refs/heads/feature", status: "200", body: "{}" });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("restricted to refs/heads/main");
    expect(result.requests).toBe("");
  });
});
