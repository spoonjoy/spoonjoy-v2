import { appendFileSync } from "node:fs";
import { join } from "node:path";

export default class NativePressReporter {
  onTestCaseAnnotate(testCase, annotation) {
    if (annotation.message !== "NumberField native press receipts") return;
    if (!process.env.NATIVE_PRESS_EVIDENCE || !process.env.NATIVE_PRESS_PHASE) {
      throw new Error("Native press reporter requires an evidence directory and phase");
    }
    appendFileSync(join(process.env.NATIVE_PRESS_EVIDENCE, "native-receipts.jsonl"), JSON.stringify({
      phase: process.env.NATIVE_PRESS_PHASE,
      project: testCase.project.name,
      test: testCase.fullName,
      annotation,
    }) + "\n");
  }
}
