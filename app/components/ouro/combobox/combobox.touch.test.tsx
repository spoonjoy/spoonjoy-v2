import { useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Combobox } from "~/components/ouro/combobox/combobox";
import { act } from "~/lib/ouro/testing/act";
import { pressTint } from "~/lib/ouro/testing/press";
import { rotate } from "~/lib/ouro/testing/rotate";
import { pressTab } from "~/lib/ouro/testing/tab";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

const herbs = ["Basil", "Chives", "Dill", "Mint", "Oregano", "Parsley", "Rosemary", "Sage", "Thyme"];
const many = Array.from({ length: 40 }, (_, index) => `Spice ${index + 1}`);

let root: Root | undefined;
const nodes: Element[] = [];
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
  await rotate(390, 844);
});

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "16px";
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host;
}

const sheet = () => document.querySelector<HTMLElement>('[data-ouro="sheet"]');
const TRIGGER = "[data-ouro-combobox-trigger]";

/** Waits for the sheet's entrance to finish. */
async function opened() {
  await expect
    .poll(() => {
      const element = sheet();
      return Boolean(element && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
    })
    .toBe(true);
  return sheet()!;
}

describe("Combobox on a phone", () => {
  it("is a button in the field that opens a sheet titled with the label", async () => {
    const host = await render(<Combobox label="Herb" name="herb" items={herbs} placeholder="Pick a herb" description="For the sauce." />);
    const trigger = host.querySelector<HTMLButtonElement>(TRIGGER)!;
    expect(trigger.labels![0]!.textContent).toBe("Herb");
    expect(trigger.textContent).toContain("Pick a herb");
    expect(host.querySelector(`#${CSS.escape(trigger.getAttribute("aria-describedby")!.split(" ")[0]!)}`)!.textContent).toBe("For the sauce.");
    expect(trigger.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await commands.tap(TRIGGER);
    const panel = await opened();
    await expect.element(page.getByRole("dialog", { name: "Herb" })).toBeVisible();
    expect(panel.querySelectorAll('[role="option"]')).toHaveLength(herbs.length);
  });

  it("pins the search input at the top, with 16px text, and filters as you type", async () => {
    await render(<Combobox label="Herb" items={many} />);
    await commands.tap(TRIGGER);
    const panel = await opened();
    const input = panel.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(input.getAttribute("aria-label")).toBe("Herb");
    expect(parseFloat(getComputedStyle(input).fontSize)).toBeGreaterThanOrEqual(16);
    const search = panel.querySelector<HTMLElement>("[data-ouro-combobox-search]")!;
    expect(getComputedStyle(search).position).toBe("sticky");
    for (const option of panel.querySelectorAll<HTMLElement>('[role="option"]')) {
      expect(option.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    await commands.tap('[data-ouro="sheet"] input[role="combobox"]');
    await userEvent.type(input, "Spice 3");
    await expect
      .poll(() => [...panel.querySelectorAll('[role="option"]')].map((option) => option.textContent))
      .toEqual(["Spice 3", "Spice 30", "Spice 31", "Spice 32", "Spice 33", "Spice 34", "Spice 35", "Spice 36", "Spice 37", "Spice 38", "Spice 39"]);
  });

  it("scrolls a long list with a finger without closing the sheet", async () => {
    await render(<Combobox label="Spice" items={many} />);
    await commands.tap(TRIGGER);
    const panel = await opened();
    const body = panel.querySelector<HTMLElement>("[data-ouro-sheet-content]")!;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
    const rect = body.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    // Scroll down first, then drag back down: the list scrolls rather than the sheet moving.
    await commands.touchDrag({ from: [x, rect.bottom - 40], to: [x, rect.top + 120], steps: 12 });
    await expect.poll(() => body.scrollTop).toBeGreaterThan(100);
    await commands.touchDrag({ from: [x, rect.top + 120], to: [x, rect.top + 220], steps: 12 });
    await expect.poll(() => body.scrollTop).toBeGreaterThan(0);
    await expect.poll(() => sheet()?.hasAttribute("data-ending-style") ?? true).toBe(false);
    expect(sheet()).not.toBeNull();
  });

  it("picks an item with a tap, closes the sheet and returns focus to the button", async () => {
    const onValueChange = vi.fn();
    const host = await render(<Combobox label="Herb" name="herb" items={herbs} onValueChange={onValueChange} />);
    await commands.tap(TRIGGER);
    await opened();
    await commands.tap('[role="option"]:nth-child(3)');
    expect(onValueChange).toHaveBeenLastCalledWith("Dill");
    await expect.poll(sheet).toBeNull();
    const trigger = host.querySelector<HTMLButtonElement>(TRIGGER)!;
    expect(trigger.textContent).toContain("Dill");
    expect(document.activeElement).toBe(trigger);
    expect(host.querySelector<HTMLInputElement>('input[name="herb"]')!.value).toBe("Dill");
  });

  it("picks several with multiple, and Done closes the sheet", async () => {
    function Picker() {
      const [value, setValue] = useState<string[]>(["Basil"]);
      return <Combobox label="Herbs" multiple items={herbs} value={value} onValueChange={setValue} doneLabel="Fertig" />;
    }
    const host = await render(<Picker />);
    expect(host.querySelector(TRIGGER)!.textContent).toContain("Basil");
    await commands.tap(TRIGGER);
    await opened();
    await commands.tap('[role="option"]:nth-child(3)');
    await expect.poll(() => host.querySelector(TRIGGER)!.textContent).toContain("Basil, Dill");
    expect(sheet()).not.toBeNull();
    await userEvent.click(page.getByRole("button", { name: "Fertig" }).first());
    await expect.poll(sheet).toBeNull();
  });

  it("keeps the popup on a landscape phone, past the sm breakpoint", async () => {
    await rotate(844, 390);
    const host = await render(<Combobox label="Herb" items={herbs} />);
    expect(host.querySelector(TRIGGER)).toBeNull();
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(parseFloat(getComputedStyle(input).fontSize)).toBeGreaterThanOrEqual(16);
    expect(host.querySelector<HTMLElement>("[data-ouro-input-group]")!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });

  it("clears a single pick with a clear button beside the field, by tap or from the keyboard", async () => {
    const onValueChange = vi.fn();
    const host = await render(
      <form>
        <Combobox label="Herb" name="herb" items={herbs} defaultValue="Dill" placeholder="Pick a herb" onValueChange={onValueChange} />
      </form>,
    );
    const form = host.querySelector("form")!;
    const clear = () => host.querySelector<HTMLButtonElement>("button[data-ouro-combobox-clear]");
    expect(clear()).not.toBeNull();
    expect(clear()!.tabIndex).toBe(0);
    expect(clear()!.closest("[aria-hidden]")).toBeNull();
    // Its hit area is 44px, though the button is smaller.
    const rect = clear()!.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    expect(document.elementFromPoint(cx, cy - 21)?.closest("button")).toBe(clear());
    expect(document.elementFromPoint(cx, cy + 21)?.closest("button")).toBe(clear());
    await commands.tap("button[data-ouro-combobox-clear]");
    expect(onValueChange).toHaveBeenLastCalledWith(null);
    expect(new FormData(form).get("herb")).toBe("");
    expect(host.querySelector(TRIGGER)!.textContent).toContain("Pick a herb");
    expect(clear()).toBeNull();
    expect(document.activeElement).toBe(host.querySelector(TRIGGER));
    expect(sheet()).toBeNull();

    // From the keyboard: Tab from the field's button reaches Clear, and Enter clears.
    await commands.tap(TRIGGER);
    await opened();
    await commands.tap('[role="option"]:nth-child(2)');
    await expect.poll(sheet).toBeNull();
    expect(new FormData(form).get("herb")).toBe("Chives");
    host.querySelector<HTMLElement>(TRIGGER)!.focus();
    await pressTab();
    expect(document.activeElement).toBe(clear());
    await userEvent.keyboard("{Enter}");
    expect(new FormData(form).get("herb")).toBe("");
  });

  it("keeps the search input still while results filter and load", async () => {
    await render(<Combobox label="Spice" items={many} />);
    await commands.tap(TRIGGER);
    const panel = await opened();
    const input = panel.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    const top = input.getBoundingClientRect().top;
    await commands.tap('[data-ouro="sheet"] input[role="combobox"]');
    await userEvent.type(input, "Spice 39");
    await expect.poll(() => panel.querySelectorAll('[role="option"]').length).toBe(1);
    expect(input.getBoundingClientRect().top).toBe(top);
    await userEvent.type(input, "9");
    await expect.poll(() => panel.querySelectorAll('[role="option"]').length).toBe(0);
    expect(input.getBoundingClientRect().top).toBe(top);
  });

  it("does not say No results before a search has been typed", async () => {
    function Search() {
      const [items, setItems] = useState<string[]>([]);
      return <Combobox label="Recipe" items={items} onInputChange={(text) => setItems(text === "leek" ? ["Leek soup"] : [])} />;
    }
    await render(<Search />);
    await commands.tap(TRIGGER);
    const panel = await opened();
    expect(panel.textContent).not.toContain("No results");
    await commands.tap('[data-ouro="sheet"] input[role="combobox"]');
    await userEvent.type(panel.querySelector("input")!, "zz");
    await expect.poll(() => panel.textContent).toContain("No results");
  });

  it("uses the sheet with allowCustomValue too, with a row that keeps the typed text", async () => {
    const onValueChange = vi.fn();
    const host = await render(
      <form>
        <Combobox label="Cuisine" name="cuisine" allowCustomValue items={["Indian", "Thai"]} onValueChange={onValueChange} placeholder="Any cuisine" />
      </form>,
    );
    expect(host.querySelector(TRIGGER)!.textContent).toContain("Any cuisine");
    await commands.tap(TRIGGER);
    const panel = await opened();
    const input = panel.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await commands.tap('[data-ouro="sheet"] input[role="combobox"]');
    await userEvent.type(input, "Georgian");
    await expect.poll(() => [...panel.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual(["Use “Georgian”"]);
    await commands.tap('[role="option"]:nth-child(1)');
    expect(onValueChange).toHaveBeenLastCalledWith("Georgian");
    await expect.poll(sheet).toBeNull();
    expect(host.querySelector(TRIGGER)!.textContent).toContain("Georgian");
    expect(host.querySelector(TRIGGER)!.textContent).not.toContain("Use");
    expect(new FormData(host.querySelector("form")!).get("cuisine")).toBe("Georgian");

    // A suggestion picks as usual, and the row is not offered for text that is an item.
    await commands.tap(TRIGGER);
    await opened();
    await userEvent.clear(sheet()!.querySelector("input")!);
    await userEvent.type(sheet()!.querySelector("input")!, "Thai");
    await expect.poll(() => [...sheet()!.querySelectorAll('[role="option"]')].map((option) => option.textContent)).toEqual(["Thai"]);
    await commands.tap('[role="option"]:nth-child(1)');
    expect(onValueChange).toHaveBeenLastCalledWith("Thai");
  });

  it.each(["Italian", undefined])("keeps uncontrolled custom edits and clears across both responsive directions (%s)", async (defaultValue) => {
    await rotate(844, 390);
    const onValueChange = vi.fn();
    const host = await render(
      <form><Combobox label="Cuisine" name="cuisine" allowCustomValue defaultValue={defaultValue} items={["Italian", "Thai"]} placeholder="Any cuisine" onValueChange={onValueChange} /></form>,
    );
    const form = host.querySelector("form")!;
    await userEvent.fill(host.querySelector<HTMLInputElement>('input[role="combobox"]')!, "Sushi");
    expect(new FormData(form).get("cuisine")).toBe("Sushi");
    const changes = onValueChange.mock.calls.length;
    await rotate(390, 844);
    await expect.poll(() => host.querySelector(TRIGGER)?.textContent).toContain("Sushi");
    expect(new FormData(form).get("cuisine")).toBe("Sushi");
    await rotate(844, 390);
    await expect.poll(() => host.querySelector('input[role="combobox"]')).not.toBeNull();
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    expect(input.value).toBe("Sushi");
    expect(new FormData(form).get("cuisine")).toBe("Sushi");
    expect(onValueChange).toHaveBeenCalledTimes(changes);
    await userEvent.clear(input);
    const clears = onValueChange.mock.calls.length;
    await rotate(390, 844);
    await expect.poll(() => host.querySelector(TRIGGER)?.textContent).toContain("Any cuisine");
    expect(new FormData(form).get("cuisine")).toBe("");
    await rotate(844, 390);
    await expect.poll(() => host.querySelector('input[role="combobox"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[role="combobox"]')!.value).toBe("");
    expect(onValueChange).toHaveBeenCalledTimes(clears);
  });

  it("keeps an app-controlled custom value and emits no change solely for a responsive swap", async () => {
    const onValueChange = vi.fn();
    const host = await render(
      <form><Combobox label="Cuisine" name="cuisine" allowCustomValue value="Sushi" defaultValue="Italian" items={["Italian"]} onValueChange={onValueChange} /></form>,
    );
    expect(host.querySelector(TRIGGER)!.textContent).toContain("Sushi");
    await rotate(844, 390);
    await expect.poll(() => host.querySelector('input[role="combobox"]')).not.toBeNull();
    expect(host.querySelector<HTMLInputElement>('input[role="combobox"]')!.value).toBe("Sushi");
    expect(new FormData(host.querySelector("form")!).get("cuisine")).toBe("Sushi");
    await rotate(390, 844);
    await expect.poll(() => host.querySelector(TRIGGER)).not.toBeNull();
    expect(host.querySelector(TRIGGER)!.textContent).toContain("Sushi");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it.each([
    [false, "Italian", "Italian"],
    [true, "Italian", "Italian"],
    [false, undefined, ""],
    [true, undefined, ""],
  ] as const)("restores an uncontrolled custom default on native form reset (sheet=%s, default=%s)", async (portrait, defaultValue, expected) => {
    await rotate(portrait ? 390 : 844, portrait ? 844 : 390);
    const onValueChange = vi.fn();
    const host = await render(
      <form><Combobox label="Cuisine" name="cuisine" allowCustomValue defaultValue={defaultValue} items={["Italian"]} placeholder="Any cuisine" onValueChange={onValueChange} /></form>,
    );
    if (portrait) {
      await commands.tap(TRIGGER);
      await opened();
      await userEvent.fill(sheet()!.querySelector("input")!, "Sushi");
      await expect.poll(() => sheet()!.querySelector('[role="option"]')?.textContent).toBe("Use “Sushi”");
      await commands.tap('[role="option"]:nth-child(1)');
      await expect.poll(sheet).toBeNull();
    } else {
      await userEvent.fill(host.querySelector<HTMLInputElement>('input[role="combobox"]')!, "Sushi");
    }
    const form = host.querySelector("form")!;
    expect(new FormData(form).get("cuisine")).toBe("Sushi");
    await act(async () => form.reset());
    await expect.poll(() => new FormData(form).get("cuisine")).toBe(expected);
    if (portrait) expect(host.querySelector(TRIGGER)!.textContent).toContain(expected || "Any cuisine");
    else expect(host.querySelector<HTMLInputElement>('input[role="combobox"]')!.value).toBe(expected);
    expect(onValueChange).toHaveBeenLastCalledWith(expected);
  });

  it("resets an unnamed uncontrolled custom field without needing an onValueChange callback", async () => {
    await rotate(844, 390);
    const host = await render(<form><Combobox label="Cuisine" allowCustomValue defaultValue="Italian" items={["Italian"]} /></form>);
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await userEvent.fill(input, "Sushi");
    await act(async () => host.querySelector("form")!.reset());
    await expect.poll(() => input.value).toBe("Italian");
    await act(async () => host.querySelector("form")!.reset());
    expect(input.value).toBe("Italian");
  });

  it.each(["Sushi", "Thai"])("leaves ownership with the app when reset makes the custom field controlled (%s)", async (next) => {
    await rotate(844, 390);
    const onValueChange = vi.fn();
    function Picker() {
      const [value, setValue] = useState<string>();
      return <form onReset={() => flushSync(() => setValue(next))}>
        <Combobox label="Cuisine" name="cuisine" allowCustomValue value={value} defaultValue="Italian" items={["Italian", "Thai"]} onValueChange={onValueChange} />
      </form>;
    }
    const host = await render(<Picker />);
    await userEvent.fill(host.querySelector<HTMLInputElement>('input[role="combobox"]')!, "Sushi");
    onValueChange.mockClear();
    await act(async () => host.querySelector("form")!.reset());
    expect(host.querySelector<HTMLInputElement>('input[role="combobox"]')!.value).toBe(next);
    expect(new FormData(host.querySelector("form")!).get("cuisine")).toBe(next);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("keeps a custom selection on a prevented reset or another form's reset", async () => {
    await rotate(844, 390);
    let prevent = true;
    const host = await render(<form onReset={(event) => { if (prevent) event.preventDefault(); }}>
      <Combobox label="Cuisine" name="cuisine" allowCustomValue defaultValue="Italian" items={["Italian"]} />
    </form>);
    const input = host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await userEvent.fill(input, "Sushi");
    await act(async () => host.querySelector("form")!.reset());
    expect(input.value).toBe("Sushi");
    prevent = false;
    const other = document.createElement("form");
    host.querySelector("form")!.append(other);
    await act(async () => other.reset());
    expect(input.value).toBe("Sushi");
  });

  it("does not reset a custom input that unmounts during reset", async () => {
    await rotate(844, 390);
    function Picker() {
      const [shown, setShown] = useState(true);
      return <form onReset={() => flushSync(() => setShown(false))}>
        {shown && <Combobox label="Cuisine" name="cuisine" allowCustomValue defaultValue="Italian" items={["Italian"]} />}
      </form>;
    }
    const host = await render(<Picker />);
    await userEvent.fill(host.querySelector<HTMLInputElement>('input[role="combobox"]')!, "Sushi");
    await act(async () => host.querySelector("form")!.reset());
    expect(host.querySelector('input[role="combobox"]')).toBeNull();
  });

  it("clears typed text to an empty string with allowCustomValue", async () => {
    const onValueChange = vi.fn();
    function Cuisine() {
      const [value, setValue] = useState("");
      return (
        <Combobox
          label="Cuisine"
          allowCustomValue
          items={["Thai"]}
          value={value}
          placeholder="Any cuisine"
          onValueChange={(next) => {
            onValueChange(next);
            setValue(next);
          }}
        />
      );
    }
    const host = await render(<Cuisine />);
    expect(host.querySelector("button[data-ouro-combobox-clear]")).toBeNull();
    await commands.tap(TRIGGER);
    const panel = await opened();
    await commands.tap('[data-ouro="sheet"] input[role="combobox"]');
    await userEvent.type(panel.querySelector("input")!, "Georgian");
    await commands.tap('[role="option"]:nth-child(1)');
    await expect.poll(sheet).toBeNull();
    expect(host.querySelector(TRIGGER)!.textContent).toContain("Georgian");
    await commands.tap("button[data-ouro-combobox-clear]");
    expect(onValueChange).toHaveBeenLastCalledWith("");
    expect(host.querySelector(TRIGGER)!.textContent).toContain("Any cuisine");
  });

  it("submits the same text with allowCustomValue on a phone sheet as in the popup, for object items", async () => {
    const cuisines = [
      { value: "it", label: "Italian" },
      { value: "th", label: "Thai" },
    ];
    /** Picks Thai, then types Georgian, and returns the form values after each. */
    async function run(layout: "popup" | "sheet") {
      await rotate(layout === "popup" ? 844 : 390, layout === "popup" ? 390 : 844);
      const onValueChange = vi.fn();
      const host = await render(
        <form>
          <Combobox label="Cuisine" name="cuisine" allowCustomValue items={cuisines} onValueChange={onValueChange} />
        </form>,
      );
      const form = host.querySelector("form")!;
      const field = () =>
        layout === "sheet" ? sheet()!.querySelector<HTMLInputElement>('input[role="combobox"]')! : host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
      const openAndType = async (text: string) => {
        if (layout === "sheet") {
          await commands.tap(TRIGGER);
          await opened();
          await commands.tap('[data-ouro="sheet"] input[role="combobox"]');
        } else {
          await commands.tap('input[role="combobox"]');
        }
        await userEvent.clear(field());
        await userEvent.type(field(), text);
      };
      await openAndType("Tha");
      await expect.poll(() => document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
      await userEvent.click(page.getByRole("option", { name: "Thai" }));
      await expect.poll(sheet).toBeNull();
      const picked = [new FormData(form).get("cuisine"), onValueChange.mock.lastCall?.[0]];
      await openAndType("Georgian");
      if (layout === "sheet") {
        await commands.tap('[role="option"]:nth-child(1)');
        await expect.poll(sheet).toBeNull();
      } else {
        field().blur();
      }
      const typed = [new FormData(form).get("cuisine"), onValueChange.mock.lastCall?.[0]];
      await act(async () => root?.unmount());
      root = undefined;
      return { picked, typed };
    }
    const popup = await run("popup");
    const phone = await run("sheet");
    expect(popup).toEqual({ picked: ["Thai", "Thai"], typed: ["Georgian", "Georgian"] });
    expect(phone).toEqual(popup);
  });

  it("translates the row that keeps the typed text", async () => {
    await render(<Combobox label="Küche" allowCustomValue items={[]} customValueLabel={(text) => `„${text}“ verwenden`} />);
    await commands.tap(TRIGGER);
    const panel = await opened();
    await commands.tap('[data-ouro="sheet"] input[role="combobox"]');
    await userEvent.type(panel.querySelector("input")!, "Thai");
    await expect.poll(() => panel.querySelector('[role="option"]')?.textContent).toBe("„Thai“ verwenden");
  });

  it("gives chip remove buttons a 44px hit area", async () => {
    await rotate(844, 390);
    const host = await render(<Combobox label="Herbs" multiple items={herbs} defaultValue={["Basil"]} />);
    const remove = host.querySelector<HTMLElement>("button[data-ouro-combobox-chip-remove]")!;
    const rect = remove.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    expect(document.elementFromPoint(cx, cy - 21)?.closest("button")).toBe(remove);
    expect(document.elementFromPoint(cx, cy + 21)?.closest("button")).toBe(remove);
  });
});

describe("Combobox server error on a phone", () => {
  it("marks the sheet's trigger invalid and keeps the form submittable", async () => {
    let sent: FormData | null = null;
    const host = await render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          sent = new FormData(event.currentTarget);
        }}
      >
        <Combobox label="Herb" name="herb" items={herbs} error="Pick a herb." defaultValue="Dill" />
      </form>,
    );
    expect(host.querySelector(TRIGGER)!.getAttribute("aria-invalid")).toBe("true");
    await act(async () => host.querySelector("form")!.requestSubmit());
    expect(sent!.get("herb")).toBe("Dill");
  });
});

describe("Combobox pressed on a phone", () => {
  it("tints the field's button on pointer-down", async () => {
    const host = await render(<Combobox label="Herb" items={herbs} />);
    const { rest, pressed, active } = await pressTint(host.querySelector<HTMLElement>(TRIGGER)!);
    expect(active).toBe(true);
    expect(pressed).not.toBe(rest);
  });

  it("tints an item in the sheet on pointer-down, from the press alone", async () => {
    await render(<Combobox label="Herb" items={herbs} />);
    await commands.tap(TRIGGER);
    const panel = await opened();
    const item = [...panel.querySelectorAll<HTMLElement>('[role="option"]')][2]!;
    const { rest, pressed, active } = await pressTint(item, { clearHighlight: true });
    expect(active).toBe(true);
    expect(pressed).not.toBe(rest);
  });

  it("does not tint a disabled item", async () => {
    await render(<Combobox label="Herb" items={[{ value: "a", label: "Basil" }, { value: "b", label: "Dill", disabled: true }]} />);
    await commands.tap(TRIGGER);
    const panel = await opened();
    const item = [...panel.querySelectorAll<HTMLElement>('[role="option"]')][1]!;
    const rest = getComputedStyle(item).backgroundColor;
    item.setAttribute("data-press-target", "");
    await commands.pointerPress({ selector: "[data-press-target]", action: "down" });
    try {
      await expect.poll(() => item.matches(":active")).toBe(true);
      item.removeAttribute("data-highlighted");
      expect(getComputedStyle(item).backgroundColor).toBe(rest);
    } finally {
      await commands.pointerPress({ selector: "[data-press-target]", action: "up" });
    }
  });

  it("tints a chip's remove button on pointer-down in the wide layout, where hover is off for a finger", async () => {
    await rotate(844, 390);
    const host = await render(<Combobox label="Herbs" multiple items={herbs} defaultValue={["Basil"]} />);
    const { rest, pressed, active } = await pressTint(host.querySelector<HTMLElement>("[data-ouro-combobox-chip-remove]")!);
    expect(active).toBe(true);
    expect(pressed).not.toBe(rest);
  });
});
