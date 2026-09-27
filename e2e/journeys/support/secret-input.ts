// Types a password into a field without the value appearing in the journeys report or in a trace's
// action log, both of which end up in the public journeys-report artifact.
//
// locator.fill() is not safe for this: Playwright 1.58 titles that step `Fill "<value>"`
// (protocolMetainfo's 'Fill "{value}"'), and the value is also a recorded parameter of the call.
// So here the value never travels as a Playwright call parameter. The page asks for it through a
// one-off exposed function, whose answer goes back over an internal protocol call that is neither
// traced nor reported; the page then sets it with the input's native value setter and dispatches
// input and change, which is what React listens to. The report shows the steps as
// "Expose binding" and "Evaluate".
//
// What this does not cover: a failure trace's DOM snapshots record input values, including this
// one, for any action taken while it is typed in and not yet submitted. The Journeys workflow
// invalidates every scratch password (seed:qa:kitchen --rotate) and deletes the scratch users
// before it uploads anything, so such a value is dead by then; still, never assert on a secret
// field's value (a failed toHaveValue prints it) and never pass one to a step title, test title,
// expect message, annotation, attachment or log.
import { randomUUID } from "node:crypto";
import type { Locator } from "@playwright/test";

export async function fillSecret(field: Locator, secret: string): Promise<void> {
  const page = field.page();
  const binding = `__spoonjoySecret${randomUUID().replace(/-/g, "")}`;
  await page.exposeFunction(binding, () => secret);
  await field.evaluate(async (element, name) => {
    const input = element as HTMLInputElement;
    const readSecret = (window as unknown as Record<string, () => Promise<string>>)[name];
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!readSecret || !setValue) throw new Error("fillSecret: could not reach the secret or the input's value setter");
    const value = await readSecret();
    input.focus();
    setValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, binding);
}
