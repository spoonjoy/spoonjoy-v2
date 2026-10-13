import { createRef, type FormEvent, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Form } from "~/components/ouro/form/form";
import { NativeSelect, type NativeSelectProps } from "~/components/ouro/select/native-select";
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
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="native-select"]')!;
    },
    get select() {
      return host.querySelector<HTMLSelectElement>("select")!;
    },
  };
}

const countries = [
  { value: "nz", label: "New Zealand" },
  { value: "za", label: "South Africa" },
  { value: "us", label: "United States", disabled: true },
];

/** The text of the elements an element's `aria-describedby` names. */
const description = (element: Element) =>
  (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "");

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

describe("NativeSelect", () => {
  it("is a labeled native select built on the Field contract", async () => {
    const { root, select } = await render(<NativeSelect label="Country" name="country" options={countries} />);
    expect(root.getAttribute("data-ouro")).toBe("native-select");
    expect(select.labels![0]!.textContent).toBe("Country");
    expect(select.name).toBe("country");
    expect([...select.options].map((item) => item.textContent)).toEqual(["New Zealand", "South Africa", "United States"]);
    expect(select.options[2]!.disabled).toBe(true);
    // The browser's own arrow is replaced by a chevron that does not take presses.
    expect(getComputedStyle(select).appearance).toBe("none");
    expect(getComputedStyle(root.querySelector("svg")!).pointerEvents).toBe("none");
  });

  it("calls onChange with the event and onValueChange with the value", async () => {
    const onChange = vi.fn();
    const onValueChange = vi.fn();
    await render(<NativeSelect label="Country" options={countries} onChange={onChange} onValueChange={onValueChange} />);
    await userEvent.selectOptions(page.getByRole("combobox", { name: "Country" }), "za");
    expect(onChange).toHaveBeenCalledOnce();
    expect(onValueChange.mock.calls[0]![0]).toBe("za");
  });

  it("renders option groups and option children", async () => {
    const { select, host } = await render(
      <>
        <NativeSelect label="Produce" options={[{ label: "Fruit", options: [{ value: "apple", label: "Apple" }] }, { value: "other", label: "Other" }]} />
        <NativeSelect label="Size">
          <option value="s">Small</option>
          <option value="l">Large</option>
        </NativeSelect>
      </>,
    );
    expect(select.querySelector("optgroup")!.label).toBe("Fruit");
    expect(select.querySelector("optgroup option")!.textContent).toBe("Apple");
    expect([...host.querySelectorAll("select")[1]!.options].map((item) => item.value)).toEqual(["s", "l"]);
  });

  it("shows a placeholder as an empty first option, muted while chosen", async () => {
    const { select } = await render(<NativeSelect label="Country" options={countries} placeholder="Choose a country" />);
    expect(select.options[0]!.value).toBe("");
    expect(select.options[0]!.textContent).toBe("Choose a country");
    expect(select.value).toBe("");
    const probe = document.createElement("span");
    probe.style.color = "var(--muted-foreground)";
    document.body.append(probe);
    expect(getComputedStyle(select).color).toBe(getComputedStyle(probe).color);
    await userEvent.selectOptions(page.getByRole("combobox", { name: "Country" }), "nz");
    expect(getComputedStyle(select).color).not.toBe(getComputedStyle(probe).color);
    probe.remove();
  });

  it("makes a required placeholder unselectable, so the browser asks for a choice", async () => {
    const submitted = vi.fn((event: FormEvent) => event.preventDefault());
    const { select } = await render(
      <Form onSubmit={submitted}>
        <NativeSelect label="Country" name="country" options={countries} placeholder="Choose a country" required />
        <button type="submit">Save</button>
      </Form>,
    );
    expect(select.options[0]!.disabled).toBe(true);
    expect(select.required).toBe(true);
    expect(select.getAttribute("aria-required")).toBe("true");
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    expect(submitted).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(select);
    expect(select.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows an error from the prop or the Form, and drops the Form's once changed", async () => {
    const { select } = await render(
      <Form errors={{ country: "We do not ship there." }}>
        <NativeSelect label="Country" name="country" description="Where we send it." options={countries} defaultValue="nz" />
      </Form>,
    );
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(description(select)).toEqual(["Where we send it.", "We do not ship there."]);
    await userEvent.selectOptions(page.getByRole("combobox", { name: "Country" }), "za");
    expect(select.getAttribute("aria-invalid")).toBeNull();
    expect(description(select)).toEqual(["Where we send it."]);
  });

  it("is disabled on request, forwards a ref and lets layout classes win", async () => {
    const ref = createRef<HTMLSelectElement>();
    const { select, root } = await render(<NativeSelect label="Country" options={countries} disabled ref={ref} className="mt-4 w-40" />);
    expect(ref.current).toBe(select);
    expect(select.disabled).toBe(true);
    expect(getComputedStyle(root).marginTop).toBe("16px");
    expect(getComputedStyle(root).width).toBe("160px");
  });

  it("is 36px tall with a fine pointer from sm up", async () => {
    await page.viewport(1024, 768);
    const { select } = await render(<NativeSelect label="Country" options={countries} />);
    expect(select.getBoundingClientRect().height).toBe(36);
  });

  it("renders the label, description and error ids on the server", () => {
    const html = renderToString(
      <Form errors={{ country: "We do not ship there." }}>
        <NativeSelect label="Country" name="country" description="Where we send it." options={countries} />
      </Form>,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    const select = doc.querySelector("select")!;
    expect(doc.querySelector("label")!.htmlFor).toBe(select.id);
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(description(select)).toEqual(["Where we send it.", "We do not ship there."]);
  });
});

describe("NativeSelect development messages", () => {
  it.each([
    ["multiple", { multiple: true }, "multiple is not supported; a native multiple select is hard to use", '<Select label="Country" multiple options={options} />'],
    ["isMulti", { isMulti: true }, "isMulti is not a prop", '<Select label="Country" multiple options={options} />'],
    ["helperText", { helperText: "Hint" }, "helperText is not a prop", '<NativeSelect description="Hint">'],
    ["isDisabled", { isDisabled: true }, "isDisabled is not a prop", "<NativeSelect disabled>"],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const props = { label: "Country", options: countries, ...extra } as unknown as NativeSelectProps;
    const { select } = await render(<NativeSelect {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] NativeSelect: ${problem}. Fix: ${fix}.`);
    expect(select.multiple).toBe(false);
    expect(select.hasAttribute("ismulti")).toBe(false);
  });

  it("warns when both options and children are set, and when there are none", async () => {
    await render(
      <>
        <NativeSelect label="Country" options={countries}>
          <option value="x">X</option>
        </NativeSelect>
        <NativeSelect label="Size" />
      </>,
    );
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] NativeSelect: options and children are both set, so the children are ignored. Fix: <NativeSelect label="Country" options={options} />.',
    );
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] NativeSelect: there are no options to choose from. Fix: <NativeSelect label="Size" options={[{ value: "nz", label: "New Zealand" }]} />.',
    );
  });
});
