import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import NativeRecordingsReporter, { writeCookSessionRecordings } from "../workers/helpers/native-recordings-reporter";
import type { Recording } from "./native-api-recording-format";

// A fresh directory per test under the OS temporary directory, which the OS clears.
function directory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "native-recordings-"));
}

const recording = (name: string): Recording => ({ name, endpoint: "GET /api/cook-sessions/{recipeId}", status: 200, body: { state: null } });

function testCase(meta: Record<string, unknown>) {
  return { meta: () => meta } as never;
}

function testModule(ok: boolean) {
  return { ok: () => ok } as never;
}

describe("native recordings reporter", () => {
  it("writes the cook-session recordings and moves aside ones the test no longer makes", () => {
    const dir = directory();
    fs.writeFileSync(path.join(dir, "cook-session-gone.json"), "{}\n");
    fs.writeFileSync(path.join(dir, "recipe-detail.json"), "{}\n");

    writeCookSessionRecordings(dir, [recording("cook-session-read")]);

    expect(fs.readdirSync(dir).sort()).toEqual(["cook-session-gone.json.stale", "cook-session-read.json", "recipe-detail.json"]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "cook-session-read.json"), "utf8"))).toEqual(recording("cook-session-read"));
  });

  it("refuses a recording outside the cook-session set", () => {
    expect(() => writeCookSessionRecordings(directory(), [recording("recipe-detail")])).toThrow("not a cook-session recording");
  });

  it("writes what the Workers test put in its metadata once the run passes", () => {
    const dir = directory();
    const reporter = new NativeRecordingsReporter({ directory: dir });
    reporter.onTestCaseResult(testCase({}));
    reporter.onTestCaseResult(testCase({ nativeApiRecordings: [recording("cook-session-start")] }));
    reporter.onTestRunEnd([testModule(true)]);

    expect(fs.readdirSync(dir)).toEqual(["cook-session-start.json"]);
  });

  it("writes nothing when the run failed or the recordings test did not run", () => {
    const dir = directory();
    const failed = new NativeRecordingsReporter({ directory: dir });
    failed.onTestCaseResult(testCase({ nativeApiRecordings: [recording("cook-session-start")] }));
    expect(() => failed.onTestRunEnd([testModule(false)])).toThrow("Workers tests failed");
    expect(() => new NativeRecordingsReporter({ directory: dir }).onTestRunEnd([testModule(true)])).toThrow("did not run");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("defaults to the committed recordings directory", () => {
    expect((new NativeRecordingsReporter() as unknown as { directory: string }).directory)
      .toBe(path.resolve(__dirname, "../fixtures/native-api-recordings"));
  });
});
