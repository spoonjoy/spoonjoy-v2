import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFormErrors, useFormMessage, type ActionErrors } from "~/hooks/use-form-errors";

describe("useFormErrors", () => {
  it("is undefined when the action returned no errors", () => {
    expect(renderHook(() => useFormErrors(undefined)).result.current).toBeUndefined();
    expect(renderHook(() => useFormErrors(null)).result.current).toBeUndefined();
  });

  it("keeps each field's message under its name and puts `general` under `form`", () => {
    const errors: ActionErrors = { title: "Title is required", tags: ["Too many", "Too long"], general: "Could not save" };
    expect(renderHook(() => useFormErrors(errors)).result.current).toEqual({
      title: "Title is required",
      tags: ["Too many", "Too long"],
      form: "Could not save",
    });
  });

  it("leaves out empty entries", () => {
    const errors: ActionErrors = { title: "", description: null, servings: undefined, tags: [], general: "" };
    expect(renderHook(() => useFormErrors(errors)).result.current).toEqual({});
  });

  it("passes only the named fields and `general` when given the form's field names", () => {
    const fields = ["email"] as const;
    const errors: ActionErrors = { email: "Email is taken", newPassword: "Too short", general: "Try again" };
    expect(renderHook(() => useFormErrors(errors, fields)).result.current).toEqual({
      email: "Email is taken",
      form: "Try again",
    });
  });

  it("keeps the same object until the action returns new errors, so the form does not show them again", () => {
    const first: ActionErrors = { title: "Title is required" };
    const { result, rerender } = renderHook(({ errors }) => useFormErrors(errors), { initialProps: { errors: first } });
    const shown = result.current;

    rerender({ errors: first });
    expect(result.current).toBe(shown);

    rerender({ errors: { title: "Title is required" } });
    expect(result.current).not.toBe(shown);
    expect(result.current).toEqual(shown);
  });
});

describe("useFormMessage", () => {
  it("puts the message under `form`, and is undefined without one", () => {
    expect(renderHook(() => useFormMessage("Could not sign out")).result.current).toEqual({ form: "Could not sign out" });
    expect(renderHook(() => useFormMessage(undefined)).result.current).toBeUndefined();
    expect(renderHook(() => useFormMessage(null)).result.current).toBeUndefined();
    expect(renderHook(() => useFormMessage("")).result.current).toBeUndefined();
  });

  it("keeps the same object while the message is the same", () => {
    const { result, rerender } = renderHook(({ message }) => useFormMessage(message), { initialProps: { message: "Nope" } });
    const shown = result.current;
    rerender({ message: "Nope" });
    expect(result.current).toBe(shown);
  });
});
