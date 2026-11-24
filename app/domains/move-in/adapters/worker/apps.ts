// The apps a cook can move in from, by the value the form's choice sends, with the job kind each starts from a backup
// and from its server.
export const MOVE_IN_APPS = { mealie: { kind: "mealie-backup", serverKind: "mealie-api" } } as const;

/** Whether a job reads the other app's server, through the connection its start kept, rather than an uploaded backup. */
export function readsAServer(kind: string): boolean {
  return Object.values(MOVE_IN_APPS).some((app) => app.serverKind === kind);
}
