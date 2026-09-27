// Persona lookup for the QA journeys. Credentials come from the JSON file scripts/seed-qa-kitchen.mjs
// writes (path in env SPOONJOY_QA_CREDENTIALS), shaped as:
//   { "chef": { "username", "email", "password" }, "friend": {...}, "newbie": {...},
//     "scratch": [{ "username", "email", "password" }, ...],
//     "scratchDesktop": [{ "username", "email", "password" }, ...] }
//
// Loading is intentionally lazy: the credentials file only needs to exist once a persona (or
// scratch user) is actually used inside a test/setup body. `playwright test --list` never runs
// test bodies, so listing journeys must not require a real credentials file on disk.
import { readFileSync } from "node:fs";
import type { TestInfo } from "@playwright/test";

export type PersonaName = "chef" | "friend" | "newbie";

export interface Persona {
  username: string;
  email: string;
  password: string;
  storageState: string;
}

interface PersonaCredentials {
  username: string;
  email: string;
  password: string;
}

type CredentialsFile = Record<PersonaName, PersonaCredentials> & {
  scratch: PersonaCredentials[];
  scratchDesktop?: PersonaCredentials[];
};

let cachedCredentials: CredentialsFile | undefined;

function loadCredentials(): CredentialsFile {
  if (cachedCredentials) return cachedCredentials;

  const credentialsPath = process.env.SPOONJOY_QA_CREDENTIALS;
  if (!credentialsPath) {
    throw new Error(
      "SPOONJOY_QA_CREDENTIALS is required; journeys sign in as the QA kitchen personas seeded by " +
        "`pnpm run seed:qa:kitchen -- --credentials-out <path>`.",
    );
  }

  const raw = readFileSync(credentialsPath, "utf8");
  cachedCredentials = JSON.parse(raw) as CredentialsFile;
  return cachedCredentials;
}

export function personaStorageStatePath(name: PersonaName): string {
  return `e2e/.auth/journeys-${name}.json`;
}

export function persona(name: PersonaName): Persona {
  const credentials = loadCredentials();
  const entry = credentials[name];
  if (!entry) {
    throw new Error(`No credentials for persona "${name}" in the file at SPOONJOY_QA_CREDENTIALS.`);
  }
  return { ...entry, storageState: personaStorageStatePath(name) };
}

// Per-run scratch users (1-indexed), seeded alongside the kitchen personas by
// scripts/seed-qa-kitchen.mjs. They own no data, so a data-changing journey can sign in as one
// and mutate freely without touching the shared personas or the other scratch indices — see
// AGENTS.md's Validation section for which journey file owns which index. Using a stored
// scratch session instead of signing up through /signup keeps journeys off QA's shared
// 60-per-minute auth rate limit (see personas.setup.ts for the budget accounting).
export function scratchStorageStatePath(n: number): string {
  return `e2e/.auth/journeys-scratch-${n}.json`;
}

export function scratch(n: number): Persona {
  const credentials = loadCredentials();
  const entry = credentials.scratch?.[n - 1];
  if (!entry) {
    throw new Error(`No credentials for scratch user ${n} in the file at SPOONJOY_QA_CREDENTIALS.`);
  }
  return { ...entry, storageState: scratchStorageStatePath(n) };
}

// Per-device scratch twins. The iphone-webkit and desktop-chrome projects run at the same time,
// and some data is one per user (each user has exactly one shopping list), so a journey whose
// devices must not share state signs in as scratch index n's base account on iPhone and as its
// desktop twin (seeded alongside it by scripts/seed-qa-kitchen.mjs) on desktop Chrome. Journeys
// that don't need the isolation keep using scratch(n) / scratchStorageStatePath(n) on both.
export const IPHONE_PROJECT = "iphone-webkit";
export const DESKTOP_PROJECT = "desktop-chrome";

export function scratchDesktopStorageStatePath(n: number): string {
  return `e2e/.auth/journeys-scratch-${n}-desktop.json`;
}

export function scratchDesktop(n: number): Persona {
  const credentials = loadCredentials();
  const entry = credentials.scratchDesktop?.[n - 1];
  if (!entry) {
    throw new Error(`No credentials for scratch user ${n}'s desktop twin in the file at SPOONJOY_QA_CREDENTIALS.`);
  }
  return { ...entry, storageState: scratchDesktopStorageStatePath(n) };
}

// The stored session for scratch index n on one device project: the base account on iPhone, the
// desktop twin on desktop Chrome. Any other project name is a mistake (the personas setup project
// never runs journeys), so it throws rather than quietly sharing an account across devices.
export function scratchStorageStatePathForProject(n: number, projectName: string): string {
  if (projectName === IPHONE_PROJECT) return scratchStorageStatePath(n);
  if (projectName === DESKTOP_PROJECT) return scratchDesktopStorageStatePath(n);
  throw new Error(
    `No per-device scratch session for project "${projectName}"; expected "${IPHONE_PROJECT}" or "${DESKTOP_PROJECT}".`,
  );
}

// The credentials behind scratchStorageStatePathForProject(n, projectName): the base account on
// iPhone, the desktop twin on desktop Chrome. For a journey that must re-enter its own account's
// password (account-settings.journey.ts's password change); never log or interpolate the password.
export function scratchForProject(n: number, projectName: string): Persona {
  if (projectName === IPHONE_PROJECT) return scratch(n);
  if (projectName === DESKTOP_PROJECT) return scratchDesktop(n);
  throw new Error(
    `No per-device scratch user for project "${projectName}"; expected "${IPHONE_PROJECT}" or "${DESKTOP_PROJECT}".`,
  );
}

// Option-fixture form of scratchStorageStatePathForProject, for module- or describe-level use:
//   test.use({ storageState: scratchStorageStateForProject(3) });
// Playwright runs a function passed to test.use as that option's fixture, per test, with the
// test's TestInfo, so each device project resolves its own account. Reading only the path (never
// the credentials file) keeps `playwright test --list` working without one.
export function scratchStorageStateForProject(
  n: number,
): (args: object, use: (storageState: string) => Promise<void>, testInfo: TestInfo) => Promise<void> {
  return async ({}, use, testInfo) => {
    await use(scratchStorageStatePathForProject(n, testInfo.project.name));
  };
}
