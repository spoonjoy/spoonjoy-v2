import { createRef, useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { NumberField, type NumberFieldProps } from "~/components/ouro/number-field/number-field";
import { Form } from "~/components/ouro/form/form";
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
      return host.querySelector<HTMLElement>('[data-ouro="number-field"]')!;
    },
    get input() {
      return host.querySelector<HTMLInputElement>("input:not([aria-hidden])")!;
    },
    get group() {
      return host.querySelector<HTMLElement>("[data-ouro-number-field-group]")!;
    },
    button(name: string) {
      return [...host.querySelectorAll("button")].find((button) => button.textContent === name)!;
    },
  };
}

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
});

describe("NumberField", () => {
  it("is a labeled number input built on the Field contract", async () => {
    const { root, input, host } = await render(<NumberField label="Servings" name="servings" defaultValue={4} />);
    expect(root.getAttribute("data-ouro")).toBe("number-field");
    expect(input.labels![0]!.textContent).toBe("Servings");
    expect(input.value).toBe("4");
    // The form value is a hidden number input with the name.
    const hidden = host.querySelector<HTMLInputElement>('input[name="servings"]')!;
    expect(hidden.type).toBe("number");
    expect(hidden.value).toBe("4");
    await expect.element(page.getByRole("textbox", { name: "Servings" })).toBeVisible();
    expect(warn).not.toHaveBeenCalled();
  });

  it("wires description, error, required and disabled through Field", async () => {
    const { host, input, rerender } = await render(
      <NumberField label="Servings" description="For how many people." error="Enter at least 1." required />,
    );
    expect(describedBy(input).map((id) => host.querySelector(`#${CSS.escape(id)}`)!.textContent)).toEqual([
      "For how many people.",
      "Enter at least 1.",
    ]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(host.querySelector("[data-ouro-required]")).not.toBeNull();
    await rerender(<NumberField label="Servings" disabled />);
    expect(input.disabled).toBe(true);
    for (const button of host.querySelectorAll("button")) expect(button.disabled).toBe(true);
  });

  it("steps with its buttons, within min and max", async () => {
    const onValueChange = vi.fn();
    const { input, button } = await render(<NumberField label="Servings" defaultValue={2} min={1} max={3} onValueChange={onValueChange} />);
    await userEvent.click(button("Increase"));
    expect(input.value).toBe("3");
    expect(onValueChange).toHaveBeenLastCalledWith(3);
    // At the limit the stepper is disabled.
    expect(button("Increase").disabled).toBe(true);
    await userEvent.click(button("Decrease"));
    await userEvent.click(button("Decrease"));
    expect(input.value).toBe("1");
    expect(onValueChange).toHaveBeenLastCalledWith(1);
    expect(button("Decrease").disabled).toBe(true);
  });

  it("steps by step with the arrow keys and parses typed text on blur", async () => {
    const onValueCommitted = vi.fn();
    const { input } = await render(<NumberField label="Weight" defaultValue={1} step={0.5} onValueCommitted={onValueCommitted} />);
    input.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(input.value).toBe("1.5");
    expect(onValueCommitted).toHaveBeenLastCalledWith(1.5);
    await userEvent.clear(input);
    await userEvent.type(input, "12");
    input.blur();
    await expect.poll(() => onValueCommitted.mock.lastCall?.[0]).toBe(12);
    await userEvent.clear(input);
    input.blur();
    await expect.poll(() => onValueCommitted.mock.lastCall?.[0]).toBe(null);
  });

  it("formats with Intl options and a locale", async () => {
    const { host } = await render(
      <>
        <NumberField label="Price" defaultValue={4.5} format={{ style: "currency", currency: "USD" }} locale="en-US" />
        <NumberField label="Preis" defaultValue={1234.5} format={{ minimumFractionDigits: 2 }} locale="de-DE" />
      </>,
    );
    const [price, preis] = [...host.querySelectorAll<HTMLInputElement>("input:not([aria-hidden])")];
    expect(price!.value).toBe("$4.50");
    expect(preis!.value).toBe("1.234,50");
  });

  it("follows a controlled value", async () => {
    function Controlled() {
      const [value, setValue] = useState<number | null>(3);
      return (
        <>
          <NumberField label="Servings" value={value} onValueChange={setValue} />
          <output>{String(value)}</output>
          <button type="button" onClick={() => setValue(8)}>
            Party
          </button>
        </>
      );
    }
    const { input, host, button } = await render(<Controlled />);
    await userEvent.click(button("Increase"));
    expect(host.querySelector("output")!.textContent).toBe("4");
    await userEvent.click(host.querySelector("button:not([data-ouro-increment], [data-ouro-decrement])")!);
    expect(input.value).toBe("8");
  });

  it("translates the stepper labels", async () => {
    const { host } = await render(<NumberField label="Portionen" decrementLabel="Weniger" incrementLabel="Mehr" />);
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Weniger", "Mehr"]);
  });

  it("passes placeholder and readOnly to the input", async () => {
    const { input, button } = await render(<NumberField label="Servings" placeholder="4" readOnly defaultValue={2} />);
    expect(input.placeholder).toBe("4");
    expect(input.readOnly).toBe(true);
    await act(async () => button("Increase").click());
    expect(input.value).toBe("2");
    input.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(input.value).toBe("2");
  });

  it("forwards its ref to the input", async () => {
    const ref = createRef<HTMLInputElement>();
    const { input } = await render(<NumberField label="Servings" ref={ref} />);
    expect(ref.current).toBe(input);
  });

  it("lets app layout classes win on the root", async () => {
    const { root } = await render(<NumberField label="Servings" className="mt-6" />);
    expect(getComputedStyle(root).marginTop).toBe("24px");
  });
});

describe("NumberField steppers", () => {
  it("leaves a loose label lookup for the field on the input, not on its steppers", async () => {
    const { host } = await render(<NumberField label="Servings" decrementLabel="Fewer servings" incrementLabel="More servings" />);
    const input = host.querySelector<HTMLInputElement>("input:not([aria-hidden])")!;
    expect(page.getByLabelText("Servings", { exact: false }).elements()).toEqual([input]);
    for (const name of ["Fewer servings", "More servings"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect.element(button).toBeVisible();
      expect(button.element().hasAttribute("aria-label")).toBe(false);
    }
  });
});

describe("NumberField phone keyboard", () => {
  // iOS's numeric keypads have no minus key, so a field that takes negatives gets the full
  // keyboard; a field that takes fractions gets the keypad with a decimal separator.
  it.each([
    ["integers from 1", { min: 1 }, "numeric"],
    ["integers from 0, formatted as a percent", { min: 0, format: { style: "percent" } as const }, "numeric"],
    ["half steps from 0", { min: 0, step: 0.5 }, "decimal"],
    ["a currency from 0", { min: 0, format: { style: "currency", currency: "USD" } as const }, "decimal"],
    ["two fraction digits from 0", { min: 0, format: { maximumFractionDigits: 2 } }, "decimal"],
    ["no minimum, so negatives", {}, "text"],
    ["a negative minimum", { min: -10, step: 0.5 }, "text"],
  ] as const)("asks for the right keyboard: %s", async (_name, props, mode) => {
    const { input } = await render(<NumberField label="Amount" {...props} />);
    expect(input.inputMode).toBe(mode);
  });
});

describe("NumberField input", () => {
  it("does not change with the mouse wheel, so scrolling the page is safe", async () => {
    const onValueChange = vi.fn();
    const { input } = await render(<NumberField label="Servings" defaultValue={4} onValueChange={onValueChange} />);
    input.focus();
    input.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
    input.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
    await act(async () => {});
    expect(input.value).toBe("4");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("reads typed text in its locale and submits a plain number", async () => {
    const { input, host } = await render(
      <form>
        <NumberField label="Gewicht" name="kg" locale="de-DE" defaultValue={1} step={0.5} min={0} />
      </form>,
    );
    await userEvent.clear(input);
    await userEvent.type(input, "2,5");
    await act(async () => input.blur());
    expect(input.value).toBe("2,5");
    expect(new FormData(host.querySelector("form")!).get("kg")).toBe("2.5");
  });
});

describe("NumberField scrub", () => {
  it("makes the label a scrub area with a mouse", async () => {
    const { host, root } = await render(<NumberField label="Servings" defaultValue={4} />);
    const scrub = root.querySelector<HTMLElement>("[data-ouro-number-field-scrub]")!;
    expect(scrub.contains(host.querySelector("label"))).toBe(true);
    expect(getComputedStyle(scrub).cursor).toBe("ew-resize");
  });

  it("focuses the input when the label is clicked", async () => {
    const { host, input } = await render(<NumberField label="Servings" defaultValue={4} />);
    await userEvent.click(host.querySelector("label")!);
    expect(document.activeElement).toBe(input);
  });

  it("changes the value when the label is dragged sideways", async () => {
    // Scrubbing reads movementX under pointer lock, which a real automated mouse reports
    // unreliably (the first move after the lock can jump by hundreds of pixels on CI). The
    // events carry the movement themselves, so the steps are exact.
    const onValueChange = vi.fn();
    const { host } = await render(<NumberField label="Servings" defaultValue={4} onValueChange={onValueChange} />);
    const scrub = host.querySelector<HTMLElement>("[data-ouro-number-field-scrub]")!;
    const pointer = (type: string, movementX = 0) =>
      new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "mouse", button: 0, movementX });
    await act(async () => scrub.dispatchEvent(pointer("pointerdown")));
    for (let step = 0; step < 3; step++) await act(async () => window.dispatchEvent(pointer("pointermove", 4)));
    await act(async () => window.dispatchEvent(pointer("pointerup")));
    expect(onValueChange.mock.lastCall?.[0]).toBeGreaterThan(4);
  });
});

describe("NumberField looks", () => {
  it("draws one bordered box around the steppers and the input", async () => {
    const { group, input } = await render(<NumberField label="Servings" />);
    const box = getComputedStyle(group);
    expect(box.borderTopStyle).toBe("solid");
    expect(getComputedStyle(input).borderTopWidth).toBe("0px");
  });

  it("uses a 16px font and a 44px box on narrow screens, stepping down with a mouse on wider screens", async () => {
    // The steppers' 44px touch hit area is checked in number-field.touch.test.tsx.
    await page.viewport(390, 844);
    const { input, group } = await render(<NumberField label="Servings" />);
    expect(parseFloat(getComputedStyle(input).fontSize)).toBeGreaterThanOrEqual(16);
    expect(group.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await page.viewport(1280, 800);
    await expect.poll(() => group.getBoundingClientRect().height).toBeLessThan(44);
    expect(getComputedStyle(input).fontSize).toBe("14px");
  });

  it("outlines the box when the input has keyboard focus", async () => {
    const { group, input } = await render(<NumberField label="Servings" />);
    expect(getComputedStyle(group).outlineStyle).toBe("none");
    input.focus();
    await expect.poll(() => getComputedStyle(group).outlineStyle).toBe("solid");
  });

  it("marks the box with the destructive border when invalid", async () => {
    const { host } = await render(
      <>
        <NumberField label="Valid" />
        <NumberField label="Invalid" error="Required." />
      </>,
    );
    const [valid, invalid] = [...host.querySelectorAll<HTMLElement>("[data-ouro-number-field-group]")];
    expect(getComputedStyle(invalid!).borderTopColor).not.toBe(getComputedStyle(valid!).borderTopColor);
  });
});

describe("NumberField development messages", () => {
  it.each([
    ["errorMessage", { errorMessage: "Required." }, "errorMessage is not a prop", '<NumberField error="Required.">'],
    ["helperText", { helperText: "Hint" }, "helperText is not a prop", '<NumberField description="Hint">'],
    ["isInvalid", { isInvalid: true }, "isInvalid is not a prop", '<NumberField error="What is wrong">'],
    ["invalid", { invalid: true }, "invalid is not a prop", '<NumberField error="What is wrong">'],
    ["isRequired", { isRequired: true }, "isRequired is not a prop", "<NumberField required>"],
    ["isDisabled", { isDisabled: true }, "isDisabled is not a prop", "<NumberField disabled>"],
    ["isReadOnly", { isReadOnly: true }, "isReadOnly is not a prop", "<NumberField readOnly>"],
    ["minValue", { minValue: 1 }, "minValue is not a prop", "<NumberField min={1}>"],
    ["maxValue", { maxValue: 9 }, "maxValue is not a prop", "<NumberField max={9}>"],
    ["onChange", { onChange: () => {} }, "onChange is not a prop", "<NumberField onValueChange={(value) => …}>"],
    ["formatOptions", { formatOptions: { style: "percent" } }, "formatOptions is not a prop", '<NumberField format={{ style: "percent" }}>'],
    ["precision", { precision: 2 }, "precision is not a prop", "<NumberField format={{ maximumFractionDigits: 2 }}>"],
    ["currency", { currency: "EUR" }, "currency is not a prop", '<NumberField format={{ style: "currency", currency: "EUR" }}>'],
    ["type", { type: "number" }, "type is not a prop; NumberField is always a number", '<NumberField label="Servings">'],
  ])("warns for %s with the fix", async (name, extra, problem, fix) => {
    const props = { label: "Servings", ...extra } as unknown as NumberFieldProps;
    const { host } = await render(<NumberField {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] NumberField: ${problem}. Fix: ${fix}.`);
    for (const element of host.querySelectorAll("*")) {
      if (name !== "type") expect(element.hasAttribute(name.toLowerCase())).toBe(false);
    }
  });

  it("names NumberField in Field's messages", async () => {
    const { rerender } = await render(<NumberField label="" className="bg-red-500" />);
    await rerender(<NumberField label="" className="bg-red-500" />);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '[ouro-ui] NumberField: "bg-red-500" sets appearance, and className is for layout only. Fix: <NumberField error="What is wrong">.',
      '[ouro-ui] NumberField: label is empty, so the control has no name. Fix: <NumberField label="Email" hideLabel> to hide a label you still need.',
    ]);
  });
});

describe("NumberField server rendering", () => {
  const node = (
    <div>
      <NumberField label="Servings" name="servings" description="For how many people." error="Enter at least 1." required defaultValue={4} />
      <NumberField label="Price" format={{ style: "currency", currency: "USD" }} locale="en-US" defaultValue={4.5} />
    </div>
  );

  it("renders the label, description and error ids on the server", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = new DOMParser().parseFromString(renderToString(node), "text/html");
    const [servings, price] = [...doc.querySelectorAll<HTMLInputElement>("input:not([aria-hidden])")];
    expect(doc.querySelector(`label[for="${servings!.id}"]`)!.textContent).toContain("Servings");
    expect(describedBy(servings!).map((id) => doc.getElementById(id)!.textContent)).toEqual(["For how many people.", "Enter at least 1."]);
    expect(servings!.getAttribute("aria-invalid")).toBe("true");
    expect(servings!.getAttribute("aria-required")).toBe("true");
    expect(servings!.getAttribute("value")).toBe("4");
    expect(price!.getAttribute("value")).toBe("$4.50");
    expect(error).not.toHaveBeenCalled();
  });

  it("hydrates with the same ids and no hydration warning", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    // Base UI's hidden form input (aria-hidden, out of the tab order) gains the field's
    // description ids on the client; what people perceive is the visible input.
    const snapshot = () =>
      [...host.querySelectorAll("label, input:not([aria-hidden]), [id]")].map((el) => [el.tagName, el.id, el.getAttribute("for"), el.getAttribute("aria-describedby")]);
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
    // Hydrated, the steppers work.
    await userEvent.click(host.querySelector<HTMLButtonElement>("button[data-ouro-increment]")!);
    expect(host.querySelector<HTMLInputElement>("input:not([aria-hidden])")!.value).toBe("5");
  });
});

describe("NumberField server error", () => {
  it.each([
    [["Too much.", ""], "true"],
    [["", ""], null],
  ] as const)("reads an error list %j as invalid: %s", async (error, expected) => {
    const view = await render(<NumberField label="Servings" error={[...error]} />);
    for (const control of [view.input]) expect(control.getAttribute("aria-invalid")).toBe(expected);
  });

  // The error is Ouro's own field state: the control gets aria-invalid from it, and Base UI
  // never counts it as a failed check, so the form can be sent again to the server.
  it("marks the control invalid and keeps the form submittable", async () => {
    let sent: FormData | null = null;
    const view = await render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          sent = new FormData(event.currentTarget);
        }}
      >
        <NumberField label="Servings" name="servings" error="Enter at least 1." defaultValue={0} />
      </form>,
    );
    const controls = [view.input];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.getAttribute("aria-invalid")).toBe("true");
    await act(async () => view.host.querySelector("form")!.requestSubmit());
    expect(sent).not.toBeNull();
    expect(sent!.get("servings")).toEqual("0");
  });
});

describe("NumberField in a Form", () => {
  it("shows the Form's error for its name and drops it once the user changes the value", async () => {
    const view = await render(
      <Form errors={{ servings: "Not that one." }}>
        <NumberField label="Servings" name="servings" defaultValue={2} />
      </Form>,
    );
    for (const control of [view.input]) expect(control.getAttribute("aria-invalid")).toBe("true");
    view.input.focus();
    await userEvent.keyboard("{ArrowUp}");
    for (const control of [view.input]) await expect.poll(() => control.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("NumberField stepper press feedback", () => {
  it("shows a pressed color that differs from the hover color", async () => {
    await render(<NumberField label="Servings" defaultValue={2} />);
    const stepper = page.getByRole("button", { name: "Increase", exact: true }).element();
    const color = () => getComputedStyle(stepper).backgroundColor;
    const rest = color();
    await userEvent.hover(stepper);
    await expect.poll(() => stepper.getAnimations().every((animation) => animation.playState !== "running")).toBe(true);
    await expect.poll(color).not.toBe(rest);
    const hovered = color();
    await commands.pointerPress({ selector: "[data-ouro-number-field-group] button:last-of-type", action: "down" });
    try {
      await expect.poll(() => stepper.getAnimations().every((animation) => animation.playState !== "running")).toBe(true);
      expect(stepper.matches(":active")).toBe(true);
      await expect.poll(color).not.toBe(hovered);
    } finally {
      await commands.pointerPress({ action: "up" });
    }
  });
});
