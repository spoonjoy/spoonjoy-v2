import { expect, type Page } from '@playwright/test';
import { readLatestDisposableE2EUser } from './disposable-auth';
import { Secret, fillSecret } from '../journeys/support/secret';

export async function fillLoginEmail(page: Page, emailAddress: string) {
  const email = page.getByLabel('Username or email').first();
  await expect(async () => {
    await email.fill(emailAddress);
    await expect(email).toHaveValue(emailAddress);
  }).toPass();
}

export async function submitPasswordLogin(page: Page, emailAddress: string, password: string) {
  const emailInput = page.getByLabel('Username or email').first();
  const passwordInput = page.getByLabel('Password').first();
  const loginButton = page.locator('form').getByRole('button', { name: 'Log in', exact: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(async () => {
      await emailInput.fill(emailAddress);
      await fillSecret(passwordInput, new Secret(password));
      await expect(emailInput).toHaveValue(emailAddress);
      // Not toHaveValue(password): a failed value assertion prints the expected value.
      await expect(passwordInput).not.toHaveValue('');
    }).toPass();
    await loginButton.click();
    await page.waitForTimeout(150);

    if (new URL(page.url()).pathname !== '/login') return;

    const emailVisible = await emailInput.isVisible().catch(() => false);
    if (!emailVisible) return;

    const hasFeedback = await page.getByText(/invalid|error|incorrect|required/i).first().isVisible().catch(() => false);
    const emailValue = await emailInput.inputValue().catch(() => emailAddress);
    if (emailValue || hasFeedback) return;
  }
}

export async function loginAsDisposableUser(page: Page, expectedUrl: string | RegExp = /\/recipes(?:[?#].*)?$/) {
  const user = readLatestDisposableE2EUser();

  await Promise.all([
    page.waitForURL(expectedUrl, { timeout: 15_000 }),
    submitPasswordLogin(page, user.email, user.password),
  ]);
}
