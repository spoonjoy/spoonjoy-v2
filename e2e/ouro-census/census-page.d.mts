import type { Page, TestType } from "@playwright/test";

export { censusTests, collectCensus, expectCensusMatches, installedItems, recordCensus, recordExpectedCensus };
export type { CensusState, Journey, Multiset };

/** One state of a journey: what its action opens, from a fresh load of the journey's path. */
interface CensusState {
  /** Unique within the journey: `default`, `delete-dialog`. */
  id: string;
  /** Opens what this state measures. Never submits, saves or confirms. */
  action?: (page: Page) => Promise<void>;
}

/** One page the app renders, as the visitor who sees it, and the states a person can open on it. */
interface Journey {
  /** Unique across the census: `home-signed-out`. */
  id: string;
  /** An enrolled journey fails on any control without an Ouro marker. */
  enrolled: boolean;
  /** Where the page is, path and query; the page must not redirect anywhere else. */
  path: string;
  /** The document's HTTP status. @default 200 */
  status?: number;
  /** The signed-in session to visit as (Playwright's storageState); none visits signed out. */
  storageState?: string | { cookies: unknown[]; origins: unknown[] };
  states: CensusState[];
}

/** A state's census: each control identity and how many times it shows, sorted by identity. */
type Multiset = Array<{ identity: string; count: number }>;

/**
 * Registers one test per state of every journey, tagged `@ouro-census`. List every Playwright
 * project the spec runs in as `projects`; `componentsDir` is where the app installs Ouro components
 * (`src/components/ouro`).
 */
declare function censusTests(options: {
  // Any Playwright test function, with the app's own fixtures.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  test: TestType<any, any>;
  journeys: readonly Journey[];
  projects: readonly string[];
  componentsDir: string;
  /** @default "e2e/ouro-census/census.baseline.json" */
  baselinePath?: string;
  /** Where each worker writes its census. @default process.env.OURO_CENSUS_DIR or "ouro-census" */
  resultsDir?: string;
  /** Runs after each load, before the state's action: wait for hydration, say. */
  prepare?: (page: Page) => Promise<void>;
}): void;

/** The page's visible controls as a multiset, once two readings a moment apart agree. Throws, naming the version it found, when the app's axe-core is older than the kits' minimum. */
declare function collectCensus(page: Page, options?: { attempts?: number; intervalMs?: number }): Promise<Multiset>;
/** The installed components' names, the only valid markers. */
declare function installedItems(componentsDir: string, readdir?: (directory: string) => string[]): string[];
/** Writes the projects and states a run must record; returns the file's path. */
declare function recordExpectedCensus(options: { journeys: readonly Journey[]; projects: readonly string[]; worker: number; directory: string }): string;
/** Adds one state's multiset to this worker's census file; returns the file's path. */
declare function recordCensus(options: { directory: string; project: string; worker: number; journeyId: string; stateId: string; multiset: Multiset }): string;
/** Throws with every problem the census finds in one state. */
declare function expectCensusMatches(options: {
  baseline: Record<string, unknown>;
  baselinePath: string;
  project: string;
  journey: Journey;
  stateId: string;
  actual: Multiset;
  actualPath: string;
  knownItems: readonly string[];
}): void;
