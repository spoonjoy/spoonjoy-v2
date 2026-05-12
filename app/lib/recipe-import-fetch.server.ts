/**
 * Safe HTTP wrapper for recipe-import.
 *
 * Enforces:
 *   - Scheme allowlist: http(s) only.
 *   - Hostname blocklist (loopback, private, link-local, IPv6 ULA/link-local).
 *   - 15s timeout (AbortController).
 *   - 5MB body cap (streamed byte counting).
 *   - text/html or application/xhtml+xml content-type.
 *
 * No real network is reached in unit tests — callers inject `deps.fetchImpl`.
 */

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export type SafeFetchCode =
  | "bad-scheme"
  | "blocked-host"
  | "timeout"
  | "too-large"
  | "non-2xx"
  | "not-html";

export class SafeFetchError extends Error {
  readonly code: SafeFetchCode;
  readonly status?: number;
  constructor(code: SafeFetchCode, message: string, status?: number) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
    this.status = status;
  }
}

export interface SafeFetchDeps {
  fetchImpl?: typeof fetch;
}

export interface SafeFetchResult {
  url: string;
  finalUrl: string;
  html: string;
  ogImageUrl: string | null;
}

function stripBrackets(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

function isIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function isBlockedIPv4(bytes: number[]): boolean {
  const [a, b] = bytes;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  return false;
}

function expandIPv6(host: string): number[] | null {
  // Returns 8 hextet values 0..0xffff, or null if not parseable.
  if (!/^[0-9a-f:]+$/i.test(host)) return null;
  const doubleColon = host.indexOf("::");
  let leftStr: string;
  let rightStr: string;
  if (doubleColon === -1) {
    leftStr = host;
    rightStr = "";
  } else {
    leftStr = host.slice(0, doubleColon);
    rightStr = host.slice(doubleColon + 2);
  }
  const left = leftStr === "" ? [] : leftStr.split(":");
  const right = rightStr === "" ? [] : rightStr.split(":");
  if (left.length + right.length > 8) return null;
  if (doubleColon === -1 && left.length !== 8) return null;
  const fillCount = 8 - left.length - right.length;
  const hextets: string[] = [
    ...left,
    ...Array(fillCount).fill("0"),
    ...right,
  ];
  const result: number[] = [];
  for (const h of hextets) {
    if (h.length === 0 || h.length > 4) return null;
    result.push(parseInt(h, 16));
  }
  return result;
}

function isBlockedIPv6(hextets: number[]): boolean {
  // ::1 loopback (all zero except last hextet = 1)
  if (
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0 &&
    hextets[6] === 0 &&
    hextets[7] === 1
  ) {
    return true;
  }
  // fc00::/7 — first 7 bits == 1111110 → first byte (high) of first hextet is 0xfc or 0xfd
  const first = hextets[0];
  const firstByte = (first >> 8) & 0xff;
  if (firstByte === 0xfc || firstByte === 0xfd) return true;
  // fe80::/10 — first 10 bits == 1111111010 → first hextet in [0xfe80, 0xfebf]
  if (first >= 0xfe80 && first <= 0xfebf) return true;
  return false;
}

export function isBlockedHost(hostname: string): boolean {
  const lower = stripBrackets(hostname.trim().toLowerCase());
  if (!lower) return true;
  if (lower === "localhost") return true;
  const v4 = isIPv4(lower);
  if (v4) return isBlockedIPv4(v4);
  if (lower.includes(":")) {
    const hextets = expandIPv6(lower);
    if (hextets) return isBlockedIPv6(hextets);
  }
  return false;
}

function extractOgImage(html: string): string | null {
  const metaRegex = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = metaRegex.exec(html)) !== null) {
    const tag = match[0];
    const propAttr = /\b(?:property|name)\s*=\s*(['"])og:image\1/i.test(tag);
    if (!propAttr) continue;
    const contentMatch =
      /\bcontent\s*=\s*"([^"]*)"/i.exec(tag) ??
      /\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    if (contentMatch && contentMatch[1]) {
      return contentMatch[1];
    }
  }
  return null;
}

function isHtmlContentType(value: string | null): boolean {
  if (!value) return false;
  const lower = value.toLowerCase();
  return (
    lower.startsWith("text/html") || lower.startsWith("application/xhtml+xml")
  );
}

async function readBodyCapped(
  response: Response,
  controller: AbortController,
): Promise<Uint8Array> {
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      controller.abort();
      throw new SafeFetchError("too-large", "Response body exceeds 5MB cap");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function fetchRecipeHtml(
  rawUrl: string,
  deps: SafeFetchDeps = {},
): Promise<SafeFetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("bad-scheme", `Cannot parse URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SafeFetchError(
      "bad-scheme",
      `Unsupported scheme: ${parsed.protocol}`,
    );
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new SafeFetchError(
      "blocked-host",
      `Hostname is blocked: ${parsed.hostname}`,
    );
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(parsed.toString(), { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeout);
    if (err && (err as { name?: string }).name === "AbortError") {
      throw new SafeFetchError("timeout", "Request timed out after 15s");
    }
    throw err;
  }
  clearTimeout(timeout);

  if (!response.ok) {
    throw new SafeFetchError(
      "non-2xx",
      `Non-2xx response: ${response.status}`,
      response.status,
    );
  }
  const contentType = response.headers.get("content-type");
  if (!isHtmlContentType(contentType)) {
    throw new SafeFetchError(
      "not-html",
      `Unsupported content-type: ${contentType ?? "(none)"}`,
    );
  }

  const bytes = await readBodyCapped(response, controller);
  const html = new TextDecoder("utf-8").decode(bytes);
  const finalUrl = response.url || parsed.toString();
  const rawOgImage = extractOgImage(html);
  let ogImageUrl: string | null = null;
  if (rawOgImage) {
    try {
      ogImageUrl = new URL(rawOgImage, finalUrl).toString();
    } catch {
      ogImageUrl = null;
    }
  }

  return {
    url: parsed.toString(),
    finalUrl,
    html,
    ogImageUrl,
  };
}
