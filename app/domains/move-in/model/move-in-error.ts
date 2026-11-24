// What can stop a move-in, each with a plain message that tells the person how to fix it.

export const MOVE_IN_ERROR_MESSAGES = {
  "broken-zip": "That file isn't a zip archive we can open: it may have been cut short while downloading. Download the backup again and drop the .zip file here, without unzipping it.",
  "not-a-backup": "That zip isn't a backup we recognise. In your recipe app, make a backup under Settings, download it, and drop that file here.",
  "backup-too-large": "That backup is larger than move-in can read yet. Try a backup without old restore copies, or move in from your server address instead.",
  "pick-a-group": "That backup holds more than one kitchen, and none of them has a member with your Spoonjoy email. Give yourself the same email in both apps, then drop the backup here again.",
  stuck: "The move-in tried five times in a row without moving forward, so it has stopped. Move in again to carry on: recipes already in stay, and nothing comes in twice.",
  expired: "This move-in went a day without moving forward, so it stopped, and what it kept to reach your kitchen was deleted: a backup holds the other app's accounts, and a token opens them. Move in again to carry on: recipes already in stay, and nothing comes in twice.",
  "no-file": "Choose your backup's .zip file first, then press Move in.",
  "server-address": "That address doesn't answer like a recipe server. Copy the address you open your recipe app at, starting with https://, and paste it here again.",
  "server-token": "Your recipe server didn't accept that token. In your recipe app, make a new API token under your profile, then paste it here again.",
  "server-unreachable": "Spoonjoy couldn't reach your recipe server. It has to open from anywhere on the internet at an https address. If it only opens at home or on your own network, move in from a backup instead.",
  "server-busy": "Your recipe server kept asking Spoonjoy to wait, for half an hour, so the move-in has stopped. Move in again later to carry on: recipes already in stay, and nothing comes in twice.",
  "no-address": "Paste your recipe server's address first, then press Move in.",
  "no-token": "Paste your recipe app's API token first, then press Move in.",
  "too-many-tries": "That's a lot of tries in a row. Wait a minute, then press Move in again.",
  "unknown-app": "Move-in works only with the apps in the list so far. Pick one of those to carry on.",
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
