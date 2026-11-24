// Times where a move-in segment spends its time, port by port, so a slow move-in shows which stage
// to speed up. The segment's log line holds counts and milliseconds only: no ids, names or recipe
// text. scripts/summarize-worker-tail.jq adds a run's lines up for the Journeys summary.
import type { RangeSource } from "../archive/zip";
import type { MoveInPorts } from "../../application/run-move-in";

/** The stages a segment's time is split into. Whatever no port accounts for (parsing, mostly, and the claim) is the rest. */
export const MOVE_IN_STAGES = ["job", "backup", "recipeWrites", "photoWrites", "photoChecks", "organizers"] as const;
export type MoveInStage = (typeof MOVE_IN_STAGES)[number];

export type MoveInStageTimes = Record<MoveInStage, { calls: number; ms: number }>;

/** The ports, each call added to its stage's count and time as it settles, and the times so far. */
export function timeMoveInPorts(ports: MoveInPorts, clock: () => number = Date.now): { ports: MoveInPorts; times: MoveInStageTimes } {
  const times = Object.fromEntries(MOVE_IN_STAGES.map((stage) => [stage, { calls: 0, ms: 0 }])) as MoveInStageTimes;
  const timed =
    <A extends unknown[], R>(stage: MoveInStage, call: (...args: A) => R | Promise<R>) =>
    async (...args: A): Promise<R> => {
      const started = clock();
      try {
        return await call(...args);
      } finally {
        times[stage].calls += 1;
        times[stage].ms += clock() - started;
      }
    };
  const timedSource = (source: RangeSource): RangeSource => ({ size: source.size, read: timed("backup", source.read.bind(source)) });
  const store = Object.fromEntries(
    Object.entries(ports.store).map(([name, call]) => [name, timed("job", (call as (...args: unknown[]) => unknown).bind(ports.store))]),
  ) as unknown as MoveInPorts["store"];
  return {
    times,
    ports: {
      ...ports,
      store,
      openArchive: async (job) => timedSource(await timed("backup", ports.openArchive)(job)),
      ownerEmail: timed("job", ports.ownerEmail),
      discardArchive: timed("backup", ports.discardArchive),
      writeRecipe: timed("recipeWrites", ports.writeRecipe),
      writeRecipes: ports.writeRecipes && timed("recipeWrites", ports.writeRecipes),
      attachPhoto: timed("photoWrites", ports.attachPhoto),
      attachPhotos: ports.attachPhotos && timed("photoWrites", ports.attachPhotos),
      hasMovedInPhoto: timed("photoChecks", ports.hasMovedInPhoto),
      organizers: ports.organizers && {
        on: ports.organizers.on,
        attach: timed("organizers", ports.organizers.attach),
        ...(ports.organizers.attachMany ? { attachMany: timed("organizers", ports.organizers.attachMany) } : {}),
      },
    },
  };
}

export interface MoveInSegmentTiming {
  /** How long the segment ran. */
  wallMs: number;
  /** How long its message waited between being queued and this delivery, retries included; null when it carried no time. */
  waitMs: number | null;
  /** Whether this run held the move-in; false when another run had it, null when the segment stopped on an error. */
  claimed: boolean | null;
  /** How many recipes the kitchen has, so a run's big move-in reads apart from its small ones; null before it is counted. */
  recipesFound: number | null;
  stages: MoveInStageTimes;
}

/** A segment's log line: counts and milliseconds under fixed keys, nothing else. */
export function moveInSegmentLine(timing: MoveInSegmentTiming): string {
  const { wallMs, waitMs, claimed, recipesFound, stages } = timing;
  return JSON.stringify({ event: "move_in_segment", wallMs, waitMs, claimed, recipesFound, stages });
}
