// Custom Playwright reporter for the explore suite. app.explore.ts runs on two device
// projects (iphone-webkit, desktop-chrome) with workers: 2, so two persona x device tests can
// be writing evidence at the same time. Rather than have every test append to the same
// explore-report/summary.json on disk (a race), each test attaches its own slice of visit
// records as a JSON attachment named `summary` (still visible per-test in the HTML report),
// already tagged with its own `route`/`persona`/`device` fields. This reporter only runs in
// the single main/dispatcher process, so it can safely collect every `summary` attachment as
// tests finish and write the one merged explore-report/summary.json once the whole run ends,
// with no locking required.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

export const SUMMARY_ATTACHMENT_NAME = "summary";
export const SUMMARY_OUTPUT_PATH = path.join("explore-report", "summary.json");

// A single route visit's evidence. Deliberately loose (`Record<string, unknown>`): this
// reporter only needs to concatenate and sort records, never interpret their fields.
export type VisitRecord = Record<string, unknown> & {
  route: string;
  persona: string;
  device: string;
};

function isVisitRecordArray(value: unknown): value is VisitRecord[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as VisitRecord).route === "string" &&
        typeof (entry as VisitRecord).persona === "string" &&
        typeof (entry as VisitRecord).device === "string",
    )
  );
}

function sortKey(record: VisitRecord): string {
  return `${record.route}\u0000${record.persona}\u0000${record.device}`;
}

export default class ExploreSummaryReporter implements Reporter {
  private records: VisitRecord[] = [];

  onTestEnd(_test: TestCase, result: TestResult): void {
    const attachment = result.attachments.find((entry) => entry.name === SUMMARY_ATTACHMENT_NAME);
    if (!attachment?.body) return;

    const parsed: unknown = JSON.parse(attachment.body.toString("utf8"));
    if (isVisitRecordArray(parsed)) this.records.push(...parsed);
  }

  onEnd(): void {
    const sorted = [...this.records].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    mkdirSync(path.dirname(SUMMARY_OUTPUT_PATH), { recursive: true });
    writeFileSync(SUMMARY_OUTPUT_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
  }
}
