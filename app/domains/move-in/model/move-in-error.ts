// What can stop a move-in, each with a plain message that tells the person how to fix it.

export const MOVE_IN_ERROR_MESSAGES = {
  "broken-zip": "That file isn't a zip archive we can open: it may have been cut short while downloading. Download the backup again and drop the .zip file here, without unzipping it.",
  "not-a-backup": "That zip isn't a backup we recognise. In your recipe app, make a backup under Settings, download it, and drop that file here.",
  "backup-too-large": "That backup is larger than move-in can read yet. Try a backup without old restore copies, or move in from your server address instead.",
  "pick-a-group": "That backup holds more than one kitchen, and none of them has a member with your Spoonjoy email. Give yourself the same email in both apps, then drop the backup here again.",
  stuck: "The move-in hit the same problem five times in a row, so it has stopped. Drop the backup here again to carry on: recipes already in stay, and nothing comes in twice.",
  expired: "This move-in went a day without moving forward, so its backup was deleted: it holds the other app's accounts. Drop the backup here again to carry on: recipes already in stay, and nothing comes in twice.",
  "no-file": "Choose your backup's .zip file first, then press Move in.",
  "unknown-app": "Move-in reads backups only from the apps in the list so far. Pick one of those to carry on.",
} as const;

export type MoveInErrorCode = keyof typeof MOVE_IN_ERROR_MESSAGES;

export class MoveInError extends Error {
  constructor(
    readonly code: MoveInErrorCode,
    readonly detail?: string,
  ) {
    super(MOVE_IN_ERROR_MESSAGES[code]);
    this.name = "MoveInError";
  }
}
