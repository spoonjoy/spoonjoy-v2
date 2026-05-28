const HOST_REDIRECTS = new Map<string, string>([
  ["www.spoonjoy.app", "spoonjoy.app"],
]);

function forwardedHostname(hostHeader: string | null): string | null {
  const host = hostHeader?.split(",")[0]?.trim().toLowerCase();

  if (!host || host.startsWith("[")) {
    return null;
  }

  return host.split(":")[0] || null;
}

export function canonicalizeRequestUrl(input: string | URL): URL | null {
  const url = input instanceof URL ? new URL(input) : new URL(input);
  const canonicalHost = HOST_REDIRECTS.get(url.hostname.toLowerCase());

  if (!canonicalHost) {
    return null;
  }

  url.hostname = canonicalHost;
  url.protocol = "https:";
  return url;
}

export function canonicalizeRequestUrlForHost(input: string | URL, hostHeader: string | null): URL | null {
  const forwardedHost = forwardedHostname(hostHeader);
  const canonicalHost = forwardedHost ? HOST_REDIRECTS.get(forwardedHost) : undefined;

  if (!canonicalHost) {
    return canonicalizeRequestUrl(input);
  }

  const url = input instanceof URL ? new URL(input) : new URL(input);
  url.hostname = canonicalHost;
  url.protocol = "https:";
  return url;
}

export function canonicalizeOrigin(origin: string): string {
  const url = new URL(origin);
  const canonicalUrl = canonicalizeRequestUrl(url);
  return (canonicalUrl ?? url).origin;
}

// A hostname (optionally with a port). Rejects paths, embedded credentials, and
// other junk so a spoofed `X-Forwarded-Host` can't smuggle a different origin.
const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?::\d{1,5})?$/i;

function forwardedOrigin(request: Request): string | null {
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  if (!forwardedHost || !HOST_PATTERN.test(forwardedHost)) return null;

  // When the proxy doesn't send a proto, fall back to the request's own scheme
  // rather than assuming https. The local dev server forwards the host but not
  // the proto and serves plain http — hardcoding https there yields an origin
  // the browser rejects ("Unexpected registration response origin"). In prod
  // the request itself is https, so this still resolves to https.
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim().toLowerCase();
  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : new URL(request.url).protocol.replace(/:$/, "");
  return `${protocol}://${forwardedHost}`;
}

/**
 * The canonical origin the browser is actually on. The public domain fronts the
 * worker, so `request.url` carries the internal `*.workers.dev` host — the
 * forwarded host is what the user typed. Prefer the (validated) forwarded host,
 * fall back to the request origin for local dev, then canonicalize (www → apex).
 */
export function requestCanonicalOrigin(request: Request): string {
  const url = new URL(request.url);
  return canonicalizeOrigin(forwardedOrigin(request) ?? url.origin);
}
