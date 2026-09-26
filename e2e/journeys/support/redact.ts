// Shared URL redaction for anything the journeys or explore suite might surface outside the
// test process: an explore summary.json artifact (public), or a console-gate failure message
// printed into CI logs. Both keep only origin + pathname of a URL — no query string,
// fragment, or userinfo — since either surface can otherwise leak search terms, session
// identifiers, or other data that shouldn't leave the run.

// Keeps only origin + pathname of a single URL. `new URL()` throws for a relative URL (e.g. a
// dock item's href, which is app-relative); for that case there is no userinfo/origin to worry
// about, so the query string and fragment are just cut off directly.
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0];
  }
}

const EMBEDDED_URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;

// Cheap redaction for free-form console/pageerror text: finds any absolute URL substring and
// applies the same origin+pathname redaction, leaving the surrounding message untouched.
export function redactUrlsInText(text: string): string {
  return text.replace(EMBEDDED_URL_PATTERN, (match) => redactUrl(match));
}
