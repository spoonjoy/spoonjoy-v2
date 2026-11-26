// The source for each app a move-in reads from its own server, by the job kind its start gave it (apps.ts).
import type { MoveInSource } from "../../application/source";
import { mealieApiSource } from "../sources/mealie-api/source";
import type { ServerApiConnection } from "../sources/server-api/client";
import { spoonjoyApiSource } from "../sources/spoonjoy-api/source";
import { MOVE_IN_APPS } from "./apps";

type ServerKind = (typeof MOVE_IN_APPS)[keyof typeof MOVE_IN_APPS]["serverKind"];

const SOURCES: Record<ServerKind, (connection: ServerApiConnection, home: string | null) => Promise<MoveInSource>> = {
  "mealie-api": mealieApiSource,
  "spoonjoy-api": spoonjoyApiSource,
};

/**
 * The source a server move-in of `serverKind` reads, through the cook's address and token. `home` is this Spoonjoy's
 * own address, by which another Spoonjoy's recipes that moved out of this one are found again.
 */
export function openServerSource(serverKind: string, connection: ServerApiConnection, home: string | null = null): Promise<MoveInSource> {
  return SOURCES[serverKind as ServerKind](connection, home);
}
