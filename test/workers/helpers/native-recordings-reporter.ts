// Writes the cook-session recordings that test/workers/native-cook-session-recordings.test.ts makes.
//
// That test runs inside the Workers runtime, which cannot write files. When refreshing, it puts its
// normalized recordings in its test's metadata, which Vitest sends to the reporters in the Node process
// that started the run; this reporter writes them to test/fixtures/native-api-recordings and moves any
// `cook-session-*` recording the test no longer makes to `<name>.json.stale`, as the Node recordings
// test does for its own. index.json is written afterwards by test/contracts/native-api-recordings.test.ts.
//
// vitest.workers.config.ts adds this reporter only while SPOONJOY_WRITE_NATIVE_API_RECORDINGS=1.
import fs from "node:fs";
import path from "node:path";
import type { Reporter, TestCase, TestModule } from "vitest/node";
import { COOK_SESSION_RECORDING_PREFIX, serializeRecording, type Recording } from "../../contracts/native-api-recording-format";

export const RECORDINGS_DIRECTORY = path.resolve(__dirname, "../../fixtures/native-api-recordings");

export function writeCookSessionRecordings(directory: string, recordings: readonly Recording[]) {
  fs.mkdirSync(directory, { recursive: true });
  const names = new Set(recordings.map(({ name }) => `${name}.json`));
  for (const file of fs.readdirSync(directory)) {
    if (file.startsWith(COOK_SESSION_RECORDING_PREFIX) && file.endsWith(".json") && !names.has(file)) {
      fs.renameSync(path.join(directory, file), path.join(directory, `${file}.stale`));
    }
  }
  for (const recording of recordings) {
    if (!recording.name.startsWith(COOK_SESSION_RECORDING_PREFIX)) {
      throw new Error(`${recording.name} is not a cook-session recording`);
    }
    fs.writeFileSync(path.join(directory, `${recording.name}.json`), serializeRecording(recording));
  }
}

export default class NativeRecordingsReporter implements Reporter {
  private recordings: Recording[] | null = null;

  private readonly directory: string;

  // Vitest passes a reporter's options object; tests pass their own directory.
  constructor(options: { directory?: string } = {}) {
    this.directory = options.directory ?? RECORDINGS_DIRECTORY;
  }

  onTestCaseResult(testCase: TestCase) {
    const recordings = testCase.meta().nativeApiRecordings;
    if (recordings) this.recordings = recordings;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>) {
    // A failed run would write a partial set, so it writes nothing.
    if (testModules.some((testModule) => !testModule.ok())) {
      throw new Error("The cook-session recordings were not refreshed because the Workers tests failed.");
    }
    if (!this.recordings) {
      throw new Error("The cook-session recordings test did not run, so nothing was refreshed.");
    }
    writeCookSessionRecordings(this.directory, this.recordings);
  }
}
