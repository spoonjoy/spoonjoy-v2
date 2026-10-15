import { useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Checkbox } from "~/components/ouro/checkbox/checkbox";
import { Radio, RadioGroup, type RadioGroupProps, type RadioProps } from "~/components/ouro/radio-group/radio-group";
import { Switch } from "~/components/ouro/switch/switch";
import { Form, type FormErrors } from "~/components/ouro/form/form";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

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
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="radio-group"]')!;
    },
    get group() {
      return host.querySelector<HTMLElement>('[role="radiogroup"]')!;
    },
    get radios() {
      return [...host.querySelectorAll<HTMLElement>('[role="radio"]')];
    },
  };
}

const describedBy = (element: Element) => (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
const texts = (doc: Document, element: Element) => describedBy(element).map((id) => doc.getElementById(id)?.textContent);

/** A theme variable as the browser computes it, so the test holds under any shadcn theme. */
function themeColor(variable: string): string {
  const probe = document.createElement("div");
  probe.style.color = `var(${variable})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** A color as canvas pixels, so `oklch(...)` and the same color serialized as `oklab(...)` compare equal. */
function pixel(color: string): string {
  const context = document.createElement("canvas").getContext("2d")!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return context.getImageData(0, 0, 1, 1).data.join(",");
}

const sizes = [
  { value: "small", label: "Small", description: "Serves 2." },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large", disabled: true },
  { value: "family", label: "Family" },
];

/** A Form whose errors arrive when "Fail" is clicked, as a server action's result does. */
function Arriving({ errors, children }: { errors: FormErrors; children: ReactNode }) {
  const [shown, setShown] = useState<FormErrors | undefined>();
  return (
    <Form errors={shown}>
      <button type="button" onClick={() => setShown(errors)}>
        Fail
      </button>
      {children}
    </Form>
  );
}
const fail = () => userEvent.click(page.getByRole("button", { name: "Fail" }));

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

describe("RadioGroup", () => {
  it("is a radio group named by its legend and described by its description and error", async () => {
    const { root, group } = await render(<RadioGroup legend="Size" description="Pick one." error="Choose a size." options={sizes} />);
    expect(root).not.toBeNull();
    await expect.element(page.getByRole("radiogroup", { name: "Size" })).toHaveAccessibleDescription("Pick one. Choose a size.");
    expect(texts(document, group)).toEqual(["Pick one.", "Choose a size."]);
  });

  it("renders a radio for each option, each named by its label and described by its description", async () => {
    const { radios } = await render(<RadioGroup legend="Size" options={sizes} />);
    expect(radios).toHaveLength(4);
    await expect.element(page.getByRole("radio", { name: "Small" })).toHaveAccessibleDescription("Serves 2.");
    await expect.element(page.getByRole("radio", { name: "Large" })).toBeDisabled();
  });

  it("moves focus and the choice with the arrow keys, skipping disabled radios, as one tab stop", async () => {
    const onValueChange = vi.fn();
    const { host, radios } = await render(
      <>
        <button type="button">Before</button>
        <RadioGroup legend="Size" options={sizes} defaultValue="medium" onValueChange={onValueChange} />
        <button type="button">After</button>
      </>,
    );
    host.querySelector("button")!.focus();
    await pressTab();
    // Tab lands on the chosen radio.
    expect(document.activeElement).toBe(radios[1]);
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(radios[3]);
    expect(onValueChange).toHaveBeenLastCalledWith("family");
    expect(radios[3]!.getAttribute("aria-checked")).toBe("true");
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(radios[1]);
    expect(onValueChange).toHaveBeenLastCalledWith("medium");
    await pressTab();
    expect(document.activeElement!.textContent).toBe("After");
    await pressTab({ shift: true });
    expect(document.activeElement).toBe(radios[1]);
  });

  it("picks with a click on a radio or its label, and with Space", async () => {
    const onValueChange = vi.fn();
    const { radios } = await render(<RadioGroup legend="Size" options={sizes} onValueChange={onValueChange} />);
    await userEvent.click(page.getByText("Medium"));
    expect(onValueChange).toHaveBeenLastCalledWith("medium");
    await userEvent.click(radios[0]!);
    expect(onValueChange).toHaveBeenLastCalledWith("small");
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false"]);
  });

  it("follows a controlled value", async () => {
    function Controlled() {
      const [value, setValue] = useState("small");
      return (
        <>
          <RadioGroup legend="Size" options={sizes} value={value} onValueChange={setValue} />
          <output>{value}</output>
        </>
      );
    }
    const { host, radios } = await render(<Controlled />);
    await userEvent.click(radios[3]!);
    expect(host.querySelector("output")!.textContent).toBe("family");
  });

  it("submits name=value for the chosen radio", async () => {
    const { host, radios } = await render(
      <form>
        <RadioGroup legend="Size" name="size" options={sizes} defaultValue="small" />
      </form>,
    );
    const form = host.querySelector("form")!;
    expect([...new FormData(form)]).toEqual([["size", "small"]]);
    await userEvent.click(radios[1]!);
    expect([...new FormData(form)]).toEqual([["size", "medium"]]);
  });

  it("takes Radio children in place of options", async () => {
    const { host, radios } = await render(
      <form>
        <RadioGroup legend="Size" name="size" defaultValue="m">
          <Radio value="s" label="Small" description="Serves 2." />
          <Radio value="m" label="Medium" />
        </RadioGroup>
      </form>,
    );
    expect([...new FormData(host.querySelector("form")!)]).toEqual([["size", "m"]]);
    await userEvent.click(radios[0]!);
    expect([...new FormData(host.querySelector("form")!)]).toEqual([["size", "s"]]);
    await expect.element(page.getByRole("radio", { name: "Small" })).toHaveAccessibleDescription("Serves 2.");
    expect(host.querySelectorAll('[data-ouro="radio"]')).toHaveLength(2);
  });

  it("required marks the legend and the group, and blocks submit until a choice", async () => {
    const { host, root, group, radios } = await render(
      <form>
        <RadioGroup legend="Size" name="size" options={sizes} required />
      </form>,
    );
    const legend = root.querySelector<HTMLElement>("[data-ouro-legend][data-ouro-required]")!;
    expect(getComputedStyle(legend, "::after").content).toBe('"*" / ""');
    expect(legend.querySelector("[aria-hidden]")).toBeNull();
    expect(group.getAttribute("aria-required")).toBe("true");
    const form = host.querySelector("form")!;
    expect(form.checkValidity()).toBe(false);
    await userEvent.click(radios[0]!);
    expect(form.checkValidity()).toBe(true);
  });

  it("shows the browser's message once, under the group and not under each radio, after a blocked submit", async () => {
    const { host } = await render(
      <Form>
        <RadioGroup legend="Size" name="size" options={sizes} required />
      </Form>,
    );
    const message = host.querySelector<HTMLInputElement>("input:invalid")!.validationMessage;
    expect(message).not.toBe("");
    const shown = () => [...host.querySelectorAll("*")].filter((node) => node.children.length === 0 && node.textContent === message);
    host.querySelector("form")!.requestSubmit();
    await expect.poll(() => shown().length).toBeGreaterThan(0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(shown()).toHaveLength(1);
    expect(shown()[0]!.closest('[data-ouro="radio"]')).toBeNull();
  });

  it("shows a Form error for its name without blocking the form, and drops it once a radio is picked", async () => {
    const { host, radios } = await render(
      <Form errors={{ size: "That size is sold out." }}>
        <RadioGroup legend="Size" name="size" options={sizes} />
      </Form>,
    );
    const group = host.querySelector<HTMLElement>('[role="radiogroup"]')!;
    expect(radios[0]!.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(group).map((id) => document.getElementById(id)?.textContent)).toEqual(["That size is sold out."]);
    expect(host.querySelector("form")!.checkValidity()).toBe(true);
    await userEvent.click(radios[1]!);
    await expect.poll(() => radios[0]!.getAttribute("aria-invalid")).toBeNull();
    expect(describedBy(group)).toEqual([]);
  });

  it("focuses its first radio when its Form error arrives and none is picked", async () => {
    const { radios } = await render(
      <Arriving errors={{ size: "That size is sold out." }}>
        <RadioGroup legend="Size" name="size" options={sizes} />
      </Arriving>,
    );
    await fail();
    await expect.poll(() => document.activeElement).toBe(radios[0]);
  });

  it("skips a disabled first radio when its Form error arrives", async () => {
    const { radios } = await render(
      <Arriving errors={{ size: "That size is sold out." }}>
        <RadioGroup legend="Size" name="size" options={[{ value: "party", label: "Party", disabled: true }, ...sizes]} />
      </Arriving>,
    );
    await fail();
    expect(radios[0]!.getAttribute("aria-invalid")).toBe("true");
    await expect.poll(() => document.activeElement).toBe(radios[1]);
  });

  it("focuses the picked radio, not the first, when its Form error arrives", async () => {
    const { radios } = await render(
      <Arriving errors={{ size: "That size is sold out." }}>
        <RadioGroup legend="Size" name="size" defaultValue="family" options={sizes} />
      </Arriving>,
    );
    await fail();
    await expect.poll(() => document.activeElement).toBe(radios[3]);
  });

  it("focuses the first enabled radio when the picked one is disabled", async () => {
    const { radios } = await render(
      <Arriving errors={{ size: "That size is sold out." }}>
        <RadioGroup legend="Size" name="size" defaultValue="large" options={sizes} />
      </Arriving>,
    );
    await fail();
    await expect.poll(() => document.activeElement).toBe(radios[0]);
  });

  it("keeps an invalid radio's border red while hovered", async () => {
    const { radios } = await render(<RadioGroup legend="Size" options={sizes} error="Choose a size." />);
    await userEvent.hover(radios[0]!);
    await expect.poll(() => pixel(getComputedStyle(radios[0]!).borderTopColor)).toBe(pixel(themeColor("--destructive")));
  });

  it("disables every radio with disabled, and marks them invalid with error", async () => {
    const { radios } = await render(<RadioGroup legend="Size" options={sizes} disabled error="Choose a size." />);
    for (const radio of radios) {
      expect(radio.hasAttribute("data-disabled")).toBe(true);
      expect(radio.getAttribute("aria-invalid")).toBe("true");
    }
  });

  it("stacks the choices by default and puts them in a row with orientation horizontal", async () => {
    const { radios } = await render(
      <>
        <RadioGroup legend="Size" options={sizes.slice(0, 2)} />
        <RadioGroup legend="Crust" orientation="horizontal" options={[{ value: "thin", label: "Thin" }, { value: "deep", label: "Deep" }]} />
      </>,
    );
    const [small, medium, thin, deep] = radios.map((radio) => radio.getBoundingClientRect());
    expect(medium!.left).toBe(small!.left);
    expect(medium!.top).toBeGreaterThan(small!.bottom);
    expect(deep!.top).toBe(thin!.top);
    expect(deep!.left).toBeGreaterThan(thin!.right);
  });

  it("fills the chosen radio with the primary color and shows its dot", async () => {
    const { radios, host } = await render(<RadioGroup legend="Size" options={sizes} defaultValue="small" />);
    expect(getComputedStyle(radios[0]!).backgroundColor).toBe(themeColor("--primary"));
    const dot = host.querySelector<HTMLElement>("[data-ouro-radio-dot]")!;
    expect(dot.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it("grows the dot in from 95% as it fades in, never from nothing, and only fades with reduced motion", async () => {
    const { radios, host } = await render(<RadioGroup legend="Size" options={sizes} defaultValue="small" />);
    const dot = (radio: HTMLElement) => radio.querySelector<HTMLElement>("[data-ouro-radio-dot]")!;
    const resting = getComputedStyle(dot(radios[1]!));
    expect(resting.opacity).toBe("0");
    expect(Number.parseFloat(resting.scale)).toBeCloseTo(0.95, 2);
    expect(resting.transitionProperty).toBe("scale, opacity");
    expect(resting.transitionDuration).toBe("0.15s, 0.15s");
    expect(resting.transitionTimingFunction).toBe("cubic-bezier(0.23, 1, 0.32, 1), cubic-bezier(0.23, 1, 0.32, 1)");
    await userEvent.click(radios[1]!);
    await expect.poll(() => getComputedStyle(dot(radios[1]!)).opacity).toBe("1");
    await expect.poll(() => Number.parseFloat(getComputedStyle(dot(radios[1]!)).scale) || 1).toBeCloseTo(1, 3);
    await commands.emulateMedia({ reducedMotion: "reduce" });
    expect(getComputedStyle(dot(radios[0]!)).transitionProperty).toBe("opacity");
    expect(Number.parseFloat(getComputedStyle(dot(radios[1]!)).scale) || 1).toBeCloseTo(1, 3);
    expect(host.querySelectorAll("[data-ouro-radio-dot]").length).toBe(radios.length);
  });

  it("fills the chosen radio with the primary color in dark mode too", async () => {
    document.documentElement.classList.add("dark");
    try {
      const { radios } = await render(<RadioGroup legend="Size" options={sizes} defaultValue="small" />);
      expect(getComputedStyle(radios[0]!).backgroundColor).toBe(themeColor("--primary"));
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });

  it("presses in while the pointer is down, but not with reduced motion", async () => {
    const { radios } = await render(<RadioGroup legend="Size" options={sizes} />);
    await commands.pointerPress({ selector: '[data-ouro="radio"]:first-child [role="radio"]', action: "down" });
    expect(getComputedStyle(radios[0]!).scale).not.toBe("none");
    await commands.pointerPress({ selector: '[data-ouro="radio"]:first-child [role="radio"]', action: "up" });
    // Let the release finish easing back before checking that a reduced-motion press does not scale.
    await expect.poll(() => getComputedStyle(radios[0]!).scale).toBe("none");
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await commands.pointerPress({ selector: '[data-ouro="radio"]:first-child [role="radio"]', action: "down" });
    expect(getComputedStyle(radios[0]!).scale).toBe("none");
    await commands.pointerPress({ selector: '[data-ouro="radio"]:first-child [role="radio"]', action: "up" });
  });
});

describe("RadioGroup development messages", () => {
  const messages = () => warn.mock.calls.map((call: unknown[]) => String(call[0]));

  it("throws with the fix when given both options and children", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const props = { legend: "Size", options: sizes, children: <Radio value="xl" label="XL" /> } as unknown as RadioGroupProps;
    await expect(render(<RadioGroup {...props} />)).rejects.toThrow(
      '[ouro-ui] RadioGroup: takes options or Radio children, not both. Fix: <RadioGroup legend="Size" options={options} />, or <RadioGroup legend="Size"><Radio value="small" label="Small" /></RadioGroup>.',
    );
    error.mockRestore();
  });

  it("throws with the fix for a Radio outside a RadioGroup", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(render(<Radio value="small" label="Small" />)).rejects.toThrow(
      '[ouro-ui] Radio: must be rendered inside <RadioGroup>. Fix: <RadioGroup legend="Size"><Radio value="small" label="Small" /></RadioGroup>.',
    );
    error.mockRestore();
  });

  it("throws with the fix for a Checkbox in a RadioGroup", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      render(
        <RadioGroup legend="Size">
          <Checkbox value="small" label="Small" />
        </RadioGroup>,
      ),
    ).rejects.toThrow(
      '[ouro-ui] Checkbox: a RadioGroup takes Radio choices. Fix: <RadioGroup legend="Size"><Radio value="small" label="Small" /></RadioGroup>, or a CheckboxGroup for several choices.',
    );
    error.mockRestore();
  });

  it("names the real prop for guessed ones", async () => {
    const props = { legend: "Size", options: sizes, label: "Size", onChange: () => {}, items: sizes, helperText: "Pick one.", isDisabled: true } as unknown as RadioGroupProps;
    await render(<RadioGroup {...props} />);
    expect(messages()).toEqual([
      '[ouro-ui] RadioGroup: helperText is not a prop. Fix: <RadioGroup description="Pick one.">.',
      "[ouro-ui] RadioGroup: isDisabled is not a prop. Fix: <RadioGroup disabled>.",
      '[ouro-ui] RadioGroup: label is not a prop; a group is named by its legend. Fix: <RadioGroup legend="Size">.',
      "[ouro-ui] RadioGroup: onChange is not a prop; onValueChange gets the chosen value. Fix: <RadioGroup onValueChange={(value) => setValue(value)}>.",
      '[ouro-ui] RadioGroup: items is not a prop. Fix: <RadioGroup options={[{ value: "small", label: "Small" }]}>.',
    ]);
  });

  it("names the real prop for a Radio's guessed ones", async () => {
    const guesses = { checked: true, name: "size" } as unknown as Partial<RadioProps>;
    await render(
      <RadioGroup legend="Size">
        <Radio value="small" label="Small" {...guesses} />
      </RadioGroup>,
    );
    expect(messages()).toEqual([
      '[ouro-ui] Radio: name belongs on the RadioGroup. Fix: <RadioGroup name="size">.',
      "[ouro-ui] Radio: checked is not a prop; the group's value picks the radio. Fix: <RadioGroup value=\"small\">.",
    ]);
  });

  it("warns when value has no onValueChange", async () => {
    await render(<RadioGroup legend="Size" options={sizes} value="small" />);
    expect(messages()).toEqual([
      "[ouro-ui] RadioGroup: value without onValueChange never changes. Fix: <RadioGroup value={value} onValueChange={setValue}>, or defaultValue.",
    ]);
  });

  it("throws with the fix for a Switch inside the group", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      render(
        <RadioGroup legend="Size">
          <Switch label="Small" />
        </RadioGroup>,
      ),
    ).rejects.toThrow('[ouro-ui] Switch: a RadioGroup takes Radio choices. Fix: <Radio value="small" label="Small" />, or put the Switch outside the group.');
    error.mockRestore();
  });

  it("does not add required words to its legend; the radiogroup carries aria-required", async () => {
    await render(<RadioGroup legend="Size" options={sizes} required />);
    await expect.element(page.getByRole("radiogroup", { name: "Size" })).toBeInTheDocument();
  });

  it("names RadioGroup and the legend for an empty legend", async () => {
    const { root } = await render(<RadioGroup legend="" options={sizes} />);
    expect(root.getAttribute("data-ouro")).toBe("radio-group");
    expect(messages()).toEqual([
      '[ouro-ui] RadioGroup: legend is empty, so the group has no name. Fix: <RadioGroup legend="Toppings" hideLegend> to hide a legend you still need.',
    ]);
  });

  it("names the legend when it is missing", async () => {
    await render(<RadioGroup {...({ options: sizes } as unknown as RadioGroupProps)} />);
    expect(messages()).toEqual([
      '[ouro-ui] RadioGroup: legend is missing, so the group has no name. Fix: <RadioGroup legend="Toppings" hideLegend> to hide a legend you still need.',
    ]);
  });

  it("has no messages for valid props", async () => {
    await render(
      <RadioGroup legend="Size" hideLegend name="size" description="One." error="Pick." required disabled defaultValue="small" orientation="horizontal" options={sizes} className="mt-4" />,
    );
    expect(messages()).toEqual([]);
  });
});

describe("RadioGroup on the server", () => {
  const node = (
    <form>
      <RadioGroup legend="Size" name="size" description="Pick one." error="Choose a size." options={sizes} defaultValue="medium" required />
    </form>
  );

  it("names and describes the group and each radio in the server HTML", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = new DOMParser().parseFromString(renderToString(node), "text/html");
    const group = doc.querySelector('[role="radiogroup"]')!;
    expect(doc.getElementById(group.getAttribute("aria-labelledby")!)!.textContent).toContain("Size");
    expect(texts(doc, group)).toEqual(["Pick one.", "Choose a size."]);
    const radios = [...doc.querySelectorAll('[role="radio"]')];
    expect(radios.map((radio) => doc.getElementById(radio.getAttribute("aria-labelledby")!)!.textContent)).toEqual(["Small", "Medium", "Large", "Family"]);
    expect(texts(doc, radios[0]!)).toEqual(["Serves 2.", "Pick one.", "Choose a size."]);
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false"]);
    expect(radios.map((radio) => radio.getAttribute("aria-invalid"))).toEqual(["true", "true", "true", "true"]);
    for (const input of doc.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      expect(doc.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    }
    expect(error).not.toHaveBeenCalled();
  });

  it("hydrates with the same ids and no hydration warning", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    const snapshot = () =>
      [...host.querySelectorAll("*")].map((el) => [
        el.tagName,
        el.id,
        el.getAttribute("for"),
        el.getAttribute("aria-labelledby"),
        el.getAttribute("aria-hidden") === "true" ? null : el.getAttribute("aria-describedby"),
      ]);
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
    await userEvent.click(host.querySelector<HTMLElement>('[role="radio"]')!);
    expect([...new FormData(host.querySelector("form")!)]).toEqual([["size", "small"]]);
  });
});
