// What can stop a move-in, each with a plain message that tells the person how to fix it.

export const MOVE_IN_ERROR_MESSAGES = {
  "broken-zip": "That file isn't a zip archive we can open: it may have been cut short while downloading. Download the backup again and drop the .zip file here, without unzipping it.",
  "not-a-backup": "That zip isn't a backup we recognise. In your recipe app, make a backup under Settings, download it, and drop that file here.",
  "backup-too-large": "That backup is larger than move-in can read yet. Try a backup without old restore copies, or move in from your server address instead.",
  "pick-a-group": "That backup holds more than one kitchen. Pick the one you want to bring.",
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
