// How long a move-in has left, worked out from its rate so far. A move-in brings recipes in at a steady
// rate (the 500-recipe timing run held 83 to 87 a minute), so the rate so far predicts the rest.

/** Before this long, the rate so far says too little to go on. */
export const TIME_LEFT_AFTER_MS = 30_000;
/** Before this many recipes are in, the rate so far says too little to go on. */
export const TIME_LEFT_AFTER_RECIPES = 20;

const MINUTE_MS = 60_000;

/**
 * "About 4 minutes left" (rounded up) or "Less than a minute left", from the recipes in so far since they began to
 * come in; null until TIME_LEFT_AFTER_MS and TIME_LEFT_AFTER_RECIPES have both gone by, and once every recipe is in.
 */
export function timeLeft({ done, found, startedAt, now }: { done: number; found: number; startedAt: string; now: Date }): string | null {
  const elapsedMs = now.getTime() - Date.parse(startedAt);
  if (!(elapsedMs >= TIME_LEFT_AFTER_MS) || done < TIME_LEFT_AFTER_RECIPES || done >= found) return null;
  const leftMs = ((found - done) * elapsedMs) / done;
  if (leftMs < MINUTE_MS) return "Less than a minute left";
  const minutes = Math.ceil(leftMs / MINUTE_MS);
  return `About ${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
}
