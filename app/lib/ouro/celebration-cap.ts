export { canCelebrate, celebrationPeriods, recordCelebration, takeCelebration, type CelebrationCap, type CelebrationPeriod };

// How often a celebration may show, kept per key in localStorage (or in memory where the browser
// refuses it), so `Moment` and `Celebrate` count under one key together.

/** How long a cap counts showings for. @internal */
type CelebrationPeriod = "day" | "week" | "month" | "ever";

/** At most `times` showings `per` period. @internal */
interface CelebrationCap {
  times: number;
  per: CelebrationPeriod;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Each period in milliseconds; a month is 30 days.
 *
 * @internal
 * @claim "Each period in milliseconds; a month" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment cap > counts by id without a dismissKey, keeps ever for good, and never celebrates at times 0)
 */
const celebrationPeriods: Record<CelebrationPeriod, number> = { day: DAY_MS, week: 7 * DAY_MS, month: 30 * DAY_MS, ever: Number.POSITIVE_INFINITY };

const PREFIX = "ouro-moment:shown:";
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return memory.get(PREFIX + key) ?? null;
  }
}

/** The showings inside the cap's period, oldest first. */
function recent(key: string, cap: CelebrationCap, now: number): number[] {
  let stored: unknown;
  try {
    // Stryker disable next-line StringLiteral: an empty string fails to parse, which leaves no showings, as "[]" does.
    stored = JSON.parse(read(key) ?? "[]");
  } catch {
    // A value that is no JSON counts as no showings.
  }
  const since = now - celebrationPeriods[cap.per];
  // Stryker disable next-line ArrayDeclaration: an entry put in the empty list is no number, so the filter drops it.
  return (Array.isArray(stored) ? stored : []).filter((time): time is number => typeof time === "number" && time > since && time <= now);
}

/**
 * Whether a celebration may show now under `cap`: fewer than `times` showings under `key`
 * inside the period. Records nothing.
 *
 * @internal
 */
function canCelebrate(key: string, cap: CelebrationCap, now: number): boolean {
  return recent(key, cap, now).length < cap.times;
}

/**
 * Records a showing now under `key`, keeping only those inside the cap's period.
 *
 * @internal
 */
function recordCelebration(key: string, cap: CelebrationCap, now: number): void {
  const value = JSON.stringify([...recent(key, cap, now), now]);
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    memory.set(PREFIX + key, value);
  }
}

/**
 * Whether a celebration may show now under `cap`, and if so, records it.
 *
 * @internal
 */
function takeCelebration(key: string, cap: CelebrationCap, now: number): boolean {
  if (!canCelebrate(key, cap, now)) return false;
  recordCelebration(key, cap, now);
  return true;
}
