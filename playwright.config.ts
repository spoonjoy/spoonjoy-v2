import { defineConfig, devices } from '@playwright/test';
import { createE2eRunId } from './scripts/e2e-run-cleanup.mjs';

// ESM-compatible path handling
delete process.env.NO_COLOR;
const authFile = './e2e/.auth/user.json';
const e2eRunId = process.env.SPOONJOY_E2E_RUN_ID ?? createE2eRunId();
process.env.SPOONJOY_E2E_RUN_ID = e2eRunId;
const webServerEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name, value]) => name !== 'NO_COLOR' && value !== undefined),
) as Record<string, string>;

export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/support/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  failOnFlakyTests: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5197',
    trace: 'on-first-retry',
  },
  projects: [
    // Setup project - runs first to authenticate
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    // Tests that need authentication (excludes auth tests and example)
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: authFile,
      },
      dependencies: ['setup'],
      testIgnore: [/.*\.setup\.ts/, /auth\.spec\.ts/, /example\.spec\.ts/, /passkey\.spec\.ts/, /oauth-authorize\.spec\.ts/],
    },
    // Tests that don't need authentication (auth flow tests + example)
    {
      name: 'chromium-no-auth',
      use: { ...devices['Desktop Chrome'] },
      testMatch: [/auth\.spec\.ts/, /example\.spec\.ts/],
      dependencies: ['setup'],
    },
    // WebAuthn passkey lifecycle — needs a fresh, unauthenticated context and a
    // CDP virtual authenticator (Chromium-only), so it manages its own user.
    {
      name: 'webauthn',
      use: { ...devices['Desktop Chrome'] },
      testMatch: [/passkey\.spec\.ts/],
    },
    // OAuth 2.1 authorize + consent — drives the login gate, so it needs a
    // fresh, unauthenticated context (no stored auth state) and manages its
    // own sign-in. Chromium-only (dev server).
    {
      name: 'oauth',
      use: { ...devices['Desktop Chrome'] },
      testMatch: [/oauth-authorize\.spec\.ts/],
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `pnpm run verify:clean:build && node e2e/support/start-ephemeral-wrangler.mjs --run-id ${e2eRunId}`,
    url: 'http://localhost:5197',
    reuseExistingServer: false,
    timeout: 180_000,
    env: webServerEnv,
  },
});
