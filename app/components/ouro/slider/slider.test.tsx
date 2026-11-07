import { createRef, useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Slider, type SliderProps } from "~/components/ouro/slider/slider";
import { Form } from "~/components/ouro/form/form";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  host.style.width = "360px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="slider"]')!;
    },
    get inputs() {
      return [...host.querySelectorAll<HTMLInputElement>('input[type="range"]')];
    },
    get thumbs() {
      return [...host.querySelectorAll<HTMLElement>("[data-ouro-slider-thumb]")];
    },
    get output() {
      return host.querySelector<HTMLElement>("[data-ouro-slider-value]");
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

describe("Slider", () => {
  it("is a labeled range input built on the Field contract", async () => {
    const { root, inputs } = await render(<Slider label="Servings" name="servings" defaultValue={4} min={1} max={12} />);
    expect(root.getAttribute("data-ouro")).toBe("slider");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.labels![0]!.textContent).toBe("Servings");
    expect(inputs[0]!.value).toBe("4");
    expect(inputs[0]!.min).toBe("1");
    expect(inputs[0]!.max).toBe("12");
    expect(inputs[0]!.name).toBe("servings");
    await expect.element(page.getByRole("slider", { name: "Servings" })).toBeVisible();
    expect(warn).not.toHaveBeenCalled();
  });

  it("wires description, error and disabled through Field", async () => {
    const { host, inputs, root, rerender } = await render(
      <Slider label="Heat" description="How spicy." error="Too hot." defaultValue={50} />,
    );
    expect(describedBy(inputs[0]!).map((id) => host.querySelector(`#${CSS.escape(id)}`)!.textContent)).toEqual(["How spicy.", "Too hot."]);
    expect(inputs[0]!.getAttribute("aria-invalid")).toBe("true");
    await rerender(<Slider label="Heat" disabled defaultValue={50} />);
    expect(inputs[0]!.disabled).toBe(true);
    expect(root.querySelector("[data-ouro-slider-control]")!.hasAttribute("data-disabled")).toBe(true);
  });

  it("steps with the keyboard and reports the value", async () => {
    const onValueChange = vi.fn();
    const onValueCommitted = vi.fn();
    const { inputs } = await render(
      <Slider label="Servings" defaultValue={4} step={2} onValueChange={onValueChange} onValueCommitted={onValueCommitted} />,
    );
    inputs[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(inputs[0]!.value).toBe("6");
    expect(onValueChange).toHaveBeenLastCalledWith(6);
    expect(onValueCommitted).toHaveBeenLastCalledWith(6);
  });

  it("takes large steps with Page Up, Page Down and Shift with an arrow", async () => {
    const { inputs } = await render(<Slider label="Oven" defaultValue={180} min={100} max={250} step={5} largeStep={25} />);
    inputs[0]!.focus();
    await userEvent.keyboard("{PageUp}");
    expect(inputs[0]!.value).toBe("205");
    await userEvent.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(inputs[0]!.value).toBe("230");
    await userEvent.keyboard("{PageDown}");
    expect(inputs[0]!.value).toBe("205");
  });

  it("follows a controlled value", async () => {
    function Controlled() {
      const [value, setValue] = useState(30);
      return (
        <>
          <Slider label="Volume" value={value} onValueChange={setValue} showValue />
          <button type="button" onClick={() => setValue(70)}>
            Louder
          </button>
        </>
      );
    }
    const { inputs, output, host } = await render(<Controlled />);
    expect(output!.textContent).toBe("30");
    await userEvent.click(host.querySelector("button")!);
    expect(inputs[0]!.value).toBe("70");
    expect(output!.textContent).toBe("70");
  });

  it("gives a value array a thumb per value, each named", async () => {
    const onValueChange = vi.fn();
    const { inputs, thumbs, host } = await render(
      <Slider label="Price" name="price" defaultValue={[20, 80]} onValueChange={onValueChange} showValue />,
    );
    expect(inputs).toHaveLength(2);
    expect(thumbs).toHaveLength(2);
    expect(inputs.map((input) => input.getAttribute("aria-label"))).toEqual(["Minimum, Price", "Maximum, Price"]);
    expect(inputs.map((input) => input.value)).toEqual(["20", "80"]);
    // The visible label names the group; each thumb has its own name.
    const label = host.querySelector("label")!;
    expect(label.hasAttribute("for")).toBe(false);
    expect(host.querySelector('[role="group"]')!.getAttribute("aria-labelledby")).toBe(label.id);
    await expect.element(page.getByRole("group", { name: "Price" })).toBeVisible();
    inputs[1]!.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onValueChange).toHaveBeenLastCalledWith([20, 79]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("translates the thumb names", async () => {
    const { inputs } = await render(<Slider label="Preis" defaultValue={[1, 2]} thumbLabels={["Von", "Bis"]} />);
    expect(inputs.map((input) => input.getAttribute("aria-label"))).toEqual(["Von, Preis", "Bis, Preis"]);
  });

  it("shows the formatted value with showValue, and a range with an en dash", async () => {
    const { host } = await render(
      <>
        <Slider label="Tip" defaultValue={0.15} min={0} max={0.3} step={0.01} format={{ style: "percent" }} showValue locale="en-US" />
        <Slider label="Budget" defaultValue={[10, 40]} max={100} format={{ style: "currency", currency: "USD", maximumFractionDigits: 0 }} showValue locale="en-US" />
        <Slider label="Plain" defaultValue={5} />
      </>,
    );
    const outputs = [...host.querySelectorAll("[data-ouro-slider-value]")];
    expect(outputs.map((output) => output.textContent)).toEqual(["15%", "$10 – $40"]);
    const tip = host.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(tip.getAttribute("aria-valuetext")).toBe("15%");
  });

  it("keeps the track the same length as the shown value changes, by reserving the widest value", async () => {
    function Price({ value }: { value: number }) {
      return <Slider label="Price" value={value} min={0} max={1000} showValue format={{ style: "currency", currency: "USD" }} />;
    }
    const { host, rerender } = await render(<Price value={0} />);
    const track = () => host.querySelector<HTMLElement>("[data-ouro-slider-control]")!.getBoundingClientRect().width;
    const atMin = track();
    expect(host.querySelector("[data-ouro-slider-value]")!.textContent).toContain("$0.00");
    await rerender(<Price value={1000} />);
    expect(host.querySelector("[data-ouro-slider-value]")!.textContent).toContain("$1,000.00");
    expect(track()).toBe(atMin);
  });

  it("keeps the track the same length for values with the step's decimals", async () => {
    function Level({ value }: { value: number }) {
      return <Slider label="Level" value={value} min={0} max={100} step={0.1} showValue />;
    }
    const { host, rerender } = await render(<Level value={0} />);
    const track = () => host.querySelector<HTMLElement>("[data-ouro-slider-control]")!.getBoundingClientRect().width;
    const shown = () => host.querySelector("[data-ouro-slider-value]")!.textContent;
    const atMin = track();
    await rerender(<Level value={33.3} />);
    expect(shown()).toBe("33.3");
    expect(track()).toBe(atMin);
    await rerender(<Level value={100} />);
    expect(shown()).toBe("100");
    expect(track()).toBe(atMin);
  });

  it("keeps the track the same length with compact notation", async () => {
    function Views({ value }: { value: number }) {
      return <Slider label="Views" value={value} min={0} max={5000} step={10} showValue format={{ notation: "compact" }} />;
    }
    const { host, rerender } = await render(<Views value={0} />);
    const track = () => host.querySelector<HTMLElement>("[data-ouro-slider-control]")!.getBoundingClientRect().width;
    const shown = () => host.querySelector("[data-ouro-slider-value]")!.textContent;
    const atMin = track();
    for (const [value, text] of [[100, "100"], [1100, "1.1K"], [5000, "5K"]] as const) {
      await rerender(<Views value={value} />);
      expect(shown()).toBe(text);
      expect(track()).toBe(atMin);
    }
  });

  it("forwards its ref to the first thumb's input", async () => {
    const ref = createRef<HTMLInputElement>();
    const { inputs } = await render(<Slider label="Volume" ref={ref} />);
    expect(ref.current).toBe(inputs[0]);
  });

  it("lets app layout classes win on the root", async () => {
    const { root } = await render(<Slider label="Volume" className="mt-6" />);
    expect(getComputedStyle(root).marginTop).toBe("24px");
  });

  it("moves the thumb when the track is pressed", async () => {
    const onValueChange = vi.fn();
    const { host } = await render(<Slider label="Volume" defaultValue={0} onValueChange={onValueChange} />);
    const control = host.querySelector<HTMLElement>("[data-ouro-slider-control]")!;
    await userEvent.click(control, { position: { x: control.offsetWidth - 2, y: control.offsetHeight / 2 } });
    expect(onValueChange.mock.lastCall![0]).toBeGreaterThan(90);
  });
});

describe("Slider looks", () => {
  it("gives the thumb a 44px hit area only on a coarse pointer", async () => {
    const { thumbs } = await render(<Slider label="Volume" />);
    const target = thumbs[0]!.querySelector<HTMLElement>("[data-ouro-touch-target]")!;
    expect(getComputedStyle(target).display).toBe("none");
  });

  it("outlines the thumb while its input has keyboard focus", async () => {
    const { thumbs, inputs } = await render(<Slider label="Volume" />);
    expect(getComputedStyle(thumbs[0]!).outlineStyle).toBe("none");
    inputs[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => getComputedStyle(thumbs[0]!).outlineStyle).toBe("solid");
  });

  it("marks the track with the destructive color when invalid", async () => {
    const { host } = await render(
      <>
        <Slider label="Valid" defaultValue={50} />
        <Slider label="Invalid" defaultValue={50} error="Too much." />
      </>,
    );
    const [valid, invalid] = [...host.querySelectorAll<HTMLElement>("[data-ouro-slider-indicator]")];
    expect(getComputedStyle(invalid!).backgroundColor).not.toBe(getComputedStyle(valid!).backgroundColor);
  });
});

describe("Slider development messages", () => {
  it.each([
    ["errorMessage", { errorMessage: "Required." }, "errorMessage is not a prop", '<Slider error="Required.">'],
    ["helperText", { helperText: "Hint" }, "helperText is not a prop", '<Slider description="Hint">'],
    ["isInvalid", { isInvalid: true }, "isInvalid is not a prop", '<Slider error="What is wrong">'],
    ["invalid", { invalid: true }, "invalid is not a prop", '<Slider error="What is wrong">'],
    ["isDisabled", { isDisabled: true }, "isDisabled is not a prop", "<Slider disabled>"],
    ["isRequired", { isRequired: true }, "isRequired is not a prop; a slider always has a value", "<Slider defaultValue={50}>"],
    ["required", { required: true }, "required is not a prop; a slider always has a value", "<Slider defaultValue={50}>"],
    ["range", { range: true }, "range is not a prop; a value array gives a thumb per value", "<Slider defaultValue={[20, 80]}>"],
    ["minValue", { minValue: 1 }, "minValue is not a prop", "<Slider min={1}>"],
    ["maxValue", { maxValue: 9 }, "maxValue is not a prop", "<Slider max={9}>"],
    ["onChange", { onChange: () => {} }, "onChange is not a prop", "<Slider onValueChange={(value) => …}>"],
    ["valueLabelDisplay", { valueLabelDisplay: "on" }, "valueLabelDisplay is not a prop", "<Slider showValue>"],
    ["showTooltip", { showTooltip: true }, "showTooltip is not a prop", "<Slider showValue>"],
  ])("warns for %s with the fix", async (name, extra, problem, fix) => {
    const props = { label: "Volume", ...extra } as unknown as SliderProps;
    const { host } = await render(<Slider {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Slider: ${problem}. Fix: ${fix}.`);
    for (const element of host.querySelectorAll("*")) expect(element.hasAttribute(name.toLowerCase())).toBe(false);
  });

  it("warns when a range has the wrong number of thumb names", async () => {
    await render(<Slider label="Price" defaultValue={[1, 2, 3]} thumbLabels={["Low", "High"]} />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Slider: thumbLabels has 2 names for 3 thumbs. Fix: <Slider thumbLabels={["Minimum", "Middle", "Maximum"]}>.',
    );
  });

  it("names Slider in Field's messages", async () => {
    const { rerender } = await render(<Slider label="" className="bg-red-500" />);
    await rerender(<Slider label="" className="bg-red-500" />);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '[ouro-ui] Slider: "bg-red-500" sets appearance, and className is for layout only. Fix: <Slider error="What is wrong">.',
      '[ouro-ui] Slider: label is empty, so the control has no name. Fix: <Slider label="Email" hideLabel> to hide a label you still need.',
    ]);
  });
});

describe("Slider server rendering", () => {
  const node = (
    <div>
      <Slider label="Heat" name="heat" description="How spicy." error="Too hot." defaultValue={50} showValue />
      <Slider label="Price" name="price" defaultValue={[20, 80]} description="Per jar." />
    </div>
  );

  it("renders the label, description and error ids on the server", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = new DOMParser().parseFromString(renderToString(node), "text/html");
    const [heat, low, high] = [...doc.querySelectorAll('input[type="range"]')];
    expect(doc.querySelector(`label[for="${heat!.id}"]`)!.textContent).toBe("Heat");
    expect(describedBy(heat!).map((id) => doc.getElementById(id)!.textContent)).toEqual(["How spicy.", "Too hot."]);
    // The thumb's input takes aria-invalid at hydration (Base UI builds it); the styles come from the root.
    expect(heat!.closest("[data-ouro-invalid]")).not.toBeNull();
    for (const thumb of [low!, high!]) expect(describedBy(thumb).map((id) => doc.getElementById(id)!.textContent)).toEqual(["Per jar."]);
    expect(doc.querySelector("[data-ouro-slider-value]")!.textContent).toBe("50");
    expect(error).not.toHaveBeenCalled();
  });

  it("hydrates with the same ids and no hydration warning", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    const snapshot = () =>
      [...host.querySelectorAll("label, input, [id]")].map((el) => [el.tagName, el.id, el.getAttribute("for"), el.getAttribute("aria-describedby")]);
    const before = snapshot();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(snapshot()).toEqual(before);
    expect(host.querySelector('input[type="range"]')!.getAttribute("aria-invalid")).toBe("true");
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("reserves the value's width only after hydration when no locale is given, so a reader in another locale hydrates the server's HTML as it is", async () => {
    // The widest value is measured in the reader's locale ("$60" on a server in en-US, "60 $" in de-DE), which a server cannot know.
    const priced = <Slider label="Price" name="price" defaultValue={[10, 40]} min={0} max={60} showValue format={{ style: "currency", currency: "USD" }} />;
    const host = document.createElement("div");
    host.innerHTML = renderToString(priced);
    document.body.append(host);
    mounted.push(host);
    expect(host.querySelectorAll("[data-ouro-slider-sample]")).toHaveLength(0);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, priced, { onRecoverableError: recoverable });
    });
    roots.push(root);
    await expect.poll(() => host.querySelectorAll("[data-ouro-slider-sample]").length).toBeGreaterThan(0);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    // With the locale given, the server measures it as the reader will.
    const fixed = new DOMParser().parseFromString(renderToString(<Slider label="Kochzeit" name="kochzeit" defaultValue={20} max={90} showValue locale="de-DE" />), "text/html");
    expect(fixed.querySelectorAll("[data-ouro-slider-sample]").length).toBeGreaterThan(0);
  });
});

describe("Slider across locales", () => {
  // A server in one locale and a reader in another. Each formats with its own runtime default, as
  // `Intl.NumberFormat` without a locale does; Base UI keeps one formatter per locale and options,
  // so each case uses options no other test does, to start from an empty cache as a fresh page would.
  const RealNumberFormat = Intl.NumberFormat;
  function runtimeLocale(locale: string) {
    const Localized = function (requested?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
      return new RealNumberFormat(requested ?? locale, options);
    } as unknown as typeof Intl.NumberFormat;
    Object.assign(Localized, { supportedLocalesOf: RealNumberFormat.supportedLocalesOf });
    Intl.NumberFormat = Localized;
  }
  afterEach(() => {
    Intl.NumberFormat = RealNumberFormat;
  });

  it("renders the same value text on a server in any locale, and shows the reader's once hydrated", async () => {
    const priced = <Slider label="Price" name="price" defaultValue={[10, 40]} min={0} max={60} showValue format={{ style: "currency", currency: "CHF" }} />;
    runtimeLocale("de-DE");
    const html = renderToString(priced);
    // A server in any locale writes the value in en-US until the reader's browser has hydrated it,
    // and the reader's browser hydrates in en-US too, so the two always agree.
    const english = (value: number) => new RealNumberFormat("en-US", { style: "currency", currency: "CHF" }).format(value);
    const server = new DOMParser().parseFromString(html, "text/html");
    expect(server.querySelector("[data-ouro-slider-value] > span")!.textContent).toBe(`${english(10)} – ${english(40)}`);
    expect([...server.querySelectorAll('input[type="range"]')].map((input) => input.getAttribute("aria-valuetext"))).toEqual([`${english(10)} start range`, `${english(40)} end range`]);
    runtimeLocale("fr-FR");
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    mounted.push(host);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, priced, { onRecoverableError: recoverable });
    });
    roots.push(root);
    const french = (value: number) => new RealNumberFormat("fr-FR", { style: "currency", currency: "CHF" }).format(value);
    await expect.poll(() => host.querySelector("[data-ouro-slider-value] > span")!.textContent).toBe(`${french(10)} – ${french(40)}`);
    expect([...host.querySelectorAll('input[type="range"]')].map((input) => input.getAttribute("aria-valuetext"))).toEqual([`${french(10)} start range`, `${french(40)} end range`]);
    // React reports a mismatch once hydration is done, after the reader's text is on screen.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("Slider server error", () => {
  it.each([
    [["Too much.", ""], "true"],
    [["", ""], null],
  ] as const)("reads an error list %j as invalid: %s", async (error, expected) => {
    const view = await render(<Slider label="Price" defaultValue={[20, 80]} error={[...error]} />);
    for (const control of view.inputs) expect(control.getAttribute("aria-invalid")).toBe(expected);
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
        <Slider label="Price" name="price" error="Too much." defaultValue={[20, 80]} />
      </form>,
    );
    const controls = view.inputs;
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.getAttribute("aria-invalid")).toBe("true");
    await act(async () => view.host.querySelector("form")!.requestSubmit());
    expect(sent).not.toBeNull();
    expect(sent!.getAll("price")).toEqual(["20", "80"]);
  });
});

describe("Slider in a Form", () => {
  it("shows the Form's error for its name and drops it once the user changes the value", async () => {
    const view = await render(
      <Form errors={{ heat: "Not that one." }}>
        <Slider label="Heat" name="heat" defaultValue={50} />
      </Form>,
    );
    for (const control of view.inputs) expect(control.getAttribute("aria-invalid")).toBe("true");
    view.inputs[0]!.focus();
    await userEvent.keyboard("{ArrowRight}");
    for (const control of view.inputs) await expect.poll(() => control.getAttribute("aria-invalid")).toBeNull();
  });
});
