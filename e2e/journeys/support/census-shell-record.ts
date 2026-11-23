// The shell's per-page record for the HX census (see census-shell.ts): which of its landmarks a
// state shows, and how that compares with e2e/journeys/census-shell.baseline.json. No browser here.
import type { Multiset } from "../../ouro-census/census-page.mjs";

export const SHELL_BASELINE_PATH = "e2e/journeys/census-shell.baseline.json";

/** The shell's landmarks, each by the context the census names it with. */
export const SHELL_LANDMARKS = Object.freeze({
  banner: "banner",
  nav: 'navigation "Main navigation"',
  tabBar: 'navigation "Spoonjoy navigation"',
  footer: "contentinfo",
});
export type ShellLandmark = keyof typeof SHELL_LANDMARKS;
/** project → journey → state → the landmarks that show a control. */
export type ShellBaseline = Record<string, Record<string, Record<string, ShellLandmark[]>>>;

/** The landmarks with at least one visible control in a census multiset, in SHELL_LANDMARKS order. */
export function visibleShellLandmarks(multiset: Multiset): ShellLandmark[] {
  return (Object.keys(SHELL_LANDMARKS) as ShellLandmark[]).filter((landmark) =>
    multiset.some(({ identity }) => identity.endsWith(`] in ${SHELL_LANDMARKS[landmark]}`)));
}

/** Why a state's shell differs from the baseline, naming the fix, or null when it matches. */
export function shellMismatch(baseline: ShellBaseline, where: { project: string; journeyId: string; stateId: string }, actual: ShellLandmark[]): string | null {
  const expected = baseline[where.project]?.[where.journeyId]?.[where.stateId];
  if (expected && JSON.stringify(expected) === JSON.stringify(actual)) return null;
  const entry = `"${where.project}" › "${where.journeyId}" › "${where.stateId}": ${JSON.stringify(actual)}`;
  if (!expected) return `${SHELL_BASELINE_PATH} has no shell record for this state. If the page is new, add ${entry}.`;
  return `This state shows the shell's ${JSON.stringify(actual)}, but ${SHELL_BASELINE_PATH} expects ${JSON.stringify(expected)}. If the change is meant, set ${entry}.`;
}
