import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Form } from "~/components/ouro/form/form";
import { Select } from "~/components/ouro/select/select";
import { TextField } from "~/components/ouro/text-field/text-field";
import { act } from "~/lib/ouro/testing/act";

// A change in a field clears that field's server error and nothing else. The cases here are
// the two where there is nothing to clear. A Select reports every change to its form, where
// a text field reports only while it shows an error, so the Select is what reaches them.

let root: Root | undefined;

async function render(node: ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(node));
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

const courses = [
  { value: "main", label: "Main" },
  { value: "side", label: "Side" },
];

async function chooseSide() {
  await userEvent.click(page.getByRole("combobox", { name: "Course", exact: true }));
  await userEvent.click(page.getByRole("option", { name: "Side", exact: true }));
  await expect.element(page.getByRole("combobox", { name: "Course", exact: true })).toHaveTextContent("Side");
}

describe("Form, a change in a field that has no error", () => {
  it("keeps the other field's error", async () => {
    await render(
      <Form errors={{ email: "Enter an email address." }}>
        <Select label="Course" name="course" options={courses} defaultValue="main" />
        <TextField label="Email" name="email" />
      </Form>,
    );
    await chooseSide();
    await expect.element(page.getByText("Enter an email address.", { exact: true })).toBeVisible();
    expect(page.getByRole("textbox", { name: "Email", exact: true }).element().getAttribute("aria-invalid")).toBe("true");
  });

  it("does nothing in a form without errors", async () => {
    await render(
      <Form>
        <Select label="Course" name="course" options={courses} defaultValue="main" />
      </Form>,
    );
    await chooseSide();
    expect(document.querySelector("[aria-invalid='true']")).toBeNull();
  });
});
