import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { formErrors, formErrorIdentity, type FormErrors } from "~/lib/ouro/form-answer";

describe("formErrors answer value", () => {
  it("recognizes the same answer through fresh projections and different answers with equal projections", () => {
    const answer = {};
    const first = formErrorIdentity(formErrors(answer, { email: "Taken." }))!;
    const same = formErrorIdentity(formErrors(answer, { email: "Other presentation." }))!;
    const next = formErrorIdentity(formErrors({}, { email: "Taken." }))!;
    expect(first.kind).toBe("answer");
    expect(same.value).toBe(first.value);
    expect(next.value).not.toBe(first.value);
    expect(first.value).not.toBe(answer);
    expect(Reflect.ownKeys(first.value as object)).toEqual([]);
  });

  it("snapshots records and array containers without cloning React nodes or freezing caller data", () => {
    const node = createElement("a", { href: "/help" }, "Help");
    const list = ["Taken.", node];
    const messages = { email: list };
    const value = formErrors({}, messages);
    list.push("Later.");
    messages.email = ["Replacement."];
    expect(value.email).toEqual(["Taken.", node]);
    expect((value.email as readonly unknown[])[1]).toBe(node);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.email)).toBe(true);
    expect(Object.isFrozen(messages)).toBe(false);
    expect(Object.isFrozen(list)).toBe(false);
    expect(() => {
      if (Array.isArray(value.email)) value.email.push("Guard bypass.");
    }).toThrow(TypeError);
  });

  it("enumerates and serializes only selected messages, never a cyclic private answer or its getter", () => {
    const answer = { private: { secret: "PRIVATE_SENTINEL" }, self: undefined as unknown };
    answer.self = answer;
    Object.defineProperty(answer, "danger", { enumerable: true, get() { throw new Error("source getter must not be read"); } });
    const value = formErrors(answer, { email: "Taken.", form: ["Try again."] });
    expect(Reflect.ownKeys(value)).toEqual(["email", "form"]);
    expect(JSON.stringify(value)).toBe('{"email":"Taken.","form":["Try again."]}');
    expect({ ...value }).toEqual({ email: "Taken.", form: ["Try again."] });
    expect(formErrorIdentity(JSON.parse(JSON.stringify(value)) as FormErrors)).toBeUndefined();
    expect(formErrorIdentity({ ...value })).toBeUndefined();
  });

  it("interns object keys without retaining the key payload and lets the key override source identity", () => {
    const key = { secret: "KEY_SENTINEL" };
    const first = formErrorIdentity(formErrors(key, { email: "Taken." }, { key }))!;
    const same = formErrorIdentity(formErrors({}, {}, { key }))!;
    expect(first.kind).toBe("key");
    expect(first.value).not.toBe(key);
    expect(Reflect.ownKeys(first.value as object)).toEqual([]);
    expect(same.value).toBe(first.value);
    expect(JSON.stringify(formErrors(key, {}, { key }))).toBe("{}");
    expect(formErrorIdentity(formErrors(key, {}))!.kind).toBe("answer");
  });

  it.each([0, "", false, 1n, Symbol("accepted"), NaN])("accepts the explicitly present key %s for primitive answers", (key) => {
    const first = formErrorIdentity(formErrors("cached", {}, { key }))!;
    const same = formErrorIdentity(formErrors(undefined, {}, { key }))!;
    expect(first.kind).toBe("key");
    expect(Object.is(first.value, same.value)).toBe(true);
  });

  it("uses Object.is for keys, including negative zero, without a global scalar intern table", () => {
    expect(Object.is(
      formErrorIdentity(formErrors(null, {}, { key: 0 }))!.value,
      formErrorIdentity(formErrors(null, {}, { key: -0 }))!.value,
    )).toBe(false);
  });

  it.each([null, undefined])("marks %s with no explicit key as absence, not a newly allocated answer", (answer) => {
    expect(formErrorIdentity(formErrors(answer, null))!.kind).toBe("none");
    expect(formErrors(answer)).toEqual({});
  });

  it("supports function source identities without inspecting their properties", () => {
    const answer = () => {};
    expect(formErrorIdentity(formErrors(answer, {}))!.value).toBe(formErrorIdentity(formErrors(answer, {}))!.value);
  });

  it("preserves an own __proto__ message key without mutating prototypes", () => {
    const messages = JSON.parse('{"__proto__":"Selected message."}') as FormErrors;
    const value = formErrors({}, messages);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(value["__proto__"]).toBe("Selected message.");
  });

  it.each([["email", 42], ["form", { secret: "REJECTED_SENTINEL" }], ["email", ["Fine.", 42]]])(
    "rejects malformed messages for %s with a safe fix, never the rejected payload",
    (name, message) => {
      let error: unknown;
      try {
        formErrors({ private: "SOURCE_SENTINEL" }, { [name as string]: message } as FormErrors);
      } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain(`[ouro-ui] Form: formErrors messages for "${name}"`);
      expect(String(error)).toContain("Fix:");
      expect(String(error)).not.toContain("SENTINEL");
      expect(String(error)).not.toContain("42");
    },
  );

  it.each([42, "private primitive", true])("requires an accepted key for a primitive source (%s)", (answer) => {
    expect(() => formErrors(answer as unknown as object, {})).toThrow("formErrors needs an object answer or an accepted key");
  });

  it.each([undefined, null])("rejects an explicitly invalid key %s rather than falling back to source identity", (key) => {
    expect(() => formErrors({}, {}, { key } as never)).toThrow("formErrors key must not be null or undefined");
  });

  it.each<[string, object]>([["missing", {}], ["inherited", Object.create({ key: "inherited" }) as object]])("rejects options without an own accepted key instead of silently choosing object identity (%s)", (_kind, options) => {
    expect(() => formErrors({}, {}, options as never)).toThrow("formErrors key must not be null or undefined");
  });

  it("retains empty selected values without treating them as answers or accessing source properties", () => {
    const value = formErrors(undefined, { email: null, form: undefined });
    expect(value).toEqual({ email: null, form: undefined });
    expect(formErrorIdentity(value)!.kind).toBe("none");
  });

  it("decodes null, undefined and ordinary records as raw absence, not answer-bearing values", () => {
    expect(formErrorIdentity(null)).toBeUndefined();
    expect(formErrorIdentity(undefined)).toBeUndefined();
    expect(formErrorIdentity({ email: "Taken." })).toBeUndefined();
  });

  it.each([[], 42, "PRIVATE_SENTINEL"])("rejects a malformed projection without printing its value", (messages) => {
    expect(() => formErrors({}, messages as unknown as FormErrors)).toThrow("formErrors messages must be a record");
    try { formErrors({}, messages as unknown as FormErrors); } catch (error) {
      expect(String(error)).not.toContain("PRIVATE_SENTINEL");
    }
  });
});
