// The format of the native API recordings in test/fixtures/native-api-recordings, shared by the two
// tests that record them: test/contracts/native-api-recordings.test.ts (the /api/v1 and OAuth routes,
// in Node) and test/workers/native-cook-session-recordings.test.ts (the cook-session routes, which
// need the Workers runtime for their Durable Object). It has no Node or Workers imports, so both
// runtimes can load it.

declare module "vitest" {
  interface ProvidedContext {
    /** True while `pnpm run test:native-recordings:refresh` runs; see vitest.workers.config.ts. */
    writeNativeApiRecordings: boolean;
  }
  interface TaskMeta {
    /** The Workers test's recordings, for test/workers/helpers/native-recordings-reporter.ts to write. */
    nativeApiRecordings?: Recording[];
  }
}

export interface Recording {
  name: string;
  endpoint: string;
  status: number;
  body: unknown;
}

export interface RecordingIndexEntry {
  name: string;
  endpoint: string;
  status: number;
}

/** Recordings whose names start with this come from the Workers test; the Node test leaves them alone. */
export const COOK_SESSION_RECORDING_PREFIX = "cook-session-";

export const FIXED_TIMESTAMP = "2026-01-01T00:00:00.000Z";

const DYNAMIC_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "access_token", pattern: /\bsj_[A-Za-z0-9_-]{8,}/g },
  { kind: "refresh_token", pattern: /\bort_[A-Za-z0-9_-]{8,}/g },
  { kind: "uuid", pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  { kind: "id", pattern: /\bc[a-z0-9]{24}\b/g },
];
const TIMESTAMP_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g;
// Upload keys start with the upload time in milliseconds.
const EPOCH_MILLISECONDS_PATTERN = /\b1\d{12}\b/g;
const FIXED_EPOCH_MILLISECONDS = "1767225600000";
const OPAQUE_KEY_PATTERN = /(^id$|Id$|^cursor$|Cursor$|^token$|^client_id$|^access_token$|^refresh_token$)/;
const STABLE_VALUES = new Set(["spoonjoy-apple-native"]);

/**
 * Replaces the values that change between runs (IDs, tokens, cursors and timestamps) with stable ones.
 * One placeholder per distinct dynamic value, numbered by first appearance across the whole run, so a
 * recipe's ID is the same placeholder in its create response, its detail and the list it appears in.
 * Each recording run makes one normalizer.
 */
export function createRecordingNormalizer() {
  const placeholders = new Map<string, string>();
  const placeholderCounts = new Map<string, number>();

  function placeholder(kind: string, value: string) {
    const key = `${kind}:${value}`;
    const existing = placeholders.get(key);
    if (existing) return existing;
    const next = (placeholderCounts.get(kind) ?? 0) + 1;
    placeholderCounts.set(kind, next);
    const created = `${kind}_${String(next).padStart(3, "0")}`;
    placeholders.set(key, created);
    return created;
  }

  function normalizeString(value: string, key: string | null): string {
    // A profile's join label is the month the test chef was created, so it changes with the calendar.
    if (key === "joinedLabel" && /^Joined [A-Z][a-z]{2} \d{4}$/.test(value)) return "Joined Jan 2026";
    let result = value.replace(TIMESTAMP_PATTERN, FIXED_TIMESTAMP).replace(EPOCH_MILLISECONDS_PATTERN, FIXED_EPOCH_MILLISECONDS);
    for (const { kind, pattern } of DYNAMIC_PATTERNS) {
      result = result.replace(pattern, (match) => placeholder(kind, match));
    }
    if (key && OPAQUE_KEY_PATTERN.test(key) && result === value && !STABLE_VALUES.has(value) && !/_\d{3}$/.test(value)) {
      const kind = /cursor/i.test(key) ? "cursor" : /token/i.test(key) ? "token" : "opaque";
      result = placeholder(kind, value);
    }
    return result;
  }

  return function normalizeRecordedValue(value: unknown, key: string | null = null): unknown {
    if (typeof value === "string") return normalizeString(value, key);
    if (Array.isArray(value)) return value.map((entry) => normalizeRecordedValue(entry, key));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([entryKey, entry]) => [entryKey, normalizeRecordedValue(entry, entryKey)]),
      );
    }
    return value;
  };
}

export function serializeRecording(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
