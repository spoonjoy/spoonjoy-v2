import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Form } from "~/components/ouro/form/form";
import { TextField } from "~/components/ouro/text-field/text-field";
import { useFormErrors, useFormMessage, type ActionErrors } from "~/hooks/use-form-errors";

const FIELDS = ["email", "name"] as const;
type Answer = { errors: ActionErrors; privateToken?: string };

function Fields({ answer, messages = answer?.errors }: { answer?: Answer; messages?: ActionErrors }) {
  const errors = useFormErrors(messages, FIELDS, answer);
  return (
    <Form errors={errors} onSubmit={(event) => event.preventDefault()}>
      <TextField name="email" label="Email" />
      <TextField name="name" label="Name" />
      <button type="submit">Send</button>
      <button type="button">Elsewhere</button>
    </Form>
  );
}

describe("Spoonjoy accepted form answers", () => {
  it("restores a cleared field for an equal accepted answer, not rebuilt pending messages", async () => {
    const first = { errors: { email: "Taken", name: "Required", general: "Try again" }, privateToken: "private" };
    const { rerender } = render(<Fields />);
    const email = screen.getByRole("textbox", { name: "Email" });
    rerender(<Fields answer={first} />);
    await waitFor(() => expect(email).toHaveFocus());
    const firstAlert = screen.getByRole("alert");
    fireEvent.change(email, { target: { value: "different" } });
    expect(email).not.toHaveAttribute("aria-invalid", "true");
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    rerender(<Fields answer={first} messages={{ ...first.errors, name: "Still required" }} />);
    expect(email).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Still required")).toBeVisible();
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
    expect(screen.getByRole("alert")).toBe(firstAlert);
    rerender(<Fields answer={{ errors: { ...first.errors }, privateToken: "another private value" }} />);
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).not.toBe(firstAlert);
    expect(screen.getByText("Taken")).toBeVisible();
    expect(document.body.textContent).not.toContain("private");
  });

  it("keeps initial display errors masked until an actual answer arrives", async () => {
    const baseline = { email: "Taken" };
    const { rerender } = render(<Fields messages={baseline} />);
    const email = screen.getByRole("textbox", { name: "Email" });
    expect(email).not.toHaveFocus();
    fireEvent.change(email, { target: { value: "different" } });
    rerender(<Fields messages={{ email: "Taken", name: "Required" }} />);
    expect(email).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Required")).toBeVisible();
    rerender(<Fields answer={{ errors: baseline }} />);
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("replaces an equal whole-form refusal only on a genuine new answer", async () => {
    function Message({ answer }: { answer?: { error: string } }) {
      return <Form errors={useFormMessage(answer?.error, answer)}><TextField name="email" label="Email" /></Form>;
    }
    const first = { error: "Could not save" };
    const { rerender } = render(<Message />);
    rerender(<Message answer={first} />);
    const alert = await screen.findByRole("alert");
    rerender(<Message answer={first} />);
    expect(screen.getByRole("alert")).toBe(alert);
    rerender(<Message answer={{ error: "Could not save" }} />);
    await waitFor(() => expect(screen.getByRole("alert")).not.toBe(alert));
  });
});
