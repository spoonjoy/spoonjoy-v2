import { createRef, useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Avatar } from "~/components/ouro/avatar/avatar";
import { Badge } from "~/components/ouro/badge/badge";
import { Button } from "~/components/ouro/button/button";
import { Combobox, type ComboboxItem, type ComboboxProps } from "~/components/ouro/combobox/combobox";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { Form } from "~/components/ouro/form/form";
import { act } from "~/lib/ouro/testing/act";
import { pressDuringScroll } from "~/lib/ouro/testing/press";
import { pressTab } from "~/lib/ouro/testing/tab";
import { audit, axeExclude, describeFindings } from "~/lib/ouro/testing/axe";
import { OuroProvider } from "~/lib/ouro/ouro-provider";

/** The colour behind an element: the nearest background around it that is not transparent. */
function behind(element: Element): string {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return "rgb(255, 255, 255)";
}


const herbs = ["Basil", "Chives", "Dill", "Mint", "Oregano", "Parsley", "Rosemary", "Sage", "Thyme"];
const cheeses = [
  { value: "brie", label: "Brie" },
  { value: "cheddar", label: "Cheddar" },
  { value: "feta", label: "Feta", disabled: true },
  { value: "gouda", label: "Gouda" },
];

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
      return host.querySelector<HTMLElement>('[data-ouro="combobox"]')!;
    },
    get input() {
      return host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    },
    get group() {
      return host.querySelector<HTMLElement>("[data-ouro-input-group]")!;
    },
    button(name: string) {
      return [...host.querySelectorAll("button")].find((button) => button.textContent === name) ?? null;
    },
  };
}

/** The open listbox's options, as their text. */
const options = () => [...document.querySelectorAll('[role="listbox"] [role="option"]')].map((option) => option.textContent);
const popup = () => document.querySelector<HTMLElement>('[data-ouro="combobox-popup"]');
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

describe("Combobox", () => {
  it("is a labeled combobox input built on the Field contract", async () => {
    const { root, input } = await render(<Combobox label="Herb" name="herb" items={herbs} placeholder="Pick a herb" />);
    expect(root.getAttribute("data-ouro")).toBe("combobox");
    expect(input.labels![0]!.textContent).toBe("Herb");
    expect(input.placeholder).toBe("Pick a herb");
    await expect.element(page.getByRole("combobox", { name: "Herb" })).toBeVisible();
    expect(warn).not.toHaveBeenCalled();
  });

  it("wires description, error, required and disabled through Field", async () => {
    const { host, input, rerender } = await render(
      <Combobox label="Herb" items={herbs} description="For the sauce." error="Pick a herb." required />,
    );
    expect(describedBy(input).map((id) => host.querySelector(`#${CSS.escape(id)}`)!.textContent)).toEqual(["For the sauce.", "Pick a herb."]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-required")).toBe("true");
    await rerender(<Combobox label="Herb" items={herbs} disabled />);
    expect(input.disabled).toBe(true);
  });

  it("shows the highlighted option in the system's highlight colours under forced colours, where its fill is dropped", async () => {
    const { input } = await render(<Combobox label="Herb" name="herb" items={herbs} />);
    await userEvent.click(input);
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => document.querySelector('[role="option"][data-highlighted]')).not.toBeNull();
    await commands.emulateMedia({ forcedColors: "active" });
    try {
      const highlighted = document.querySelector('[role="option"][data-highlighted]')!;
      expect(getComputedStyle(highlighted).backgroundColor).not.toBe(behind(highlighted));
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

  it("leaves the rest of the page exposed while its list is open, so the gate passes from the page's main landmark", async () => {
    const main = document.createElement("main");
    main.innerHTML = '<h1>Recipes</h1><a href="#notes">Notes</a><span> for each recipe</span><span aria-hidden="true" data-ornament="">~</span>';
    document.body.append(main);
    mounted.push(main);
    const host = document.createElement("div");
    main.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <OuroProvider portalContainer={main}>
          <div className="grid gap-4">
            <Combobox label="Herb" name="herb" items={herbs} />
            <Combobox label="Garnish" name="garnish" items={herbs} />
          </div>
        </OuroProvider>,
      ),
    );
    // What the page hides outside the list is what it hid before the list opened.
    const hidden = () => [...main.querySelectorAll('[aria-hidden="true"]')].filter((element) => !element.closest('[data-ouro="combobox-portal"]'));
    const before = hidden();
    await userEvent.click(host.querySelector<HTMLInputElement>('input[role="combobox"]')!);
    await expect.poll(popup).not.toBeNull();
    await expect.poll(hidden).toEqual(before);
    // The list lies over the middle of main, where axe reads the background of the block the link
    // sits in, as on an app's page whose main reaches past the list (main holds no text of its own).
    const list = popup()!.getBoundingClientRect();
    main.style.height = `${2 * (list.top + list.height / 2 - main.getBoundingClientRect().top)}px`;
    const middle = main.getBoundingClientRect();
    expect(popup()!.contains(document.elementFromPoint(middle.left + middle.width / 2, middle.top + middle.height / 2))).toBe(true);
    expect(describeFindings(await audit({ include: [document.documentElement], exclude: axeExclude.map((selector) => [selector]) }))).toBe("");
    // What the list hides itself, what the page hides inside what Base UI marked, what a dialog
    // opened over the list hides, and what anything hides once the list is closed, stays hidden.
    const option = popup()!.querySelector('[role="option"]')!;
    option.setAttribute("aria-hidden", "true");
    const note = main.querySelector("h1")!.appendChild(document.createElement("span"));
    note.setAttribute("aria-hidden", "true");
    await new Promise((resolve) => setTimeout(resolve));
    expect(option.getAttribute("aria-hidden")).toBe("true");
    expect(note.getAttribute("aria-hidden")).toBe("true");
    option.removeAttribute("aria-hidden");
    const heading = main.querySelector("h1")!;
    expect(heading.hasAttribute("data-base-ui-inert")).toBe(true);
    const dialog = document.body.appendChild(document.createElement("div"));
    dialog.setAttribute("role", "dialog");
    heading.setAttribute("aria-hidden", "true");
    await new Promise((resolve) => setTimeout(resolve));
    expect(heading.getAttribute("aria-hidden")).toBe("true");
    dialog.remove();
    heading.removeAttribute("aria-hidden");
    await userEvent.keyboard("{Escape}");
    await expect.poll(popup).toBeNull();
    const link = main.querySelector("a")!;
    link.setAttribute("data-base-ui-inert", "");
    link.setAttribute("aria-hidden", "true");
    await new Promise((resolve) => setTimeout(resolve));
    expect(link.getAttribute("aria-hidden")).toBe("true");
  });

  it("warns when its open list renders outside every landmark of a page that has a main", async () => {
    const main = document.body.appendChild(document.createElement("main"));
    mounted.push(main);
    const { input } = await render(<Combobox label="Herb" name="herb" items={herbs} />);
    await userEvent.click(input);
    await expect.poll(popup).not.toBeNull();
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      "[ouro-ui] Combobox: the open popup renders outside every landmark, so screen reader users who move by landmark miss it. Fix: <OuroProvider portalContainer={popups}> around the app, with <div ref={popups} /> inside <main>.",
    ]);
  });

  it("filters the items as you type and picks one", async () => {
    const onValueChange = vi.fn();
    const { input, host } = await render(<Combobox label="Herb" name="herb" items={herbs} onValueChange={onValueChange} />);
    await userEvent.click(input);
    await userEvent.type(input, "ma");
    await expect.poll(options).toEqual(["Rosemary"]);
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onValueChange).toHaveBeenLastCalledWith("Rosemary");
    expect(input.value).toBe("Rosemary");
    expect(host.querySelector<HTMLInputElement>('input[name="herb"]')!.value).toBe("Rosemary");
    await expect.poll(popup).toBeNull();
  });

  it("takes items with a value and a label, and submits the value", async () => {
    const onValueChange = vi.fn();
    const { input, host } = await render(
      <Combobox label="Cheese" name="cheese" items={cheeses} defaultValue="gouda" onValueChange={onValueChange} />,
    );
    expect(input.value).toBe("Gouda");
    expect(host.querySelector<HTMLInputElement>('input[name="cheese"]')!.value).toBe("gouda");
    // Pressing the chevron opens the list.
    await userEvent.click(host.querySelector<HTMLElement>("[data-ouro-combobox-icon]")!);
    await expect.poll(options).toEqual(["Brie", "Cheddar", "Feta", "Gouda"]);
    const feta = [...document.querySelectorAll('[role="option"]')].find((option) => option.textContent === "Feta")!;
    expect(feta.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(page.getByRole("option", { name: "Brie" }));
    expect(onValueChange).toHaveBeenLastCalledWith("brie");
  });

  it("follows a controlled value", async () => {
    function Controlled() {
      const [value, setValue] = useState<string | null>("brie");
      return (
        <>
          <Combobox label="Cheese" items={cheeses} value={value} onValueChange={setValue} />
          <button type="button" onClick={() => setValue("cheddar")}>
            Sharp
          </button>
          <output>{String(value)}</output>
        </>
      );
    }
    const { input } = await render(<Controlled />);
    expect(input.value).toBe("Brie");
    await userEvent.click(page.getByRole("button", { name: "Sharp" }));
    expect(input.value).toBe("Cheddar");
  });

  it("shows the empty message when nothing matches", async () => {
    const { input } = await render(<Combobox label="Herb" items={herbs} emptyLabel="No herbs match." />);
    await userEvent.click(input);
    await userEvent.type(input, "zz");
    await expect.element(page.getByText("No herbs match.")).toBeVisible();
  });

  it("clears the value with the clear button and puts focus back in the input", async () => {
    const onValueChange = vi.fn();
    const { input, button } = await render(<Combobox label="Herb" items={herbs} defaultValue="Dill" onValueChange={onValueChange} />);
    await userEvent.click(button("Clear")!);
    expect(onValueChange).toHaveBeenLastCalledWith(null);
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("translates its button labels", async () => {
    const { button } = await render(<Combobox label="Kraut" items={herbs} defaultValue="Dill" clearLabel="Leeren" />);
    expect(button("Leeren")).not.toBeNull();
  });

  it("forwards its ref to the input", async () => {
    const ref = createRef<HTMLInputElement>();
    const { input } = await render(<Combobox label="Herb" items={herbs} ref={ref} />);
    expect(ref.current).toBe(input);
  });

  it("lets app layout classes win on the root", async () => {
    const { root } = await render(<Combobox label="Herb" items={herbs} className="mt-6" />);
    expect(getComputedStyle(root).marginTop).toBe("24px");
  });
});

describe("Combobox async", () => {
  it("hands typing to onInputChange and shows the app's items unfiltered", async () => {
    // The search answers when the test says so, so the loading state lasts as long as the checks need.
    let answer = () => {};
    function Search() {
      const [results, setResults] = useState<string[]>([]);
      const [loading, setLoading] = useState(false);
      return (
        <Combobox
          label="Recipe"
          items={results}
          loading={loading}
          onInputChange={(text) => {
            setLoading(true);
            answer = () => {
              setResults(text ? [`${text} soup`, `${text} pie`] : []);
              setLoading(false);
            };
          }}
        />
      );
    }
    const { input } = await render(<Search />);
    await userEvent.click(input);
    await userEvent.type(input, "leek");
    await expect.element(page.getByText("Loading…")).toBeVisible();
    expect(popup()!.getAttribute("aria-busy")).toBe("true");
    await act(async () => answer());
    // The app's items are shown as given: "leek pie" does not contain "leek soup" and both show.
    await expect.poll(options).toEqual(["leek soup", "leek pie"]);
    expect(popup()!.hasAttribute("aria-busy")).toBe(false);
  });

  it("does not search again when an item is picked", async () => {
    const onInputChange = vi.fn();
    const { input } = await render(<Combobox label="Recipe" items={["Leek soup"]} onInputChange={onInputChange} />);
    await userEvent.click(input);
    await userEvent.type(input, "l");
    expect(onInputChange).toHaveBeenLastCalledWith("l");
    const calls = onInputChange.mock.calls.length;
    await userEvent.click(page.getByRole("option", { name: "Leek soup" }));
    expect(input.value).toBe("Leek soup");
    expect(onInputChange.mock.calls.length).toBe(calls);
  });

  it("keeps a picked item's label when the results change", async () => {
    const { input, rerender } = await render(<Combobox label="Cheese" items={cheeses} defaultValue="brie" onInputChange={() => {}} />);
    expect(input.value).toBe("Brie");
    await rerender(<Combobox label="Cheese" items={[]} defaultValue="brie" onInputChange={() => {}} />);
    expect(input.value).toBe("Brie");
  });

  it("shows a value it has not seen among the items as the value itself", async () => {
    const { input } = await render(<Combobox label="Cheese" items={[]} defaultValue="comté" onInputChange={() => {}} />);
    expect(input.value).toBe("comté");
  });

  it("waits for a search before saying nothing matched", async () => {
    const { input } = await render(<Combobox label="Recipe" items={[]} onInputChange={() => {}} />);
    await userEvent.click(input);
    await expect.poll(popup).not.toBeNull();
    expect(popup()!.textContent).not.toContain("No results");
    await userEvent.type(input, "zz");
    await expect.element(page.getByText("No results")).toBeVisible();
  });

  it("translates the loading message", async () => {
    const { input } = await render(<Combobox label="Rezept" items={[]} loading loadingLabel="Lädt…" />);
    await userEvent.click(input);
    await userEvent.type(input, "x");
    await expect.element(page.getByText("Lädt…")).toBeVisible();
  });
});

describe("Combobox multiple", () => {
  it("shows a chip per pick and submits each value", async () => {
    const onValueChange = vi.fn();
    const { input, host } = await render(
      <Combobox label="Herbs" name="herbs" multiple items={herbs} defaultValue={["Basil"]} onValueChange={onValueChange} />,
    );
    const chips = () => [...host.querySelectorAll("[data-ouro-combobox-chip]")].map((chip) => chip.firstChild!.textContent);
    expect(chips()).toEqual(["Basil"]);
    await userEvent.click(input);
    await userEvent.type(input, "thy");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onValueChange).toHaveBeenLastCalledWith(["Basil", "Thyme"]);
    expect(chips()).toEqual(["Basil", "Thyme"]);
    expect([...host.querySelectorAll<HTMLInputElement>('input[name="herbs"]')].map((hidden) => hidden.value)).toEqual(["Basil", "Thyme"]);
  });

  it("removes a chip with its remove button", async () => {
    const onValueChange = vi.fn();
    const { button } = await render(<Combobox label="Herbs" multiple items={herbs} defaultValue={["Basil", "Dill"]} onValueChange={onValueChange} />);
    await userEvent.click(button("Remove Basil")!);
    expect(onValueChange).toHaveBeenLastCalledWith(["Dill"]);
  });

  it("translates the remove label", async () => {
    const { button } = await render(
      <Combobox label="Kräuter" multiple items={herbs} defaultValue={["Dill"]} removeLabel={(item) => `${item} entfernen`} />,
    );
    expect(button("Dill entfernen")).not.toBeNull();
  });
});

describe("Combobox allowCustomValue", () => {
  it("keeps what people type and suggests matching items", async () => {
    const onValueChange = vi.fn();
    const { input, host } = await render(
      <Combobox label="Cuisine" name="cuisine" allowCustomValue items={["Italian", "Indian", "Thai"]} onValueChange={onValueChange} />,
    );
    await userEvent.click(input);
    await userEvent.type(input, "Ind");
    await expect.poll(options).toEqual(["Indian"]);
    await userEvent.type(input, "onesian");
    expect(onValueChange).toHaveBeenLastCalledWith("Indonesian");
    input.blur();
    expect(input.value).toBe("Indonesian");
    expect(host.querySelector<HTMLInputElement>('input[name="cuisine"]')!.value).toBe("Indonesian");
  });

  it("fills the input with a picked suggestion", async () => {
    const onValueChange = vi.fn();
    const { input } = await render(<Combobox label="Cuisine" allowCustomValue items={["Italian", "Thai"]} onValueChange={onValueChange} />);
    await userEvent.click(input);
    await userEvent.type(input, "Th");
    await userEvent.click(page.getByRole("option", { name: "Thai" }));
    expect(input.value).toBe("Thai");
    expect(onValueChange).toHaveBeenLastCalledWith("Thai");
  });

  it("can be controlled", async () => {
    function Cuisine() {
      const [value, setValue] = useState("Thai");
      return (
        <>
          <Combobox label="Cuisine" allowCustomValue items={["Italian", "Thai"]} value={value} onValueChange={setValue} />
          <output>{value}</output>
        </>
      );
    }
    const { input, host } = await render(<Cuisine />);
    expect(input.value).toBe("Thai");
    await userEvent.click(input);
    await userEvent.type(input, "!");
    expect(host.querySelector("output")!.textContent).toBe("Thai!");
  });

  it("does not search again when a suggestion is picked", async () => {
    const onInputChange = vi.fn();
    const { input } = await render(<Combobox label="Cuisine" allowCustomValue items={["Thai", "Thali"]} onInputChange={onInputChange} />);
    await userEvent.click(input);
    await userEvent.type(input, "Tha");
    const calls = onInputChange.mock.calls.length;
    await userEvent.click(page.getByRole("option", { name: "Thali" }));
    expect(input.value).toBe("Thali");
    expect(onInputChange.mock.calls.length).toBe(calls);
  });

  it("waits for a search before saying nothing matched", async () => {
    const { input } = await render(<Combobox label="Cuisine" allowCustomValue items={[]} onInputChange={() => {}} />);
    await userEvent.click(input);
    expect(document.body.textContent).not.toContain("No results");
    await userEvent.type(input, "zz");
    await expect.element(page.getByText("No results")).toBeVisible();
  });

  it("says nothing matched for a controlled search with no results", async () => {
    const { input } = await render(<Combobox label="Cuisine" allowCustomValue items={[]} value="zz" onInputChange={() => {}} />);
    await userEvent.click(input);
    await expect.element(page.getByText("No results")).toBeVisible();
  });

  it("leaves filtering to onInputChange, which hears every keystroke", async () => {
    const onInputChange = vi.fn();
    const { input } = await render(<Combobox label="Cuisine" allowCustomValue items={["Italian", "Thai"]} onInputChange={onInputChange} />);
    await userEvent.click(input);
    await userEvent.type(input, "Zz");
    expect(onInputChange).toHaveBeenLastCalledWith("Zz");
    expect(options()).toEqual(["Italian", "Thai"]);
  });
});

describe("Combobox looks", () => {
  it("draws TextField's bordered box around the input", async () => {
    const { group } = await render(<Combobox label="Herb" items={herbs} />);
    const box = getComputedStyle(group);
    expect(box.borderTopStyle).toBe("solid");
    expect(parseFloat(box.borderTopWidth)).toBeGreaterThan(0);
    expect(parseFloat(box.paddingLeft)).toBeGreaterThan(0);
  });

  it("uses a 16px font and a 44px box on phones, stepping down with a mouse on wider screens", async () => {
    await page.viewport(390, 844);
    const { input, group } = await render(<Combobox label="Herb" items={herbs} />);
    expect(parseFloat(getComputedStyle(input).fontSize)).toBeGreaterThanOrEqual(16);
    expect(group.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await page.viewport(1280, 800);
    await expect.poll(() => group.getBoundingClientRect().height).toBeLessThan(44);
  });

  it("outlines the box when the input has keyboard focus and marks it when invalid", async () => {
    const { host } = await render(
      <>
        <Combobox label="Valid" items={herbs} />
        <Combobox label="Invalid" items={herbs} error="Pick one." />
      </>,
    );
    const [valid, invalid] = [...host.querySelectorAll<HTMLElement>("[data-ouro-input-group]")];
    expect(getComputedStyle(invalid!).borderTopColor).not.toBe(getComputedStyle(valid!).borderTopColor);
    await pressTab();
    await expect.poll(() => getComputedStyle(valid!).outlineStyle).toBe("solid");
  });

  it("opens the popup at the input's width, above the page's layer", async () => {
    const { input, group } = await render(<Combobox label="Herb" items={herbs} />);
    await userEvent.click(input);
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(popup).not.toBeNull();
    expect(Math.round(popup()!.getBoundingClientRect().width)).toBe(Math.round(group.getBoundingClientRect().width));
    expect(popup()!.closest('[data-ouro="combobox-portal"]')).not.toBeNull();
  });

  it("closes with only a fade when reduced motion is on", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const { input } = await render(<Combobox label="Herb" items={herbs} />);
    await userEvent.click(input);
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(popup).not.toBeNull();
    expect(getComputedStyle(popup()!).transitionProperty).toBe("opacity");
  });
});

describe("Combobox motion", () => {
  const timing = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return { duration: style.transitionDuration.split(", ")[0], easing: style.transitionTimingFunction.split(/,\s(?![^(]*\))/)[0] };
  };

  it("scales about the point Base UI computes next to its input, and leaves on the ease-out token", async () => {
    const { input } = await render(<Combobox label="Herb" items={herbs} />);
    await userEvent.click(input);
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(popup).not.toBeNull();
    const element = popup()!;
    element.style.setProperty("--transform-origin", "7px 3px");
    expect(getComputedStyle(element).transformOrigin).toBe("7px 3px");
    element.setAttribute("data-ending-style", "");
    expect(timing(element)).toEqual({ duration: "0.15s", easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
    element.removeAttribute("data-ending-style");
  });

  it("leaves a loose label lookup for the field on the input, not on its clear or remove buttons", async () => {
    const { host } = await render(
      <>
        <Combobox label="Herb" items={herbs} defaultValue="Basil" clearLabel="Clear herb" />
        <Combobox label="Basil" multiple items={herbs} defaultValue={["Basil"]} />
      </>,
    );
    const [single, multiple] = [...host.querySelectorAll<HTMLInputElement>('input[role="combobox"]')];
    expect(page.getByLabelText("Herb", { exact: false }).elements()).toEqual([single]);
    expect(page.getByLabelText("Basil", { exact: false }).elements()).toEqual([multiple]);
    for (const name of ["Clear herb", "Remove Basil"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect.element(button).toBeInTheDocument();
      expect(button.element().hasAttribute("aria-label")).toBe(false);
    }
  });

  it("shrinks a chip's remove button on pointer-down", async () => {
    await render(<Combobox label="Herbs" multiple items={herbs} defaultValue={["Basil"]} />);
    const selector = "[data-ouro-combobox-chip-remove]";
    const remove = document.querySelector<HTMLElement>(selector)!;
    await commands.pointerPress({ selector, action: "down" });
    try {
      await expect.poll(() => getComputedStyle(remove).scale).toBe("0.97");
    } finally {
      await commands.pointerPress({ selector, action: "up" });
    }
  });
});

describe("Combobox development messages", () => {
  it.each([
    ["errorMessage", { errorMessage: "Required." }, "errorMessage is not a prop", '<Combobox error="Required.">'],
    ["helperText", { helperText: "Hint" }, "helperText is not a prop", '<Combobox description="Hint">'],
    ["isInvalid", { isInvalid: true }, "isInvalid is not a prop", '<Combobox error="What is wrong">'],
    ["invalid", { invalid: true }, "invalid is not a prop", '<Combobox error="What is wrong">'],
    ["isRequired", { isRequired: true }, "isRequired is not a prop", "<Combobox required>"],
    ["isDisabled", { isDisabled: true }, "isDisabled is not a prop", "<Combobox disabled>"],
    ["options", { options: ["a"] }, "options is not a prop", "<Combobox items={[…]}>"],
    ["isLoading", { isLoading: true }, "isLoading is not a prop", "<Combobox loading>"],
    ["isMulti", { isMulti: true }, "isMulti is not a prop", "<Combobox multiple>"],
    ["freeSolo", { freeSolo: true }, "freeSolo is not a prop", "<Combobox allowCustomValue>"],
    ["creatable", { creatable: true }, "creatable is not a prop", "<Combobox allowCustomValue>"],
    ["onSearch", { onSearch: () => {} }, "onSearch is not a prop", "<Combobox onInputChange={(text) => …}>"],
    ["onInputValueChange", { onInputValueChange: () => {} }, "onInputValueChange is not a prop", "<Combobox onInputChange={(text) => …}>"],
    ["onChange", { onChange: () => {} }, "onChange is not a prop", "<Combobox onValueChange={(value) => …}>"],
    ["noOptionsMessage", { noOptionsMessage: "None" }, "noOptionsMessage is not a prop", '<Combobox emptyLabel="None">'],
    ["isClearable", { isClearable: true }, "isClearable is not a prop; the clear button shows whenever there is a value", "<Combobox>"],
    ["inputValue", { inputValue: "Ba" }, "inputValue needs onInputChange, or the text can never change", "<Combobox inputValue={text} onInputChange={setText}>"],
  ])("warns for %s with the fix", async (name, extra, problem, fix) => {
    const props = { label: "Herb", items: herbs, ...extra } as unknown as ComboboxProps;
    const { host } = await render(<Combobox {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Combobox: ${problem}. Fix: ${fix}.`);
    for (const element of host.querySelectorAll("*")) expect(element.hasAttribute(name.toLowerCase())).toBe(false);
  });

  it("warns when multiple and allowCustomValue are both set", async () => {
    const props = { label: "Tags", items: herbs, multiple: true, allowCustomValue: true } as unknown as ComboboxProps;
    await render(<Combobox {...props} />);
    expect(warn).toHaveBeenCalledWith(
      "[ouro-ui] Combobox: multiple and allowCustomValue do not combine; allowCustomValue keeps one typed value. Fix: <Combobox multiple items={tags}>.",
    );
  });

  it("names Combobox in Field's messages", async () => {
    const { rerender } = await render(<Combobox label="" items={herbs} className="bg-red-500" />);
    await rerender(<Combobox label="" items={herbs} className="bg-red-500" />);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '[ouro-ui] Combobox: "bg-red-500" sets appearance, and className is for layout only. Fix: <Combobox error="What is wrong">.',
      '[ouro-ui] Combobox: label is empty, so the control has no name. Fix: <Combobox label="Email" hideLabel> to hide a label you still need.',
    ]);
  });
});

describe("Combobox server rendering", () => {
  const node = (
    <div>
      <Combobox label="Herb" name="herb" items={herbs} description="For the sauce." error="Pick a herb." required defaultValue="Dill" />
      <Combobox label="Herbs" name="herbs" multiple items={herbs} defaultValue={["Basil"]} description="As many as you like." />
      <Combobox label="Cuisine" allowCustomValue items={["Thai"]} defaultValue="Thai" />
    </div>
  );

  it("renders the label, description and error ids on the server", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = new DOMParser().parseFromString(renderToString(node), "text/html");
    const [herb, multi, cuisine] = [...doc.querySelectorAll('input[role="combobox"]')];
    expect(doc.querySelector(`label[for="${herb!.id}"]`)!.textContent).toContain("Herb");
    expect(describedBy(herb!).map((id) => doc.getElementById(id)!.textContent)).toEqual(["For the sauce.", "Pick a herb."]);
    expect(herb!.getAttribute("aria-invalid")).toBe("true");
    expect(herb!.getAttribute("value")).toBe("Dill");
    expect(describedBy(multi!).map((id) => doc.getElementById(id)!.textContent)).toEqual(["As many as you like."]);
    expect(doc.querySelector("[data-ouro-combobox-chip]")!.firstChild!.textContent).toBe("Basil");
    expect(doc.querySelector(`label[for="${cuisine!.id}"]`)!.textContent).toBe("Cuisine");
    expect(error).not.toHaveBeenCalled();
  });

  it("hydrates with the same ids and no hydration warning", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    // Base UI's hidden form inputs (out of the tab order, not announced) gain the field's
    // description ids on the client; what people perceive is the combobox input.
    const snapshot = () =>
      [...host.querySelectorAll('label, input[role="combobox"], :not(input)[id]')].map((el) => [el.tagName, el.id, el.getAttribute("for"), el.getAttribute("aria-describedby")]);
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
  });
});

describe("Combobox server error", () => {
  it("marks the custom-value input invalid too", async () => {
    const view = await render(<Combobox label="Herb" items={herbs} allowCustomValue error="Pick a herb." />);
    expect(view.input.getAttribute("aria-invalid")).toBe("true");
  });

  it.each([
    [["Too much.", ""], "true"],
    [["", ""], null],
  ] as const)("reads an error list %j as invalid: %s", async (error, expected) => {
    const view = await render(<Combobox label="Herb" items={herbs} error={[...error]} />);
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
        <Combobox label="Herb" name="herb" items={herbs} error="Pick a herb." defaultValue="Dill" />
      </form>,
    );
    const controls = [view.input];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control.getAttribute("aria-invalid")).toBe("true");
    await act(async () => view.host.querySelector("form")!.requestSubmit());
    expect(sent).not.toBeNull();
    expect(sent!.get("herb")).toEqual("Dill");
  });
});

describe("Combobox in a Form", () => {
  it("shows the Form's error for its name and drops it once the user changes the value", async () => {
    const view = await render(
      <Form errors={{ herb: "Not that one." }}>
        <Combobox label="Herb" name="herb" items={herbs} defaultValue="Dill" />
      </Form>,
    );
    for (const control of [view.input]) expect(control.getAttribute("aria-invalid")).toBe("true");
    await userEvent.click(view.input);
    await userEvent.click(page.getByRole("option", { name: "Basil" }));
    for (const control of [view.input]) await expect.poll(() => control.getAttribute("aria-invalid")).toBeNull();
  });
});

describe("Combobox and the page's scroll", () => {
  // A long page with smooth scrolling and a scroll padding under its sticky header (a docs site's,
  // say), scrolled to 2000px, with the trigger in that header. Opening focuses and scrolls to what
  // the popup holds, which the browser did for the page too, as far as its end.
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  beforeEach(async () => {
    await page.viewport(1280, 800);
    await expect.poll(() => innerWidth).toBe(1280);
  });
  afterEach(() => {
    document.documentElement.removeAttribute("style");
    window.scrollTo({ top: 0, behavior: "instant" });
  });

  for (const reduced of [false, true]) {
    for (const input of ["pointer", "keyboard"] as const) {
      it(`leaves the page where it is as it opens and closes, by ${input}${reduced ? ", with reduced motion" : ""}`, async () => {
        if (reduced) await commands.emulateMedia({ reducedMotion: "reduce" });
        await render(
          <div style={{ height: 5000 }}>
            <header style={{ position: "sticky", top: 0, height: 100 }}>
              <Combobox label="Herb" items={herbs} />
            </header>
          </div>,
        );
        window.scrollTo({ top: 2000, behavior: "instant" });
        Object.assign(document.documentElement.style, { scrollBehavior: "smooth", scrollPaddingTop: "120px" });
        const painted: number[] = [];
        let reading = true;
        const read = () => {
          painted.push(window.scrollY);
          if (reading) requestAnimationFrame(read);
        };
        requestAnimationFrame(read);
        const opener = document.querySelector<HTMLElement>('[data-ouro-control="combobox"][data-ouro-part="input"]')!;
        if (input === "pointer") {
          await commands.pointerPress({ selector: '[data-ouro-control="combobox"][data-ouro-part="input"]', action: "down" });
          await commands.pointerPress({ action: "up" });
        } else {
          opener.focus({ preventScroll: true });
          await userEvent.keyboard("{ArrowDown}");
        }
        await expect.poll(() => {
          const open = popup();
          return Boolean(open?.hasAttribute("data-open") && !open.hasAttribute("data-starting-style") && open.getAnimations().length === 0);
        }).toBe(true);
        await frame();
        await frame();
        await userEvent.keyboard("{Escape}");
        await expect.poll(() => {
          const open = popup();
          return !open || (open.hasAttribute("data-closed") && open.getAnimations().length === 0);
        }).toBe(true);
        await frame();
        await frame();
        reading = false;
        expect(painted.length).toBeGreaterThan(2);
        expect(new Set(painted)).toEqual(new Set([2000]));
      });
    }
  }

  it("stays open and stops the page where it is, pressed as a smooth scroll begins", async () => {
    // A smooth scroll begins as the press goes down, ahead of the trigger's own handlers: the press
    // stops it where it is, holding the page from then on, not only once the popup opens, and the
    // popup opens and stays open.
    await render(
      <div style={{ height: 5000 }}>
        <header style={{ position: "sticky", top: 0, height: 100 }}>
          <Combobox label="Herb" items={herbs} />
        </header>
      </div>,
    );
    const { behaviorAtPress } = await pressDuringScroll('[data-ouro-control="combobox"][data-ouro-part="input"]', { from: 2000, to: 4000, scroll: "begins" });
    await expect.poll(() => {
      const open = popup();
      return Boolean(open?.hasAttribute("data-open") && !open.hasAttribute("data-starting-style") && open.getAnimations().length === 0);
    }).toBe(true);
    await frame();
    await frame();
    expect(popup()!.hasAttribute("data-open")).toBe(true);
    expect(behaviorAtPress).toBe("auto");
    expect(window.scrollY).toBe(2000);
  });

  it("stays open and stops the page where it is, pressed as a smooth scroll begins, with a value of its own", async () => {
    // A smooth scroll begins as the press goes down, ahead of the trigger's own handlers: the press
    // stops it where it is, holding the page from then on, not only once the popup opens, and the
    // popup opens and stays open.
    await render(
      <div style={{ height: 5000 }}>
        <header style={{ position: "sticky", top: 0, height: 100 }}>
          <Combobox label="Herb" items={herbs} allowCustomValue />
        </header>
      </div>,
    );
    const { behaviorAtPress } = await pressDuringScroll('[data-ouro-control="combobox"][data-ouro-part="input"]', { from: 2000, to: 4000, scroll: "begins" });
    await expect.poll(() => {
      const open = popup();
      return Boolean(open?.hasAttribute("data-open") && !open.hasAttribute("data-starting-style") && open.getAnimations().length === 0);
    }).toBe(true);
    await frame();
    await frame();
    expect(popup()!.hasAttribute("data-open")).toBe(true);
    expect(behaviorAtPress).toBe("auto");
    expect(window.scrollY).toBe(2000);
  });

  for (const custom of [false, true]) {
    it(`leaves the page to the app at Enter in its closed input, which submits the form${custom ? ", with a value of its own" : ""}`, async () => {
      // Enter in a closed combobox opens nothing; the form's submit may scroll the page (to its
      // results, or to a field to fix), and that scroll is the app's.
      await render(
        <div style={{ height: 5000 }}>
          <header style={{ position: "sticky", top: 0, height: 100 }}>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                window.scrollTo({ top: 1500, behavior: "instant" });
              }}
            >
              {custom ? <Combobox label="Herb" items={herbs} allowCustomValue /> : <Combobox label="Herb" items={herbs} />}
              <button type="submit" data-test-harness="">
                Find
              </button>
            </form>
          </header>
        </div>,
      );
      window.scrollTo({ top: 2000, behavior: "instant" });
      const html = document.documentElement;
      html.style.scrollBehavior = "smooth";
      let atPress = "";
      window.addEventListener("keydown", () => (atPress = html.style.scrollBehavior), { once: true });
      document.querySelector<HTMLElement>('[data-ouro-control="combobox"][data-ouro-part="input"]')!.focus({ preventScroll: true });
      await userEvent.keyboard("{Enter}");
      await frame();
      await frame();
      expect(atPress).toBe("smooth");
      expect(html.style.scrollBehavior).toBe("smooth");
      expect(window.scrollY).toBe(1500);
      expect(popup()).toBeNull();
    });
  }
});

const people: ComboboxItem[] = [
  {
    value: "rowan",
    label: "Rowan Vale",
    description: "Principal Engineer, Platform Services and Developer Experience, North Harbor office",
    media: <Avatar name="Rowan Vale" alt="" size="xs" />,
    meta: <Badge>1:1</Badge>,
  },
  { value: "iris", label: "Iris Okafor", description: "Designer", media: <Avatar name="Iris Okafor" alt="" size="xs" presence="available" presenceLabel="Available" /> },
  { value: "theo", label: "Theo Brandt" },
];

describe("Combobox rich items", () => {
  it("shows media, a description and a mark on a row, and media on its chip", async () => {
    const { input, host } = await render(<Combobox label="To" multiple items={people} defaultValue={["iris"]} />);
    await userEvent.click(input);
    await expect.poll(options).toHaveLength(3);
    const [rowan, iris, theo] = [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')];
    // Read in order: the name, the second line, then the mark.
    // The avatar's initials ("RV") are drawn, not text, and hidden from screen readers with alt="".
    expect(rowan!.textContent).toBe("Rowan Vale" + "Principal Engineer, Platform Services and Developer Experience, North Harbor office" + "1:1");
    const media = rowan!.querySelector<HTMLElement>("[data-ouro-combobox-media]")!;
    const description = rowan!.querySelector<HTMLElement>("[data-ouro-combobox-description]")!;
    const meta = rowan!.querySelector<HTMLElement>("[data-ouro-combobox-meta]")!;
    expect(media.querySelector('[data-ouro="avatar"]')).not.toBeNull();
    expect(meta.textContent).toBe("1:1");
    // The picture comes first, the mark at the row's end; the second line is cut, whole in its title.
    expect(media.getBoundingClientRect().right).toBeLessThanOrEqual(description.getBoundingClientRect().left);
    expect(meta.getBoundingClientRect().left).toBeGreaterThanOrEqual(description.getBoundingClientRect().right);
    expect(meta.getBoundingClientRect().right).toBeGreaterThan(rowan!.getBoundingClientRect().right - 16);
    expect(description.getBoundingClientRect().top).toBeGreaterThan(rowan!.querySelector(".truncate")!.getBoundingClientRect().top);
    expect(description.scrollWidth).toBeGreaterThan(description.clientWidth);
    expect(getComputedStyle(description).textOverflow).toBe("ellipsis");
    expect(description.title).toBe("Principal Engineer, Platform Services and Developer Experience, North Harbor office");
    expect(rowan!.getBoundingClientRect().right).toBeLessThanOrEqual(popup()!.getBoundingClientRect().right);
    // The picked row keeps its 16px check; the avatar's own presence glyph keeps its size inside its dot.
    expect(iris!.querySelector("[data-ouro-combobox-media]")).not.toBeNull();
    const check = iris!.firstElementChild!.querySelector("svg")!;
    expect(check.getBoundingClientRect().width).toBe(16);
    const dot = iris!.querySelector<HTMLElement>("[data-ouro-avatar-presence]")!;
    expect(dot.querySelector("svg")!.getBoundingClientRect().width).toBeLessThan(dot.getBoundingClientRect().width);
    // A plain item keeps its plain row.
    expect(theo!.querySelector("[data-ouro-combobox-media], [data-ouro-combobox-description], [data-ouro-combobox-meta]")).toBeNull();
    expect(theo!.textContent).toBe("Theo Brandt");
    // The chip shows the picture before the name, inside the chip.
    const chip = host.querySelector<HTMLElement>("[data-ouro-combobox-chip]")!;
    const chipMedia = chip.querySelector<HTMLElement>("[data-ouro-combobox-chip-media]")!;
    expect(chipMedia.querySelector('[data-ouro="avatar"]')).not.toBeNull();
    expect(chip.querySelector(":scope > span")!.textContent).toBe("Iris Okafor");
    expect(chipMedia.getBoundingClientRect().left).toBeGreaterThanOrEqual(chip.getBoundingClientRect().left);
    expect(chipMedia.getBoundingClientRect().height).toBeLessThanOrEqual(chip.getBoundingClientRect().height);
  });

  it("lays out a row for whichever of media, description and meta it has, and keeps a plain row's long label whole", async () => {
    const long = "Theo Brandt from the support team, who answers on weekends and holidays";
    const { input } = await render(
      <Combobox
        label="To"
        items={[
          { value: "media", label: "Only a picture", media: <Avatar name="Only Picture" alt="" size="xs" /> },
          { value: "description", label: "Only a line", description: "Designer" },
          { value: "meta", label: "Only a mark", meta: <Badge>1:1</Badge> },
          { value: "plain", label: long },
        ]}
      />,
    );
    await userEvent.click(input);
    await expect.poll(options).toHaveLength(4);
    const rows = [...document.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')];
    const parts = (row: HTMLElement) =>
      ["media", "description", "meta"].filter((part) => row.querySelector(`[data-ouro-combobox-${part}]`)).join(",");
    expect(rows.map(parts)).toEqual(["media", "description", "meta", ""]);
    // A rich row's label stays on one line; a plain row's label wraps, whole.
    for (const row of rows.slice(0, 3)) expect(row.getBoundingClientRect().height).toBeLessThan(60);
    const plain = rows[3]!.lastElementChild as HTMLElement;
    expect(plain.textContent).toBe(long);
    expect(plain.scrollWidth).toBeLessThanOrEqual(plain.clientWidth);
    expect(plain.getBoundingClientRect().height).toBeGreaterThan(2 * parseFloat(getComputedStyle(plain).lineHeight) - 1);
  });

  it("shows rich suggestions with allowCustomValue too", async () => {
    const { input } = await render(<Combobox label="To" allowCustomValue items={people} />);
    await userEvent.click(input);
    await expect.poll(options).toHaveLength(3);
    expect(document.querySelector('[role="option"] [data-ouro-combobox-description]')!.textContent).toBe(
      "Principal Engineer, Platform Services and Developer Experience, North Harbor office",
    );
  });
});

describe("Combobox keys", () => {
  it("picks the first match on Enter with autoHighlight, and nothing without it", async () => {
    const first = vi.fn();
    const plain = vi.fn();
    await render(
      <>
        <Combobox label="First herb" items={herbs} autoHighlight onValueChange={first} />
        <Combobox label="Plain herb" items={herbs} onValueChange={plain} />
      </>,
    );
    const field = (name: string) => page.getByRole("combobox", { name, exact: true }).element() as HTMLInputElement;
    await userEvent.click(field("First herb"));
    await userEvent.type(field("First herb"), "ma");
    await expect.poll(options).toEqual(["Rosemary"]);
    await userEvent.keyboard("{Enter}");
    expect(first).toHaveBeenLastCalledWith("Rosemary");
    expect(field("First herb").value).toBe("Rosemary");
    await userEvent.click(field("Plain herb"));
    await userEvent.type(field("Plain herb"), "ma");
    await expect.poll(options).toEqual(["Rosemary"]);
    await userEvent.keyboard("{Enter}");
    expect(plain).not.toHaveBeenCalled();
  });

  it("hands the app each key first, and leaves a key the app prevents alone", async () => {
    const seen: string[] = [];
    const picked = vi.fn();
    const { input } = await render(
      <Combobox
        label="Herbs"
        multiple
        items={herbs}
        autoHighlight
        onValueChange={picked}
        onInputKeyDown={(event) => {
          seen.push(`${event.key} after ${picked.mock.calls.length} picks`);
          if (event.key === "ArrowDown" || (event.key === "Enter" && event.currentTarget.value === "ma")) event.preventDefault();
        }}
      />,
    );
    await act(async () => input.focus());
    // A prevented arrow leaves the list closed.
    await userEvent.keyboard("{ArrowDown}");
    await act(async () => {});
    expect(popup()).toBeNull();
    await userEvent.type(input, "ma");
    await expect.poll(options).toEqual(["Rosemary"]);
    // A prevented Enter picks nothing, and the list stays open.
    await userEvent.keyboard("{Enter}");
    expect(picked).not.toHaveBeenCalled();
    expect(popup()).not.toBeNull();
    // An Enter the app lets through picks, after the app has seen it.
    await userEvent.keyboard("{Backspace}{Backspace}thy");
    await expect.poll(options).toEqual(["Thyme"]);
    await userEvent.keyboard("{Enter}");
    expect(picked).toHaveBeenLastCalledWith(["Thyme"]);
    await pressTab();
    expect(seen).toContain("ArrowDown after 0 picks");
    expect(seen.filter((key) => key.startsWith("Enter"))).toEqual(["Enter after 0 picks", "Enter after 0 picks"]);
    expect(seen).toContain("Tab after 1 picks");
  });

  it("takes its text from inputValue, and clears it after a pick when the app says so", async () => {
    function People() {
      const [text, setText] = useState("Ro");
      const [picked, setPicked] = useState<string[]>([]);
      return (
        <Combobox
          label="To"
          multiple
          autoHighlight
          items={herbs.filter((herb) => picked.includes(herb) || herb.toLowerCase().includes(text.toLowerCase()))}
          inputValue={text}
          onInputChange={setText}
          value={picked}
          onValueChange={(next) => {
            setPicked(next);
            setText("");
          }}
        />
      );
    }
    const { input, host } = await render(<People />);
    expect(input.value).toBe("Ro");
    await userEvent.click(input);
    await userEvent.keyboard("{Backspace}{Backspace}thy");
    expect(input.value).toBe("thy");
    await expect.poll(options).toEqual(["Thyme"]);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => [...host.querySelectorAll("[data-ouro-combobox-chip]")].map((chip) => chip.textContent)).toEqual(["ThymeRemove Thyme"]);
    expect(input.value).toBe("");
  });

  it("shows a single pick's label in a controlled input once the list closes", async () => {
    const changes: string[] = [];
    function Herb() {
      const [text, setText] = useState("");
      return (
        <Combobox
          label="Herb"
          items={herbs.filter((herb) => herb.toLowerCase().includes(text.toLowerCase()))}
          inputValue={text}
          onInputChange={(next) => {
            changes.push(next);
            setText(next);
          }}
        />
      );
    }
    const { input } = await render(<Herb />);
    await userEvent.click(input);
    await userEvent.type(input, "thy");
    await expect.poll(options).toEqual(["Thyme"]);
    await userEvent.click(document.querySelector<HTMLElement>('[role="listbox"] [role="option"]')!);
    await expect.poll(() => input.value).toBe("Thyme");
    expect(changes.at(-1)).toBe("Thyme");
  });

  it("keeps a read-only field as it is", async () => {
    const changed = vi.fn();
    const { host } = await render(
      <>
        <Combobox label="Herbs" multiple readOnly items={herbs} defaultValue={["Basil"]} onValueChange={changed} />
        <Combobox label="Herb" readOnly items={herbs} defaultValue="Dill" onValueChange={changed} />
        <Combobox label="Cuisine" readOnly allowCustomValue items={["Thai"]} defaultValue="Thai" onValueChange={changed} />
      </>,
    );
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input[role="combobox"]')];
    expect(inputs).toHaveLength(3);
    for (const input of inputs) {
      expect(input.readOnly).toBe(true);
      // The list opens to browse, but a key or a press picks nothing.
      await userEvent.click(input);
      await expect.poll(popup).not.toBeNull();
      await userEvent.keyboard("x{ArrowDown}{Enter}");
      const option = document.querySelector<HTMLElement>('[role="listbox"] [role="option"]');
      if (option) await userEvent.click(option);
      await userEvent.keyboard("{Escape}");
      await expect.poll(popup).toBeNull();
    }
    expect(inputs.map((input) => input.value)).toEqual(["", "Dill", "Thai"]);
    expect(changed).not.toHaveBeenCalled();
    expect([...host.querySelectorAll("[data-ouro-combobox-chip]")].map((chip) => chip.textContent)).toEqual(["Basil"]);
    expect(host.querySelector("[data-ouro-combobox-chip-remove], [data-ouro-combobox-clear]")).toBeNull();
    // A chip has no role that may carry aria-readonly; the input's readonly says it.
    expect(host.querySelector("[data-ouro-combobox-chip][aria-readonly]")).toBeNull();
  });
});

describe("Combobox in a Dialog", () => {
  it("draws its list above the dialog it sits in", async () => {
    await render(
      <Dialog title="New chat" trigger={<Button>New chat</Button>}>
        <Combobox label="To" items={herbs} />
      </Dialog>,
    );
    await userEvent.click(page.getByRole("button", { name: "New chat" }));
    await expect.element(page.getByRole("dialog", { name: "New chat" })).toBeVisible();
    await userEvent.click(page.getByRole("combobox", { name: "To" }));
    await expect.poll(options).toHaveLength(herbs.length);
    const option = document.querySelector<HTMLElement>('[role="listbox"] [role="option"]')!;
    const box = option.getBoundingClientRect();
    // What is drawn at the option's middle is the option, not the dialog over it.
    await expect.poll(() => option.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))).toBe(true);
  });
});
