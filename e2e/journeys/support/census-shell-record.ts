// The shell's per-page record for the HX census (see census-shell.ts): which of its landmarks a
// state shows, and how that compares with the journey's record in e2e/journeys/census-shell/. One
// file per journey, so pull requests that add journeys never edit the same file. No browser here.
import type { Multiset } from "../../ouro-census/census-page.mjs";

export const SHELL_RECORD_DIR = "e2e/journeys/census-shell";

/** The shell's landmarks, each by the context the census names it with. */
export const SHELL_LANDMARKS = Object.freeze({
  banner: "banner",
  nav: 'navigation "Main navigation"',
  tabBar: 'navigation "Spoonjoy navigation"',
  footer: "contentinfo",
});
export type ShellLandmark = keyof typeof SHELL_LANDMARKS;
/** One journey's record: project → state → the landmarks that show a control. */
export type ShellRecord = Record<string, Record<string, ShellLandmark[]>>;
export type ShellCheck = { kind: "changed" | "unrecorded"; message: string } | null;

export function shellRecordPath(journeyId: string): string {
  return `${SHELL_RECORD_DIR}/${journeyId}.json`;
}

/** The landmarks with at least one visible control in a census multiset, in SHELL_LANDMARKS order. */
export function visibleShellLandmarks(multiset: Multiset): ShellLandmark[] {
  return (Object.keys(SHELL_LANDMARKS) as ShellLandmark[]).filter((landmark) =>
    multiset.some(({ identity }) => identity.endsWith(`] in ${SHELL_LANDMARKS[landmark]}`)));
}

/**
 * Compares a state's shell with its journey's record. A changed shell is a regression unless the
 * record is updated with it; a state with no record yet (a new page) is reported, not failed, so a
 * new census entry needs nothing else to pass.
 */
export function checkShell(record: ShellRecord | undefined, where: { project: string; journeyId: string; stateId: string }, actual: ShellLandmark[]): ShellCheck {
  const expected = record?.[where.project]?.[where.stateId];
  const path = shellRecordPath(where.journeyId);
  const entry = `"${where.project}" › "${where.stateId}": ${JSON.stringify(actual)}`;
  if (!expected) return { kind: "unrecorded", message: `${path} has no shell record for this state; to check it from now on, add ${entry}.` };
  if (JSON.stringify(expected) === JSON.stringify(actual)) return null;
  return { kind: "changed", message: `This state shows the shell's ${JSON.stringify(actual)}, but ${path} expects ${JSON.stringify(expected)}. If the change is meant, set ${entry}.` };
}
