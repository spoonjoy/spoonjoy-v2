import type { Route } from "./+types/csp-report";
import { captureEvent, resolvePostHogServerConfig } from "~/lib/analytics-server";

/**
 * Content-Security-Policy violation sink.
 *
 * The report-only CSP (see `app/lib/security-headers.server.ts`) points its
 * `report-uri` here. Browsers POST violation reports with no app credentials,
 * so this route is intentionally public — it never calls `getUserId`.
 *
 * Browsers using the legacy `report-uri` directive send the
 * `application/csp-report` body shape:
 *
 *     { "csp-report": { "blocked-uri", "violated-directive",
 *       "effective-directive", "document-uri", "disposition", ... } }
 *
 * We extract a privacy-safe summary and forward it to PostHog as
 * `spoonjoy.csp_violation`. Reports must never disrupt the browser, so every
 * POST resolves to `204`: malformed/empty bodies are swallowed (never 500),
 * and capture is fire-and-forget. Non-POST methods get `405`.
 */

const NO_CONTENT = 204;
const METHOD_NOT_ALLOWED = 405;

/** A single field of a legacy CSP violation report. */
type ReportField = string | undefined;

/** Privacy-safe summary forwarded to analytics. Strings only — no nested data. */
type CspViolationProperties = Record<string, string>;

/** Read a string field from the report, ignoring non-string values. */
function readString(report: Record<string, unknown>, key: string): ReportField {
  const value = report[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Reduce a `document-uri` to origin + path only, dropping any query string or
 * fragment that might carry user-entered content.
 *
 * Values with an opaque origin (`about:blank`, `data:`/`blob:` documents) and
 * non-URL values (some browsers send `inline`) are passed through verbatim:
 * those have no meaningful origin+path to reconstruct, so reducing them would
 * mangle the value rather than make it safer.
 */
function sanitizeDocumentUri(value: ReportField): ReportField {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.origin === "null") return value;
    return `${url.origin}${url.pathname}`;
  } catch {
    return value;
  }
}

/**
 * Extract the legacy `{ "csp-report": {...} }` payload from a parsed body.
 * Returns the privacy-safe property bag, or `null` when the body is not a
 * usable report (so the caller can no-op without capturing).
 */
function summarizeReport(parsed: unknown): CspViolationProperties | null {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const inner = (parsed as Record<string, unknown>)["csp-report"];
  if (inner === null || typeof inner !== "object" || Array.isArray(inner)) {
    return null;
  }
  const report = inner as Record<string, unknown>;

  const properties: CspViolationProperties = {};
  const blockedUri = readString(report, "blocked-uri");
  if (blockedUri) properties.blockedUri = blockedUri;
  const violatedDirective = readString(report, "violated-directive");
  if (violatedDirective) properties.violatedDirective = violatedDirective;
  const effectiveDirective = readString(report, "effective-directive");
  if (effectiveDirective) properties.effectiveDirective = effectiveDirective;
  const documentUri = sanitizeDocumentUri(readString(report, "document-uri"));
  if (documentUri) properties.documentUri = documentUri;
  const disposition = readString(report, "disposition");
  if (disposition) properties.disposition = disposition;

  return properties;
}

/** Parse the request body as JSON, returning `undefined` on empty/malformed input. */
async function parseReportBody(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    if (!text.trim()) return undefined;
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return new Response(null, { status: METHOD_NOT_ALLOWED });
  }

  const properties = summarizeReport(await parseReportBody(request));
  if (properties) {
    const cloudflare = context.cloudflare;
    const ctx = cloudflare?.ctx;
    const waitUntil = ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : undefined;
    const config = resolvePostHogServerConfig(cloudflare?.env ?? {});
    const capture = captureEvent(config, {
      event: "spoonjoy.csp_violation",
      distinctId: "anon",
      properties,
    });
    if (waitUntil) {
      waitUntil(capture);
    } else {
      // No Workers execution context (e.g. tests) — await so capture still runs.
      await capture;
    }
  }

  return new Response(null, { status: NO_CONTENT });
}
