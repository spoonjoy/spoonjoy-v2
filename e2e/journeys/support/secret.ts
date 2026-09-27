// Passwords (and any other secret) in journey and support code are Secret values, never strings,
// and fillSecret is the only place one is turned back into its text.
//
// Why: the journeys report is public, and Playwright 1.58 puts typed values in it. fill() titles
// its step 'Fill "<value>"' and, when it fails after finding its element, prints `fill("<value>")`
// in the call log on the public job log; a failed toHaveValue(expected) prints the expected value.
// Because a Secret is not a string, `locator.fill(secret)`, `page.fill(selector, secret)`,
// `locator.type(secret)` and `expect(locator).toHaveValue(secret)` do not typecheck
// (`tsc -p tsconfig.e2e.json`, part of `pnpm run typecheck` and also run by the Journeys workflow
// before it touches QA). Anything that turns a Secret into text by itself (a template literal, String(),
// JSON.stringify, console.log / util.inspect, an error message, Playwright's serialisation of an
// evaluate() argument) gets "[redacted]" or an object without the value. `pnpm run check:journeys`
// (rule secret-boundary) fails any journey or support file other than this one that reads a raw
// password source: the credentials file without parseCredentialsJson, or the disposable-user
// factory without createDisposableJourneyUser.
//
// How fillSecret types without leaking: the value never travels as a Playwright call parameter.
// The page asks for it through a one-off exposed function whose answer goes back over
// BindingCall.resolve, an internal protocol call that is neither traced nor reported. The function
// answers once only (Playwright 1.58 can't remove an exposed function and re-installs it on every
// navigation); a page script that found and called it first would get the value, and fillSecret
// would then fail visibly instead of typing. The page sets the value with the input's native
// value setter and dispatches input and change, which is what React listens to. The report shows
// "Clear", "Expose binding" and "Evaluate".
//
// What still sees the typed value: the page itself. Trace DOM snapshots record every input's
// value, and the failure page snapshot (error-context.md) prints a textbox's value.
// scripts/sanitize-journey-traces.mjs redacts password inputs' values from every trace snapshot
// and password textboxes' values from every page snapshot before the workflow uploads anything,
// and fails if one is left. Keep password inputs uncontrolled (no React `value` prop): Playwright's
// call logs print a resolved element's attributes, and a controlled input's value attribute
// would carry the password there, where the sanitizer can't reach.
import { randomBytes, randomUUID } from "node:crypto";
import { inspect } from "node:util";
import type { Locator } from "@playwright/test";
import { createDisposableE2EUser } from "../../support/disposable-auth";

export const REDACTED = "[redacted]";

// Module-private: nothing outside this file can read a Secret's value.
const secretValues = new WeakMap<Secret, string>();

export class Secret {
  // A private member makes the type nominal: only a real Secret is assignable to Secret.
  private readonly kind = "secret";

  constructor(value: string) {
    if (typeof value !== "string" || value === "") throw new Error("A Secret needs a non-empty string.");
    secretValues.set(this, value);
    Object.freeze(this);
  }

  // A fresh random secret, for example a new password to change to.
  static generate(bytes = 24): Secret {
    return new Secret(randomBytes(bytes).toString("base64url"));
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

function revealSecret(secret: Secret): string {
  const value = secretValues.get(secret);
  if (value === undefined) throw new Error("fillSecret needs a Secret.");
  return value;
}

// Parses the QA credentials file (scripts/seed-qa-kitchen.mjs's --credentials-out), turning every
// "password" field into a Secret on the way in, so no string password ever exists in journey code.
export function parseCredentialsJson(text: string): unknown {
  return JSON.parse(text, (key, value: unknown) =>
    key === "password" && typeof value === "string" ? new Secret(value) : value,
  );
}

export interface DisposableJourneyUser {
  email: string;
  username: string;
  password: Secret;
}

// A throwaway codex-e2e-* user (removed by the run's cleanup) whose password is a Secret.
export function createDisposableJourneyUser(): DisposableJourneyUser {
  const { email, username, password } = createDisposableE2EUser();
  return { email, username, password: new Secret(password) };
}

// Types a secret into a field. The only place a Secret's value is read.
export async function fillSecret(field: Locator, secret: Secret): Promise<void> {
  const value = revealSecret(secret);
  // fill()'s actionability checks (visible, enabled, editable), which evaluate() skips; the step
  // is titled "Clear" and carries no value.
  await field.clear();

  const page = field.page();
  const binding = `__spoonjoySecret${randomUUID().replace(/-/g, "")}`;
  let pending: string | null = value;
  await page.exposeFunction(binding, () => {
    const answer = pending;
    pending = null;
    if (answer === null) throw new Error("fillSecret: this secret was already read");
    return answer;
  });
  await field.evaluate(async (element, name) => {
    const input = element as HTMLInputElement;
    const readSecret = (window as unknown as Record<string, () => Promise<string>>)[name];
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!readSecret || !setValue) throw new Error("fillSecret: could not reach the secret or the input's value setter");
    const typed = await readSecret();
    input.focus();
    setValue.call(input, typed);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, binding);
}
