// The apps a cook can move in from, by the value the form's choice sends, with the job kind each starts from a backup
// and from its server. Another Spoonjoy (spoonjoy.app, or a cook's own server) moves in only from its server: its
// account export names its photos by address, so a downloaded export alone can't bring them.
export const MOVE_IN_APPS = {
  mealie: { kind: "mealie-backup", serverKind: "mealie-api" },
  spoonjoy: { kind: null, serverKind: "spoonjoy-api" },
} as const satisfies Record<string, { kind: string | null; serverKind: string }>;

/** Whether a job reads the other app's server, through the connection its start kept, rather than an uploaded backup. */
export function readsAServer(kind: string): boolean {
  return Object.values(MOVE_IN_APPS).some((app) => app.serverKind === kind);
}

/** The app, as the form's choice names it, that a job of `kind` moves in from: Mealie for a kind no app starts. */
export function moveInAppOf(kind: string): keyof typeof MOVE_IN_APPS {
  const found = Object.entries(MOVE_IN_APPS).find(([, app]) => app.kind === kind || app.serverKind === kind);
  return (found?.[0] ?? "mealie") as keyof typeof MOVE_IN_APPS;
}
