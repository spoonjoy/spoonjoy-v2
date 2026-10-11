const seenMessages = new Set<string>();
const seenByKey = new WeakMap<object, Set<string>>();

const tidy = (text: string) => text.replace(/\.$/, "");

function format(component: string, problem: string, fix: string): string {
  return `[ouro-ui] ${component}: ${tidy(problem)}. Fix: ${tidy(fix)}.`;
}

/**
 * Logs one development-only warning in the format
 * `[ouro-ui] <Component>: <what's wrong>. Fix: <exact code>.`
 *
 * With a `key` (use a per-instance ref object) the warning is emitted once per
 * key and message; without one, once per message text. No-op in production.
 *
 * The check is the bare `process.env.NODE_ENV !== "production"` form, which
 * bundlers replace statically. Guard the call site the same way so the message
 * strings are removed from production builds too.
 *
 * @example
 * if (process.env.NODE_ENV !== "production") {
 *   devWarn("Button", '"bg-red-500" sets appearance', 'tone="destructive"', ref);
 * }
 */
export function devWarn(component: string, problem: string, fix: string, key?: object): void {
  /* istanbul ignore else @preserve -- the else path exists only in production bundles; scripts/dev-strip.test.mjs covers it */
  if (process.env.NODE_ENV !== "production") {
    const message = format(component, problem, fix);
    if (key) {
      let seen = seenByKey.get(key);
      if (!seen) {
        seen = new Set();
        seenByKey.set(key, seen);
      }
      if (seen.has(message)) return;
      seen.add(message);
    } else {
      if (seenMessages.has(message)) return;
      seenMessages.add(message);
    }
    console.warn(message);
  }
}

/**
 * Throws an `Error` for a misuse that cannot be recovered from. In development
 * the message teaches the fix; in production it is shortened to
 * `[ouro-ui] <Component>: <problem>`.
 *
 * Build the `fix` argument only in development so its text is stripped from
 * production builds.
 *
 * @example
 * devThrow(
 *   "Sheet.Title",
 *   "must be rendered inside <Sheet>",
 *   process.env.NODE_ENV !== "production" ? '<Sheet title="…">…</Sheet>' : "",
 * );
 */
export function devThrow(component: string, problem: string, fix: string): never {
  /* istanbul ignore else @preserve -- the else path exists only in production bundles; scripts/dev-strip.test.mjs covers it */
  if (process.env.NODE_ENV !== "production") {
    throw new Error(format(component, problem, fix));
  } else {
    throw new Error(`[ouro-ui] ${component}: ${problem}`);
  }
}
