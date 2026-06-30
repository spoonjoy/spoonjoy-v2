import type { Route } from "./+types/csp-report";
import { captureEvent, resolvePostHogServerConfig } from "~/lib/analytics-server";

/**
 * Content-Security-Policy violation sink.
 *
 * The report-only CSP (see `app/lib/security-headers.server.ts`) points both its
 * legacy `report-uri` AND its modern `report-to` (Reporting API) directive here,
 * so this route accepts BOTH body shapes:
 *
 *   - legacy `report-uri` (`application/csp-report`):
 *       { "csp-report": { "blocked-uri", "violated-directive",
 *         "effective-directive", "document-uri", "disposition", … } }
 *   - modern `report-to` / Reporting API (`application/reports+json`):
 *       [ { "type": "csp-violation", "body": { "blockedURL",
 *         "effectiveDirective", "documentURL", "disposition", … } }, … ]
 *
 * Browsers POST with no app credentials, so this route is intentionally public
 * (never calls `getUserId`). We extract a privacy-safe summary and forward it to
 * PostHog as `spoonjoy.csp_violation`. Reports must never disrupt the browser,
 * so every POST resolves to `204`: malformed / empty / unrecognized bodies are
 * swallowed (never 500), and capture is fire-and-forget. Non-POST methods get
 * `405`.
 */

const NO_CONTENT = 204;
const METHOD_NOT_ALLOWED = 405;

/** A single string field of a violation report. */
type ReportField = string | undefined;

/** Privacy-safe summary forwarded to analytics. Strings only — no nested data. */
type CspViolationProperties = Record<string, string>;

/** Output property → source key, for one report-body shape. */
type FieldKeyMap = Record<
  "blockedUri" | "violatedDirective" | "effectiveDirective" | "documentUri" | "disposition",
  string
>;

/** Legacy `report-uri` keys (kebab-case, on the `csp-report` object). */
const LEGACY_KEYS: FieldKeyMap = {
  blockedUri: "blocked-uri",
  violatedDirective: "violated-directive",
  effectiveDirective: "effective-directive",
  documentUri: "document-uri",
  disposition: "disposition",
};

/** Reporting API (`report-to`) keys (camelCase, inside each report's `body`). */
const REPORTING_API_KEYS: FieldKeyMap = {
  blockedUri: "blockedURL",
  violatedDirective: "violatedDirective",
  effectiveDirective: "effectiveDirective",
  documentUri: "documentURL",
  disposition: "disposition",
};

/** Narrow to a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Read a string field from the report, ignoring non-string/empty values. */
function readString(report: Record<string, unknown>, key: string): ReportField {
  const value = report[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Reduce a document URI to origin + path only, dropping any query string or
 * fragment that might carry user-entered content. Opaque-origin (`about:blank`,
 * `data:`) and non-URL values (`inline`) pass through verbatim — they have no
 * meaningful origin+path to reconstruct, so reducing them would mangle the
 * value rather than make it safer.
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

/** Pull the mapped, privacy-safe string fields out of one report body. */
function collectProperties(
  report: Record<string, unknown>,
  keys: FieldKeyMap,
): CspViolationProperties {
  const properties: CspViolationProperties = {};
  const blockedUri = readString(report, keys.blockedUri);
  if (blockedUri) properties.blockedUri = blockedUri;
  const violatedDirective = readString(report, keys.violatedDirective);
  if (violatedDirective) properties.violatedDirective = violatedDirective;
  const effectiveDirective = readString(report, keys.effectiveDirective);
  if (effectiveDirective) properties.effectiveDirective = effectiveDirective;
  const documentUri = sanitizeDocumentUri(readString(report, keys.documentUri));
  if (documentUri) properties.documentUri = documentUri;
  const disposition = readString(report, keys.disposition);
  if (disposition) properties.disposition = disposition;
  return properties;
}

/**
 * Build the privacy-safe property bag from a parsed body, accepting both the
 * legacy `report-uri` object and the modern Reporting API array. Returns `null`
 * when the body is not a usable CSP report (so the caller can no-op).
 */
function summarizeReport(parsed: unknown): CspViolationProperties | null {
  // Modern Reporting API (`report-to`): an array of reports. Summarize the
  // first CSP violation — CSP POSTs in practice carry a single report.
  if (Array.isArray(parsed)) {
    const violation = parsed.find(
      (entry) => isPlainObject(entry) && entry.type === "csp-violation",
    );
    if (!isPlainObject(violation) || !isPlainObject(violation.body)) {
      return null;
    }
    return collectProperties(violation.body, REPORTING_API_KEYS);
  }
  // Legacy `report-uri`: { "csp-report": {...} }.
  if (!isPlainObject(parsed) || !isPlainObject(parsed["csp-report"])) {
    return null;
  }
  return collectProperties(parsed["csp-report"], LEGACY_KEYS);
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
