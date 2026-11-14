export {
  artFrameClass,
  dismissedKey,
  dismissPeriods,
  haloClass,
  isDismissed,
  kindToneClass,
  keepDismissed,
  MOMENT_STORAGE_PREFIX,
  periods,
  rootClass,
  SETTLE_MS,
  seenThisSession,
  sparkClasses,
  sparkleClass,
  subscribeMoments,
  takeShowing,
  type MomentKind,
  type MomentPeriod,
};

import { celebrationPeriods, takeCelebration, type CelebrationPeriod } from "~/lib/ouro/celebration-cap";

// Class strings, values and the stored-state helpers for Moment, apart from the component so
// its file exports only components (React Fast Refresh). Class strings are literal so the
// app's Tailwind finds them when it compiles.

/** What a moment is about. @internal */
type MomentKind = "empty" | "loading" | "error" | "first-run" | "success" | "ask";

/** How long a celebration cap counts showings for, shared with Celebrate. @internal */
type MomentPeriod = CelebrationPeriod;

/**
 * Each period in milliseconds; a month is 30 days.
 *
 * @internal
 * @claim "Each period in milliseconds; a month" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment cap > counts by id without a dismissKey, keeps ever for good, and never celebrates at times 0)
 */
const periods = celebrationPeriods;

/**
 * The prefix of every key Moment writes to `localStorage`.
 *
 * @internal
 * @claim "The prefix of every key Moment" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment dismissal > stays dismissed through dismissKey, after a remount and in another tab)
 * @claim "The prefix of every key Moment" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment cap > celebrates at most times per period, then again once the period has passed)
 */
const MOMENT_STORAGE_PREFIX = "ouro-moment:";

/** The key that remembers a dismissal. @internal */
const dismissedKey = (key: string) => `${MOMENT_STORAGE_PREFIX}dismissed:${key}`;


/** Values kept in memory, for a browser that refuses localStorage (a private window), so a dismissal still holds on the page. */
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

/**
 * Calls `onChange` when a moment is dismissed in this page or, through the storage event, in
 * another tab.
 *
 * @internal
 */
function subscribeMoments(onChange: () => void): () => void {
  listeners.add(onChange);
  addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    removeEventListener("storage", onChange);
  };
}

/**
 * How long an art's looping motion runs before it settles, in milliseconds.
 *
 * @internal
 * @claim "How long an art's looping motion" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment motion budget > settles the art's loops at the end of their turn within 5 s, SVG animations too, and leaves other motion alone)
 */
const SETTLE_MS = 5000;

const seenInMemory = new Set<string>();

/**
 * Whether a moment with this key has appeared before in this session (this tab, until it
 * closes), and from now on it has.
 *
 * @internal
 */
function seenThisSession(key: string): boolean {
  const name = `${MOMENT_STORAGE_PREFIX}seen:${key}`;
  try {
    if (sessionStorage.getItem(name) !== null) return true;
    sessionStorage.setItem(name, "1");
    return false;
  } catch {
    if (seenInMemory.has(name)) return true;
    seenInMemory.add(name);
    return false;
  }
}

/**
 * Whether the moment with this key was dismissed: for good, or, with `forMs`, less than that
 * long ago. A dismissal kept for good stays so.
 *
 * @internal
 */
function isDismissed(key: string, forMs: number | undefined, now: number): boolean {
  const value = read(dismissedKey(key));
  if (value === null) return false;
  const at = Number(value);
  return forMs === undefined || value === "1" || now - at < forMs;
}

/** How long a dismissal with `dismissFor` lasts, in milliseconds. @internal */
const dismissPeriods = { hour: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000, month: 30 * 24 * 60 * 60 * 1000 } as const;

/**
 * Remembers that the moment with this key was dismissed, and tells every moment on the page.
 *
 * @internal
 * @claim "Remembers that the moment with this" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment dismissal > closes every copy of a moment on the page at once)
 */
function keepDismissed(key: string, at: number | undefined): void {
  write(dismissedKey(key), at === undefined ? "1" : String(at));
  for (const listener of [...listeners]) listener();
}

/**
 * Whether a celebration may show now under `cap`, and if so, records it, under the same keys
 * as Celebrate's.
 *
 * @internal
 */
const takeShowing = takeCelebration;

/**
 * The colour each kind gives the art's `currentColor` and its celebration.
 *
 * @internal
 * @claim "The colour each kind gives the" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > names its kind in data-moment and colours the art from the theme by kind)
 */
const kindToneClass: Record<MomentKind, string> = {
  empty: "text-muted-foreground",
  loading: "text-muted-foreground",
  error: "text-destructive",
  "first-run": "text-primary",
  success: "text-success",
  ask: "text-primary",
};

/** The root, by layout. @internal */
const rootClass = {
  default: "@container/moment relative box-border flex w-full min-w-0 flex-col items-center gap-4 px-6 py-8 text-center text-balance",
  quiet: "relative box-border flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-start",
  inline: "relative box-border flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-start",
} as const;

/**
 * The art's frame, by layout: up to 160px tall, 96px when the moment is narrower than 24rem
 * (its content box, inside the padding, narrower than 21rem), and 24px inline.
 * The art fills the frame's height.
 *
 * @internal
 * @claim "The art's frame, by layout: up" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment sizes > gives the art 160px, 96px in a pane narrower than 24rem, and 24px inline)
 */
const artFrameClass = {
  default: "relative flex h-(--ouro-moment-art) max-w-full shrink-0 items-center justify-center [--ouro-moment-art:10rem] @max-[21rem]/moment:[--ouro-moment-art:6rem]",
  hero: "relative flex h-(--ouro-moment-art) max-w-full shrink-0 items-center justify-center [--ouro-moment-art:13.75rem] @max-[21rem]/moment:[--ouro-moment-art:6rem]",
  inline: "relative flex size-(--ouro-moment-art) shrink-0 items-center justify-center [--ouro-moment-art:1.5rem]",
} as const;

/**
 * The soft disc that swells out from behind the art when a moment celebrates; with reduced
 * motion it only fades.
 *
 * @internal
 */
const haloClass =
  "pointer-events-none absolute inset-0 m-auto size-(--ouro-moment-art) max-w-full rounded-full bg-current opacity-0 " +
  "[transition:transform_var(--ouro-duration-sheet)_var(--ouro-ease-out),opacity_var(--ouro-duration-sheet)_var(--ouro-ease-out)] " +
  "starting:opacity-20 motion-safe:starting:[transform:scale(0.5)]";

/**
 * A small four-pointed spark that grows beside the art and fades; it stays inside the art's
 * frame, and it is hidden with reduced motion.
 *
 * @internal
 * @claim "A small four-pointed spark that grows" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment > stays in the page's flow, and its celebration stays inside the art's frame)
 * @claim "A small four-pointed spark that grows" registry/ouro/components/ouro/moment/moment.test.tsx verify:testExists(registry/ouro/components/ouro/moment/moment.test.tsx::Moment motion > swells the disc and grows the sparks when it celebrates, and with reduced motion only fades the disc)
 */
const sparkleClass =
  "pointer-events-none absolute size-3 opacity-0 motion-reduce:hidden " +
  "[transition:transform_var(--ouro-duration-sheet)_var(--ouro-ease-out),opacity_var(--ouro-duration-slow)_ease_var(--ouro-duration-slow)] " +
  "starting:[transform:scale(0)] starting:opacity-100";

/** Where the sparks sit in the art's frame, and their tones. @internal */
const sparkClasses = ["start-[8%] top-[14%] text-primary", "end-[10%] top-[6%] text-warning", "end-[4%] bottom-[22%] text-success", "start-[16%] bottom-[8%] text-primary"] as const;
