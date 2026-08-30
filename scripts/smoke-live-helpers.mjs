import { execFileSync } from "node:child_process";

import {
  DEFAULT_PRODUCTION_BASE_URL,
  PRODUCTION_BASE_URLS,
  PRODUCTION_D1_DATABASE_NAME,
  QA_BASE_URL,
  QA_D1_DATABASE_NAME,
  QA_R2_BUCKET,
  arg,
  resolveScriptTarget,
  usesLocalD1,
} from "./script-environment.mjs";

export {
  DEFAULT_PRODUCTION_BASE_URL,
  PRODUCTION_BASE_URLS,
  PRODUCTION_D1_DATABASE_NAME,
  QA_BASE_URL,
  QA_D1_DATABASE_NAME,
  QA_R2_BUCKET,
  arg,
  usesLocalD1,
};

export const IMAGE_COVER_SMOKE_FLAG = "--include-image-cover-smoke";
const WORKER_VERSION_ID_FLAG = "--worker-version-id";
const WORKER_VERSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_VERSION_OVERRIDE_HEADER = "Cloudflare-Workers-Version-Overrides";
const WORKER_VERSION_RESPONSE_HEADER = "X-Spoonjoy-Worker-Version";
const WORKER_VERSION_READINESS_TIMEOUT_MS = 60_000;
const WORKER_VERSION_READINESS_INTERVAL_MS = 500;
const CLOUDFLARE_SECRET_ENV_NAMES = [
  "CF_API_KEY",
  "CF_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_D1_API_TOKEN",
  "CLOUDFLARE_EMAIL",
  "CLOUDFLARE_WORKERS_API_TOKEN",
];

export async function assertConsentActionRedirect(response) {
  const status = response.status();
  if (status === 302) return;

  const responseText = await response.text().catch(() => "<response body unavailable>");
  throw new Error(`Consent action failed with ${status}: ${responseText.slice(0, 200)}`);
}

function observePromise(promise) {
  return promise.then(
    (value) => ({ fulfilled: true, value }),
    (error) => ({ fulfilled: false, error }),
  );
}

function unwrapObservedPromise(outcome) {
  if (!outcome.fulfilled) throw outcome.error;
  return outcome.value;
}

export async function completeConsentSubmission({ callbackRequest, consentResponse, submit }) {
  // Observe both Playwright waiters before clicking so simultaneous timeouts
  // cannot surface as unhandled rejections outside the canary cleanup path.
  const callbackOutcome = observePromise(callbackRequest);
  const consentOutcome = observePromise(consentResponse);

  await submit();
  const consentActionResponse = unwrapObservedPromise(await consentOutcome);
  await assertConsentActionRedirect(consentActionResponse);
  const callbackRequestValue = unwrapObservedPromise(await callbackOutcome);
  return { callbackRequestValue, consentActionResponse };
}

function withoutCloudflareSecrets(env) {
  const sanitized = { ...env };
  for (const name of CLOUDFLARE_SECRET_ENV_NAMES) delete sanitized[name];
  return sanitized;
}

export function buildD1CommandEnvironment(env) {
  const token = env.CLOUDFLARE_D1_API_TOKEN ?? env.CLOUDFLARE_API_TOKEN;
  const scoped = withoutCloudflareSecrets(env);
  if (token) scoped.CLOUDFLARE_API_TOKEN = token;
  return scoped;
}

export function buildBrowserEnvironment(env) {
  const scoped = withoutCloudflareSecrets(env);
  delete scoped.CLOUDFLARE_ACCOUNT_ID;
  return scoped;
}

function normalizeWorkerVersionId(value) {
  if (typeof value !== "string" || !WORKER_VERSION_UUID.test(value)) {
    throw new Error("--worker-version-id must be supplied exactly once with a valid UUID.");
  }
  return value.toLowerCase();
}

export function buildWorkerVersionOverrideHeaders(workerVersionId) {
  if (workerVersionId === null) return {};
  const normalized = normalizeWorkerVersionId(workerVersionId);
  return {
    [WORKER_VERSION_OVERRIDE_HEADER]: `spoonjoy-v2="${normalized}"`,
  };
}

function headerEntries(headers) {
  if (headers instanceof Headers) return [...headers.entries()];
  if (typeof headers !== "object" || headers === null) return [];
  return Object.entries(headers);
}

function headerValue(headers, name) {
  return headerEntries(headers).find(([headerName]) => headerName.toLowerCase() === name.toLowerCase())?.[1] ?? null;
}

function workerVersionResponseId(headers) {
  const value = headerValue(headers, WORKER_VERSION_RESPONSE_HEADER);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function workerVersionReadinessError(expected, attempts, elapsedMs, lastObserved) {
  return new Error(
    `Candidate Worker ${expected} was not ready after ${attempts} ${attempts === 1 ? "attempt" : "attempts"} and ${elapsedMs}ms; last observed version: ${lastObserved ?? "missing"}.`,
  );
}

function isSameOrigin(requestUrl, baseUrl) {
  try {
    return new URL(requestUrl).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

export function isRouteActionResponse({ baseUrl, responseUrl, routePath, requestMethod }) {
  if (requestMethod.toUpperCase() !== "POST") return false;
  try {
    const response = new URL(responseUrl);
    return response.origin === new URL(baseUrl).origin
      && (response.pathname === routePath || response.pathname === `${routePath}.data`);
  } catch {
    return false;
  }
}

function isStaticAssetBindingUrl(requestUrl) {
  const pathname = new URL(requestUrl).pathname;
  return pathname === "/assets" || pathname.startsWith("/assets/");
}

export function buildWorkerVersionRequestHeaders({ baseUrl, requestUrl, headers = {}, workerVersionId }) {
  const normalized = workerVersionId === null ? null : normalizeWorkerVersionId(workerVersionId);
  const scopedHeaders = Object.fromEntries(
    headerEntries(headers).filter(([name]) => name.toLowerCase() !== WORKER_VERSION_OVERRIDE_HEADER.toLowerCase()),
  );
  if (normalized !== null && isSameOrigin(requestUrl, baseUrl)) {
    scopedHeaders[WORKER_VERSION_OVERRIDE_HEADER] = `spoonjoy-v2="${normalized}"`;
  }
  return scopedHeaders;
}

function cdpHeaders(headers) {
  return Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
}

export async function installWorkerVersionBrowserRouting(
  page,
  { baseUrl, workerVersionId, interceptRequest },
) {
  const session = await page.context().newCDPSession(page);
  let failure = null;

  await session.send("Fetch.enable", {
    patterns: [{ requestStage: "Request", urlPattern: "*" }],
  });
  session.on("Fetch.requestPaused", async (event) => {
    try {
      const intercepted = await interceptRequest(event.request);
      if (intercepted !== null) {
        await session.send("Fetch.fulfillRequest", {
          requestId: event.requestId,
          responseCode: intercepted.status,
          responseHeaders: cdpHeaders(intercepted.headers),
          body: Buffer.from(intercepted.body).toString("base64"),
        });
        return;
      }

      const headers = buildWorkerVersionRequestHeaders({
        baseUrl,
        requestUrl: event.request.url,
        headers: event.request.headers,
        workerVersionId,
      });
      await session.send("Fetch.continueRequest", {
        requestId: event.requestId,
        headers: cdpHeaders(headers),
      });
    } catch (error) {
      failure = new Error(`Chromium request interception failed: ${String(error)}`);
      await session.send("Fetch.failRequest", {
        requestId: event.requestId,
        errorReason: "Aborted",
      }).catch(() => undefined);
    }
  });

  return {
    assertHealthy() {
      if (failure !== null) throw failure;
    },
  };
}

export function assertWorkerVersionResponse(headers, workerVersionId, label = "Spoonjoy response") {
  if (workerVersionId === null) return;
  const expected = normalizeWorkerVersionId(workerVersionId);
  const actual = workerVersionResponseId(headers);

  if (!actual) {
    throw new Error(`${label} is missing ${WORKER_VERSION_RESPONSE_HEADER}; candidate Worker ${expected} was not proven.`);
  }
  if (actual.toLowerCase() !== expected) {
    throw new Error(`${label} expected candidate Worker ${expected} but received ${actual}.`);
  }
}

export async function waitForWorkerVersionReady({
  workerVersionId,
  probe,
  timeoutMs = WORKER_VERSION_READINESS_TIMEOUT_MS,
  intervalMs = WORKER_VERSION_READINESS_INTERVAL_MS,
  now = Date.now,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
}) {
  if (workerVersionId === null) {
    return { attempts: 0, elapsedMs: 0, workerVersionId: null };
  }
  const expected = normalizeWorkerVersionId(workerVersionId);
  if (typeof probe !== "function") {
    throw new Error("Worker version readiness requires a probe function.");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Worker version readiness timeout must be a positive finite number.");
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("Worker version readiness interval must be a positive finite number.");
  }

  const startedAt = now();
  let attempts = 0;
  let lastObserved = null;
  while (true) {
    const elapsedBeforeProbe = Math.max(0, now() - startedAt);
    if (attempts > 0 && elapsedBeforeProbe >= timeoutMs) {
      throw workerVersionReadinessError(expected, attempts, elapsedBeforeProbe, lastObserved);
    }
    attempts += 1;
    const remainingMs = Math.max(1, timeoutMs - elapsedBeforeProbe);
    lastObserved = workerVersionResponseId(await probe(attempts, remainingMs));
    const elapsedMs = Math.max(0, now() - startedAt);
    if (elapsedMs >= timeoutMs) {
      throw workerVersionReadinessError(expected, attempts, elapsedMs, lastObserved);
    }
    if (lastObserved?.toLowerCase() === expected) {
      return { attempts, elapsedMs, workerVersionId: expected };
    }
    await sleep(Math.min(intervalMs, timeoutMs - elapsedMs));
  }
}

export async function waitForBrowserWorkerVersionReady({
  workerVersionId,
  navigate,
  timeoutMs = WORKER_VERSION_READINESS_TIMEOUT_MS,
  intervalMs = WORKER_VERSION_READINESS_INTERVAL_MS,
  now = Date.now,
  sleep,
}) {
  if (workerVersionId !== null && typeof navigate !== "function") {
    throw new Error("Browser Worker readiness requires a navigate function.");
  }
  return waitForWorkerVersionReady({
    workerVersionId,
    timeoutMs,
    intervalMs,
    now,
    sleep,
    probe: async (attempt, remainingMs) => {
      try {
        const response = await navigate({ attempt, timeoutMs: remainingMs });
        return response?.status === 200 ? response.headers : {};
      } catch {
        return {};
      }
    },
  });
}

export async function waitForWorkerChannelsReady({
  workerVersionId,
  probes,
  timeoutMs = WORKER_VERSION_READINESS_TIMEOUT_MS,
  intervalMs = WORKER_VERSION_READINESS_INTERVAL_MS,
  now = Date.now,
  sleep,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (workerVersionId === null) {
    return { attempts: 0, elapsedMs: 0, workerVersionId: null };
  }
  if (!Array.isArray(probes) || probes.length < 2 || probes.some((probe) => typeof probe !== "function")) {
    throw new Error("Worker channel readiness requires at least two channel probe functions.");
  }
  const expected = normalizeWorkerVersionId(workerVersionId);
  let consecutiveReadyCycles = 0;

  return waitForWorkerVersionReady({
    workerVersionId,
    timeoutMs,
    intervalMs,
    now,
    sleep,
    probe: async (attempt, remainingMs) => {
      const responses = await Promise.all(probes.map(async (probe) => {
        let timer;
        const deadline = new Promise((resolve) => {
          timer = setTimer(() => resolve(null), remainingMs);
        });
        try {
          return await Promise.race([
            Promise.resolve()
              .then(() => probe({ attempt, timeoutMs: remainingMs }))
              .catch(() => null),
            deadline,
          ]);
        } finally {
          clearTimer(timer);
        }
      }));
      const allChannelsReady = responses.every((response) => (
        response?.status === 200
        && workerVersionResponseId(response.headers)?.toLowerCase() === expected
      ));
      consecutiveReadyCycles = allChannelsReady ? consecutiveReadyCycles + 1 : 0;
      return consecutiveReadyCycles >= 2 ? { [WORKER_VERSION_RESPONSE_HEADER]: expected } : {};
    },
  });
}

export function createWorkerVersionResponseTracker({ baseUrl, workerVersionId }) {
  const expected = workerVersionId === null ? null : normalizeWorkerVersionId(workerVersionId);
  const records = [];

  const assertSince = (checkpoint, phase) => {
    if (expected === null) return;
    if (!Number.isInteger(checkpoint) || checkpoint < 0 || checkpoint > records.length) {
      throw new Error(`${phase} used an invalid Worker response checkpoint.`);
    }
    const phaseRecords = records.slice(checkpoint);
    if (phaseRecords.length === 0) {
      throw new Error(`${phase} observed no Spoonjoy responses to verify.`);
    }
    const failures = phaseRecords.filter((record) => record.error !== null);
    if (failures.length > 0) {
      throw new Error(`${phase}: ${failures.map((record) => record.error.message).join(" ")}`);
    }
  };

  return {
    checkpoint() {
      return records.length;
    },
    record({ url, headers, label = url }) {
      if (expected === null || !isSameOrigin(url, baseUrl) || isStaticAssetBindingUrl(url)) return false;
      let error = null;
      try {
        assertWorkerVersionResponse(headers, expected, label);
      } catch (caught) {
        error = caught instanceof Error ? caught : new Error(String(caught));
      }
      records.push({ error });
      return true;
    },
    assertSince,
    assertAll(phase) {
      assertSince(0, phase);
    },
  };
}

export function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function shouldRunAppleOAuthCheck(targetEnv) {
  return targetEnv === "production";
}

const OAUTH_EVIDENCE_KEYS = [
  "provider",
  "appOrigin",
  "controllerPath",
  "documentPath",
  "providerHost",
  "clientIdMatches",
  "redirectUriMatches",
  "responseModeMatches",
  "redirectToPreserved",
  "publicSignInMarkerPresent",
  "publicErrorSentinelAbsent",
  "cspViolations",
];
const OAUTH_PROVIDERS = new Set(["apple", "github", "google"]);
const CSP_DIRECTIVES = new Set([
  "base-uri",
  "child-src",
  "connect-src",
  "default-src",
  "font-src",
  "form-action",
  "frame-ancestors",
  "frame-src",
  "img-src",
  "manifest-src",
  "media-src",
  "object-src",
  "script-src",
  "script-src-attr",
  "script-src-elem",
  "style-src",
  "style-src-attr",
  "style-src-elem",
  "worker-src",
]);
const OAUTH_CSP_PHASES = new Set([
  "login-load",
  "service-worker-control",
  "provider-click",
  "provider-handoff",
]);

function safeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "invalid";
  }
}

function safePath(value) {
  try {
    return new URL(value, "https://projection.invalid").pathname;
  } catch {
    return "/invalid";
  }
}

function projectOAuthCspViolation(violation) {
  const rawDirective = violation?.directive ?? violation?.effectiveDirective;
  const rawDocument = violation?.documentPath ?? violation?.documentUrl;
  const rawBlocked = violation?.blockedOrigin ?? violation?.blockedUrl;
  const rawPhase = violation?.phase;
  return {
    directive: CSP_DIRECTIVES.has(rawDirective) ? rawDirective : "unknown",
    documentPath: safePath(rawDocument),
    blockedOrigin: safeOrigin(rawBlocked),
    phase: OAUTH_CSP_PHASES.has(rawPhase) ? rawPhase : "unknown",
  };
}

function projectOAuthNavigationEvidence(evidence) {
  const projection = {
    provider: OAUTH_PROVIDERS.has(evidence?.provider) ? evidence.provider : "unknown",
    appOrigin: safeOrigin(evidence?.appOrigin),
    controllerPath: safePath(evidence?.controllerPath),
    documentPath: safePath(evidence?.documentPath),
    providerHost: typeof evidence?.providerHost === "string" && /^[a-z0-9.-]+$/i.test(evidence.providerHost)
      ? evidence.providerHost.toLowerCase()
      : "invalid",
    clientIdMatches: evidence?.clientIdMatches === true,
    redirectUriMatches: evidence?.redirectUriMatches === true,
    responseModeMatches: evidence?.responseModeMatches === true,
    redirectToPreserved: evidence?.redirectToPreserved === true,
    publicSignInMarkerPresent: evidence?.publicSignInMarkerPresent === true,
    publicErrorSentinelAbsent: evidence?.publicErrorSentinelAbsent === true,
    cspViolations: Array.isArray(evidence?.cspViolations)
      ? evidence.cspViolations.map(projectOAuthCspViolation)
      : [],
  };
  return Object.fromEntries(OAUTH_EVIDENCE_KEYS.map((key) => [key, projection[key]]));
}

export function serializeOAuthNavigationEvidence(evidence) {
  return JSON.stringify(projectOAuthNavigationEvidence(evidence), null, 2);
}

async function observeOAuthNavigationWithPage(input) {
  const { page, appOrigin, provider, publicSignInMarker, publicErrorSentinel, redirectTo } = input;
  const cspViolations = [];
  const cspBinding = "__spoonjoyReportOAuthCspViolation";
  await page.exposeFunction(cspBinding, (violation) => {
    const documentOrigin = safeOrigin(violation?.documentUrl);
    if (
      documentOrigin === new URL(appOrigin).origin
      && OAUTH_CSP_PHASES.has(violation?.phase)
      && violation.phase !== "provider-handoff"
    ) {
      cspViolations.push(violation);
    }
  });
  await page.addInitScript((reportBinding) => {
    globalThis.__spoonjoyOAuthCanary = { phase: "login-load" };
    globalThis.addEventListener("securitypolicyviolation", (event) => {
      globalThis[reportBinding]?.({
        effectiveDirective: event.effectiveDirective || event.violatedDirective,
        documentUrl: event.documentURI,
        blockedUrl: event.blockedURI,
        phase: globalThis.__spoonjoyOAuthCanary.phase,
      });
    });
  }, cspBinding);

  const login = new URL("/login", appOrigin);
  if (redirectTo) login.searchParams.set("redirectTo", redirectTo);
  await page.goto(login.toString(), { waitUntil: "load" });
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return;
    globalThis.__spoonjoyOAuthCanary.phase = "service-worker-control";
    await navigator.serviceWorker.ready;
  });
  let controllerUrl = await page.evaluate(() => navigator.serviceWorker?.controller?.scriptURL ?? null);
  if (controllerUrl === null) {
    await page.reload({ waitUntil: "load" });
    controllerUrl = await page.evaluate(() => navigator.serviceWorker?.controller?.scriptURL ?? null);
  }

  const link = page.getByRole("link", {
    name: `Continue with ${provider[0].toUpperCase()}${provider.slice(1)}`,
  });
  let documentUrl = null;
  const cdp = await page.context().newCDPSession(page);
  const frameTree = await cdp.send("Page.getFrameTree");
  const rootFrameId = frameTree.frameTree.frame.id;
  const onDocumentRequest = (event) => {
    if (
      event.type === "Document"
      && event.frameId === rootFrameId
      && safeOrigin(event.request?.url) === new URL(appOrigin).origin
      && safePath(event.request?.url) === `/auth/${provider}`
    ) {
      documentUrl = event.request.url;
    }
  };
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", onDocumentRequest);
  await page.evaluate(() => {
    globalThis.__spoonjoyOAuthCanary.phase = "provider-click";
  });
  try {
    await Promise.all([
      page.waitForURL((url) => url.origin !== appOrigin, { timeout: 15_000 }),
      link.click(),
    ]);
  } finally {
    cdp.off("Network.requestWillBeSent", onDocumentRequest);
    await cdp.detach();
  }

  await page.evaluate(() => {
    globalThis.__spoonjoyOAuthCanary.phase = "provider-handoff";
  });
  const markerByText = await page.getByText(publicSignInMarker, { exact: false }).first().isVisible().catch(() => false);
  const title = await page.title();
  const sentinelByText = await page.getByText(publicErrorSentinel, { exact: false }).first().isVisible().catch(() => false);

  return {
    controllerUrl,
    documentUrl,
    providerUrl: page.url(),
    publicSignInMarkerPresent: markerByText || title.includes(publicSignInMarker),
    publicErrorSentinelPresent: sentinelByText || title.includes(publicErrorSentinel),
    cspViolations,
  };
}

export async function runOAuthNavigationCanary({
  page,
  provider,
  appOrigin,
  expectedProviderHost,
  expectedProviderPath,
  expectedClientId,
  expectedRedirectUri,
  expectedResponseMode,
  redirectTo = null,
  publicSignInMarker,
  publicErrorSentinel,
  observe = observeOAuthNavigationWithPage,
}) {
  const controllerPath = "/sw.js";
  const documentPath = `/auth/${provider}`;
  const observation = await observe({
    page,
    provider,
    appOrigin,
    controllerPath,
    documentPath,
    expectedProviderHost,
    expectedProviderPath,
    expectedClientId,
    expectedRedirectUri,
    expectedResponseMode,
    redirectTo,
    publicSignInMarker,
    publicErrorSentinel,
  });

  if (!observation?.controllerUrl) {
    throw new Error("OAuth navigation did not establish a service-worker controller.");
  }
  const controller = new URL(observation.controllerUrl);
  if (controller.origin !== new URL(appOrigin).origin || controller.pathname !== controllerPath) {
    throw new Error("OAuth navigation controller did not use the expected /sw.js script.");
  }

  if (!observation?.documentUrl) {
    throw new Error(`OAuth document navigation did not request ${documentPath}.`);
  }
  const document = new URL(observation.documentUrl);
  if (document.origin !== new URL(appOrigin).origin || document.pathname !== documentPath) {
    throw new Error(`OAuth document navigation did not request ${documentPath}.`);
  }
  const redirectToPreserved = redirectTo
    ? document.searchParams.get("redirectTo") === redirectTo
    : !document.searchParams.has("redirectTo");
  if (!redirectToPreserved) {
    throw new Error("OAuth document navigation did not preserve redirectTo exactly once.");
  }

  const providerUrl = new URL(observation.providerUrl);
  const clientIdMatches = providerUrl.searchParams.get("client_id") === expectedClientId;
  const redirectUriMatches = providerUrl.searchParams.get("redirect_uri") === expectedRedirectUri;
  const responseModeMatches = providerUrl.searchParams.get("response_mode") === expectedResponseMode;
  if (providerUrl.host !== expectedProviderHost) throw new Error("OAuth provider host did not match the expected handoff.");
  if (providerUrl.pathname !== expectedProviderPath) throw new Error("OAuth provider path did not match the expected handoff.");
  if (!clientIdMatches) throw new Error("OAuth provider handoff used an unexpected client ID.");
  if (!redirectUriMatches) throw new Error("OAuth provider handoff used an unexpected redirect URI.");
  if (!responseModeMatches) throw new Error("OAuth provider handoff used an unexpected response mode.");
  if (observation.publicSignInMarkerPresent !== true) throw new Error("OAuth provider public sign-in marker was absent.");
  if (observation.publicErrorSentinelPresent === true) throw new Error("OAuth provider public error sentinel was present.");

  const cspViolations = Array.isArray(observation.cspViolations)
    ? observation.cspViolations.map(projectOAuthCspViolation)
    : [];
  if (cspViolations.length > 0) throw new Error("OAuth navigation observed a scoped CSP violation.");

  return projectOAuthNavigationEvidence({
    provider,
    appOrigin,
    controllerPath: controller.pathname,
    documentPath: document.pathname,
    providerHost: providerUrl.host,
    clientIdMatches,
    redirectUriMatches,
    responseModeMatches,
    redirectToPreserved,
    publicSignInMarkerPresent: true,
    publicErrorSentinelAbsent: true,
    cspViolations,
  });
}

export function parseSmokeArgs(argv = process.argv.slice(2), env = process.env) {
  const target = resolveScriptTarget({
    argv,
    env,
    defaultBaseUrl: env.SPOONJOY_SMOKE_BASE_URL ?? DEFAULT_PRODUCTION_BASE_URL,
  });
  const { baseUrl, targetEnv } = target;
  const outDir = arg(argv, "--out", "live-smoke-artifacts");
  const includeImageCoverSmoke = argv.includes(IMAGE_COVER_SMOKE_FLAG);
  if (includeImageCoverSmoke && targetEnv !== "qa") {
    throw new Error("The image-cover smoke is QA-only and must use `--target-env qa`.");
  }

  return {
    baseUrl,
    includeImageCoverSmoke,
    outDir,
    targetEnv,
    target,
    shouldCleanup: !argv.includes("--keep-smoke-data"),
  };
}

export function parseMcpCanaryArgs(argv = process.argv.slice(2), env = process.env) {
  const target = resolveScriptTarget({
    argv,
    env,
    defaultBaseUrl: env.SPOONJOY_MCP_CANARY_BASE_URL ?? "https://spoonjoy.app",
  });
  const versionFlagCount = argv.filter((value) => value === WORKER_VERSION_ID_FLAG).length;
  if (versionFlagCount > 1) {
    throw new Error("--worker-version-id must be supplied exactly once with a valid UUID.");
  }
  const rawWorkerVersionId = arg(argv, WORKER_VERSION_ID_FLAG, null);
  const workerVersionId = rawWorkerVersionId === null ? null : normalizeWorkerVersionId(rawWorkerVersionId);

  return {
    baseUrl: target.baseUrl,
    outDir: arg(argv, "--out", "mcp-oauth-canary-artifacts"),
    targetEnv: target.targetEnv,
    target,
    shouldCleanup: !argv.includes("--keep-smoke-data"),
    includeLegacyDbProbe: !argv.includes("--skip-legacy-db-probe"),
    workerVersionId,
  };
}

export function parseMcpOAuthAuditArgs(argv = process.argv.slice(2), env = process.env) {
  const target = resolveScriptTarget({
    argv,
    env,
    defaultBaseUrl: env.SPOONJOY_MCP_AUDIT_BASE_URL ?? "https://spoonjoy.app",
  });
  return {
    baseUrl: target.baseUrl,
    outDir: arg(argv, "--out", "mcp-oauth-d1-audit-artifacts"),
    targetEnv: target.targetEnv,
    target,
  };
}

function d1ExecuteTarget(targetEnv) {
  if (targetEnv === "local") {
    return {
      database: "DB",
      args: resolveScriptTarget({ argv: ["--base-url", "http://localhost"], defaultBaseUrl: "http://localhost" }).d1Args,
    };
  }
  if (targetEnv === "qa") {
    return { database: QA_D1_DATABASE_NAME, args: ["--remote"] };
  }
  if (targetEnv === "production") {
    return { database: PRODUCTION_D1_DATABASE_NAME, args: ["--remote"] };
  }
  throw new Error("D1 smoke operation requires targetEnv local, qa, or production.");
}

export function buildCleanupD1Args(email, { targetEnv }) {
  const command = `DELETE FROM "User" WHERE email = ${sqlString(email)};`;
  return buildD1CommandArgs(command, { targetEnv });
}

export function buildD1CommandArgs(command, { targetEnv }) {
  const target = d1ExecuteTarget(targetEnv);
  return ["exec", "wrangler", "d1", "execute", target.database, ...target.args, "--command", command];
}

export function buildUserCountD1Args(email, { targetEnv }) {
  const command = `SELECT COUNT(*) AS count FROM "User" WHERE email = ${sqlString(email)};`;
  return buildD1CommandArgs(command, { targetEnv });
}

export function buildMcpCanaryUserLookupD1Args(email, { targetEnv }) {
  return buildD1CommandArgs(`SELECT id FROM "User" WHERE email = ${sqlString(email)} LIMIT 1;`, { targetEnv });
}

export function buildMcpCanaryLegacyRefreshInsertD1Args(input, { targetEnv }) {
  return buildD1CommandArgs([
    `INSERT INTO "OAuthRefreshToken" (id, tokenHash, userId, clientId, scope, resource, connectionKey, revokedAt, createdAt)`,
    `VALUES (${sqlString(input.id)}, ${sqlString(input.tokenHash)}, ${sqlString(input.userId)}, ${sqlString(input.clientId)}, ${sqlString(input.scope)}, NULL, ${sqlString(input.connectionKey)}, NULL, CURRENT_TIMESTAMP);`,
  ].join(" "), { targetEnv });
}

export function buildMcpCanaryConnectionResourceD1Args(input, { targetEnv }) {
  return buildD1CommandArgs([
    `SELECT resource FROM "OAuthRefreshToken"`,
    `WHERE userId = ${sqlString(input.userId)} AND clientId = ${sqlString(input.clientId)} AND connectionKey = ${sqlString(input.connectionKey)} AND revokedAt IS NULL`,
    `ORDER BY createdAt DESC LIMIT 1;`,
  ].join(" "), { targetEnv });
}

export function buildMcpCanaryCleanupD1Args(input, { targetEnv }) {
  const commands = [
    `DELETE FROM "OAuthGrant" WHERE connectionKey = ${sqlString(input.connectionKey)};`,
    `DELETE FROM "OAuthRefreshToken" WHERE connectionKey = ${sqlString(input.connectionKey)};`,
  ];
  if (input.clientId) {
    commands.push(`DELETE FROM "OAuthClient" WHERE id = ${sqlString(input.clientId)};`);
  }
  commands.push(`DELETE FROM "User" WHERE email = ${sqlString(input.email)};`);
  return buildD1CommandArgs(commands.join(" "), { targetEnv });
}

export function buildMcpOAuthInvariantAuditD1Args({ targetEnv }) {
  return buildD1CommandArgs([
    `WITH grant_cutoff_raw(row_count, nonnull_count, applied_at) AS (SELECT COUNT(*), COUNT(applied_at), datetime(MIN(applied_at)) FROM d1_migrations WHERE name = '0027_oauth_grants_and_lineage.sql'), grant_cutoff(applied_at, invalid) AS (SELECT CASE WHEN row_count = 1 AND nonnull_count = 1 AND applied_at IS NOT NULL THEN applied_at ELSE datetime('0000-01-01') END, CASE WHEN row_count = 1 AND nonnull_count = 1 AND applied_at IS NOT NULL THEN 0 ELSE 1 END FROM grant_cutoff_raw), audit(invariant, count) AS (VALUES`,
    `('active_refresh_missing_resource', (SELECT COUNT(*) FROM "OAuthRefreshToken" rt_missing JOIN "OAuthClient" oc_missing ON oc_missing.id = rt_missing.clientId WHERE rt_missing.revokedAt IS NULL AND rt_missing.resource IS NULL AND oc_missing.revokedAt IS NULL AND lower(trim(oc_missing.clientName)) = 'claude' AND oc_missing.redirectUris = 'https://claude.ai/api/mcp/auth_callback')),`,
    `('duplicate_active_connection_keys', (SELECT COUNT(*) FROM (SELECT connectionKey FROM "OAuthRefreshToken" WHERE revokedAt IS NULL AND connectionKey IS NOT NULL GROUP BY connectionKey HAVING COUNT(*) > 1))),`,
    `('access_refresh_resource_mismatch', (SELECT COUNT(*) FROM "ApiCredential" ac WHERE ac.revokedAt IS NULL AND ac.oauthClientId IS NOT NULL AND (ac.expiresAt IS NULL OR datetime(ac.expiresAt) > datetime('now')) AND NOT EXISTS (SELECT 1 FROM "OAuthRefreshToken" rt WHERE rt.userId = ac.userId AND rt.clientId = ac.oauthClientId AND rt.revokedAt IS NULL AND COALESCE(rt.resource, '') = COALESCE(ac.oauthResource, '')))),`,
    `('canary_user_residue', (SELECT COUNT(*) FROM "User" WHERE email LIKE 'codex-mcp-canary-%@example.com')),`,
    `('canary_refresh_residue', (SELECT COUNT(*) FROM "OAuthRefreshToken" WHERE connectionKey LIKE 'mcp_canary_connection_%')),`,
    `('foreign_key_violations', (SELECT COUNT(*) FROM pragma_foreign_key_check)),`,
    `('grant_cutoff_invalid', (SELECT invalid FROM grant_cutoff)),`,
    `('active_refresh_without_grant', (SELECT COUNT(*) FROM "OAuthRefreshToken" rt_unlinked WHERE rt_unlinked.revokedAt IS NULL AND (datetime(rt_unlinked.createdAt) IS NULL OR datetime(rt_unlinked.createdAt) >= (SELECT applied_at FROM grant_cutoff)) AND (rt_unlinked.grantId IS NULL OR NOT EXISTS (SELECT 1 FROM "OAuthGrant" g_unlinked WHERE g_unlinked.id = rt_unlinked.grantId)))),`,
    `('active_access_without_grant', (SELECT COUNT(*) FROM "ApiCredential" ac_unlinked WHERE ac_unlinked.revokedAt IS NULL AND ac_unlinked.oauthClientId IS NOT NULL AND (ac_unlinked.expiresAt IS NULL OR datetime(ac_unlinked.expiresAt) > datetime('now')) AND (datetime(ac_unlinked.createdAt) IS NULL OR datetime(ac_unlinked.createdAt) >= (SELECT applied_at FROM grant_cutoff)) AND (ac_unlinked.oauthGrantId IS NULL OR NOT EXISTS (SELECT 1 FROM "OAuthGrant" g_unlinked WHERE g_unlinked.id = ac_unlinked.oauthGrantId)))),`,
    `('active_grant_without_active_refresh', (SELECT COUNT(*) FROM "OAuthGrant" g_empty WHERE g_empty.status = 'active' AND NOT EXISTS (SELECT 1 FROM "OAuthRefreshToken" rt_empty WHERE rt_empty.grantId = g_empty.id AND rt_empty.revokedAt IS NULL))),`,
    `('grant_identity_mismatch', (SELECT (SELECT COUNT(*) FROM "OAuthRefreshToken" rt_identity JOIN "OAuthGrant" g_refresh ON g_refresh.id = rt_identity.grantId WHERE NOT (rt_identity.userId IS g_refresh.userId) OR NOT (rt_identity.clientId IS g_refresh.clientId) OR NOT (rt_identity.issuer IS g_refresh.issuer) OR NOT (rt_identity.resource IS g_refresh.resource) OR NOT (rt_identity.connectionKey IS g_refresh.connectionKey) OR EXISTS (SELECT DISTINCT value FROM json_each('["' || replace(rt_identity.scope, ' ', '","') || '"]') WHERE value <> '' EXCEPT SELECT DISTINCT value FROM json_each('["' || replace(g_refresh.scope, ' ', '","') || '"]') WHERE value <> '') OR EXISTS (SELECT DISTINCT value FROM json_each('["' || replace(g_refresh.scope, ' ', '","') || '"]') WHERE value <> '' EXCEPT SELECT DISTINCT value FROM json_each('["' || replace(rt_identity.scope, ' ', '","') || '"]') WHERE value <> '')) + (SELECT COUNT(*) FROM "ApiCredential" ac_identity JOIN "OAuthGrant" g_access ON g_access.id = ac_identity.oauthGrantId WHERE NOT (ac_identity.userId IS g_access.userId) OR NOT (ac_identity.oauthClientId IS g_access.clientId) OR NOT (ac_identity.oauthIssuer IS g_access.issuer) OR NOT (ac_identity.oauthResource IS g_access.resource) OR NOT (ac_identity.scopes IS g_access.scope) OR NOT (ac_identity.oauthConnectionKey IS g_access.connectionKey)))),`,
    `('oauth_grant_count', (SELECT COUNT(*) FROM "OAuthGrant")),`,
    `('claude_redirect_client_count', (SELECT COUNT(*) FROM "OAuthClient" WHERE revokedAt IS NULL AND lower(trim(clientName)) = 'claude' AND redirectUris = 'https://claude.ai/api/mcp/auth_callback'))`,
    `) SELECT invariant, count FROM audit;`,
  ].join(" "), { targetEnv });
}

export function buildQaR2GetArgs(key) {
  return ["exec", "wrangler", "r2", "object", "get", `${QA_R2_BUCKET}/${key}`, "--remote", "--pipe"];
}

export function buildQaR2DeleteArgs(key) {
  return ["exec", "wrangler", "r2", "object", "delete", `${QA_R2_BUCKET}/${key}`, "--remote", "--force"];
}

function errorText(value) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return "";
}

export function isQaR2ObjectMissingError(error) {
  const parts = [];
  if (typeof error === "string") parts.push(error);
  if (error instanceof Error) parts.push(error.message);
  if (typeof error === "object" && error !== null) {
    for (const key of ["stdout", "stderr", "output"]) {
      if (key in error) parts.push(errorText(error[key]));
    }
  }
  return /(?:the specified key does not exist|nosuchkey|not found)/i.test(parts.join("\n"));
}

export function parseD1CountOutput(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Wrangler D1 count output did not contain a JSON array.");
  }
  const parsed = JSON.parse(output.slice(start, end + 1));
  const first = parsed?.[0];
  const row = first?.results?.[0];
  const count = row?.count ?? row?.["COUNT(*)"] ?? row?.["count(*)"];
  if (typeof count === "number") return count;
  if (typeof count === "string" && /^\d+$/.test(count)) return Number(count);
  throw new Error("Wrangler D1 count output did not include a numeric count.");
}

export function parseD1RowsOutput(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Wrangler D1 output did not contain a JSON array.");
  }
  const parsed = JSON.parse(output.slice(start, end + 1));
  const rows = parsed?.[0]?.results;
  if (Array.isArray(rows)) return rows;
  throw new Error("Wrangler D1 output did not include a results array.");
}

export function readGitMetadata(runCommand = execFileSync) {
  const read = (args) => {
    try {
      return String(runCommand("git", args, { encoding: "utf8" })).trim() || "unknown";
    } catch {
      return "unknown";
    }
  };
  return {
    branch: read(["rev-parse", "--abbrev-ref", "HEAD"]),
    commit: read(["rev-parse", "HEAD"]),
  };
}

export const MCP_CANARY_ISSUE_TITLE = "MCP OAuth canary failing";
export const MCP_CANARY_ISSUE_LABEL = "mcp-oauth-canary";
const MCP_CANARY_PRODUCTION_BASE_URL = "https://spoonjoy.app";
const MCP_CANARY_SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const MCP_CANARY_WORKER_VERSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const MCP_CANARY_REQUIRED_CHECK_NAMES = [
  "candidate Worker override readiness",
  "signup disposable user",
  "protected-resource metadata",
  "dynamic client registration",
  "authorize consent UI and approve redirect",
  "authorization_code token exchange",
  "mcp initialize and tools/list with issued access token",
  "refresh rotation and replay rejection",
  "mcp initialize and tools/list with refreshed access token",
  "legacy Claude refresh token promotion",
];

export function validateMcpCanaryRecoveryEvidence(report, expected) {
  const fail = (error) => ({ ok: false, error });
  if (!report || typeof report !== "object" || Array.isArray(report)) return fail("Canary report must be an object.");
  if (report.schemaVersion !== 1) return fail("Canary report schemaVersion must be 1.");
  if (report.targetEnv !== "production") return fail("Canary report target must be production.");
  if (report.baseUrl !== MCP_CANARY_PRODUCTION_BASE_URL) return fail("Canary report base URL is not canonical production.");
  if (report.resource !== `${MCP_CANARY_PRODUCTION_BASE_URL}/mcp`) return fail("Canary report resource is not canonical production MCP.");
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) return fail("Expected release identity is required.");
  if (!MCP_CANARY_SOURCE_SHA_PATTERN.test(expected.sourceSha) || !MCP_CANARY_SOURCE_SHA_PATTERN.test(report.git?.commit)) {
    return fail("Canary source SHA must be an exact lowercase Git SHA.");
  }
  if (!MCP_CANARY_WORKER_VERSION_PATTERN.test(expected.workerVersionId) || !MCP_CANARY_WORKER_VERSION_PATTERN.test(report.workerVersionId)) {
    return fail("Canary Worker version must be an exact UUID.");
  }
  if (report.git.commit !== expected.sourceSha) return fail("Canary source SHA does not match the release.");
  if (report.workerVersionId !== expected.workerVersionId) return fail("Canary Worker version does not match the release.");
  if (report.failure !== undefined && report.failure !== null) return fail("Canary report contains a failure.");
  if (!Array.isArray(report.checks)) return fail("Canary checks must be an array.");
  if (report.checks.length !== MCP_CANARY_REQUIRED_CHECK_NAMES.length) return fail("Canary check count is incomplete.");
  for (let index = 0; index < MCP_CANARY_REQUIRED_CHECK_NAMES.length; index += 1) {
    const check = report.checks[index];
    if (!check || check.name !== MCP_CANARY_REQUIRED_CHECK_NAMES[index]) return fail("Canary checks do not match the required sequence.");
    if (typeof check.elapsedMs !== "number" || !Number.isFinite(check.elapsedMs) || check.elapsedMs < 0) return fail("Canary check timing is invalid.");
  }
  const cleanup = report.cleanup;
  if (!cleanup || typeof cleanup !== "object" || cleanup.skipped || cleanup.error || cleanup.remaining !== 0) {
    return fail("Canary cleanup did not prove zero residue.");
  }
  if (report.legacyProbe?.promotedResource !== `${MCP_CANARY_PRODUCTION_BASE_URL}/mcp`) {
    return fail("Canary legacy promotion proof is missing.");
  }
  return { ok: true };
}

const MCP_CANARY_SECRET_PATTERNS = [
  {
    kind: "bearer_authorization",
    pattern: /Authorization:\s*Bearer\s+[A-Za-z0-9._~-]+/gi,
    replacement: "Authorization: Bearer [REDACTED]",
  },
  {
    kind: "spoonjoy_access_token",
    pattern: /\bsj_[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED]",
  },
  {
    kind: "oauth_refresh_token",
    pattern: /\bort_[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED]",
  },
  {
    kind: "oauth_authorization_code",
    pattern: /\boac_[A-Za-z0-9_-]{20,}\b/g,
    replacement: "[REDACTED]",
  },
  {
    kind: "callback_code_query",
    pattern: /([?&]code=)(?!\[REDACTED\])[^&\s]+/gi,
    replacement: "$1[REDACTED]",
  },
  {
    kind: "client_secret",
    pattern: /(client_secret=)(?!\[REDACTED\])[^&\s]+/gi,
    replacement: "$1[REDACTED]",
  },
];

export function redactMcpCanaryText(value) {
  return MCP_CANARY_SECRET_PATTERNS.reduce(
    (text, rule) => text.replace(rule.pattern, rule.replacement),
    String(value),
  );
}

export function serializeSanitizedMcpCanaryReport(report) {
  return redactMcpCanaryText(JSON.stringify(report, null, 2));
}

export function findMcpCanarySecretLeaks(value) {
  const text = String(value);
  return MCP_CANARY_SECRET_PATTERNS.flatMap((rule) =>
    [...text.matchAll(rule.pattern)].map((match) => ({ kind: rule.kind, match: match[0] })),
  );
}

function markdownValue(value) {
  return redactMcpCanaryText(value === undefined || value === null || value === "" ? "n/a" : String(value));
}

function workflowLink(url) {
  return url ? `[workflow run](${url})` : "n/a";
}

function artifactLink(url) {
  return url ? `[artifact](${url})` : "n/a";
}

function checkRows(report) {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  return checks.map((check) => `| ${markdownValue(check.name)} | ${markdownValue(check.elapsedMs)} |`);
}

export function buildMcpCanaryStepSummary({ report, status, workflowRunUrl, artifactUrl }) {
  const cleanup = report.cleanup ?? {};
  const failure = report.failure?.message ?? "";
  const rows = checkRows(report);
  return redactMcpCanaryText([
    "# MCP OAuth Canary",
    "",
    `Status: **${markdownValue(status)}**`,
    `Target: ${markdownValue(report.targetEnv)} (${markdownValue(report.baseUrl)})`,
    `Resource: ${markdownValue(report.resource)}`,
    `Generated: ${markdownValue(report.generatedAt)}`,
    `Run: ${workflowLink(workflowRunUrl)}`,
    `Artifact: ${artifactLink(artifactUrl)}`,
    "",
    "## Checks",
    "| Check | Elapsed ms |",
    "| --- | ---: |",
    ...rows,
    "",
    "## Cleanup",
    `Target: ${markdownValue(cleanup.target)}`,
    `Remaining disposable users: ${markdownValue(cleanup.remaining)}`,
    `Error: ${markdownValue(cleanup.error)}`,
    "",
    "## Legacy Probe",
    `legacy Claude refresh promotion: ${markdownValue(report.legacyProbe?.promotedResource ?? report.legacyProbe?.reason ?? "n/a")}`,
    "",
    "## Failure",
    markdownValue(failure),
    "",
  ].join("\n"));
}

export function buildMcpCanaryIssueBody({ report, status, workflowRunUrl, artifactUrl }) {
  const failure = report.failure?.message ?? "n/a";
  const cleanup = report.cleanup ?? {};
  return redactMcpCanaryText([
    "## Current Status",
    `Status: **${markdownValue(status)}**`,
    `Target: ${markdownValue(report.targetEnv)} (${markdownValue(report.baseUrl)})`,
    `Resource: ${markdownValue(report.resource)}`,
    `Commit: ${markdownValue(report.git?.commit)}`,
    `Run: ${workflowLink(workflowRunUrl)}`,
    `Artifact: ${artifactLink(artifactUrl)}`,
    "",
    "## Failure",
    markdownValue(failure),
    "",
    "## Cleanup",
    `Remaining disposable users: ${markdownValue(cleanup.remaining)}`,
    `Cleanup error: ${markdownValue(cleanup.error)}`,
    "",
    "## Completed Checks",
    "| Check | Elapsed ms |",
    "| --- | ---: |",
    ...checkRows(report),
    "",
  ].join("\n"));
}

export function decideMcpCanaryIssueAction({ status, openIssueNumber }) {
  if (status === "failure" && openIssueNumber) return { action: "comment", issueNumber: openIssueNumber };
  if (status === "failure") return { action: "create" };
  if (status === "success" && openIssueNumber) return { action: "close", issueNumber: openIssueNumber };
  return { action: "none" };
}

const MCP_OAUTH_AUDIT_INFO_INVARIANTS = new Set(["claude_redirect_client_count", "oauth_grant_count"]);

export function normalizeMcpOAuthAuditRows(rows) {
  return rows.map((row) => {
    const count = typeof row.count === "number" ? row.count : (/^\d+$/.test(String(row.count)) ? Number(row.count) : Number.NaN);
    if (!Number.isFinite(count)) {
      throw new Error(`MCP OAuth audit invariant ${row.invariant} did not include a numeric count.`);
    }
    const status = MCP_OAUTH_AUDIT_INFO_INVARIANTS.has(row.invariant) ? "info" : (count === 0 ? "pass" : "fail");
    return { invariant: row.invariant, count, status };
  });
}

export function mcpOAuthAuditHasFailures(rows) {
  return rows.some((row) => row.status === "fail");
}

export function buildMcpOAuthAuditSummary({ targetEnv, baseUrl, generatedAt, rows, workflowRunUrl }) {
  return [
    "# MCP OAuth D1 Audit",
    "",
    `Target: ${targetEnv} (${baseUrl})`,
    `Generated: ${generatedAt}`,
    `Run: ${workflowLink(workflowRunUrl)}`,
    "",
    "| Invariant | Count | Status |",
    "| --- | ---: | --- |",
    ...rows.map((row) => `| ${row.invariant} | ${row.count} | ${row.status} |`),
    "",
  ].join("\n");
}

function environmentReport(target) {
  return {
    targetEnv: target.targetEnv,
    baseUrl: target.baseUrl,
    d1Target: target.d1Target,
    r2Target: target.r2Target,
    destructiveScope: target.destructiveScope,
  };
}

function r2ReportFrom(imageCoverSmoke) {
  const r2 = imageCoverSmoke?.r2 ?? {};
  const report = {
    retainedKeys: Array.isArray(r2.retainedKeys) ? r2.retainedKeys : [],
    deletedKeys: Array.isArray(r2.deletedKeys) ? r2.deletedKeys : [],
    verifiedDeletedKeys: Array.isArray(r2.verifiedDeletedKeys) ? r2.verifiedDeletedKeys : [],
  };
  if (Array.isArray(r2.generatedCoverKeys)) {
    report.generatedCoverKeys = r2.generatedCoverKeys;
  }
  return report;
}

export function buildSmokeReport({
  generatedAt,
  target,
  git,
  created,
  screenshots = [],
  consoleErrors = [],
  pageErrors = [],
  cleanup = null,
  cleanupVerification = null,
  imageCoverSmoke = null,
  apple = null,
  pushPublicKeyStatus,
}) {
  return {
    baseUrl: target.baseUrl,
    generatedAt,
    email: created.email,
    username: created.username,
    recipeTitle: created.recipeTitle,
    recipeId: created.recipeId,
    screenshots,
    consoleErrors,
    pageErrors,
    cleanup,
    cleanupVerification,
    imageCoverSmoke,
    targetEnv: target.targetEnv,
    apple,
    pushPublicKeyStatus,
    environment: environmentReport(target),
    git,
    created,
    r2: r2ReportFrom(imageCoverSmoke),
  };
}
