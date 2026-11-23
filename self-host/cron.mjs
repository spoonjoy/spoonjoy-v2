// Runs the Worker's cron triggers (wrangler.json `triggers.crons`) on a timer, because Miniflare
// does not schedule them. Times are UTC, as Cloudflare runs them.

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day of month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day of week", min: 0, max: 7 },
];
const HORIZON_MS = 5 * 366 * 24 * 60 * 60_000;

function parseField(text, { name, min, max }, expression) {
  const values = new Set();
  for (const part of text.split(",")) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!match) throw new Error(`Can't read the cron expression "${expression}": bad ${name} "${part}".`);
    const start = match[1] === "*" ? min : Number(match[2]);
    const end = match[1] === "*" ? max : match[3] !== undefined ? Number(match[3]) : match[4] ? max : start;
    const step = match[4] ? Number(match[4]) : 1;
    if (start < min || end > max || start > end || step < 1) {
      throw new Error(`Can't read the cron expression "${expression}": ${name} "${part}" is out of range.`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return { any: text === "*", values };
}

function parseCron(expression) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Can't read the cron expression "${expression}": it needs five fields.`);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.map((part, index) => parseField(part, FIELDS[index], expression));
  if (dayOfWeek.values.has(7)) dayOfWeek.values.add(0);
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function dayMatches(cron, date) {
  const byMonthDay = cron.dayOfMonth.values.has(date.getUTCDate());
  const byWeekDay = cron.dayOfWeek.values.has(date.getUTCDay());
  // As in cron: when both day fields are restricted, either one matching is enough.
  if (!cron.dayOfMonth.any && !cron.dayOfWeek.any) return byMonthDay || byWeekDay;
  return byMonthDay && byWeekDay;
}

/** The first time strictly after `afterMs` (to the minute) that `expression` matches. */
export function nextCronTime(expression, afterMs) {
  const cron = parseCron(expression);
  const date = new Date(Math.floor(afterMs / 60_000) * 60_000 + 60_000);
  const limit = afterMs + HORIZON_MS;
  while (date.getTime() <= limit) {
    if (!cron.month.values.has(date.getUTCMonth() + 1)) {
      date.setUTCMonth(date.getUTCMonth() + 1, 1);
      date.setUTCHours(0, 0, 0, 0);
    } else if (!dayMatches(cron, date)) {
      date.setUTCDate(date.getUTCDate() + 1);
      date.setUTCHours(0, 0, 0, 0);
    } else if (!cron.hour.values.has(date.getUTCHours())) {
      date.setUTCHours(date.getUTCHours() + 1, 0, 0, 0);
    } else if (!cron.minute.values.has(date.getUTCMinutes())) {
      date.setUTCMinutes(date.getUTCMinutes() + 1, 0, 0);
    } else {
      return date.getTime();
    }
  }
  throw new Error(`The cron expression "${expression}" never matches.`);
}

/**
 * Calls `run(cron)` at each trigger's times until the returned stop function is called. A failed
 * run goes to `onError` and the timer carries on.
 */
export function startCronTimers(crons, run, onError = (error) => console.error(error)) {
  const timers = new Map();
  let stopped = false;
  const schedule = (cron) => {
    const delay = nextCronTime(cron, Date.now()) - Date.now();
    timers.set(cron, setTimeout(async () => {
      try {
        await run(cron);
      } catch (error) {
        onError(error);
      }
      if (!stopped) schedule(cron);
    }, delay));
  };
  for (const cron of crons) schedule(cron);
  return () => {
    stopped = true;
    for (const timer of timers.values()) clearTimeout(timer);
  };
}
