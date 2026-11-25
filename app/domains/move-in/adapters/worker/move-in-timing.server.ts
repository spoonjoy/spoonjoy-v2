// Times where a move-in segment spends its time, port by port, so a slow move-in shows which stage
// to speed up. Each stage also counts its D1 round trips, which don't swing with load the way its
// milliseconds do. The segment's log line holds counts and milliseconds only: no ids, names or
// recipe text. scripts/summarize-worker-tail.jq adds a run's lines up for the Journeys summary.
import type { RangeSource } from "../archive/zip";
import type { MoveInPorts } from "../../application/run-move-in";

/** The stages a segment's time is split into. Whatever no port accounts for (parsing, mostly, and the claim) is the rest. */
export const MOVE_IN_STAGES = ["job", "backup", "recipeWrites", "photoWrites", "photoChecks", "organizers"] as const;
export type MoveInStage = (typeof MOVE_IN_STAGES)[number];

export type MoveInStageTimes = Record<MoveInStage, { calls: number; ms: number; d1: number }>;

/** Which stage a metered D1 binding's round trips count under: the one whose port call is running, if any. */
export interface D1Meter {
  stage: MoveInStage | null;
  times: MoveInStageTimes | null;
}

/** The D1 methods that each make one round trip. */
const D1_TRIPS = new Set(["batch", "exec", "first", "all", "run", "raw"]);

/**
 * A D1 binding that counts each round trip under the meter's stage, and the meter that timeMoveInPorts sets. A
 * prepared statement counts when it runs, not when it is bound; a trip outside any port call isn't counted.
 */
export function meterD1<T extends object>(db: T): { db: T; meter: D1Meter } {
  const meter: D1Meter = { stage: null, times: null };
  // The binding is handed its own statements back, so a batch never sees a wrapper.
  const wrapped = new WeakMap<object, object>();
  const unwrap = (value: unknown): unknown => (value && typeof value === "object" ? (wrapped.get(value) ?? value) : value);
  const wrap = <O extends object>(target: O): O => {
    const proxy = new Proxy(target, {
      get(object, key) {
        const value = Reflect.get(object, key, object) as unknown;
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (D1_TRIPS.has(String(key)) && meter.times && meter.stage) meter.times[meter.stage].d1 += 1;
          const plain = args.map((arg) => (Array.isArray(arg) ? arg.map(unwrap) : unwrap(arg)));
          const result = (value as (...args: unknown[]) => unknown).apply(object, plain);
          // prepare and bind hand back a statement, which counts when it runs.
          return key === "prepare" || key === "bind" ? wrap(result as object) : result;
        };
      },
    });
    wrapped.set(proxy, target);
    return proxy;
  };
  return { db: wrap(db), meter };
}

/**
 * The ports, each call added to its stage's count and time as it settles, and the times so far. With a meter, the D1
 * round trips a port call makes count under its stage, and a port called from inside another counts under the outer
 * one. The runner awaits each port call before the next, which this relies on: calls of two stages running at once
 * would count under whichever started first.
 */
export function timeMoveInPorts(ports: MoveInPorts, clock: () => number = Date.now, meter?: D1Meter): { ports: MoveInPorts; times: MoveInStageTimes } {
  const times = Object.fromEntries(MOVE_IN_STAGES.map((stage) => [stage, { calls: 0, ms: 0, d1: 0 }])) as MoveInStageTimes;
  if (meter) meter.times = times;
  let running = 0;
  const timed =
    <A extends unknown[], R>(stage: MoveInStage, call: (...args: A) => R | Promise<R>) =>
    async (...args: A): Promise<R> => {
      const started = clock();
      if (meter && running++ === 0) meter.stage = stage;
      try {
        return await call(...args);
      } finally {
        if (meter && --running === 0) meter.stage = null;
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
