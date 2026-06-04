import { expect, type Page } from '@playwright/test';

export async function fillLoginEmail(page: Page, emailAddress: string) {
  const email = page.getByLabel('Email').first();
  await expect(async () => {
    await email.fill(emailAddress);
    await expect(email).toHaveValue(emailAddress);
  }).toPass();
}

export async function submitPasswordLogin(page: Page, emailAddress: string, password: string) {
  await page.getByLabel('Password').first().fill(password);
  await fillLoginEmail(page, emailAddress);
  await page.getByRole('button', { name: /log in/i }).first().click();
}

export async function loginAsSeedUser(page: Page) {
  await submitPasswordLogin(page, 'demo@spoonjoy.com', 'demo1234');
}
