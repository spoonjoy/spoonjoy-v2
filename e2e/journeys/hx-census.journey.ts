// The HX census journey (AGENTS.md, "The HX census"): HX's census kit (ouro-census, installed under
// e2e/ouro-census/) runs every state of every journey in support/hx-census.ts, on both device
// projects, as that journey's persona. Each state loads the journey's page fresh, waits for
// hydration, runs the state's action (which only opens things), and fails unless its visible
// controls equal e2e/ouro-census/census.baseline.json (and, for an enrolled journey, every control
// is HX's).
//
// The census reads the seeded QA kitchen before any other journey changes QA data, so the Journeys
// workflow runs it alone first (`pnpm run test:journeys:census`), then everything else
// (`pnpm run test:journeys:after-census`). The kit tags its tests @ouro-census.
import type { TestInfo } from "@playwright/test";
import { censusTests } from "../ouro-census/census-page.mjs";
import { test as journeyTest } from "./support/journey";
import { CENSUS_PROJECTS, censusJourneys } from "./support/hx-census";
import { waitForHydration } from "./support/navigation";

const NOT_FOUND_PATH = "/hx-census-page-that-does-not-exist";

const test = journeyTest.extend<{ notFoundDocument: void }>({
  // The "not found" journey's document answers 404, which some browsers also log as a console error.
  notFoundDocument: [
    async ({ expectConsoleError }, use) => {
      expectConsoleError(/^Failed to load resource: the server responded with a status of 404\b/, {
        url: new RegExp(`${NOT_FOUND_PATH}$`),
        optional: true,
      });
      await use();
    },
    { auto: true },
  ],
});

// Playwright reads a hook's first parameter for the fixtures it asks for and accepts only an object
// pattern there; the kit's beforeAll names it `_fixtures`, which Playwright refuses before any test
// runs. This hands the kit a test whose beforeAll gives Playwright the pattern it wants. Its tests
// are declared through this file too (the apply trap), which is where Playwright then finds them.
const censusTest = new Proxy(test, {
  apply(target, thisArg, args) {
    return Reflect.apply(target, thisArg, args);
  },
  get(target, key, receiver) {
    if (key !== "beforeAll") return Reflect.get(target, key, receiver);
    return (hook: (fixtures: object, testInfo: TestInfo) => void) =>
      // eslint-disable-next-line no-empty-pattern -- Playwright requires an object pattern here.
      target.beforeAll(({}, testInfo) => hook({}, testInfo));
  },
});

censusTests({
  test: censusTest,
  journeys: censusJourneys(),
  projects: CENSUS_PROJECTS,
  componentsDir: "app/components/ouro",
  resultsDir: "hx-census",
  prepare: waitForHydration,
});
