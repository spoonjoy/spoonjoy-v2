import { test, expect } from '@playwright/test';
import { loginAsSeedUser, submitPasswordLogin } from '../support/auth';

// These tests run WITHOUT auth (chromium-no-auth project)
test.describe('Auth Flow', () => {
  test.describe.configure({ mode: 'serial' });

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
    await expect(page).toHaveURL(/\/recipes(?:[?#].*)?$/);
    await expect(page.getByRole('heading', { name: /public recipe box|recipes worth opening/i }).first()).toBeVisible();
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
    await expect(page).toHaveURL(/\/recipes(?:[?#].*)?$/);
    
    // Click logout
    const logoutButton = page.getByRole('button', { name: /log\s*out/i }).first();
    await expect(logoutButton).toBeVisible();
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
});
