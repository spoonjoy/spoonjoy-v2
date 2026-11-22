// Input fields that many of Spoonjoy's actions share, declared once with Ouro UI's action model.
import { field } from "../tools/ouro-actions/ouro-actions.mts";

/** Whose kitchen: only a local server with no signed-in person reads it. A signed-in caller always acts as themselves. */
export const ownerEmail = field.string({
  label: "Owner",
  description: "Optional. Whose kitchen, for a local server with no signed-in person; a signed-in caller always acts as themselves.",
  optional: true,
  protocolOnly: true,
});

/** A retry key, for a program that sends the same call again after a timeout. */
export const idempotencyKey = (description: string) =>
  field.string({ label: "Idempotency key", description, optional: true, protocolOnly: true });

/** A full-text query, with the search tools' comma rule. */
export const searchQuery = field.string({
  label: "Search",
  description: "The words to search for. Every word must match; commas separate alternatives, any of which may match.",
  optional: true,
});

/** How many results a search returns, 1 to 25. */
export const searchLimit = field.number({ label: "Limit", description: "The most results to return, 1 to 25.", optional: true, min: 1, max: 25 });

/** A page of a list: how many, and from where. */
export const pageLimit = (description: string) => field.number({ label: "Limit", description, optional: true });
export const pageOffset = field.number({ label: "Offset", description: "Zero-based pagination offset.", optional: true });

/** The bytes a photo upload takes: a start_photo_upload link's uploadId, or the bytes themselves base64-encoded. */
export const photoUploadId = field.string({
  label: "Upload",
  description: "The uploadId from start_photo_upload, after the photo was PUT to its putUrl. Use this or imageBase64, not both.",
  optional: true,
  protocolOnly: true,
});
export const photoImageBase64 = field.string({
  label: "Image",
  description: "The photo's bytes, base64-encoded. Use this or uploadId, not both; prefer uploadId, which keeps the bytes out of the conversation.",
  optional: true,
});
export const photoMimeType = field.enum({ label: "Type", description: "The photo's type. Required with imageBase64; with uploadId, Spoonjoy reads it from the bytes.", values: ["image/jpeg", "image/png", "image/webp"], optional: true });
export const photoFilename = (example: string) => field.string({ label: "File name", description: `The photo's file name, such as ${example}. Required with imageBase64; optional with uploadId.`, optional: true });

/** The steps a sandboxed chat follows to send a photo it holds as a file, so its bytes never pass through the conversation. */
export const PHOTO_UPLOAD_STEPS =
  "To send a photo that is a file (in a chat, an attachment is at /mnt/user-data/uploads/<name>): call start_photo_upload, run `curl -fsS -T /mnt/user-data/uploads/<name> \"<putUrl>\"` in your code sandbox, then pass the returned uploadId here. Never read the photo into the conversation or write it out as base64.";
