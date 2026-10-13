import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Field } from "~/components/ouro/field/field";
import { FieldControl } from "~/components/ouro/field/field-parts";
import { Form } from "~/components/ouro/form/form";
import { TextField } from "~/components/ouro/text-field/text-field";
import { act } from "~/lib/ouro/testing/act";

// Ouro UI's own test of this, "ignores a change in a field without a form error" in
// app/components/ouro/form/form.test.tsx, cannot run on Spoonjoy's Vitest 4: it looks a field up
// by the name "Name" beside one labelled "Unnamed", and Vitest 4 refuses a locator that finds two
// elements (vitest.ouro.config.ts skips it by name). This is the same check with exact names:
// typing in other fields leaves a field's error from the action where it is.

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}

it("keeps a field's error when the user changes a different field, named or not", async () => {
  const host = await render(
    <Form errors={{ email: "That email is taken." }}>
      <TextField label="Name" name="name" />
      <TextField label="Email" name="email" />
      <Field label="Unnamed">
        <FieldControl />
      </Field>
    </Form>,
  );
  const email = host.querySelector<HTMLInputElement>('[name="email"]')!;
  expect(email.getAttribute("aria-invalid")).toBe("true");

  await userEvent.fill(page.getByRole("textbox", { name: "Name", exact: true }), "Ari");
  await userEvent.fill(page.getByRole("textbox", { name: "Unnamed", exact: true }), "x");

  expect(email.getAttribute("aria-invalid")).toBe("true");
  await expect.element(page.getByText("That email is taken.")).toBeVisible();
});
