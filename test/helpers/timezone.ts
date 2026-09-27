// Runs `fn` with the process's local timezone set to `timeZone`, then puts the original back.
// Node re-reads TZ whenever process.env.TZ is assigned, so `new Date(y, m, d, ...)`,
// getTimezoneOffset() and toLocale*() without a timeZone follow it inside `fn`.
export async function withTimeZone<T>(timeZone: string, fn: () => T | Promise<T>): Promise<T> {
  const original = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    return await fn();
  } finally {
    if (original === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = original;
    }
  }
}
