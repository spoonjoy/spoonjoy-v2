import { useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Checkbox } from "~/components/ouro/checkbox/checkbox";
import { CheckboxGroup, type CheckboxGroupProps } from "~/components/ouro/checkbox/checkbox-group";
import { Switch } from "~/components/ouro/switch/switch";
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
      return host.querySelector<HTMLElement>('[data-ouro="checkbox-group"]')!;
    },
    get group() {
      return host.querySelector<HTMLElement>('[role="group"]')!;
    },
    get boxes() {
      return [...host.querySelectorAll<HTMLElement>('[role="checkbox"]')];
    },
  };
}

const describedBy = (element: Element) => (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
const texts = (doc: Document, element: Element) => describedBy(element).map((id) => doc.getElementById(id)?.textContent);

const herbs = [
  { value: "basil", label: "Basil", description: "Sweet and peppery." },
  { value: "mint", label: "Mint" },
  { value: "sage", label: "Sage", disabled: true },
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

describe("CheckboxGroup", () => {
  it("is a group named by its legend and described by its description and error", async () => {
    const { root, group } = await render(<CheckboxGroup legend="Herbs" description="Pick any." error="Pick at least one." options={herbs} />);
    expect(root).not.toBeNull();
    await expect.element(page.getByRole("group", { name: "Herbs" })).toHaveAccessibleDescription("Pick any. Pick at least one.");
    expect(texts(document, group)).toEqual(["Pick any.", "Pick at least one."]);
    // The legend is not a <label>: a group has no one element to focus.
    expect(root.querySelector("label")?.textContent).not.toBe("Herbs");
  });

  it("renders a checkbox for each option, each named by its label and described by its description", async () => {
    const { boxes } = await render(<CheckboxGroup legend="Herbs" options={herbs} />);
    expect(boxes).toHaveLength(3);
    await expect.element(page.getByRole("checkbox", { name: "Basil" })).toHaveAccessibleDescription("Sweet and peppery.");
    await expect.element(page.getByRole("checkbox", { name: "Mint" })).not.toHaveAttribute("aria-describedby");
    await expect.element(page.getByRole("checkbox", { name: "Sage" })).toBeDisabled();
  });

  it("keeps the group's value: defaultValue, toggling with Space and clicks, and onValueChange", async () => {
    const onValueChange = vi.fn();
    const { boxes } = await render(<CheckboxGroup legend="Herbs" options={herbs} defaultValue={["mint"]} onValueChange={onValueChange} />);
    expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    boxes[0]!.focus();
    await userEvent.keyboard(" ");
    expect(onValueChange).toHaveBeenLastCalledWith(["mint", "basil"]);
    await userEvent.click(page.getByText("Mint"));
    expect(onValueChange).toHaveBeenLastCalledWith(["basil"]);
    expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  });

  it("follows a controlled value", async () => {
    function Controlled() {
      const [value, setValue] = useState<string[]>(["basil"]);
      return (
        <>
          <CheckboxGroup legend="Herbs" options={herbs} value={value} onValueChange={setValue} />
          <output>{value.join(",")}</output>
        </>
      );
    }
    const { host, boxes } = await render(<Controlled />);
    await userEvent.click(boxes[1]!);
    expect(host.querySelector("output")!.textContent).toBe("basil,mint");
    await userEvent.click(boxes[0]!);
    expect(host.querySelector("output")!.textContent).toBe("mint");
  });

  it("submits name=value for each checked box", async () => {
    const { host, boxes } = await render(
      <form>
        <CheckboxGroup legend="Herbs" name="herbs" options={herbs} defaultValue={["basil"]} />
      </form>,
    );
    const form = host.querySelector("form")!;
    expect(new FormData(form).getAll("herbs")).toEqual(["basil"]);
    await userEvent.click(boxes[1]!);
    expect(new FormData(form).getAll("herbs")).toEqual(["basil", "mint"]);
  });

  it("takes Checkbox children in place of options", async () => {
    const onValueChange = vi.fn();
    const { host, boxes } = await render(
      <form>
        <CheckboxGroup legend="Herbs" name="herbs" onValueChange={onValueChange}>
          <Checkbox value="basil" label="Basil" description="Sweet." />
          <Checkbox value="mint" label="Mint" />
        </CheckboxGroup>
      </form>,
    );
    await userEvent.click(boxes[1]!);
    expect(onValueChange).toHaveBeenLastCalledWith(["mint"]);
    expect(new FormData(host.querySelector("form")!).getAll("herbs")).toEqual(["mint"]);
    await expect.element(page.getByRole("checkbox", { name: "Basil" })).toHaveAccessibleDescription("Sweet.");
    expect(host.querySelectorAll('[data-ouro="checkbox"]')).toHaveLength(2);
  });

  it("disables every box with disabled", async () => {
    const { boxes, root } = await render(<CheckboxGroup legend="Herbs" options={herbs} disabled />);
    for (const box of boxes) expect(box.hasAttribute("data-disabled")).toBe(true);
    // The legend names a section, not a control, so it keeps full contrast; the boxes fade.
    const legend = root.querySelector<HTMLElement>("[data-ouro-legend]")!;
    expect(getComputedStyle(legend).opacity).toBe("1");
  });

  it("marks the boxes invalid with error", async () => {
    const { boxes } = await render(<CheckboxGroup legend="Herbs" options={herbs} error="Pick at least one." />);
    for (const box of boxes) expect(box.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows a Form error for its name on every box without blocking the form, and drops it once one is toggled", async () => {
    const { host, group, boxes } = await render(
      <Form errors={{ herbs: "Pick a herb we have." }}>
        <CheckboxGroup legend="Herbs" name="herbs" options={herbs} />
      </Form>,
    );
    expect(boxes.map((box) => box.getAttribute("aria-invalid"))).toEqual(["true", "true", "true"]);
    expect(texts(document, group)).toEqual(["Pick a herb we have."]);
    expect(host.querySelector("form")!.checkValidity()).toBe(true);
    await userEvent.click(boxes[1]!);
    await expect.poll(() => boxes.map((box) => box.getAttribute("aria-invalid"))).toEqual([null, null, null]);
    expect(describedBy(group)).toEqual([]);
  });

  it("focuses its first box when its Form error arrives", async () => {
    const { boxes } = await render(
      <Arriving errors={{ herbs: "Pick a herb we have." }}>
        <CheckboxGroup legend="Herbs" name="herbs" options={herbs} />
      </Arriving>,
    );
    await fail();
    await expect.poll(() => document.activeElement).toBe(boxes[0]);
  });

  it("skips a disabled first box when its Form error arrives", async () => {
    const { boxes } = await render(
      <Arriving errors={{ herbs: "Pick a herb we have." }}>
        <CheckboxGroup legend="Herbs" name="herbs" options={[{ value: "dill", label: "Dill", disabled: true }, ...herbs]} />
      </Arriving>,
    );
    await fail();
    expect(boxes[0]!.getAttribute("aria-invalid")).toBe("true");
    await expect.poll(() => document.activeElement).toBe(boxes[1]);
  });

  it("required marks the legend and blocks submit until a box is checked", async () => {
    const { host, root, boxes } = await render(
      <form>
        <CheckboxGroup legend="Herbs" name="herbs" options={herbs} required />
      </form>,
    );
    const form = host.querySelector("form")!;
    const legend = root.querySelector<HTMLElement>("[data-ouro-legend][data-ouro-required]")!;
    expect(getComputedStyle(legend, "::after").content).toBe('"*" / ""');
    expect(legend.querySelector("[aria-hidden]")).toBeNull();
    expect(form.checkValidity()).toBe(false);
    const first = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(first.validationMessage).toBe("Choose at least one.");
    await userEvent.click(boxes[1]!);
    expect(form.checkValidity()).toBe(true);
    await userEvent.click(boxes[1]!);
    expect(form.checkValidity()).toBe(false);
  });

  it("announces required in the group's name, since no box carries aria-required", async () => {
    await render(<CheckboxGroup legend="Herbs" name="herbs" options={herbs} required />);
    await expect.element(page.getByRole("group", { name: "Herbs (required)" })).toBeInTheDocument();
    // Only screen readers get the words; the asterisk is what shows.
    const words = document.querySelector("[data-ouro-legend] .sr-only")!;
    expect(words.textContent).toBe(" (required)");
  });

  it("translates the required words with requiredLabel", async () => {
    await render(<CheckboxGroup legend="Kräuter" name="herbs" options={herbs} required requiredLabel="(erforderlich)" />);
    await expect.element(page.getByRole("group", { name: "Kräuter (erforderlich)" })).toBeInTheDocument();
  });

  it("shows the required message once, under the group and not under each box, after a blocked submit", async () => {
    const { host } = await render(
      <Form>
        <CheckboxGroup legend="Herbs" name="herbs" options={herbs} required />
      </Form>,
    );
    const shown = () =>
      [...host.querySelectorAll("*")].filter((node) => node.children.length === 0 && node.textContent === "Choose at least one.");
    host.querySelector("form")!.requestSubmit();
    await expect.poll(() => shown().length).toBeGreaterThan(0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(shown()).toHaveLength(1);
    expect(shown()[0]!.closest('[data-ouro="checkbox"]')).toBeNull();
  });

  it("translates the required message with requiredMessage", async () => {
    const { host } = await render(
      <form>
        <CheckboxGroup legend="Kräuter" name="herbs" options={herbs} required requiredMessage="Wähle mindestens eins." />
      </form>,
    );
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.validationMessage).toBe("Wähle mindestens eins.");
  });

  it("lays out the choices in a column, 20px apart on touch-sized screens", async () => {
    const { boxes } = await render(<CheckboxGroup legend="Herbs" options={herbs.slice(1)} />);
    const [mint, sage] = boxes.map((box) => box.closest<HTMLElement>('[data-ouro="checkbox"]')!.getBoundingClientRect());
    expect(sage!.left).toBe(mint!.left);
    expect(sage!.top - mint!.bottom).toBe(20);
  });
});

describe("CheckboxGroup development messages", () => {
  const messages = () => warn.mock.calls.map((call: unknown[]) => String(call[0]));

  it("throws with the fix when given both options and children", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const props = { legend: "Herbs", options: herbs, children: <Checkbox value="dill" label="Dill" /> } as unknown as CheckboxGroupProps;
    await expect(render(<CheckboxGroup {...props} />)).rejects.toThrow(
      '[ouro-ui] CheckboxGroup: takes options or Checkbox children, not both. Fix: <CheckboxGroup legend="Herbs" options={options} />, or <CheckboxGroup legend="Herbs"><Checkbox value="basil" label="Basil" /></CheckboxGroup>.',
    );
    error.mockRestore();
  });

  it("names the real prop for guessed ones", async () => {
    const props = { legend: "Herbs", options: herbs, label: "Herbs", onChange: () => {}, items: herbs, errorMessage: "Pick one.", isRequired: true } as unknown as CheckboxGroupProps;
    await render(<CheckboxGroup {...props} />);
    expect(messages()).toEqual([
      '[ouro-ui] CheckboxGroup: errorMessage is not a prop. Fix: <CheckboxGroup error="Pick one.">.',
      "[ouro-ui] CheckboxGroup: isRequired is not a prop. Fix: <CheckboxGroup required>.",
      '[ouro-ui] CheckboxGroup: label is not a prop; a group is named by its legend. Fix: <CheckboxGroup legend="Herbs">.',
      "[ouro-ui] CheckboxGroup: onChange is not a prop; onValueChange gets the checked values. Fix: <CheckboxGroup onValueChange={(values) => setValues(values)}>.",
      "[ouro-ui] CheckboxGroup: items is not a prop. Fix: <CheckboxGroup options={[{ value: \"basil\", label: \"Basil\" }]}>.",
    ]);
  });

  it("names CheckboxGroup and the legend for an empty legend", async () => {
    const { root } = await render(<CheckboxGroup legend="" options={herbs} />);
    expect(root.getAttribute("data-ouro")).toBe("checkbox-group");
    expect(messages()).toEqual([
      '[ouro-ui] CheckboxGroup: legend is empty, so the group has no name. Fix: <CheckboxGroup legend="Toppings" hideLegend> to hide a legend you still need.',
    ]);
  });

  it("points a child's name, error and required to the group, and asks for its value", async () => {
    await render(
      <CheckboxGroup legend="Herbs">
        <Checkbox label="Basil" name="basil" error="No." required />
      </CheckboxGroup>,
    );
    expect(messages()).toEqual([
      '[ouro-ui] Checkbox: name belongs on the CheckboxGroup. Fix: <CheckboxGroup name="basil">.',
      '[ouro-ui] Checkbox: error belongs on the CheckboxGroup, which shows it once for every choice. Fix: <CheckboxGroup error="What is wrong">.',
      "[ouro-ui] Checkbox: required belongs on the CheckboxGroup. Fix: <CheckboxGroup required>.",
      '[ouro-ui] Checkbox: a checkbox in a CheckboxGroup needs a value. Fix: <Checkbox value="basil" label="Basil" />.',
    ]);
  });

  it("warns when value has no onValueChange", async () => {
    await render(<CheckboxGroup legend="Herbs" options={herbs} value={["basil"]} />);
    expect(messages()).toEqual([
      "[ouro-ui] CheckboxGroup: value without onValueChange never changes. Fix: <CheckboxGroup value={values} onValueChange={setValues}>, or defaultValue.",
    ]);
  });

  it("throws with the fix for a Switch inside the group", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      render(
        <CheckboxGroup legend="Notify me">
          <Switch label="Comments" />
        </CheckboxGroup>,
      ),
    ).rejects.toThrow(
      '[ouro-ui] Switch: a CheckboxGroup takes Checkbox choices. Fix: <Checkbox value="comments" label="Comments" />, or put the Switch outside the group.',
    );
    error.mockRestore();
  });

  it("has no messages for valid props", async () => {
    await render(
      <CheckboxGroup legend="Herbs" hideLegend name="herbs" description="Any." error="Pick one." required disabled defaultValue={["basil"]} options={herbs} className="mt-4" />,
    );
    expect(messages()).toEqual([]);
  });
});

describe("CheckboxGroup on the server", () => {
  const node = (
    <form>
      <CheckboxGroup legend="Herbs" name="herbs" description="Pick any." error="Pick at least one." options={herbs} defaultValue={["mint"]} />
    </form>
  );

  it("names and describes the group and each box in the server HTML", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = new DOMParser().parseFromString(renderToString(node), "text/html");
    const group = doc.querySelector('[role="group"]')!;
    expect(doc.getElementById(group.getAttribute("aria-labelledby")!)!.textContent).toBe("Herbs");
    expect(texts(doc, group)).toEqual(["Pick any.", "Pick at least one."]);
    const boxes = [...doc.querySelectorAll('[role="checkbox"]')];
    expect(boxes.map((box) => doc.getElementById(box.getAttribute("aria-labelledby")!)!.textContent)).toEqual(["Basil", "Mint", "Sage"]);
    // Each box is described by its own description, then the group's, as Base UI links them.
    expect(texts(doc, boxes[0]!)).toEqual(["Sweet and peppery.", "Pick any.", "Pick at least one."]);
    expect(texts(doc, boxes[1]!)).toEqual(["Pick any.", "Pick at least one."]);
    expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    for (const input of doc.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      expect(doc.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    }
    expect(error).not.toHaveBeenCalled();
  });

  it("announces required in the group's name in the server HTML", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(<CheckboxGroup legend="Herbs" name="herbs" options={herbs} required />);
    document.body.append(host);
    mounted.push(host);
    await expect.element(page.getByRole("group", { name: "Herbs (required)" })).toBeInTheDocument();
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
    const box = host.querySelector<HTMLElement>('[role="checkbox"]')!;
    await userEvent.click(box);
    expect(new FormData(host.querySelector("form")!).getAll("herbs")).toEqual(["basil", "mint"]);
  });
});
