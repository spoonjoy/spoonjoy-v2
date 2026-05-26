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
