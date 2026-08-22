import { runOAuthNavigationCanary } from "./smoke-live-helpers.mjs";

const APPLE_OAUTH_CANARY = {
  provider: "apple",
  appOrigin: "https://spoonjoy.app",
  expectedProviderHost: "appleid.apple.com",
  expectedProviderPath: "/auth/authorize",
  expectedClientId: "app.spoonjoy.client",
  expectedRedirectUri: "https://spoonjoy.app/.redwood/functions/auth/oauth?method=loginWithApple",
  expectedResponseMode: "form_post",
  publicSignInMarker: "Sign in to Apple",
  publicErrorSentinel: "invalid_request",
};

export async function runAppleOAuthNavigationCheck({
  browser,
  runCanary,
}) {
  const context = await browser.newContext({
    locale: "en-US",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });
  try {
    const page = await context.newPage();
    return await runCanary({ page, ...APPLE_OAUTH_CANARY });
  } finally {
    await context.close();
  }
}
