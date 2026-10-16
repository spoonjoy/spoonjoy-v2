import { createRef, useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Field } from "~/components/ouro/field/field";
import { FieldControl } from "~/components/ouro/field/field-parts";
import { TextField, type TextFieldProps } from "~/components/ouro/text-field/text-field";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  host.style.maxWidth = "420px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="text-field"]')!;
    },
    get input() {
      return host.querySelector<HTMLInputElement>("input")!;
    },
    get group() {
      return host.querySelector<HTMLElement>("[data-ouro-input-group]")!;
    },
    button(name: string) {
      return [...host.querySelectorAll("button")].find((button) => button.textContent === name) ?? null;
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

describe("TextField", () => {
  it("is a labeled text input built on the Field contract", async () => {
    const { root, input } = await render(<TextField label="Recipe name" name="name" />);
    expect(root.getAttribute("data-ouro")).toBe("text-field");
    expect(input.type).toBe("text");
    expect(input.name).toBe("name");
    expect(input.labels![0]!.textContent).toBe("Recipe name");
    await expect.element(page.getByRole("textbox", { name: "Recipe name" })).toBeVisible();
  });

  it("wires description, error, required and disabled through Field", async () => {
    const { host, input, rerender } = await render(
      <TextField label="Email" type="email" description="We never share it." error="Enter an email address." required />,
    );
    const ids = describedBy(input);
    expect(ids.map((id) => host.querySelector(`#${CSS.escape(id)}`)!.textContent)).toEqual([
      "We never share it.",
      "Enter an email address.",
    ]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-required")).toBe("true");
    await rerender(<TextField label="Email" type="email" disabled />);
    expect(input.disabled).toBe(true);
  });

  it("passes input attributes, value and change handlers through", async () => {
    const onChange = vi.fn();
    const onValueChange = vi.fn();
    const { input } = await render(
      <TextField label="Name" placeholder="Lemon pasta" maxLength={40} defaultValue="Pasta" onChange={onChange} onValueChange={onValueChange} />,
    );
    expect(input.placeholder).toBe("Lemon pasta");
    expect(input.maxLength).toBe(40);
    expect(input.value).toBe("Pasta");
    await userEvent.type(input, "!");
    expect(input.value).toBe("Pasta!");
    expect(onChange).toHaveBeenCalled();
    expect(onValueChange).toHaveBeenLastCalledWith("Pasta!", expect.anything());
  });

  it("passes aria-required through without making the input natively required", async () => {
    const { input } = await render(<TextField label="Quantity" aria-required />);
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.required).toBe(false);
  });

  it("forwards its ref to the input", async () => {
    let element: HTMLInputElement | null = null;
    const object = createRef<HTMLInputElement>();
    const { host } = await render(
      <>
        <TextField label="Name" ref={(node) => void (element = node)} />
        <TextField label="Other" ref={object} />
      </>,
    );
    const [first, second] = [...host.querySelectorAll("input")];
    expect(element).toBe(first);
    expect(object.current).toBe(second);
  });

  it("lets the app's inputMode and autoComplete win over the type's defaults", async () => {
    const { input } = await render(<TextField label="Code" inputMode="numeric" autoComplete="one-time-code" />);
    expect(input.inputMode).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
  });

  it("lets app layout classes win on the root", async () => {
    const { root } = await render(<TextField label="Name" className="mt-6" />);
    expect(getComputedStyle(root).marginTop).toBe("24px");
  });
});

describe("TextField types", () => {
  it.each([
    ["text", "text", "on"],
    ["email", "email", "email"],
    ["password", "text", "current-password"],
    ["tel", "tel", "tel"],
    ["url", "url", "url"],
    ["search", "search", "off"],
    ["date", null, "off"],
    ["time", null, "off"],
  ] as const)("type=%s gets inputMode %s and autocomplete %s", async (type, inputMode, autoComplete) => {
    const { input } = await render(<TextField label="Value" type={type} />);
    expect(input.type).toBe(type);
    expect(input.getAttribute("inputmode")).toBe(inputMode);
    expect(input.getAttribute("autocomplete")).toBe(autoComplete);
    expect(warn).not.toHaveBeenCalled();
  });

  it("turns off capitalization and spell check for email and url", async () => {
    const { host } = await render(
      <>
        <TextField label="Email" type="email" />
        <TextField label="Site" type="url" />
        <TextField label="Name" />
      </>,
    );
    const [email, url, name] = [...host.querySelectorAll("input")];
    for (const input of [email!, url!]) {
      expect(input.getAttribute("autocapitalize")).toBe("none");
      expect(input.spellcheck).toBe(false);
    }
    expect(name!.hasAttribute("autocapitalize")).toBe(false);
  });

  it("renders a text input with a decimal keyboard and points to NumberField for type=number", async () => {
    const props = { label: "Servings", type: "number" } as unknown as TextFieldProps;
    const { input } = await render(<TextField {...props} />);
    expect(input.type).toBe("text");
    expect(input.getAttribute("inputmode")).toBe("decimal");
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] TextField: type="number" is not a TextField type; NumberField parses, steps and formats numbers. Fix: <NumberField label="Servings" />, or <TextField inputMode="numeric"> for digit codes.',
    );
  });

  it.each([
    ["datetime-local", "has no date-and-time field; DatePicker picks the date and a time TextField the time", '<DatePicker label="When" name="date" /> and <TextField label="Time" type="time" name="time" />'],
    ["file", "FileField picks and lists files", '<FileField label="When" name="file" />'],
    ["month", "DatePicker picks dates from a calendar", '<DatePicker label="When" />, or <TextField type="date"> for the OS picker'],
    ["week", "DatePicker picks dates from a calendar", '<DatePicker label="When" />, or <TextField type="date"> for the OS picker'],
  ] as const)("renders a text input and names the component for type=%s", async (type, why, fix) => {
    const props = { label: "When", type } as unknown as TextFieldProps;
    const { input } = await render(<TextField {...props} />);
    expect(input.type).toBe("text");
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] TextField: type="${type}" is not a TextField type; ${why}. Fix: ${fix}.`);
  });

  it("renders a text input and lists the types for any other type", async () => {
    const props = { label: "Color", type: "color" } as unknown as TextFieldProps;
    const { input } = await render(<TextField {...props} />);
    expect(input.type).toBe("text");
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] TextField: type="color" is not a TextField type; use "text", "email", "password", "tel", "url", "search", "date", "time". Fix: <TextField type="text">.',
    );
  });
});

describe("TextField password toggle", () => {
  it("shows and hides the password with a pressed toggle button", async () => {
    const { input, button } = await render(<TextField label="Password" type="password" defaultValue="hunter22" />);
    const show = button("Show password")!;
    expect(input.type).toBe("password");
    expect(show.getAttribute("aria-pressed")).toBe("false");
    expect(show.type).toBe("button");
    await userEvent.click(show);
    expect(input.type).toBe("text");
    // The name stays fixed; the pressed state says whether the password shows.
    expect(show.textContent).toBe("Show password");
    expect(show.getAttribute("aria-pressed")).toBe("true");
    expect(button("Hide password")).toBeNull();
    await userEvent.click(show);
    expect(input.type).toBe("password");
    expect(show.getAttribute("aria-pressed")).toBe("false");
  });

  it("leaves a loose label lookup for the field on the input, not on the toggle or the clear button", async () => {
    const { input } = await render(<TextField label="Password" type="password" clearable clearLabel="Clear password" defaultValue="hunter22" />);
    // Playwright's getByLabel("Password") takes any element whose label text contains the
    // words, and an aria-label is label text. The buttons are named by their own (visually
    // hidden) text, which is a name but not a label, so only the input matches.
    expect(page.getByLabelText("Password", { exact: false }).elements()).toEqual([input]);
    for (const name of ["Show password", "Clear password"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect.element(button).toBeVisible();
      expect(button.element().hasAttribute("aria-label")).toBe(false);
    }
  });

  it("names the toggle and the clear button with showPasswordLabel and clearLabel", async () => {
    const { button, input } = await render(
      <TextField label="Passwort" type="password" clearable defaultValue="x" showPasswordLabel="Passwort anzeigen" clearLabel="Leeren" />,
    );
    const toggle = button("Passwort anzeigen")!;
    await userEvent.click(toggle);
    expect(input.type).toBe("text");
    expect(toggle.textContent).toBe("Passwort anzeigen");
    expect(button("Leeren")).not.toBeNull();
    expect(button("Show password")).toBeNull();
    expect(button("Clear")).toBeNull();
  });

  it("hides the password again when the form submits, so password managers see a password field", async () => {
    let typeAtSubmit = "";
    const { host, button } = await render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          typeAtSubmit = event.currentTarget.querySelector("input")!.type;
        }}
      >
        <TextField label="Password" type="password" defaultValue="hunter22" />
        <button type="submit">Sign in</button>
      </form>,
    );
    await userEvent.click(button("Show password")!);
    expect(host.querySelector("input")!.type).toBe("text");
    await userEvent.click(host.querySelector<HTMLButtonElement>('button[type="submit"]')!);
    expect(typeAtSubmit).toBe("password");
    expect(button("Show password")!.getAttribute("aria-pressed")).toBe("false");
  });

  it("flips the type without losing focus or the cursor position", async () => {
    const { input, button } = await render(<TextField label="Password" type="password" defaultValue="hunter22" />);
    await userEvent.click(input);
    input.setSelectionRange(3, 3);
    await userEvent.click(button("Show password")!);
    expect(input.type).toBe("text");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 3]);
    input.setSelectionRange(2, 5);
    await userEvent.click(button("Show password")!);
    expect(input.type).toBe("password");
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    // Typing carries on at the cursor.
    await userEvent.keyboard("X");
    expect(input.value).toBe("huXr22");
  });

  it("keeps focus on the toggle when the keyboard presses it", async () => {
    const { input, button } = await render(<TextField label="Password" type="password" defaultValue="hunter22" />);
    input.focus();
    await userEvent.keyboard("{Tab}");
    const toggle = button("Show password")!;
    expect(document.activeElement).toBe(toggle);
    await userEvent.keyboard("{Enter}");
    expect(input.type).toBe("text");
    expect(document.activeElement).toBe(toggle);
  });

  it("keeps the type's autocomplete while the password shows", async () => {
    const { input, button } = await render(<TextField label="New password" type="password" autoComplete="new-password" />);
    await userEvent.click(button("Show password")!);
    expect(input.getAttribute("autocomplete")).toBe("new-password");
  });

  it("disables the toggle with the field", async () => {
    const { button } = await render(<TextField label="Password" type="password" disabled />);
    expect(button("Show password")!.disabled).toBe(true);
  });

  it("has no toggle for other types", async () => {
    const { host } = await render(<TextField label="Email" type="email" />);
    expect(host.querySelector("button")).toBeNull();
  });
});

describe("TextField clearable", () => {
  it("clears the field and refocuses it", async () => {
    const onChange = vi.fn();
    const onValueChange = vi.fn();
    const { input, button } = await render(
      <TextField label="Search recipes" type="search" clearable defaultValue="pasta" onChange={onChange} onValueChange={onValueChange} />,
    );
    const clear = button("Clear")!;
    expect(clear.type).toBe("button");
    await userEvent.click(clear);
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenLastCalledWith("", expect.anything());
    // The button only shows while there is something to clear.
    expect(button("Clear")).toBeNull();
    await userEvent.keyboard("soup");
    expect(button("Clear")).not.toBeNull();
  });

  it("clears a controlled field through its change handler", async () => {
    function Controlled() {
      const [value, setValue] = useState("lemon");
      return <TextField label="Search" clearable value={value} onValueChange={(next) => setValue(next)} />;
    }
    const { input, button } = await render(<Controlled />);
    expect(input.value).toBe("lemon");
    await userEvent.click(button("Clear")!);
    expect(input.value).toBe("");
    expect(button("Clear")).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("clears from the keyboard", async () => {
    const { input, button } = await render(<TextField label="Search" clearable defaultValue="pasta" />);
    input.focus();
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(button("Clear"));
    await userEvent.keyboard("{Enter}");
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("hides the button when the form resets the field to empty", async () => {
    const { host, button } = await render(
      <form>
        <TextField label="Search" clearable />
        <button type="reset">Reset</button>
      </form>,
    );
    await userEvent.type(host.querySelector("input")!, "soup");
    expect(button("Clear")).not.toBeNull();
    await userEvent.click(host.querySelector<HTMLButtonElement>('button[type="reset"]')!);
    await expect.poll(() => button("Clear")).toBeNull();
  });

  it("shows no clear button when disabled or read-only", async () => {
    const { host } = await render(
      <>
        <TextField label="One" clearable disabled defaultValue="x" />
        <TextField label="Two" clearable readOnly defaultValue="x" />
      </>,
    );
    expect(host.querySelector("button")).toBeNull();
  });

  it("hides the browser's own clear button on a clearable search field", async () => {
    const { host } = await render(
      <>
        <TextField label="One" type="search" clearable />
        <TextField label="Two" type="search" />
      </>,
    );
    const [clearable, plain] = [...host.querySelectorAll("input")];
    expect(clearable!.className).toContain("[&::-webkit-search-cancel-button]:appearance-none");
    expect(plain!.className).not.toContain("search-cancel");
  });
});

describe("TextField adornments", () => {
  it("shows text and icons before and after the input, inside the box", async () => {
    const { group, input } = await render(
      <TextField
        label="Price"
        startAdornment="$"
        endAdornment={<svg data-testid="icon" viewBox="0 0 16 16" aria-hidden="true" />}
      />,
    );
    const [start, end] = [...group.querySelectorAll("[data-ouro-adornment]")];
    expect(start!.getAttribute("data-ouro-adornment")).toBe("start");
    expect(start!.textContent).toBe("$");
    expect(end!.getAttribute("data-ouro-adornment")).toBe("end");
    const box = group.getBoundingClientRect();
    const field = input.getBoundingClientRect();
    expect(start!.getBoundingClientRect().right).toBeLessThanOrEqual(field.left);
    expect(end!.getBoundingClientRect().left).toBeGreaterThanOrEqual(field.right);
    expect(start!.getBoundingClientRect().left).toBeGreaterThan(box.left);
    expect(end!.getBoundingClientRect().right).toBeLessThan(box.right);
  });

  it("describes the input with text adornments, after the field's own description", async () => {
    const { host, input } = await render(<TextField label="Weight" description="Per serving." startAdornment="about" endAdornment={2} />);
    expect(describedBy(input).map((id) => host.querySelector(`#${CSS.escape(id)}`)!.textContent)).toEqual(["Per serving.", "about", "2"]);
  });

  it("keeps an aria-describedby the app passes", async () => {
    const { input } = await render(<TextField label="Weight" endAdornment="kg" aria-describedby="hint" />);
    expect(describedBy(input).at(-1)).toBe("hint");
    expect(describedBy(input)).toHaveLength(2);
  });

  it("does not describe the input with element adornments", async () => {
    const { input } = await render(<TextField label="Search" startAdornment={<svg viewBox="0 0 16 16" aria-hidden="true" />} />);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });

  it("puts the end adornment after the clear button and the password toggle", async () => {
    const { group } = await render(<TextField label="PIN" type="password" clearable defaultValue="1" endAdornment="!" />);
    const order = [...group.querySelectorAll("input, button, [data-ouro-adornment]")].map(
      (child) => child.getAttribute("data-ouro-adornment") ?? (child.textContent || child.tagName),
    );
    expect(order).toEqual(["INPUT", "Clear", "Show password", "end"]);
  });

  it("focuses the input when the box around it is pressed", async () => {
    const { input, group } = await render(<TextField label="Price" startAdornment="$" />);
    await userEvent.click(group.querySelector("[data-ouro-adornment]")!);
    expect(document.activeElement).toBe(input);
  });

  it("focuses the input when the box is pressed inside a focusable container, such as a dialog", async () => {
    const { input, group } = await render(
      <div tabIndex={-1}>
        <TextField label="Price" startAdornment="$" />
      </div>,
    );
    await userEvent.click(group.querySelector("[data-ouro-adornment]")!);
    expect(document.activeElement).toBe(input);
  });

  it("leaves a plain Field inside an adornment named Field", async () => {
    const { host } = await render(
      <TextField
        label="Outer"
        endAdornment={
          <Field label="Inner">
            <FieldControl />
          </Field>
        }
      />,
    );
    expect(host.querySelector('[data-ouro="text-field"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-ouro="field"]')).toHaveLength(1);
  });

  it("leaves focus alone when an interactive adornment is pressed", async () => {
    const onClick = vi.fn();
    const { host } = await render(
      <TextField
        label="Link"
        endAdornment={
          <button type="button" onClick={onClick}>
            Copy
          </button>
        }
      />,
    );
    const copy = [...host.querySelectorAll("button")].find((button) => button.textContent === "Copy")!;
    await userEvent.click(copy);
    expect(onClick).toHaveBeenCalled();
    // The button takes focus as buttons do in the browser (Safari leaves it on the body).
    expect(document.activeElement).not.toBe(host.querySelector("input"));
  });

  it("does not refocus when the input itself is pressed", async () => {
    const { input } = await render(<TextField label="Name" defaultValue="Pasta" />);
    await userEvent.click(input);
    expect(document.activeElement).toBe(input);
  });
});

describe("TextField looks", () => {
  it("draws one bordered box around the input and its adornments", async () => {
    const { group, input } = await render(<TextField label="Price" startAdornment="$" />);
    const box = getComputedStyle(group);
    expect(box.borderTopStyle).toBe("solid");
    expect(parseFloat(box.borderTopWidth)).toBeGreaterThan(0);
    expect(getComputedStyle(input).borderTopWidth).toBe("0px");
  });

  it("uses a 16px font on phones, so iOS does not zoom on focus, and a 44px box", async () => {
    await page.viewport(390, 844);
    const { input, group } = await render(<TextField label="Email" type="email" />);
    expect(parseFloat(getComputedStyle(input).fontSize)).toBeGreaterThanOrEqual(16);
    const phone = group.getBoundingClientRect().height;
    expect(phone).toBeGreaterThanOrEqual(44);
    await page.viewport(1280, 800);
    await expect.poll(() => group.getBoundingClientRect().height).toBeLessThan(phone);
    expect(getComputedStyle(input).fontSize).toBe("14px");
  });

  it("outlines the box when the input has keyboard focus", async () => {
    const { group, input } = await render(<TextField label="Name" />);
    expect(getComputedStyle(group).outlineStyle).toBe("none");
    input.focus();
    await expect.poll(() => getComputedStyle(group).outlineStyle).toBe("solid");
  });

  it("marks the box with the destructive border when invalid, and fades it when disabled", async () => {
    const { host } = await render(
      <>
        <TextField label="Valid" />
        <TextField label="Invalid" error="Required." />
        <TextField label="Disabled" disabled />
      </>,
    );
    const [valid, invalid, disabled] = [...host.querySelectorAll<HTMLElement>("[data-ouro-input-group]")];
    expect(getComputedStyle(invalid!).borderTopColor).not.toBe(getComputedStyle(valid!).borderTopColor);
    expect(getComputedStyle(disabled!).opacity).toBe("0.5");
  });
});

describe("TextField variant and size", () => {
  it("draws no frame of its own with variant plain, and still outlines on keyboard focus", async () => {
    const { group, input } = await render(<TextField label="Search recipes" hideLabel type="search" variant="plain" />);
    const box = getComputedStyle(group);
    expect(group.dataset.variant).toBe("plain");
    expect(box.borderTopWidth).toBe("0px");
    expect(box.paddingLeft).toBe("0px");
    expect(box.paddingRight).toBe("0px");
    expect(box.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    input.focus();
    await expect.poll(() => getComputedStyle(group).outlineStyle).toBe("solid");
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps a plain field's buttons inside its box", async () => {
    const { group, button } = await render(<TextField label="Search" type="search" variant="plain" clearable defaultValue="basil" />);
    expect(button("Clear")!.getBoundingClientRect().right).toBeLessThanOrEqual(group.getBoundingClientRect().right + 0.5);
  });

  it("sets 20px text in a taller box with size lg, at phone and desktop widths", async () => {
    await page.viewport(390, 844);
    const { group, input } = await render(<TextField label="Search" size="lg" startAdornment={<svg aria-hidden="true" />} />);
    expect(group.dataset.size).toBe("lg");
    expect(getComputedStyle(input).fontSize).toBe("20px");
    expect(group.getBoundingClientRect().height).toBe(56);
    expect(group.querySelector("svg")!.getBoundingClientRect().width).toBe(20);
    await page.viewport(1280, 800);
    await expect.poll(() => group.getBoundingClientRect().height).toBe(48);
    expect(getComputedStyle(input).fontSize).toBe("20px");
  });

  it("is outlined at the medium size by default", async () => {
    const { group } = await render(<TextField label="Name" />);
    expect(group.dataset.variant).toBe("outline");
    expect(group.dataset.size).toBe("md");
  });

  it("sits inside the app's own bordered row: the row draws the one frame", async () => {
    const { host, group, input } = await render(
      <div data-row="" className="flex items-center border-y border-border">
        <TextField label="Search recipes" hideLabel type="search" variant="plain" size="lg" className="flex-1" />
      </div>,
    );
    const row = host.querySelector<HTMLElement>("[data-row]")!;
    expect(input.getBoundingClientRect().left).toBe(row.getBoundingClientRect().left);
    expect(group.getBoundingClientRect().width).toBe(row.getBoundingClientRect().width);
    expect(row.getBoundingClientRect().height).toBe(group.getBoundingClientRect().height + 2);
  });

  it.each([
    ["a filled variant", { variant: "filled" }, 'variant="filled" is not a variant; use "outline" or "plain"', '<TextField variant="outline">'],
    ["shadcn's ghost", { variant: "ghost" }, 'variant="ghost" is not a variant; use "outline" or "plain"', '<TextField variant="plain">'],
    ["an unstyled variant", { variant: "unstyled" }, 'variant="unstyled" is not a variant; use "outline" or "plain"', '<TextField variant="plain">'],
    ["an unknown size", { size: "xl" }, 'size="xl" is not a size; use "md" or "lg"', '<TextField size="md">'],
    ["the input's size attribute", { size: 20 }, "size={20} is not a size; a width in characters is not supported, so set the width with className", '<TextField className="w-40">'],
  ] as const)("renders the default and names the fix for %s", async (_name, wrong, problem, fix) => {
    const props = { label: "Name", ...wrong } as unknown as TextFieldProps;
    const { group, input } = await render(<TextField {...props} />);
    expect(group.dataset.variant).toBe("outline");
    expect(group.dataset.size).toBe("md");
    expect(input.hasAttribute("size")).toBe(false);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] TextField: ${problem}. Fix: ${fix}.`);
  });
});

describe("TextField development messages", () => {
  it.each([
    ["errorMessage", { errorMessage: "Required." }, "errorMessage is not a prop", '<TextField error="Required.">'],
    ["helperText", { helperText: "Hint" }, "helperText is not a prop", '<TextField description="Hint">'],
    ["isInvalid", { isInvalid: true }, "isInvalid is not a prop", '<TextField error="What is wrong">'],
    ["invalid", { invalid: true }, "invalid is not a prop", '<TextField error="What is wrong">'],
    ["isRequired", { isRequired: true }, "isRequired is not a prop", "<TextField required>"],
    ["isDisabled", { isDisabled: true }, "isDisabled is not a prop", "<TextField disabled>"],
    ["startIcon", { startIcon: "x" }, "startIcon is not a prop", "<TextField startAdornment={<SearchIcon />}>"],
    ["leftIcon", { leftIcon: "x" }, "leftIcon is not a prop", "<TextField startAdornment={<SearchIcon />}>"],
    ["endIcon", { endIcon: "x" }, "endIcon is not a prop", "<TextField endAdornment={<CheckIcon />}>"],
    ["rightIcon", { rightIcon: "x" }, "rightIcon is not a prop", "<TextField endAdornment={<CheckIcon />}>"],
    ["prefix", { prefix: "$" }, "prefix is not a prop", '<TextField startAdornment="$">'],
    ["suffix", { suffix: "kg" }, "suffix is not a prop", '<TextField endAdornment="kg">'],
    ["isClearable", { isClearable: true }, "isClearable is not a prop", "<TextField clearable>"],
    ["multiline", { multiline: true }, "multiline is not a prop; TextField is one line", '<TextArea label="Notes" autoGrow />'],
  ])("warns for %s with the fix", async (name, extra, problem, fix) => {
    const props = { label: "Email", ...extra } as unknown as TextFieldProps;
    const { host } = await render(<TextField {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] TextField: ${problem}. Fix: ${fix}.`);
    // Guard props never reach the DOM.
    for (const element of host.querySelectorAll("*")) expect(element.hasAttribute(name.toLowerCase())).toBe(false);
  });

  it("names TextField in Field's messages", async () => {
    const { rerender } = await render(<TextField label="" className="bg-red-500" />);
    await rerender(<TextField label="" className="bg-red-500" />);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '[ouro-ui] TextField: "bg-red-500" sets appearance, and className is for layout only. Fix: <TextField error="What is wrong">.',
      '[ouro-ui] TextField: label is empty, so the control has no name. Fix: <TextField label="Email" hideLabel> to hide a label you still need.',
    ]);
  });

  it("says nothing for a full, valid field", async () => {
    await render(
      <TextField
        label="Password"
        type="password"
        name="password"
        required
        description="8 or more characters."
        error="Too short."
        clearable
        startAdornment="#"
        endAdornment="!"
        hideLabel
        className="mt-2"
        defaultValue="x"
      />,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("TextField server rendering", () => {
  const node = (
    <div>
      <TextField label="Email" type="email" name="email" description="We never share it." error="Enter an email address." required />
      <TextField label="Price" startAdornment="$" endAdornment="per jar" clearable defaultValue="4" />
      <TextField label="Password" type="password" />
    </div>
  );

  it("renders the label, description, error and adornment ids on the server", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = new DOMParser().parseFromString(renderToString(node), "text/html");
    const [email, price] = [...doc.querySelectorAll("input")];
    expect(doc.querySelector(`label[for="${email!.id}"]`)!.textContent).toContain("Email");
    expect(describedBy(email!).map((id) => doc.getElementById(id)!.textContent)).toEqual(["We never share it.", "Enter an email address."]);
    expect(email!.getAttribute("aria-invalid")).toBe("true");
    expect(email!.getAttribute("inputmode")).toBe("email");
    expect(email!.getAttribute("autocomplete")).toBe("email");
    expect(describedBy(price!).map((id) => doc.getElementById(id)!.textContent)).toEqual(["$", "per jar"]);
    expect(doc.querySelector("button[data-ouro-clear]")).not.toBeNull();
    expect(doc.querySelector("button[data-ouro-show-password]")!.getAttribute("aria-pressed")).toBe("false");
    expect(error).not.toHaveBeenCalled();
  });

  it("hydrates with the same ids and no hydration warning", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    const snapshot = () =>
      [...host.querySelectorAll("*")].map((el) => [el.tagName, el.id, el.getAttribute("for"), el.getAttribute("aria-describedby")]);
    const before = snapshot();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(snapshot()).toEqual(before);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    // Hydrated, the controls work.
    const clear = host.querySelector<HTMLButtonElement>("button[data-ouro-clear]")!;
    await userEvent.click(clear);
    expect(host.querySelectorAll("input")[1]!.value).toBe("");
  });
});

describe("TextField under a parent's spacing", () => {
  it("keeps the 16px that space-y-4 puts between the TextField and the button below it", async () => {
    // The parent's rule has zero specificity, so a margin class on the root would beat it.
    const { host } = await render(
      <div className="space-y-4">
        <TextField label="Email" />
        <Button>Save</Button>
      </div>,
    );
    const root = host.querySelector<HTMLElement>('[data-ouro="text-field"]')!;
    const button = host.querySelector<HTMLElement>('[data-ouro="button"]')!;
    expect(getComputedStyle(root).marginBottom).toBe("16px");
    expect(Math.abs(button.getBoundingClientRect().top - root.getBoundingClientRect().bottom - 16)).toBeLessThanOrEqual(1);
  });
});
