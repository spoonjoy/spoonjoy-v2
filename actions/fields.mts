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
