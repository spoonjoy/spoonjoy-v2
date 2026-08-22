import { expect, test } from "../fixtures";

import { runOAuthNavigationCanary, serializeOAuthNavigationEvidence } from "../../scripts/smoke-live-helpers.mjs";

test("service-worker-controlled OAuth link performs a full Google document handoff", async ({ page }) => {
  await page.route("https://accounts.google.com/o/oauth2/v2/auth**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><title>Sign in - Google Accounts</title><body>Sign in with Google</body></html>",
    });
  });

  const evidence = await runOAuthNavigationCanary({
    page,
    provider: "google",
    appOrigin: "http://localhost:5197",
    expectedProviderHost: "accounts.google.com",
    expectedClientId: "spoonjoy-playwright-google-client",
    expectedRedirectUri: "http://localhost:5197/auth/google/callback",
    expectedResponseMode: null,
    redirectTo: "/oauth/authorize?client_id=e2e&response_type=code",
    publicSignInMarker: "Sign in with Google",
    publicErrorSentinel: "invalid_request",
  });

  expect(evidence.redirectToPreserved).toBe(true);
  expect(evidence.cspViolations).toEqual([]);
  expect(JSON.parse(serializeOAuthNavigationEvidence(evidence))).toEqual(evidence);
  console.log(`SPOONJOY_OAUTH_EVIDENCE=${JSON.stringify(evidence)}`);
});
