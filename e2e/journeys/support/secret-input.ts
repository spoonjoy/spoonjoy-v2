// Types a password (or any other secret) into a field without the value appearing in the journeys
// report's step titles or in a trace's action log, both of which end up in the public
// journeys-report artifact. `pnpm run check:journeys` (rule no-secret-fill) fails any journey or
// helper that types a secret with fill(), type(), pressSequentially() or insertText() instead.
//
// Why not fill(): Playwright 1.58 titles that step `Fill "<value>"` (protocolMetainfo's
// 'Fill "{value}"'), records the value as a call parameter, and, when a fill fails after finding
// its element, prints `fill("<value>")` in the error's call log, straight into the public job log.
//
// How this avoids them: the value never travels as a Playwright call parameter. The page asks for
// it through a one-off exposed function whose answer goes back over BindingCall.resolve, an
// internal protocol call that is neither traced nor reported, and the function answers once only,
// so a page script can't read the secret again later (Playwright 1.58 can't remove an exposed
// function, and re-installs it on every navigation). The page then sets the value with the input's
// native value setter and dispatches input and change, which is what React listens to. The report
// shows the steps as "Expose binding" and "Evaluate".
//
// What still sees the value, and what removes it before upload: the page itself. Trace DOM
// snapshots record every input's value, and the failure page snapshot (error-context.md) prints a
// textbox's value, including a password input's. scripts/sanitize-journey-traces.mjs redacts
// password inputs' values from every trace snapshot and password textboxes' values from every
// page snapshot before the workflow uploads anything, and fails if one is left. Never assert on a
// secret field's value (a failed toHaveValue prints it), and never pass a secret to a step title,
// test title, expect message, annotation, attachment or log.
import { randomUUID } from "node:crypto";
import type { Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export async function fillSecret(field: Locator, secret: string): Promise<void> {
  // fill()'s own actionability checks, which evaluate() skips; neither prints the value.
  await expect(field).toBeEditable();

  const page = field.page();
  const binding = `__spoonjoySecret${randomUUID().replace(/-/g, "")}`;
  let pending: string | null = secret;
  await page.exposeFunction(binding, () => {
    const value = pending;
    pending = null;
    if (value === null) throw new Error("fillSecret: this secret was already read");
    return value;
  });
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
