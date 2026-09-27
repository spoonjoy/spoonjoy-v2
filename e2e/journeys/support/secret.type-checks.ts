// Compile-time proof that a Secret can't be typed, asserted or used as a plain string. Nothing
// calls this; `tsc -p tsconfig.e2e.json` (part of `pnpm run typecheck`) checks it, and every @ts-expect-error below
// fails the typecheck if its line ever compiles, for example because Secret became a string.
import { expect, type Locator, type Page } from "@playwright/test";
import { Secret } from "./secret";

export async function secretTypeChecks(page: Page, field: Locator, secret: Secret): Promise<void> {
  // @ts-expect-error fill() takes a string; secrets go through fillSecret.
  await field.fill(secret);
  // @ts-expect-error page.fill(selector, value) takes a string value.
  await page.fill("#current", secret);
  // @ts-expect-error type() takes a string.
  await field.type(secret);
  // @ts-expect-error pressSequentially() takes a string.
  await field.pressSequentially(secret);
  // @ts-expect-error keyboard.type() takes a string.
  await page.keyboard.type(secret);
  // @ts-expect-error keyboard.insertText() takes a string.
  await page.keyboard.insertText(secret);
  // @ts-expect-error toHaveValue() takes a string or RegExp; a failure would print it.
  await expect(field).toHaveValue(secret);
  // @ts-expect-error a Secret is not a string.
  const text: string = secret;
  // @ts-expect-error a look-alike object is not a Secret.
  const lookAlike: Secret = { kind: "secret" };
  void text;
  void lookAlike;
}
