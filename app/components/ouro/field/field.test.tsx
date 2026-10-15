import { Form } from "@base-ui/react/form";
import { type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, server } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Field } from "~/components/ouro/field/field";
import { RadioGroup } from "~/components/ouro/radio-group/radio-group";
import { Select } from "~/components/ouro/select/select";
import { Form as OuroForm } from "~/components/ouro/form/form";
import {
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldRoot,
} from "~/components/ouro/field/field-parts";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get field() {
      return host.querySelector<HTMLElement>('[data-ouro="field"]')!;
    },
    get input() {
      return host.querySelector<HTMLInputElement>("input")!;
    },
    get label() {
      return host.querySelector<HTMLLabelElement>("label")!;
    },
  };
}

/** The ids an element's `aria-describedby` lists. */
const describedBy = (element: Element) => (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await page.viewport(414, 896);
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

describe("Field wiring", () => {
  it("associates the label with the control", async () => {
    const { input, label, field } = await render(
      <Field label="Email">
        <FieldControl type="email" />
      </Field>,
    );
    expect(field.getAttribute("data-ouro")).toBe("field");
    expect(label.htmlFor).toBe(input.id);
    expect(input.id).not.toBe("");
    expect([...input.labels!]).toEqual([label]);
    await expect.element(page.getByRole("textbox", { name: "Email" })).toBeVisible();
  });

  it("references the description and the error in aria-describedby", async () => {
    const { host, input } = await render(
      <Field label="Email" description="We never share it." error="Enter an email address.">
        <FieldControl />
      </Field>,
    );
    const description = [...host.querySelectorAll("p, div")].find((el) => el.textContent === "We never share it.")!;
    const error = [...host.querySelectorAll("div")].find((el) => el.textContent === "Enter an email address.")!;
    expect(description.id).not.toBe("");
    expect(error.id).not.toBe("");
    expect(describedBy(input)).toEqual([description.id, error.id]);
    await expect.element(page.getByRole("textbox", { name: "Email" })).toHaveAccessibleDescription("We never share it. Enter an email address.");
  });

  it("has no aria-describedby without a description or an error", async () => {
    const { input } = await render(
      <Field label="Email">
        <FieldControl />
      </Field>,
    );
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });

  it("keeps an aria-describedby the app passes to the control", async () => {
    const { input, host } = await render(
      <>
        <p id="hint">Outside hint</p>
        <Field label="Email" description="Inside">
          <FieldControl aria-describedby="hint" />
        </Field>
      </>,
    );
    const inside = [...host.querySelectorAll("p")].find((el) => el.textContent === "Inside")!;
    expect(describedBy(input)).toEqual([inside.id, "hint"]);
  });

  it("sets aria-invalid and shows the message with error", async () => {
    const { input, host, rerender } = await render(
      <Field label="Email">
        <FieldControl />
      </Field>,
    );
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    await rerender(
      <Field label="Email" error="Enter an email address.">
        <FieldControl />
      </Field>,
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain("Enter an email address.");
    await rerender(
      <Field label="Email" error="">
        <FieldControl />
      </Field>,
    );
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  it("shows an error that is a React node, such as a message with a link, and describes the control with it", async () => {
    const { host, input } = await render(
      <Field
        label="Recipe link"
        error={
          <>
            You already brought this one in as Soup. <a href="/recipes/soup">Open it</a>
          </>
        }
      >
        <FieldControl />
      </Field>,
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const error = host.querySelector<HTMLElement>(`#${CSS.escape(describedBy(input)[0]!)}`)!;
    expect(error.textContent).toBe("You already brought this one in as Soup. Open it");
    expect(error.querySelector("a")!.getAttribute("href")).toBe("/recipes/soup");
    await expect.element(page.getByRole("textbox", { name: "Recipe link" })).toHaveAccessibleDescription("You already brought this one in as Soup. Open it");
    await expect.element(page.getByRole("link", { name: "Open it" })).toBeVisible();
  });

  it("lists nodes and strings from an error array, and counts null, false and empty text as no error", async () => {
    const { host, input, rerender } = await render(
      // The types take text and elements only; untyped code can leave a condition's null or false behind.
      <Field label="Password" error={["Use 8 or more characters.", <a key="rules" href="/rules">Read the rules</a>, null, false, ""] as string[]}>
        <FieldControl />
      </Field>,
    );
    expect([...host.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["Use 8 or more characters.", "Read the rules"]);
    for (const empty of [null, false, "", [], [null, ""]]) {
      await rerender(
        <Field label="Password" error={empty as string[]}>
          <FieldControl />
        </Field>,
      );
      expect(input.hasAttribute("aria-invalid")).toBe(false);
      expect(describedBy(input)).toEqual([]);
    }
  });

  it("shows every message of an error array as a list", async () => {
    const { input, host } = await render(
      <Field label="Password" error={["Use 8 or more characters.", "Add a number."]}>
        <FieldControl type="password" />
      </Field>,
    );
    const items = [...host.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(["Use 8 or more characters.", "Add a number."]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const error = host.querySelector("ul")!.parentElement!;
    expect(describedBy(input)).toContain(error.id);
  });

  it("shows a repeated message once, with no key warning", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { host } = await render(
      <Field label="Email" error={["Required.", "Required.", "Use a full address."]}>
        <FieldControl />
      </Field>,
    );
    expect([...host.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Required.", "Use a full address."]);
    expect(error).not.toHaveBeenCalled();
  });

  it("shows two copies of one message as that message", async () => {
    const { host } = await render(
      <Field label="Email" error={["Required.", "Required."]}>
        <FieldControl />
      </Field>,
    );
    expect(host.querySelector("ul")).toBeNull();
    expect(host.textContent).toContain("Required.");
  });

  it("treats an empty error array as valid", async () => {
    const { input } = await render(
      <Field label="Email" error={[]}>
        <FieldControl />
      </Field>,
    );
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  it("sets required and aria-required, and marks the label without adding to its text or name", async () => {
    const { input, label, host } = await render(
      <Field label="Email" required>
        <FieldControl />
      </Field>,
    );
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-required")).toBe("true");
    // The marker is CSS on the element around the label: no element and no text of its own.
    const marked = host.querySelector<HTMLElement>("[data-ouro-required]")!;
    expect(marked.contains(label)).toBe(true);
    expect(marked).not.toBe(label);
    expect(getComputedStyle(marked, "::after").content).toBe('"*" / ""');
    expect(getComputedStyle(label, "::after").content).toBe("none");
    expect(label.textContent).toBe("Email");
    expect(host.textContent).toBe("Email");
    await expect.element(page.getByRole("textbox", { name: "Email", exact: true })).toBeVisible();
  });

  it("finds a required field by its exact label, as Testing Library and Playwright look it up", async () => {
    const { input, label } = await render(
      <Field label="Email" required>
        <FieldControl />
      </Field>,
    );
    // Testing Library's getByLabelText("Email") compares the whole text of the <label>.
    expect([...document.querySelectorAll("label")].filter((element) => element.textContent === "Email")).toEqual([label]);
    // Playwright's getByLabel("Email", { exact: true }), which Vitest's getByLabelText shares.
    expect(page.getByLabelText("Email", { exact: true }).elements()).toEqual([input]);
    expect(page.getByLabelText("Email", { exact: false }).elements()).toEqual([input]);
  });

  it("shows the required marker beside the label, and in forced colors too", async () => {
    const { host } = await render(
      <>
        <Field label="Email" required>
          <FieldControl />
        </Field>
        <Field label="Email">
          <FieldControl />
        </Field>
      </>,
    );
    const [required, plain] = [...host.querySelectorAll<HTMLElement>("[data-ouro-label]")];
    const markerWidth = () => required!.getBoundingClientRect().width - plain!.getBoundingClientRect().width;
    expect(markerWidth()).toBeGreaterThan(4);
    // WebKit has no forced-colors mode to check.
    if (server.browser !== "chromium") return;
    await commands.emulateMedia({ forcedColors: "active" });
    try {
      await expect.poll(() => matchMedia("(forced-colors: active)").matches).toBe(true);
      // Generated text takes the forced text color, so it shows on any forced background.
      const probe = document.createElement("span");
      probe.style.color = "CanvasText";
      host.append(probe);
      const after = getComputedStyle(required!, "::after");
      expect(after.content).toBe('"*" / ""');
      expect(after.color).toBe(getComputedStyle(probe).color);
      expect(markerWidth()).toBeGreaterThan(4);
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

  it("passes aria-required through, to say a control is required without the browser's blocking check", async () => {
    const { input, rerender } = await render(
      <Field label="Quantity">
        <FieldControl aria-required />
      </Field>,
    );
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.required).toBe(false);
    // A required field stays required whatever the control is passed.
    await rerender(
      <Field label="Quantity" required>
        <FieldControl aria-required={false} />
      </Field>,
    );
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.required).toBe(true);
  });

  it("has no required marker or aria-required by default", async () => {
    const { input, label } = await render(
      <Field label="Email">
        <FieldControl />
      </Field>,
    );
    expect(input.required).toBe(false);
    expect(input.hasAttribute("aria-required")).toBe(false);
    expect(label.closest("[data-ouro-label]")!.hasAttribute("data-ouro-required")).toBe(false);
    expect(getComputedStyle(label.closest("[data-ouro-label]")!, "::after").content).toBe("none");
  });

  it("disables the control with disabled and fades the label", async () => {
    const { input, label } = await render(
      <Field label="Email" disabled>
        <FieldControl />
      </Field>,
    );
    expect(input.disabled).toBe(true);
    expect(Number(getComputedStyle(label).opacity)).toBeLessThan(1);
  });

  it("names the control with name", async () => {
    const { input } = await render(
      <Field label="Email" name="email">
        <FieldControl />
      </Field>,
    );
    expect(input.name).toBe("email");
  });

  it("hides the label visually with hideLabel and keeps it as the name", async () => {
    const { label } = await render(
      <Field label="Search recipes" hideLabel>
        <FieldControl />
      </Field>,
    );
    // The element around the label is what hides, so a required marker hides with it.
    const rect = label.closest("[data-ouro-label]")!.getBoundingClientRect();
    expect(rect.width).toBeLessThanOrEqual(1);
    expect(rect.height).toBeLessThanOrEqual(1);
    await expect.element(page.getByRole("textbox", { name: "Search recipes" })).toBeInTheDocument();
  });

  it("focuses the control when the label is clicked", async () => {
    const { input, label } = await render(
      <Field label="Email">
        <FieldControl />
      </Field>,
    );
    label.click();
    expect(document.activeElement).toBe(input);
  });

  it("shows a Base UI Form error for its name without an error prop", async () => {
    const { input, host } = await render(
      <Form errors={{ email: "That email is taken." }}>
        <Field label="Email" name="email">
          <FieldControl />
        </Field>
      </Form>,
    );
    expect(host.textContent).toContain("That email is taken.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("lets app layout classes win", async () => {
    const { field } = await render(
      <Field label="Email" className="mt-4 w-40">
        <FieldControl />
      </Field>,
    );
    expect(getComputedStyle(field).marginTop).toBe("16px");
    expect(getComputedStyle(field).width).toBe("160px");
  });
});

describe("Field looks", () => {
  it("styles the control as a bordered text input in the theme's colors", async () => {
    const { input } = await render(
      <Field label="Email">
        <FieldControl />
      </Field>,
    );
    const style = getComputedStyle(input);
    expect(style.borderTopStyle).toBe("solid");
    expect(parseFloat(style.borderTopWidth)).toBeGreaterThan(0);
    expect(style.width).not.toBe("0px");
    expect(style.boxSizing).toBe("border-box");
  });

  it("uses a 16px font on phones, so iOS does not zoom on focus, and steps down from sm", async () => {
    await page.viewport(390, 844);
    const { input } = await render(
      <Field label="Email">
        <FieldControl />
      </Field>,
    );
    expect(getComputedStyle(input).fontSize).toBe("16px");
    const phone = input.getBoundingClientRect().height;
    expect(phone).toBeGreaterThanOrEqual(44);
    await page.viewport(1280, 800);
    await expect.poll(() => input.getBoundingClientRect().height).toBeLessThan(phone);
    expect(getComputedStyle(input).fontSize).toBe("14px");
  });

  it("marks an invalid control with the destructive border", async () => {
    const { host } = await render(
      <>
        <Field label="Valid">
          <FieldControl />
        </Field>
        <Field label="Invalid" error="Required.">
          <FieldControl />
        </Field>
      </>,
    );
    const [valid, invalid] = [...host.querySelectorAll("input")];
    expect(getComputedStyle(invalid!).borderTopColor).not.toBe(getComputedStyle(valid!).borderTopColor);
  });

  it("shows a focus outline in the ring color on keyboard focus", async () => {
    const { input } = await render(
      <Field label="Email">
        <FieldControl />
      </Field>,
    );
    input.focus();
    const style = getComputedStyle(input);
    expect(style.outlineStyle).toBe("solid");
  });

  it("fades and slides the error in, and only fades it with reduced motion", async () => {
    const { host, rerender } = await render(
      <Field label="Email">
        <FieldControl />
      </Field>,
    );
    await rerender(
      <Field label="Email" error="Required.">
        <FieldControl />
      </Field>,
    );
    const error = [...host.querySelectorAll("div")].find((el) => el.textContent === "Required.")!;
    const properties = getComputedStyle(error).transitionProperty;
    expect(properties).toContain("opacity");
    expect(properties).toMatch(/translate|transform/);
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await expect.poll(() => getComputedStyle(error).transitionProperty).toBe("opacity");
  });
});

describe("Field development messages", () => {
  it.each([
    ["htmlFor", { htmlFor: "email" }, "htmlFor is not a prop; Field connects the label itself", '<Field label="Email"><FieldControl /></Field>'],
    ["errorMessage", { errorMessage: "Required." }, "errorMessage is not a prop", '<Field error="Required.">'],
    ["helperText", { helperText: "Hint" }, "helperText is not a prop", '<Field description="Hint">'],
    ["isInvalid", { isInvalid: true }, "isInvalid is not a prop", '<Field error="What is wrong">'],
    ["invalid", { invalid: true }, "invalid is not a prop", '<Field error="What is wrong">'],
    ["isRequired", { isRequired: true }, "isRequired is not a prop", "<Field required>"],
    ["isDisabled", { isDisabled: true }, "isDisabled is not a prop", "<Field disabled>"],
    ["placeholder", { placeholder: "Email" }, "placeholder is not a label", '<Field label="Email"><FieldControl placeholder="you@example.com" /></Field>'],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const props = { label: "Email", ...extra } as unknown as Parameters<typeof Field>[0];
    const { field } = await render(
      <Field {...props}>
        <FieldControl />
      </Field>,
    );
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Field: ${problem}. Fix: ${fix}.`);
    // Guard props never reach the DOM.
    expect(field.hasAttribute(Object.keys(extra)[0]!.toLowerCase())).toBe(false);
  });

  it("warns once for an empty label", async () => {
    const { rerender } = await render(
      <Field label="">
        <FieldControl />
      </Field>,
    );
    await rerender(
      <Field label="">
        <FieldControl />
      </Field>,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "[ouro-ui] Field: label is empty, so the control has no name. Fix: <Field label=\"Email\" hideLabel> to hide a label you still need.",
    );
  });

  it("warns when the child is not a control the label can reach", async () => {
    await render(
      <Field label="Notes">
        <textarea />
      </Field>,
    );
    expect(warn).toHaveBeenCalledWith(
      "[ouro-ui] Field: the label is not connected to a control. Fix: <Field label=\"Notes\"><FieldControl /></Field>, or <FieldControl render={<textarea />} /> for another element.",
    );
  });

  it("does not warn for a control rendered through FieldControl", async () => {
    await render(
      <Field label="Notes" description="Optional." error="Too long." required name="notes">
        <FieldControl render={<textarea />} />
      </Field>,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns for an appearance class, pointing to the control", async () => {
    await render(
      <Field label="Email" className="bg-red-500">
        <FieldControl />
      </Field>,
    );
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Field: "bg-red-500" sets appearance, and className is for layout only. Fix: <Field error="What is wrong">.',
    );
  });

  it("points other appearance classes to the theme", async () => {
    await render(
      <Field label="Email" className="text-lg">
        <FieldControl />
      </Field>,
    );
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Field: "text-lg" sets appearance, and className is for layout only. Fix: style fields in your theme (--input, --ring, --radius).',
    );
  });
});

describe("Required marker", () => {
  it("is an asterisk with empty alternative text, so screen readers do not read it", async () => {
    const { label } = await render(
      <Field label="Email" required>
        <FieldControl />
      </Field>,
    );
    const content = getComputedStyle(label.closest("[data-ouro-label]")!, "::after").content;
    expect(content.replace(/\s+/g, " ")).toBe('"*" / ""');
  });

  it.each<[string, () => ReactNode, string]>([
    ["a field with a <label>", () => <Field label="Email" required disabled><FieldControl /></Field>, "[data-ouro-label]"],
    ["a field whose label is not a <label>", () => <Select label="Course" required disabled options={[{ value: "main", label: "Main" }]} />, "[data-ouro-label]"],
    ["a group's legend", () => <RadioGroup legend="Size" required disabled options={[{ value: "s", label: "Small" }]} />, "[data-ouro-legend]"],
  ])("fades with %s when it is disabled", async (_name, node, frame) => {
    const { host } = await render(node());
    expect(getComputedStyle(host.querySelector(frame)!, "::after").opacity).toBe("0.5");
  });
});

describe("Helper text after the control", () => {
  it("links a FieldDescription placed after the control in a Field, and keeps the error after it", async () => {
    const { input, host, field } = await render(
      <OuroForm errors={{ email: "That email is taken." }}>
        <Field label="Email" name="email">
          <FieldControl type="email" />
          <FieldDescription>We never share it.</FieldDescription>
        </Field>
      </OuroForm>,
    );
    const order = [...field.children].map((child) => child.textContent);
    expect(order).toEqual(["Email", "", "We never share it.", "That email is taken."]);
    await expect.poll(() => describedBy(input).map((id) => host.querySelector(`#${CSS.escape(id)}`)?.textContent)).toEqual(
      expect.arrayContaining(["We never share it.", "That email is taken."]),
    );
    await expect.element(page.getByRole("textbox", { name: "Email", exact: true })).toHaveAccessibleDescription("That email is taken. We never share it.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(warn).not.toHaveBeenCalled();
  });

  it("links a FieldDescription placed after the control in a field built from parts", async () => {
    const { input, field } = await render(
      <FieldRoot name="email">
        <FieldLabel>Email</FieldLabel>
        <FieldControl type="email" />
        <FieldDescription>We never share it.</FieldDescription>
        <FieldError />
      </FieldRoot>,
    );
    expect([...field.children].map((child) => child.textContent)).toEqual(["Email", "", "We never share it."]);
    await expect.element(page.getByRole("textbox", { name: "Email", exact: true })).toHaveAccessibleDescription("We never share it.");
    expect(input.name).toBe("email");
  });
});

describe("Field parts", () => {
  it("compose a field with the same wiring", async () => {
    const { input, label, host } = await render(
      <FieldRoot name="email" required invalid className="mt-2">
        <FieldLabel>Email</FieldLabel>
        <FieldDescription>We never share it.</FieldDescription>
        <FieldControl type="email" />
        <FieldError match>Enter an email address.</FieldError>
      </FieldRoot>,
    );
    expect(label.htmlFor).toBe(input.id);
    expect(input.name).toBe("email");
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(label.closest("[data-ouro-required]")).not.toBeNull();
    expect(label.textContent).toBe("Email");
    const ids = describedBy(input);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(host.querySelector(`#${CSS.escape(id)}`)).not.toBeNull();
    expect(host.querySelector('[data-ouro="field"]')).not.toBeNull();
  });

  it.each([
    ["FieldLabel", () => <FieldLabel>Email</FieldLabel>],
    ["FieldDescription", () => <FieldDescription>Hint</FieldDescription>],
    ["FieldError", () => <FieldError match>Required.</FieldError>],
    ["FieldControl", () => <FieldControl />],
  ])("%s throws outside FieldRoot with the JSX shape", (name, part) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderToString(part())).toThrow(
      `[ouro-ui] ${name}: must be rendered inside <FieldRoot> or <Field>. Fix: <FieldRoot name="email"><FieldLabel>Email</FieldLabel><FieldDescription>…</FieldDescription><FieldControl /><FieldError /></FieldRoot>.`,
    );
    error.mockRestore();
  });

  it("warns about appearance classes on parts", async () => {
    await render(
      <FieldRoot className="shadow-lg">
        <FieldLabel className="font-bold">Email</FieldLabel>
        <FieldDescription className="text-red-500">Hint</FieldDescription>
        <FieldControl className="rounded-full" />
        <FieldError match className="text-sm">
          Required.
        </FieldError>
      </FieldRoot>,
    );
    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^\[ouro-ui\] FieldRoot: "shadow-lg" sets appearance/),
        expect.stringMatching(/^\[ouro-ui\] FieldLabel: "font-bold" sets appearance/),
        expect.stringMatching(/^\[ouro-ui\] FieldDescription: "text-red-500" sets appearance/),
        expect.stringMatching(/^\[ouro-ui\] FieldControl: "rounded-full" sets appearance/),
        expect.stringMatching(/^\[ouro-ui\] FieldError: "text-sm" sets appearance/),
      ]),
    );
  });
});

describe("Field server rendering", () => {
  it("renders the label, description and error ids on the server", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <Field label="Email" description="We never share it." error="Enter an email address." required className="bg-red-500">
        <FieldControl />
      </Field>,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const input = doc.querySelector("input")!;
    const label = doc.querySelector("label")!;
    expect(label.htmlFor).toBe(input.id);
    const ids = describedBy(input);
    expect(ids).toHaveLength(2);
    expect(doc.getElementById(ids[0]!)!.textContent).toBe("We never share it.");
    expect(doc.getElementById(ids[1]!)!.textContent).toBe("Enter an email address.");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("hydrates with the same ids and no hydration warning", async () => {
    const node = (
      <div>
        <Field label="Email" description="We never share it." error="Enter an email address." required>
          <FieldControl />
        </Field>
        <Field label="Name" description="As on your card.">
          <FieldControl />
        </Field>
      </div>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    const before = [...host.querySelectorAll("input, label, p, div")].map((el) => [
      el.id,
      el.getAttribute("for"),
      el.getAttribute("aria-describedby"),
    ]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    const after = [...host.querySelectorAll("input, label, p, div")].map((el) => [
      el.id,
      el.getAttribute("for"),
      el.getAttribute("aria-describedby"),
    ]);
    expect(after).toEqual(before);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const [email, name] = [...host.querySelectorAll("input")];
    expect(email!.labels![0]!.textContent).toContain("Email");
    expect(name!.labels![0]!.textContent).toBe("Name");
  });
});

describe("Field under a parent's spacing", () => {
  it("keeps the 16px that space-y-4 puts between the Field and the button below it", async () => {
    // The parent's rule has zero specificity, so a margin class on the root would beat it.
    const { host } = await render(
      <div className="space-y-4">
        <Field label="Email">
          <FieldControl />
        </Field>
        <Button>Save</Button>
      </div>,
    );
    const root = host.querySelector<HTMLElement>('[data-ouro="field"]')!;
    const button = host.querySelector<HTMLElement>('[data-ouro="button"]')!;
    expect(getComputedStyle(root).marginBottom).toBe("16px");
    expect(Math.abs(button.getBoundingClientRect().top - root.getBoundingClientRect().bottom - 16)).toBeLessThanOrEqual(1);
  });
});
