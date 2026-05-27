import { test, expect } from '@playwright/test';

// These tests run WITHOUT auth (chromium-no-auth project)
test.describe('Auth Flow', () => {
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
    
    // Fill in valid credentials
    await page.getByLabel('Email').first().fill('demo@spoonjoy.com');
    await page.getByLabel('Password').first().fill('demo1234');
    await page.getByRole('button', { name: /log in/i }).first().click();
    
    // Should redirect to the public recipe index.
    await expect(page).toHaveURL('/recipes');
    await expect(page.getByRole('heading', { name: /public recipe box|recipes worth opening/i }).first()).toBeVisible();
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login');
    
    // Fill in invalid credentials
    await page.getByLabel('Email').first().fill('wrong@example.com');
    await page.getByLabel('Password').first().fill('wrongpassword');
    await page.getByRole('button', { name: /log in/i }).first().click();
    
    // Should show error message (stay on login page)
    await expect(page).toHaveURL('/login');
    const errorMessage = page.getByText(/invalid|error|incorrect/i).first();
    await expect(errorMessage).toBeVisible();
  });

  test('logout redirects to landing page', async ({ page }) => {
    // First login
    await page.goto('/login');
    await page.getByLabel('Email').first().fill('demo@spoonjoy.com');
    await page.getByLabel('Password').first().fill('demo1234');
    await page.getByRole('button', { name: /log in/i }).first().click();
    await expect(page).toHaveURL('/recipes');
    
    // Click logout
    const logoutButton = page.getByRole('button', { name: /log\s*out/i }).first();
    await expect(logoutButton).toBeVisible();
    await logoutButton.click();
    
    // Should redirect to landing or login page
    await expect(page).toHaveURL(/^\/$|\/login/);
  });

  test('unauthenticated recipes access stays public', async ({ page }) => {
    await page.goto('/recipes');
    
    await expect(page).toHaveURL('/recipes');
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
