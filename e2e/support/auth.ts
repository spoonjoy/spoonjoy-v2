import { expect, type Page } from '@playwright/test';

export async function fillLoginEmail(page: Page, emailAddress: string) {
  const email = page.getByLabel('Email').first();
  await expect(async () => {
    await email.fill(emailAddress);
    await expect(email).toHaveValue(emailAddress);
  }).toPass();
}

export async function submitPasswordLogin(page: Page, emailAddress: string, password: string) {
  const emailInput = page.getByLabel('Email').first();
  const passwordInput = page.getByLabel('Password').first();
  const loginButton = page.locator('form').getByRole('button', { name: 'Log In', exact: true });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await expect(async () => {
      await emailInput.fill(emailAddress);
      await passwordInput.fill(password);
      await expect(emailInput).toHaveValue(emailAddress);
      await expect(passwordInput).toHaveValue(password);
    }).toPass();
    await loginButton.click();
    await page.waitForTimeout(150);

    const emailVisible = await emailInput.isVisible().catch(() => false);
    if (!emailVisible) return;

    const hasFeedback = await page.getByText(/invalid|error|incorrect|required/i).first().isVisible().catch(() => false);
    const emailValue = await emailInput.inputValue().catch(() => emailAddress);
    if (emailValue || hasFeedback) return;
  }
}

export async function loginAsSeedUser(page: Page, expectedUrl: string | RegExp = /\/recipes(?:[?#].*)?$/) {
  await Promise.all([
    page.waitForURL(expectedUrl, { timeout: 15_000 }),
    submitPasswordLogin(page, 'demo@spoonjoy.com', 'demo1234'),
  ]);
}
