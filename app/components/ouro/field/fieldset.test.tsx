import { type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { Field } from "~/components/ouro/field/field";
import { Checkbox } from "@base-ui/react/checkbox";
import { FieldControl, FieldLabel, FieldRoot } from "~/components/ouro/field/field-parts";
import { Fieldset } from "~/components/ouro/field/fieldset";
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
    get fieldset() {
      return host.querySelector<HTMLFieldSetElement>('[data-ouro="fieldset"]')!;
    },
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

const shipping = (props: Partial<Parameters<typeof Fieldset>[0]> = {}) => (
  <Fieldset legend="Shipping address" {...props}>
    <Field label="Street">
      <FieldControl />
    </Field>
    <Field label="City">
      <FieldControl />
    </Field>
    <button type="button">Look up</button>
  </Fieldset>
);

describe("Fieldset", () => {
  it("renders a fieldset named by its legend, with no browser chrome", async () => {
    const { fieldset } = await render(shipping());
    expect(fieldset.tagName).toBe("FIELDSET");
    await expect.element(page.getByRole("group", { name: "Shipping address" })).toBeVisible();
    const style = getComputedStyle(fieldset);
    expect(style.borderTopWidth).toBe("0px");
    expect(style.paddingTop).toBe("0px");
    expect(style.marginTop).toBe("0px");
    expect(style.minWidth).toBe("0px");
  });

  it("describes the group with description", async () => {
    const { fieldset } = await render(shipping({ description: "Where we send your order." }));
    const id = fieldset.getAttribute("aria-describedby")!;
    expect(document.getElementById(id)!.textContent).toBe("Where we send your order.");
    await expect.element(page.getByRole("group", { name: "Shipping address" })).toHaveAccessibleDescription("Where we send your order.");
  });

  it("has no aria-describedby without a description", async () => {
    const { fieldset } = await render(shipping());
    expect(fieldset.hasAttribute("aria-describedby")).toBe(false);
  });

  it("disables every nested control with disabled", async () => {
    const { host, fieldset } = await render(shipping({ disabled: true }));
    expect(fieldset.disabled).toBe(true);
    const controls = [...host.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")];
    expect(controls).toHaveLength(3);
    for (const control of controls) expect(control.matches(":disabled")).toBe(true);
    for (const field of host.querySelectorAll('[data-ouro="field"]')) expect(field.hasAttribute("data-disabled")).toBe(true);
  });

  it("disables a Base UI control in a FieldRoot, which is not a native control", async () => {
    const { host } = await render(
      <Fieldset legend="Preferences" disabled>
        <FieldRoot name="newsletter">
          <Checkbox.Root aria-label="Newsletter" />
          <FieldLabel>Newsletter</FieldLabel>
        </FieldRoot>
      </Fieldset>,
    );
    const checkbox = host.querySelector<HTMLElement>('[role="checkbox"]')!;
    expect(checkbox.getAttribute("aria-disabled")).toBe("true");
    expect(checkbox.hasAttribute("data-disabled")).toBe(true);
    expect(checkbox.tabIndex).toBe(-1);
  });

  it("leaves controls enabled by default", async () => {
    const { host } = await render(shipping());
    for (const control of host.querySelectorAll("input, button")) expect(control.matches(":disabled")).toBe(false);
  });

  it("hides the legend visually with hideLegend and keeps it as the name", async () => {
    const { host } = await render(shipping({ hideLegend: true, description: "Where we send it." }));
    const legend = [...host.querySelectorAll("div")].find((el) => el.textContent === "Shipping address")!;
    expect(legend.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    await expect.element(page.getByRole("group", { name: "Shipping address" })).toBeInTheDocument();
  });

  it("hides the legend without a description too", async () => {
    const { host } = await render(shipping({ hideLegend: true }));
    const legend = [...host.querySelectorAll("div")].find((el) => el.textContent === "Shipping address")!;
    expect(legend.getBoundingClientRect().width).toBeLessThanOrEqual(1);
  });

  it("lets app layout classes win", async () => {
    const { fieldset } = await render(shipping({ className: "mt-6" }));
    expect(getComputedStyle(fieldset).marginTop).toBe("24px");
  });

  it("warns for label, pointing to legend", async () => {
    const props = { legend: "Shipping", label: "Shipping" } as unknown as Parameters<typeof Fieldset>[0];
    const { fieldset } = await render(<Fieldset {...props}>x</Fieldset>);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Fieldset: label is not a prop. Fix: <Fieldset legend="Shipping">.');
    expect(fieldset.hasAttribute("label")).toBe(false);
  });

  it("warns for an empty legend", async () => {
    await render(<Fieldset legend="">x</Fieldset>);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Fieldset: legend is empty, so the group has no name. Fix: <Fieldset legend="Shipping address" hideLegend> to hide a legend you still need.',
    );
  });

  it("warns for an appearance class", async () => {
    await render(<Fieldset legend="Shipping" className="border">x</Fieldset>);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Fieldset: "border" sets appearance, and className is for layout only. Fix: style fields in your theme (--input, --ring, --radius).',
    );
  });
});

describe("Fieldset server rendering", () => {
  it("names and describes the group in the server HTML and hydrates without warnings", async () => {
    const node = shipping({ description: "Where we send it." });
    const html = renderToString(node);
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    mounted.push(host);
    const fieldset = host.querySelector("fieldset")!;
    const labelledBy = fieldset.getAttribute("aria-labelledby")!;
    expect(host.querySelector(`#${CSS.escape(labelledBy)}`)!.textContent).toBe("Shipping address");
    const describedBy = fieldset.getAttribute("aria-describedby")!;
    expect(host.querySelector(`#${CSS.escape(describedBy)}`)!.textContent).toBe("Where we send it.");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(fieldset.getAttribute("aria-labelledby")).toBe(labelledBy);
    expect(fieldset.getAttribute("aria-describedby")).toBe(describedBy);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});
