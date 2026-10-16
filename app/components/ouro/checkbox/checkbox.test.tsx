import { useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Checkbox, type CheckboxProps } from "~/components/ouro/checkbox/checkbox";
import { Form, type FormErrors } from "~/components/ouro/form/form";
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
      return host.querySelector<HTMLElement>('[data-ouro="checkbox"]')!;
    },
    get box() {
      return host.querySelector<HTMLElement>('[role="checkbox"]')!;
    },
    get input() {
      return host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    },
    get label() {
      return host.querySelector<HTMLLabelElement>("label")!;
    },
  };
}

const describedBy = (element: Element) => (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
const textOf = (doc: Document | Element, ids: string[]) =>
  ids.map((id) => (doc instanceof Document ? doc : doc.ownerDocument).getElementById(id)?.textContent);

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

describe("Checkbox", () => {
  it("is a checkbox named by its label, with the label to its right", async () => {
    const { root, box, label } = await render(<Checkbox label="Email me new recipes" />);
    expect(root).not.toBeNull();
    await expect.element(page.getByRole("checkbox", { name: "Email me new recipes" })).not.toBeChecked();
    expect(label.getBoundingClientRect().left).toBeGreaterThan(box.getBoundingClientRect().right);
    // The box comes first, so it reads before its label.
    expect(box.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("toggles with Space, and with a click on the box or the label", async () => {
    const onCheckedChange = vi.fn();
    const { box, label } = await render(<Checkbox label="Basil" onCheckedChange={onCheckedChange} />);
    box.focus();
    await userEvent.keyboard(" ");
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    await userEvent.keyboard(" ");
    expect(box.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(label);
    expect(box.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect(onCheckedChange).toHaveBeenCalledTimes(4);
  });

  it("does not toggle with Enter", async () => {
    const { box } = await render(<Checkbox label="Basil" />);
    box.focus();
    await userEvent.keyboard("{Enter}");
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  it("follows a controlled checked value", async () => {
    function Controlled() {
      const [checked, setChecked] = useState(false);
      return (
        <>
          <Checkbox label="Basil" checked={checked} onCheckedChange={setChecked} />
          <output>{String(checked)}</output>
        </>
      );
    }
    const { box, host } = await render(<Controlled />);
    await userEvent.click(box);
    expect(host.querySelector("output")!.textContent).toBe("true");
    expect(box.getAttribute("aria-checked")).toBe("true");
  });

  it("announces the indeterminate state as mixed and shows a dash", async () => {
    const { box, host, rerender } = await render(<Checkbox label="All herbs" indeterminate />);
    expect(box.getAttribute("aria-checked")).toBe("mixed");
    expect(box.hasAttribute("data-indeterminate")).toBe(true);
    const [tick, dash] = [...host.querySelectorAll("path")];
    expect(getComputedStyle(tick!).display).toBe("none");
    expect(getComputedStyle(dash!).display).not.toBe("none");
    await rerender(<Checkbox label="All herbs" />);
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  it("submits an indeterminate box only once the app checks it", async () => {
    const onCheckedChange = vi.fn();
    const { host, box, rerender } = await render(
      <form>
        <Checkbox label="All herbs" name="all" indeterminate checked={false} onCheckedChange={onCheckedChange} />
      </form>,
    );
    const form = host.querySelector("form")!;
    expect([...new FormData(form)]).toEqual([]);
    await userEvent.click(box);
    // Controlled: the click asks the app, and nothing submits until the app checks the box.
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    expect(box.getAttribute("aria-checked")).toBe("mixed");
    expect([...new FormData(form)]).toEqual([]);
    await rerender(
      <form>
        <Checkbox label="All herbs" name="all" checked onCheckedChange={onCheckedChange} />
      </form>,
    );
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect([...new FormData(form)]).toEqual([["all", "on"]]);
  });

  it("shows a Form error for its name without blocking the form, and drops it once toggled", async () => {
    const { host, box } = await render(
      <Form errors={{ terms: "Accept the terms." }}>
        <Checkbox label="I accept the terms" name="terms" />
      </Form>,
    );
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(textOf(box, describedBy(box))).toEqual(["Accept the terms."]);
    // The error only shows: the form can still be sent again.
    expect(host.querySelector("form")!.checkValidity()).toBe(true);
    await userEvent.click(box);
    await expect.poll(() => box.getAttribute("aria-invalid")).toBeNull();
    expect(describedBy(box)).toEqual([]);
  });

  it("takes focus when its Form error arrives, unless it is disabled", async () => {
    const { host } = await render(
      <Arriving errors={{ locked: "Locked.", terms: "Accept the terms." }}>
        <Checkbox label="Locked" name="locked" disabled />
        <Checkbox label="I accept the terms" name="terms" />
      </Arriving>,
    );
    await fail();
    const [locked, terms] = [...host.querySelectorAll<HTMLElement>('[role="checkbox"]')];
    expect(locked!.getAttribute("aria-invalid")).toBe("true");
    // The disabled box cannot be changed, so focus goes to the first one that can.
    await expect.poll(() => document.activeElement).toBe(terms);
  });

  it("submits name=value with its form when checked, and nothing when not", async () => {
    const { host, box } = await render(
      <form>
        <Checkbox label="Email me" name="newsletter" value="weekly" />
        <Checkbox label="Text me" name="sms" defaultChecked />
      </form>,
    );
    const form = host.querySelector("form")!;
    expect([...new FormData(form)]).toEqual([["sms", "on"]]);
    await userEvent.click(box);
    expect([...new FormData(form)]).toEqual([
      ["newsletter", "weekly"],
      ["sms", "on"],
    ]);
  });

  it("required blocks submit until checked, and sets aria-required and the marker", async () => {
    const { host, box, input, label } = await render(
      <form>
        <Checkbox label="I accept the terms" name="terms" required />
      </form>,
    );
    expect(box.getAttribute("aria-required")).toBe("true");
    expect(input.required).toBe(true);
    expect(label.closest("[data-ouro-required]")).not.toBeNull();
    expect(label.textContent).toBe("I accept the terms");
    expect(page.getByLabelText("I accept the terms", { exact: true }).elements()).toContain(box);
    expect(host.querySelector("form")!.checkValidity()).toBe(false);
    await userEvent.click(box);
    expect(host.querySelector("form")!.checkValidity()).toBe(true);
  });

  it("describes the box with its description and error, and marks it invalid", async () => {
    const { box } = await render(<Checkbox label="I accept the terms" description="You can read them first." error="Accept the terms to continue." />);
    expect(textOf(box, describedBy(box))).toEqual(["You can read them first.", "Accept the terms to continue."]);
    expect(box.getAttribute("aria-invalid")).toBe("true");
    // Some installed themes serialize the border as oklab, and a theme may transition it in.
    await expect.poll(() => pixel(getComputedStyle(box).borderTopColor)).toBe(pixel(themeColor("--destructive")));
    await expect
      .element(page.getByRole("checkbox", { name: "I accept the terms" }))
      .toHaveAccessibleDescription("You can read them first. Accept the terms to continue.");
  });

  it("keeps an invalid box's border red while hovered", async () => {
    const { box } = await render(<Checkbox label="I accept the terms" error="Accept the terms to continue." />);
    await userEvent.hover(box);
    await expect.poll(() => pixel(getComputedStyle(box).borderTopColor)).toBe(pixel(themeColor("--destructive")));
  });

  it("puts the description and error under the label, not under the box", async () => {
    const { host, label } = await render(<Checkbox label="Terms" description="Read them first." error="Required." />);
    const description = [...host.querySelectorAll("p")].find((el) => el.textContent === "Read them first.")!;
    const error = [...host.querySelectorAll("div")].find((el) => el.textContent === "Required.")!;
    const left = label.getBoundingClientRect().left;
    expect(description.getBoundingClientRect().left).toBe(left);
    expect(error.getBoundingClientRect().left).toBe(left);
    expect(description.getBoundingClientRect().top).toBeGreaterThan(label.getBoundingClientRect().top);
  });

  it("disables the box and fades it", async () => {
    const onCheckedChange = vi.fn();
    const { box, input } = await render(<Checkbox label="Basil" disabled onCheckedChange={onCheckedChange} />);
    expect(box.hasAttribute("data-disabled")).toBe(true);
    expect(input.disabled).toBe(true);
    expect(getComputedStyle(box).opacity).toBe("0.5");
    await userEvent.click(box, { force: true });
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("readOnly shows the state and ignores clicks", async () => {
    const { box } = await render(<Checkbox label="Basil" checked readOnly />);
    await userEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(box.getAttribute("aria-readonly")).toBe("true");
    expect(warn).not.toHaveBeenCalled();
  });

  it("hides the label visually with hideLabel and keeps the name", async () => {
    const { label } = await render(<Checkbox label="Select row" hideLabel />);
    expect(label.closest("[data-ouro-label]")!.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    await expect.element(page.getByRole("checkbox", { name: "Select row" })).toBeInTheDocument();
  });

  it("forwards ref to the box", async () => {
    let element: HTMLElement | null = null;
    const { box } = await render(<Checkbox label="Basil" ref={(node) => void (element = node)} />);
    expect(element).toBe(box);
  });
});

describe("Checkbox look", () => {
  it("fills with the primary color when checked", async () => {
    const { box } = await render(<Checkbox label="Basil" defaultChecked />);
    expect(getComputedStyle(box).backgroundColor).toBe(themeColor("--primary"));
  });

  it("fills with the primary color when checked or mixed in dark mode too", async () => {
    document.documentElement.classList.add("dark");
    try {
      const { host } = await render(
        <>
          <Checkbox label="Basil" defaultChecked />
          <Checkbox label="All herbs" indeterminate />
        </>,
      );
      for (const box of host.querySelectorAll('[role="checkbox"]')) expect(getComputedStyle(box).backgroundColor).toBe(themeColor("--primary"));
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });

  it("is 16px beside 14px text with a fine pointer from sm, centered on the label's first line", async () => {
    await page.viewport(1280, 800);
    const { box, label } = await render(<Checkbox label="Basil" />);
    expect(box.getBoundingClientRect().height).toBe(16);
    expect(getComputedStyle(label).fontSize).toBe("14px");
    const labelLine = parseFloat(getComputedStyle(label).lineHeight);
    const boxCenter = box.getBoundingClientRect().top + 8 - label.closest("[data-ouro-label]")!.getBoundingClientRect().top;
    expect(boxCenter).toBeCloseTo(labelLine / 2, 0);
  });

  it("grows the tick in from 95% as it fades in when checked, and only fades it with reduced motion", async () => {
    const { box, host } = await render(<Checkbox label="Basil" />);
    const tick = host.querySelector("path")!;
    expect(getComputedStyle(tick).opacity).toBe("0");
    expect(Number.parseFloat(getComputedStyle(tick).scale)).toBeCloseTo(0.95, 2);
    expect(getComputedStyle(tick).transitionProperty).toBe("opacity, scale");
    expect(getComputedStyle(tick).transitionTimingFunction).toBe("cubic-bezier(0.23, 1, 0.32, 1), cubic-bezier(0.23, 1, 0.32, 1)");
    await userEvent.click(box);
    await expect.poll(() => getComputedStyle(tick).opacity).toBe("1");
    await expect.poll(() => Number.parseFloat(getComputedStyle(tick).scale) || 1).toBeCloseTo(1, 3);
    await commands.emulateMedia({ reducedMotion: "reduce" });
    expect(getComputedStyle(tick).transitionProperty).toBe("opacity");
    expect(getComputedStyle(tick).opacity).toBe("1");
    await userEvent.click(box);
    await expect.poll(() => getComputedStyle(tick).opacity).toBe("0");
    expect(Number.parseFloat(getComputedStyle(tick).scale) || 1).toBeCloseTo(1, 3);
  });

  it("presses in while the pointer is down, but not with reduced motion", async () => {
    await render(<Checkbox label="Basil" />);
    await commands.pointerPress({ selector: '[role="checkbox"]', action: "down" });
    const box = document.querySelector<HTMLElement>('[role="checkbox"]')!;
    expect(getComputedStyle(box).scale).not.toBe("none");
    await commands.pointerPress({ selector: '[role="checkbox"]', action: "up" });
    // Let the release finish easing back before checking that a reduced-motion press does not scale.
    await expect.poll(() => getComputedStyle(box).scale).toBe("none");
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await commands.pointerPress({ selector: '[role="checkbox"]', action: "down" });
    expect(getComputedStyle(box).scale).toBe("none");
    await commands.pointerPress({ selector: '[role="checkbox"]', action: "up" });
  });
});

describe("Checkbox development messages", () => {
  const messages = () => warn.mock.calls.map((call: unknown[]) => String(call[0]));

  it("names the real prop for guessed ones", async () => {
    const guesses = {
      onChange: () => {},
      isChecked: true,
      isIndeterminate: true,
      defaultValue: true,
      errorMessage: "Required.",
      helperText: "Read them.",
      isInvalid: true,
      invalid: true,
      isRequired: true,
      isDisabled: true,
    } as unknown as Partial<CheckboxProps>;
    await render(<Checkbox label="Terms" {...guesses} />);
    expect(messages()).toEqual([
      '[ouro-ui] Checkbox: errorMessage is not a prop. Fix: <Checkbox error="Required.">.',
      '[ouro-ui] Checkbox: helperText is not a prop. Fix: <Checkbox description="Read them.">.',
      '[ouro-ui] Checkbox: isInvalid is not a prop. Fix: <Checkbox error="What is wrong">.',
      '[ouro-ui] Checkbox: invalid is not a prop. Fix: <Checkbox error="What is wrong">.',
      "[ouro-ui] Checkbox: isRequired is not a prop. Fix: <Checkbox required>.",
      "[ouro-ui] Checkbox: isDisabled is not a prop. Fix: <Checkbox disabled>.",
      "[ouro-ui] Checkbox: onChange is not a prop; onCheckedChange gets the new state. Fix: <Checkbox onCheckedChange={(checked) => setChecked(checked)}>.",
      "[ouro-ui] Checkbox: isChecked is not a prop. Fix: <Checkbox checked={true}>.",
      "[ouro-ui] Checkbox: isIndeterminate is not a prop. Fix: <Checkbox indeterminate>.",
      "[ouro-ui] Checkbox: defaultValue is not a prop; a checkbox starts checked with defaultChecked. Fix: <Checkbox defaultChecked>.",
    ]);
    // Guard props never reach the DOM.
    expect(document.querySelector("[isChecked], [helperText]")).toBeNull();
  });

  it("names Checkbox, not Field, for a missing label and an appearance class", async () => {
    const { root } = await render(<Checkbox {...({ label: "" } as CheckboxProps)} className="bg-red-500 mt-4" />);
    expect(root.getAttribute("data-ouro")).toBe("checkbox");
    expect(messages()).toContain('[ouro-ui] Checkbox: label is empty, so the control has no name. Fix: <Checkbox label="Email" hideLabel> to hide a label you still need.');
    expect(messages()).toContain('[ouro-ui] Checkbox: "bg-red-500" sets appearance, and className is for layout only. Fix: <Checkbox error="What is wrong">.');
    expect(root.classList.contains("mt-4")).toBe(true);
  });

  it("warns when indeterminate has no onCheckedChange to clear it", async () => {
    await render(<Checkbox label="All herbs" indeterminate />);
    expect(messages()).toEqual([
      "[ouro-ui] Checkbox: indeterminate without onCheckedChange stays mixed after a click while the box submits as checked. Fix: <Checkbox indeterminate={some} checked={all} onCheckedChange={toggleAll}>.",
    ]);
  });

  it("does not warn about indeterminate on a disabled box, which cannot be clicked", async () => {
    await render(<Checkbox label="All herbs" indeterminate disabled />);
    expect(messages()).toEqual([]);
  });

  it("warns when checked has no onCheckedChange", async () => {
    await render(<Checkbox label="Basil" checked />);
    expect(messages()).toEqual([
      "[ouro-ui] Checkbox: checked without onCheckedChange never changes. Fix: <Checkbox checked={checked} onCheckedChange={setChecked}>, or defaultChecked.",
    ]);
  });

  it("has no messages for valid props", async () => {
    await render(<Checkbox label="Basil" name="herbs" value="basil" description="Fresh." error="Pick one." required defaultChecked className="mt-4" />);
    expect(messages()).toEqual([]);
  });
});

describe("Checkbox on the server", () => {
  const node = (
    <form>
      <Checkbox label="I accept the terms" name="terms" required description="You can read them first." error="Accept the terms to continue." />
      <Checkbox label="All herbs" indeterminate />
    </form>
  );

  it("renders the name, description, error and state in the server HTML", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = new DOMParser().parseFromString(renderToString(node), "text/html");
    const [terms, all] = [...doc.querySelectorAll('[role="checkbox"]')];
    expect(textOf(doc, describedBy(terms!))).toEqual(["You can read them first.", "Accept the terms to continue."]);
    expect(doc.getElementById(terms!.getAttribute("aria-labelledby")!)!.textContent).toContain("I accept the terms");
    expect(terms!.getAttribute("aria-invalid")).toBe("true");
    expect(terms!.getAttribute("aria-required")).toBe("true");
    const input = doc.querySelector<HTMLInputElement>('input[name="terms"]')!;
    expect(doc.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    expect(all!.getAttribute("aria-checked")).toBe("mixed");
    expect(doc.getElementById(all!.getAttribute("aria-labelledby")!)!.textContent).toBe("All herbs");
    expect(error).not.toHaveBeenCalled();
  });

  it("hydrates with the same ids and no hydration warning", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    // Base UI also describes the hidden native input after hydration; it is aria-hidden, so
    // only the box's description counts, and the box has it in the server HTML.
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
    const box = host.querySelector<HTMLElement>('[role="checkbox"]')!;
    await userEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("true");
  });
});

describe("Checkbox under a parent's spacing", () => {
  it("keeps the 16px that space-y-4 puts between the Checkbox and the button below it", async () => {
    // The parent's rule has zero specificity, so a margin class on the root would beat it.
    const { host } = await render(
      <div className="space-y-4">
        <Checkbox label="Basil" />
        <Button>Save</Button>
      </div>,
    );
    const root = host.querySelector<HTMLElement>('[data-ouro="checkbox"]')!;
    const button = host.querySelector<HTMLElement>('[data-ouro="button"]')!;
    expect(getComputedStyle(root).marginBottom).toBe("16px");
    expect(Math.abs(button.getBoundingClientRect().top - root.getBoundingClientRect().bottom - 16)).toBeLessThanOrEqual(1);
  });
});
