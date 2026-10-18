// The HX census journey (AGENTS.md, "The HX census"): every state of every journey in
// support/hx-census.ts, on both device projects, as that journey's persona. Each state loads the
// journey's page fresh, runs the state's action (which only opens things), waits for animations,
// records the exact multiset of visible controls in this worker's hx-census-actual file, and fails
// unless it equals hx-census.baseline.json (and, for an enrolled journey, every control is HX's).
//
// The census reads the seeded QA kitchen before any other journey changes QA data, so the Journeys
// workflow runs it alone first (`pnpm run test:journeys:census`), then everything else
// (`pnpm run test:journeys:after-census`). Its tests are tagged @hx-census.
import { test, expect } from "./support/journey";
import { census, censusStorageState, collectCensus, expectCensusMatches, recordCensus } from "./support/hx-census";
import { waitForHydration } from "./support/navigation";

for (const journey of census) {
  test.describe(`HX census ${journey.id}`, () => {
    test.use({ storageState: censusStorageState(journey.persona) });

    for (const state of journey.states) {
      test(`${journey.id} / ${state.id}`, { tag: "@hx-census" }, async ({ page, expectConsoleError }, testInfo) => {
        const status = journey.status ?? 200;
        const response = await page.goto(journey.path);
        // A "not found" page's document answers 404, which some browsers also log as a console error.
        expectConsoleError(new RegExp(`^Failed to load resource: the server responded with a status of ${status}\\b`), {
          url: new RegExp(`^${page.url().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
          optional: true,
        });
        expect(response?.status(), `${journey.path} answers ${status}`).toBe(status);
        await waitForHydration(page);
        await state.action?.(page);

        const actual = await collectCensus(page);
        const actualPath = recordCensus(testInfo.project.name, testInfo.workerIndex, journey.id, state.id, actual);
        expectCensusMatches({ project: testInfo.project.name, journey, stateId: state.id, actual, actualPath });
      });
    }
  });
}
