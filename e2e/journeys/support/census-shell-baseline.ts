// The census baseline as the page journeys check it: e2e/ouro-census/census.baseline.json with the
// shared shell's controls taken out of every page entry (the `shell-*` journeys keep theirs). The
// census hides the shell before it records (census-shell.ts), so this lets an entry recorded with the
// shell in it, before the shell had journeys of its own, still pass, and no one has to strip it.
// No browser here.

/** The contexts the census names the shell's landmarks with. */
export const SHELL_CONTEXTS = Object.freeze(["banner", 'navigation "Main navigation"', 'navigation "Spoonjoy navigation"', "contentinfo"]);

type Baseline = Record<string, Record<string, Record<string, Array<{ identity: string; count: number }>>>>;

export function isShellIdentity(identity: string): boolean {
  return SHELL_CONTEXTS.some((context) => identity.endsWith(`] in ${context}`));
}

/** The baseline with shell identities removed from each page entry; the shell's own entries stay whole. */
export function withoutShell(baseline: Baseline): Baseline {
  return Object.fromEntries(Object.entries(baseline).map(([project, journeys]) => [
    project,
    Object.fromEntries(Object.entries(journeys).map(([journeyId, states]) => [
      journeyId,
      journeyId.startsWith("shell-")
        ? states
        : Object.fromEntries(Object.entries(states).map(([stateId, multiset]) => [stateId, multiset.filter(({ identity }) => !isShellIdentity(identity))])),
    ])),
  ]));
}
