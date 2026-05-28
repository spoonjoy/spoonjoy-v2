import { defineConfig, devices } from '@playwright/test';

// ESM-compatible path handling
const authFile = './e2e/.auth/user.json';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
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
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
