import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useFormErrors, useFormMessage, useIntentAnswer, type ActionErrors } from "~/hooks/use-form-errors";
import { formErrorIdentity } from "~/lib/ouro/form-answer";

describe("useFormErrors", () => {
  it("constructs an empty display baseline when the action returned no errors", () => {
    expect(renderHook(() => useFormErrors(undefined)).result.current).toEqual({});
    expect(renderHook(() => useFormErrors(null)).result.current).toEqual({});
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
  it("puts the message under `form`, and constructs an empty baseline without one", () => {
    expect(renderHook(() => useFormMessage("Could not sign out")).result.current).toEqual({ form: "Could not sign out" });
    expect(renderHook(() => useFormMessage(undefined)).result.current).toEqual({});
    expect(renderHook(() => useFormMessage(null)).result.current).toEqual({});
    expect(renderHook(() => useFormMessage("")).result.current).toEqual({});
  });

  describe("explicit intent ownership", () => {
    it("retains the actual own answer through unrelated, missing and malformed intents", () => {
      const intents = ["updateUserInfo"];
      const first = { intent: "updateUserInfo", private: "not a message" };
      const { result, rerender } = renderHook(
        ({ source }: { source: { intent?: unknown; private?: string } | null | undefined }) => useIntentAnswer(source, intents),
        { initialProps: { source: undefined } },
      );
      expect(result.current).toBeUndefined();
      rerender({ source: first });
      expect(result.current).toBe(first);
      rerender({ source: { intent: "uploadPhoto" } });
      expect(result.current).toBe(first);
      rerender({ source: null });
      expect(result.current).toBe(first);
      rerender({ source: { intent: 1 } });
      expect(result.current).toBe(first);
      rerender({ source: {} });
      expect(result.current).toBe(first);
      const second = { intent: "updateUserInfo" };
      rerender({ source: second });
      expect(result.current).toBe(second);
      rerender({ source: second });
      expect(result.current).toBe(second);
    });

    it("uses an initial own answer as a baseline and never serializes its private payload", () => {
      const answer = { intent: "updateUserInfo", private: "secret payload", errors: { email: "Taken" } };
      const own = renderHook(() => useIntentAnswer(answer, ["updateUserInfo"])).result.current;
      expect(own).toBe(answer);
      const errors = renderHook(() => useFormErrors(answer.errors, undefined, own)).result.current;
      expect(JSON.stringify(errors)).toBe('{"email":"Taken"}');
      expect(formErrorIdentity(errors)?.kind).toBe("answer");
      expect(formErrorIdentity(errors)?.value).not.toBe(answer);
    });
  });

  it("keeps the same object for the same answer, and makes a new one when the same message arrives again", () => {
    const first = { error: "Nope" };
    const { result, rerender } = renderHook(({ answer }) => useFormMessage(answer.error, answer), {
      initialProps: { answer: first },
    });
    const shown = result.current;

    rerender({ answer: first });
    expect(result.current).toBe(shown);

    // The same refusal a second time is a new answer: the form shows it and moves focus again.
    rerender({ answer: { error: "Nope" } });
    expect(result.current).not.toBe(shown);
    expect(result.current).toEqual({ form: "Nope" });
  });
});
