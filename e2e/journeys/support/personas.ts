// Persona lookup for the QA journeys. Credentials come from the JSON file scripts/seed-qa-kitchen.mjs
// writes (path in env SPOONJOY_QA_CREDENTIALS), shaped as:
//   { "chef": { "username", "email", "password" }, "friend": {...}, "newbie": {...},
//     "scratch": [{ "username", "email", "password" }, ...] }
//
// Loading is intentionally lazy: the credentials file only needs to exist once a persona (or
// scratch user) is actually used inside a test/setup body. `playwright test --list` never runs
// test bodies, so listing journeys must not require a real credentials file on disk.
import { readFileSync } from "node:fs";

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
// 20-per-minute auth rate limit (see personas.setup.ts for the budget accounting).
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
