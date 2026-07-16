import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { installWorkerVersionBrowserRouting } from '../../scripts/smoke-live-helpers.mjs';
import { loginAsSeedUser, submitPasswordLogin } from '../support/auth';

const CANDIDATE_VERSION = '22222222-2222-4222-8222-222222222222';
const OVERRIDE_HEADER = 'cloudflare-workers-version-overrides';

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

// These tests run WITHOUT auth (chromium-no-auth project)
test.describe('Auth Flow', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);

  test('landing page has login and signup buttons', async ({ page }) => {
    await page.goto('/');
    
    // Should have Login link
    const loginLink = page.getByRole('link', { name: /log\s*in/i }).first();
    await expect(loginLink).toBeVisible();
    
    // Should have Sign Up link/button
    const signupLink = page.getByRole('link', { name: /sign\s*up/i }).first();
    await expect(signupLink).toBeVisible();
  });

  test('login with valid credentials redirects to public recipe index', async ({ page }) => {
    await page.goto('/login');
    
    await loginAsSeedUser(page);
    
    // Should redirect to the public recipe index.
    expect(new URL(page.url()).pathname).toBe('/recipes');
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login');
    
    await submitPasswordLogin(page, 'wrong@example.com', 'wrongpassword');
    
    // Should show error message (stay on login page)
    await expect(page).toHaveURL('/login');
    const errorMessage = page.getByText(/invalid|error|incorrect/i).first();
    await expect(errorMessage).toBeVisible();
  });

  test('logout redirects to landing page', async ({ page }) => {
    // First login
    await page.goto('/login');
    await loginAsSeedUser(page);
    
    // Click logout
    const logoutButton = page.getByRole('button', { name: /log\s*out/i }).first();
    await expect(logoutButton).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/recipes');
    await logoutButton.click();
    
    // Should redirect to landing or login page
    await expect(page).toHaveURL(/^\/$|\/login/);
  });

  test('unauthenticated recipes access stays public', async ({ page }) => {
    await page.goto('/recipes');
    
    await expect(page).toHaveURL(/\/recipes(?:[?#].*)?$/);
    await expect(page.getByRole('heading', { name: /public recipe box|recipes worth opening/i }).first()).toBeVisible();
  });

  test('signup page loads', async ({ page }) => {
    await page.goto('/signup');
    
    // Should have signup form elements
    await expect(page.getByLabel('Email').first()).toBeVisible();
    await expect(page.getByLabel('Password').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /sign\s*up/i }).first()).toBeVisible();
  });

  test('pins every same-origin redirect hop and intercepts external OAuth callbacks before network', async ({ page }) => {
    const mainRequests: Array<{ path: string; override: string | null }> = [];
    const externalRequests: string[] = [];
    const externalServer = createServer((request, response) => {
      externalRequests.push(request.url ?? '');
      response.end('external network received callback');
    });
    const externalPort = await listen(externalServer);
    const mainServer = createServer((request, response) => {
      mainRequests.push({
        path: request.url ?? '',
        override: request.headers[OVERRIDE_HEADER] ?? null,
      });
      if (request.url === '/same-origin-start') {
        response.writeHead(302, { Location: '/same-origin-target' });
        response.end();
        return;
      }
      if (request.url === '/external-start') {
        response.writeHead(302, {
          Location: `http://127.0.0.1:${externalPort}/api/mcp/auth_callback?code=secret&state=opaque`,
        });
        response.end();
        return;
      }
      response.end('same-origin target');
    });
    const mainPort = await listen(mainServer);
    const baseUrl = `http://127.0.0.1:${mainPort}`;
    const interceptedCallbacks: string[] = [];

    try {
      const routing = await installWorkerVersionBrowserRouting(page, {
        baseUrl,
        workerVersionId: CANDIDATE_VERSION,
        interceptRequest: async (request: { url: string }) => {
          const url = new URL(request.url);
          if (url.port !== String(externalPort) || url.pathname !== '/api/mcp/auth_callback') return null;
          interceptedCallbacks.push(request.url);
          return {
            status: 200,
            headers: { 'Content-Type': 'text/plain' },
            body: 'callback intercepted',
          };
        },
      });

      await page.goto(`${baseUrl}/same-origin-start`);
      await expect(page.locator('body')).toHaveText('same-origin target');
      await page.goto(`${baseUrl}/external-start`);
      await expect(page.locator('body')).toHaveText('callback intercepted');
      routing.assertHealthy();

      expect(mainRequests).toEqual([
        {
          path: '/same-origin-start',
          override: `spoonjoy-v2="${CANDIDATE_VERSION}"`,
        },
        {
          path: '/same-origin-target',
          override: `spoonjoy-v2="${CANDIDATE_VERSION}"`,
        },
        {
          path: '/external-start',
          override: `spoonjoy-v2="${CANDIDATE_VERSION}"`,
        },
      ]);
      expect(interceptedCallbacks).toHaveLength(1);
      expect(new URL(interceptedCallbacks[0] ?? '').searchParams.get('code')).toBe('secret');
      expect(externalRequests).toEqual([]);
    } finally {
      await close(mainServer);
      await close(externalServer);
    }
  });
});
