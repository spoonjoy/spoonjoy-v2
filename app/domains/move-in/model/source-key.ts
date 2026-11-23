// Source keys: how a row in another app's kitchen is named, so a second move-in finds what the first
// one brought and adds nothing twice. A key is unique inside one source kitchen (an ImportSource);
// GUIDs are spelled one way whatever database wrote them.

const GUID = /^[{]?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})[}]?$/;

/** A GUID in lower-case dashed form, from SQLite's undashed hex or Postgres's dashed form; null otherwise. */
export function normalizeGuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = GUID.exec(value.trim().toLowerCase());
  return match ? match.slice(1).join("-") : null;
}

/** A row's key: its GUID, or `<table>:<id>` for tables whose ids are integers. */
export function tableRowKey(table: string, id: unknown): string | null {
  const guid = normalizeGuid(id);
  if (guid) return guid;
  if (typeof id === "number" || (typeof id === "string" && id !== "")) return `${table}:${id}`;
  return null;
}

/** A join row's key: the pair of GUIDs it joins. */
export function joinKey(left: unknown, right: unknown): string | null {
  const a = normalizeGuid(left);
  const b = normalizeGuid(right);
  return a && b ? `${a}|${b}` : null;
}
