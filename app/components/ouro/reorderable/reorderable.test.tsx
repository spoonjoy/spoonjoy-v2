import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, server, userEvent } from "vitest/browser";
import { Reorderable, type ReorderableProps } from "~/components/ouro/reorderable/reorderable";
import { dropIndex, edgeSpeed, EDGE, MAX_SPEED, moveItem, scrollParent } from "~/components/ouro/reorderable/reorderable-styles";
import { rubberband } from "~/lib/ouro/spring";
import { act } from "~/lib/ouro/testing/act";
import { holdFrames, type HeldFrames } from "~/lib/ouro/testing/frames";
import { pressTab } from "~/lib/ouro/testing/tab";

// Touch drags are in reorderable.touch.test.tsx. Here the keyboard runs in Chromium and
// WebKit, pointer events are dispatched so both run the drag paths, and a real mouse
// drag runs in Chromium.

const chromiumOnly = it.skipIf(server.browser !== "chromium");

let root: Root | undefined;
let host: HTMLElement;
const nodes: Element[] = [];

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  error = vi.spyOn(console, "error");
});
/** Animation frames, when a test holds them still to look at a spring mid-flight. */
let frames: HeldFrames | undefined;
const freeze = () => (frames ??= holdFrames());
afterEach(async () => {
  frames?.release();
  frames = undefined;
  await commands.pointerPress({ action: "up" });
  await act(async () => root?.unmount());
  root = undefined;
  for (const node of nodes.splice(0)) node.remove();
  scrollTo(0, 0);
  expect(error).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

async function render(node: ReactNode) {
  if (!root) {
    host = document.createElement("div");
    host.style.width = "360px";
    document.body.append(host);
    nodes.push(host);
    root = createRoot(host);
  }
  await act(async () => root!.render(node));
  return host.querySelector<HTMLElement>("[data-ouro-reorderable-list]")!;
}

const names = ["Sear", "Soften", "Deglaze", "Braise"];
const steps = (list = names) => list.map((name) => ({ id: name.toLowerCase(), label: name, content: <div style={{ height: 48 }}>{name}</div> }));

function list(props: Partial<ReorderableProps> = {}) {
  return <Reorderable label="Steps" items={steps()} {...props} />;
}

const rows = (element: HTMLElement) => [...element.children] as HTMLElement[];
const order = (element: HTMLElement) => rows(element).map((row) => row.querySelector("[data-ouro-reorderable-content]")!.textContent);
const handle = (name: string) => page.getByRole("button", { name: `Reorder ${name}`, exact: true }).element() as HTMLButtonElement;
const said = () => document.querySelector("[data-ouro-announcer]")?.textContent ?? "";
const instructions = "Press Enter for a menu of moves. Press Space to pick up, then use the arrow keys to move, Space to drop, and Escape to cancel.";
/** The items of the open menu of moves, by name, and whether each can be chosen. */
const moves = () =>
  Object.fromEntries(
    [...document.querySelectorAll('[role="menuitem"]:not([data-ouro-menu-close])')].map((item) => [item.textContent, !item.hasAttribute("data-disabled")]),
  );
const move = (name: string) => page.getByRole("menuitem", { name, exact: true });
const menuOpen = () => expect.element(page.getByRole("menu")).toBeVisible();
const menuClosed = () => expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();

/** Focuses a handle the way the keyboard does. */
async function focus(name: string) {
  await act(async () => handle(name).focus());
}

async function press(keys: string) {
  await userEvent.keyboard(keys);
  await act(async () => {});
}

function middle(element: Element): [number, number] {
  const rect = element.getBoundingClientRect();
  return [rect.left + rect.width / 2, rect.top + rect.height / 2];
}

/** The time the next dispatched event carries, in ms. */
let clock = 1000;
/** Lets `ms` pass before the next event: 16 is a pointer still moving, 300 one that has rested. */
const wait = (ms: number) => {
  clock += ms;
};

/** Dispatches one pointer event, as the primary mouse button unless `init` says otherwise, and flushes React. */
async function pointer(target: EventTarget, type: string, x: number, y: number, init: PointerEventInit = {}) {
  let event!: PointerEvent;
  await act(async () => {
    // While the pointer is down its button is held, as a real mouse's is.
    const buttons = type === "pointerdown" || type === "pointermove" ? 1 : 0;
    event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons, clientX: x, clientY: y, ...init });
    Object.defineProperty(event, "timeStamp", { value: clock });
    target.dispatchEvent(event);
  });
  return event;
}

/** Presses a handle and moves the pointer `dy` px in four steps 16ms apart, then lets it rest, still down. */
async function dragBy(name: string, dy: number) {
  const [x, y] = middle(handle(name));
  wait(1000);
  await pointer(handle(name), "pointerdown", x, y);
  for (let step = 1; step <= 4; step++) {
    wait(16);
    await pointer(window, "pointermove", x, y + (dy * step) / 4);
  }
  wait(300);
  return [x, y + dy] as const;
}

/** How far a row is from its place, in px, to a hundredth. */
const shifted = (row: HTMLElement) => Math.round(Number.parseFloat(/translateY\((.+)px\)/.exec(row.style.transform)?.[1] ?? "0") * 100) / 100;
/** Brings every spring to rest: steps the frames a test holds and gives them back, or waits for real ones. */
const rest = async (element: HTMLElement) => {
  if (!frames) return expect.poll(() => element.hasAttribute("data-ouro-settling")).toBe(false);
  frames.until(() => !element.hasAttribute("data-ouro-settling"));
  frames.release();
  frames = undefined;
};

describe("Reorderable", () => {
  it("renders a named list of rows, each with a handle that says how to use it", async () => {
    const element = await render(list());
    expect(element.tagName).toBe("OL");
    expect(page.getByRole("list", { name: "Steps" }).element()).toBe(element);
    expect(page.getByRole("listitem").elements().length).toBe(4);
    expect(order(element)).toEqual(names);
    const grip = handle("Soften");
    expect(grip.hasAttribute("data-grabbed")).toBe(false);
    expect(grip.getAttribute("type")).toBe("button");
    const described = document.getElementById(grip.getAttribute("aria-describedby")!)!;
    expect(described.textContent).toBe(instructions);
    expect(described.hidden).toBe(true);
    await expect.element(page.getByRole("button", { name: "Reorder Soften" })).toHaveAccessibleDescription(described.textContent!);
    expect(element.closest('[data-ouro="reorderable"]')).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("shows a row's label when it has no content", async () => {
    const element = await render(<Reorderable label="Tags" items={[{ id: "a", label: "Vegetarian" }, { id: "b", label: "Quick" }]} />);
    expect(order(element)).toEqual(["Vegetarian", "Quick"]);
  });

  describe("from the keyboard", () => {
    it("picks a row up with Space, moves it with the arrows, drops it with Space, and announces each step with its position", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      await focus("Sear");
      await press(" ");
      expect(handle("Sear").hasAttribute("data-grabbed")).toBe(true);
      expect(rows(element)[0]!.hasAttribute("data-grabbed")).toBe(true);
      await expect.poll(said).toBe("Sear picked up. Position 1 of 4.");
      // The handle is a menu button, never also a toggle: what it holds is in its description.
      expect(handle("Sear").getAttribute("aria-haspopup")).toBe("menu");
      expect(handle("Sear").hasAttribute("aria-pressed")).toBe(false);
      await expect.element(page.getByRole("button", { name: "Reorder Sear" })).toHaveAccessibleDescription("Picked up. Use the arrow keys to move, Space to drop, and Escape to cancel.");
      await expect.element(page.getByRole("button", { name: "Reorder Soften" })).toHaveAccessibleDescription(instructions);

      // A move from the keyboard does not animate: every row is in its place at once.
      const still = () => {
        expect(element.hasAttribute("data-ouro-settling")).toBe(false);
        for (const row of rows(element)) {
          expect(row.style.transform).toBe("");
          expect(row.getAnimations().length).toBe(0);
        }
      };
      await press("{ArrowDown}");
      expect(order(element)).toEqual(["Soften", "Sear", "Deglaze", "Braise"]);
      still();
      // Focus stays on the handle although its row moved in the page.
      expect(document.activeElement).toBe(handle("Sear"));
      expect(handle("Sear").hasAttribute("data-grabbed")).toBe(true);
      await expect.poll(said).toBe("Sear moved. Position 2 of 4.");

      await press("{ArrowDown}");
      await expect.poll(said).toBe("Sear moved. Position 3 of 4.");
      await press("{ArrowUp}");
      expect(order(element)).toEqual(["Soften", "Sear", "Deglaze", "Braise"]);
      expect(document.activeElement).toBe(handle("Sear"));
      await expect.poll(said).toBe("Sear moved. Position 2 of 4.");
      expect(onReorder).not.toHaveBeenCalled();

      await press(" ");
      expect(handle("Sear").hasAttribute("data-grabbed")).toBe(false);
      expect(rows(element)[1]!.hasAttribute("data-grabbed")).toBe(false);
      expect(handle("Sear").hasAttribute("aria-pressed")).toBe(false);
      await expect.element(page.getByRole("button", { name: "Reorder Sear" })).toHaveAccessibleDescription(instructions);
      await expect.poll(said).toBe("Sear dropped. Position 2 of 4.");
      still();
      expect(onReorder.mock.calls).toEqual([[["soften", "sear", "deglaze", "braise"], { id: "sear", from: 0, to: 1 }]]);
      expect(document.activeElement).toBe(handle("Sear"));
      // Dropped, the arrows are the page's again.
      await press("{ArrowDown}");
      expect(order(element)).toEqual(["Soften", "Sear", "Deglaze", "Braise"]);
    });

    it("says the position again at either end instead of moving", async () => {
      const element = await render(list());
      await focus("Sear");
      await press(" ");
      await expect.poll(said).toBe("Sear picked up. Position 1 of 4.");
      await press("{ArrowUp}");
      await expect.poll(said).toBe("Sear moved. Position 1 of 4.");
      expect(order(element)).toEqual(names);
      await press("{ArrowDown}{ArrowDown}{ArrowDown}");
      await expect.poll(said).toBe("Sear moved. Position 4 of 4.");
      await press("{ArrowDown}");
      expect(order(element)).toEqual(["Soften", "Deglaze", "Braise", "Sear"]);
      expect(document.activeElement).toBe(handle("Sear"));
    });

    it("puts the row back on Escape, announces it and reports nothing", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      const escapes: boolean[] = [];
      const listener = (event: KeyboardEvent) => {
        if (event.key === "Escape") escapes.push(event.defaultPrevented);
      };
      document.addEventListener("keydown", listener);
      await focus("Braise");
      await press(" ");
      await press("{ArrowUp}{ArrowUp}");
      expect(order(element)).toEqual(["Sear", "Braise", "Soften", "Deglaze"]);
      await press("{Escape}");
      expect(order(element)).toEqual(names);
      expect(handle("Braise").hasAttribute("data-grabbed")).toBe(false);
      expect(document.activeElement).toBe(handle("Braise"));
      await expect.poll(said).toBe("Braise put back. Position 4 of 4.");
      expect(onReorder).not.toHaveBeenCalled();
      // That Escape stopped at the list. With nothing picked up, Escape is the page's.
      expect(escapes).toEqual([]);
      await press("{Escape}");
      document.removeEventListener("keydown", listener);
      expect(escapes).toEqual([false]);
    });

    it("drops a row in place without reporting when it did not move", async () => {
      const onReorder = vi.fn();
      await render(list({ onReorder }));
      await focus("Soften");
      await press(" ");
      await press("{ArrowDown}{ArrowUp}");
      await press(" ");
      await expect.poll(said).toBe("Soften dropped. Position 2 of 4.");
      expect(onReorder).not.toHaveBeenCalled();
    });

    it("drops the row where it is when focus moves away", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      await focus("Sear");
      await press(" ");
      await press("{ArrowDown}");
      await pressTab();
      expect(document.activeElement).not.toBe(handle("Sear"));
      expect(handle("Sear").hasAttribute("data-grabbed")).toBe(false);
      expect(order(element)).toEqual(["Soften", "Sear", "Deglaze", "Braise"]);
      expect(onReorder.mock.calls).toEqual([[["soften", "sear", "deglaze", "braise"], { id: "sear", from: 0, to: 1 }]]);
      await expect.poll(said).toBe("Sear dropped. Position 2 of 4.");
      // A handle that holds nothing ignores losing focus.
      await focus("Braise");
      await pressTab();
      expect(onReorder).toHaveBeenCalledTimes(1);
    });

    it("opens the menu of moves on an arrow key, and moves the row with one only once it is picked up", async () => {
      const element = await render(list());
      const soften = handle("Soften");
      await focus("Soften");
      await press("{ArrowDown}");
      // As on any menu button: the menu, and nothing has moved.
      await expect.poll(() => document.querySelector('[role="menu"]')).not.toBeNull();
      expect(order(element)).toEqual(names);
      await press("{Escape}");
      await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
      await act(async () => soften.focus());
      await press(" ");
      const held = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
      const other = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
      await act(async () => {
        handle("Soften").dispatchEvent(other);
        handle("Soften").dispatchEvent(held);
      });
      expect(other.defaultPrevented).toBe(false);
      expect(held.defaultPrevented).toBe(true);
      expect(order(element)).toEqual(["Sear", "Deglaze", "Soften", "Braise"]);
    });

    it("keeps the new order on its own, and follows items when they arrive in another order", async () => {
      const element = await render(list());
      await focus("Sear");
      await press(" ");
      await press("{ArrowDown}");
      await press(" ");
      // The app did not change `items`: the list still shows what the user did.
      await render(list({ className: "mt-2" }));
      expect(order(element)).toEqual(["Soften", "Sear", "Deglaze", "Braise"]);
      await render(<Reorderable label="Steps" items={steps(["Braise", "Sear", "Soften"])} />);
      expect(order(element)).toEqual(["Braise", "Sear", "Soften"]);
    });

    it("lets go of a picked-up row when the app replaces the rows", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      await focus("Sear");
      await press(" ");
      await press("{ArrowDown}");
      await render(<Reorderable label="Steps" items={steps(["Braise", "Sear"])} onReorder={onReorder} />);
      expect(order(element)).toEqual(["Braise", "Sear"]);
      expect(handle("Sear").hasAttribute("data-grabbed")).toBe(false);
      await press("{ArrowUp}");
      expect(order(element)).toEqual(["Braise", "Sear"]);
      expect(onReorder).not.toHaveBeenCalled();
    });

    it("speaks and names with the labels the app passes", async () => {
      await render(
        list({
          handleLabel: "Déplacer {label}",
          instructionsLabel: "Espace pour saisir.",
          heldLabel: "Saisi.",
          pickedUpLabel: "{label} saisi, {n} sur {total}",
          movedLabel: "{label} déplacé, {n} sur {total}",
          droppedLabel: "{label} déposé, {n} sur {total}",
          canceledLabel: "{label} remis, {n} sur {total}",
          moveUpLabel: "Monter",
          moveDownLabel: "Descendre",
          moveToTopLabel: "Tout en haut",
          moveToBottomLabel: "Tout en bas",
          closeLabel: "Fermer",
        }),
      );
      const grip = page.getByRole("button", { name: "Déplacer Sear" });
      await expect.element(grip).toHaveAccessibleDescription("Espace pour saisir.");
      await act(async () => (grip.element() as HTMLElement).focus());
      await press(" ");
      await expect.poll(said).toBe("Sear saisi, 1 sur 4");
      await expect.element(grip).toHaveAccessibleDescription("Saisi.");
      await press("{ArrowDown}");
      await expect.poll(said).toBe("Sear déplacé, 2 sur 4");
      await press("{Escape}");
      await expect.poll(said).toBe("Sear remis, 1 sur 4");
      await press(" ");
      await press(" ");
      await expect.poll(said).toBe("Sear déposé, 1 sur 4");
      await press("{Enter}");
      await expect.poll(() => Object.keys(moves())).toEqual(["Monter", "Descendre", "Tout en haut", "Tout en bas"]);
      await expect.poll(() => document.querySelector("[data-ouro-menu-close]")?.textContent ?? "Fermer").toBe("Fermer");
      await userEvent.click(move("Descendre"));
      await expect.poll(said).toBe("Sear déplacé, 2 sur 4");
    });
  });

  describe("from the handle's menu, with no drag", () => {
    it("opens a menu of moves on a click of the handle; a move is done at once, announced and reported", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      const grip = handle("Soften");
      expect(grip.getAttribute("aria-haspopup")).toBe("menu");
      expect(grip.getAttribute("aria-expanded")).toBe("false");
      await userEvent.click(grip);
      await menuOpen();
      expect(grip.getAttribute("aria-expanded")).toBe("true");
      // The click picked nothing up.
      expect(grip.hasAttribute("data-grabbed")).toBe(false);
      expect(moves()).toEqual({ "Move up": true, "Move down": true, "Move to top": true, "Move to bottom": true });
      await userEvent.click(move("Move down"));
      expect(order(element)).toEqual(["Sear", "Deglaze", "Soften", "Braise"]);
      await expect.poll(said).toBe("Soften moved. Position 3 of 4.");
      expect(onReorder.mock.calls).toEqual([[["sear", "deglaze", "soften", "braise"], { id: "soften", from: 1, to: 2 }]]);
      await menuClosed();
      // Focus is back on the handle, although its row moved in the page.
      await expect.poll(() => document.activeElement).toBe(grip);
      // The move does not animate: every row is in its place at once.
      for (const row of rows(element)) expect(row.style.transform).toBe("");
      expect(element.hasAttribute("data-ouro-settling")).toBe(false);
    });

    it("moves a row to the top and to the bottom, and disables the moves that cannot apply", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      const grip = handle("Sear");
      await userEvent.click(grip);
      await menuOpen();
      // The first row cannot go up.
      expect(moves()).toEqual({ "Move up": false, "Move down": true, "Move to top": false, "Move to bottom": true });
      await userEvent.click(move("Move to bottom"));
      expect(order(element)).toEqual(["Soften", "Deglaze", "Braise", "Sear"]);
      await expect.poll(said).toBe("Sear moved. Position 4 of 4.");
      await menuClosed();
      await userEvent.click(grip);
      await menuOpen();
      // Now last, it cannot go down.
      expect(moves()).toEqual({ "Move up": true, "Move down": false, "Move to top": true, "Move to bottom": false });
      await userEvent.click(move("Move up"));
      expect(order(element)).toEqual(["Soften", "Deglaze", "Sear", "Braise"]);
      await expect.poll(said).toBe("Sear moved. Position 3 of 4.");
      await menuClosed();
      await userEvent.click(grip);
      await menuOpen();
      await userEvent.click(move("Move to top"));
      expect(order(element)).toEqual(["Sear", "Soften", "Deglaze", "Braise"]);
      await expect.poll(said).toBe("Sear moved. Position 1 of 4.");
      expect(onReorder.mock.calls.map(([, moved]) => moved)).toEqual([
        { id: "sear", from: 0, to: 3 },
        { id: "sear", from: 3, to: 2 },
        { id: "sear", from: 2, to: 0 },
      ]);
    });

    it("opens the menu on Enter, and the keyboard chooses a move from it", async () => {
      const element = await render(list());
      const grip = handle("Deglaze");
      await focus("Deglaze");
      await press("{Enter}");
      await menuOpen();
      expect(grip.hasAttribute("data-grabbed")).toBe(false);
      // Focus moves into the menu; the arrow keys walk its items and Enter chooses one.
      await expect.poll(() => document.activeElement?.closest('[role="menu"]') ?? null).not.toBeNull();
      await expect
        .poll(async () => {
          if (document.activeElement?.textContent !== "Move up") await userEvent.keyboard("{ArrowDown}");
          return document.activeElement?.textContent;
        })
        .toBe("Move up");
      await press("{Enter}");
      expect(order(element)).toEqual(["Sear", "Deglaze", "Soften", "Braise"]);
      await expect.poll(said).toBe("Deglaze moved. Position 2 of 4.");
      await menuClosed();
      await expect.poll(() => document.activeElement).toBe(grip);
      // Escape closes the menu and moves nothing.
      await press("{Enter}");
      await menuOpen();
      await press("{Escape}");
      await menuClosed();
      expect(order(element)).toEqual(["Sear", "Deglaze", "Soften", "Braise"]);
    });

    it("opens the menu on a screen reader's activation, a click with no pointer and no key", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      await act(async () => handle("Braise").click());
      await menuOpen();
      expect(moves()).toEqual({ "Move up": true, "Move down": false, "Move to top": true, "Move to bottom": false });
      // A screen reader activates the item the same way.
      await act(async () => (move("Move to top").element() as HTMLElement).click());
      expect(order(element)).toEqual(["Braise", "Sear", "Soften", "Deglaze"]);
      await expect.poll(said).toBe("Braise moved. Position 1 of 4.");
      expect(onReorder.mock.calls).toEqual([[["braise", "sear", "soften", "deglaze"], { id: "braise", from: 3, to: 0 }]]);
      await menuClosed();
      // Activated again while its menu is open, the handle closes it.
      const grip = handle("Sear");
      await act(async () => grip.click());
      await menuOpen();
      await act(async () => grip.click());
      await menuClosed();
      expect(grip.getAttribute("aria-expanded")).toBe("false");
    });

    it("keeps Space for picking up: it opens no menu, held down it does nothing more, and any activation drops the row", async () => {
      const element = await render(list());
      await focus("Sear");
      await press(" ");
      expect(handle("Sear").hasAttribute("data-grabbed")).toBe(true);
      expect(handle("Sear").getAttribute("aria-expanded")).toBe("false");
      expect(document.querySelector('[role="menu"]')).toBeNull();
      // A key held down repeats: the row is not dropped and picked up again.
      const repeat = new KeyboardEvent("keydown", { key: " ", repeat: true, bubbles: true, cancelable: true });
      await act(async () => {
        handle("Sear").dispatchEvent(repeat);
      });
      expect(repeat.defaultPrevented).toBe(true);
      expect(handle("Sear").hasAttribute("data-grabbed")).toBe(true);
      await press("{ArrowDown}");
      // Enter, or a screen reader's activation, drops a row that is picked up; it does not open the menu over it.
      await press("{Enter}");
      expect(handle("Sear").hasAttribute("data-grabbed")).toBe(false);
      await expect.poll(said).toBe("Sear dropped. Position 2 of 4.");
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(order(element)).toEqual(["Soften", "Sear", "Deglaze", "Braise"]);
    });

    it("closes the menu when a drag starts on the handle, and when the app replaces the rows", async () => {
      const element = await render(list());
      const grip = handle("Sear");
      await act(async () => grip.click());
      await menuOpen();
      const [x, y] = middle(grip);
      wait(1000);
      await pointer(grip, "pointerdown", x, y);
      wait(16);
      await pointer(window, "pointermove", x, y + 30);
      expect(element.hasAttribute("data-dragging")).toBe(true);
      await menuClosed();
      wait(300);
      await pointer(window, "pointerup", x, y + 30);
      await rest(element);
      // The pointer's click that ends the drag is not an activation; a press that does not move is.
      await act(async () => {
        grip.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      });
      expect(document.querySelector('[role="menu"]')).toBeNull();
      await pointer(grip, "pointerdown", x, y);
      await pointer(window, "pointerup", x, y);
      await act(async () => {
        grip.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      });
      await menuOpen();
      await render(<Reorderable label="Steps" items={steps(["Braise", "Sear"])} />);
      await menuClosed();
      expect(grip.getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("with a pointer", () => {
    it("moves the row with the pointer, makes room in the rows it passes, and reports the drop once", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      const [first, second, third] = rows(element) as [HTMLElement, HTMLElement, HTMLElement];
      const height = first.getBoundingClientRect().height;
      const down = await pointer(handle("Sear"), "pointerdown", ...middle(handle("Sear")));
      // The press selects no text and starts no native drag.
      expect(down.defaultPrevented).toBe(true);
      const [x, y] = middle(handle("Sear"));
      await pointer(window, "pointermove", x, y + 2);
      expect(element.hasAttribute("data-dragging")).toBe(false);
      const far = Math.round(height * 2.2);
      const near = Math.round(height * 1.1);
      await pointer(window, "pointermove", x, y + far);
      expect(element.hasAttribute("data-dragging")).toBe(true);
      expect(first.hasAttribute("data-dragging")).toBe(true);
      expect(first.style.transform).toBe(`translateY(${far}px)`);
      expect(second.style.transform).toBe(`translateY(${-height}px)`);
      expect(third.style.transform).toBe(`translateY(${-height}px)`);
      expect(getComputedStyle(first).zIndex).toBe("10");
      // Back up past the third row: only the second still makes room.
      await pointer(window, "pointermove", x, y + near);
      expect(second.style.transform).toBe(`translateY(${-height}px)`);
      expect(third.style.transform).toBe("");
      expect(onReorder).not.toHaveBeenCalled();
      wait(300);
      freeze();
      await pointer(window, "pointerup", x, y + near);
      expect(order(element)).toEqual(["Soften", "Sear", "Deglaze", "Braise"]);
      expect(onReorder.mock.calls).toEqual([[["soften", "sear", "deglaze", "braise"], { id: "sear", from: 0, to: 1 }]]);
      expect(element.hasAttribute("data-dragging")).toBe(false);
      // The dropped row is in its new place in the list, and starts where it was on screen:
      // it was 1.1 rows down from the first place, so it is 0.1 of a row below the second.
      expect(shifted(first)).toBe(near - height);
      expect(first.hasAttribute("data-ouro-settling")).toBe(true);
      expect(first.hasAttribute("data-dropped")).toBe(true);
      expect(getComputedStyle(first).zIndex).toBe("10");
      await rest(element);
      for (const row of rows(element)) {
        expect(row.style.transform).toBe("");
        expect(row.hasAttribute("data-ouro-settling")).toBe(false);
        expect(row.hasAttribute("data-dropped")).toBe(false);
      }
      await expect.poll(said).toBe("Sear dropped. Position 2 of 4.");
    });

    it("moves a row up, shifting the rows above it down, and resists past either end of the list", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      const all = rows(element);
      const height = all[0]!.getBoundingClientRect().height;
      const up = Math.round(height * 2.2);
      const [x, y] = await dragBy("Braise", -up);
      expect(all[3]!.style.transform).toBe(`translateY(${-up}px)`);
      expect(all[1]!.style.transform).toBe(`translateY(${height}px)`);
      expect(all[2]!.style.transform).toBe(`translateY(${height}px)`);
      expect(all[0]!.style.transform).toBe("");
      // Far above the list the row resists past the first place, and far below past the last:
      // it gives a part of the distance, never all of it and never none.
      const span = element.getBoundingClientRect().height;
      await pointer(window, "pointermove", x, y - 2000);
      expect(shifted(all[3]!)).toBeCloseTo(-height * 3 + rubberband(-(up + 2000 - height * 3), span), 1);
      expect(shifted(all[3]!)).toBeLessThan(-height * 3);
      expect(shifted(all[3]!)).toBeGreaterThan(-height * 3 - span);
      await pointer(window, "pointermove", x, y + 4000);
      expect(shifted(all[3]!)).toBeCloseTo(rubberband(4000 - up, span), 1);
      expect(shifted(all[3]!)).toBeGreaterThan(0);
      await pointer(window, "pointermove", x, y - 2000);
      wait(300);
      await pointer(window, "pointerup", x, y - 2000);
      expect(order(element)).toEqual(["Braise", "Sear", "Soften", "Deglaze"]);
      expect(onReorder.mock.calls).toEqual([[["braise", "sear", "soften", "deglaze"], { id: "braise", from: 3, to: 0 }]]);
    });

    it("reports nothing for a press that does not move, or a drag dropped where it began", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      const [x, y] = middle(handle("Soften"));
      await pointer(handle("Soften"), "pointerdown", x, y);
      await pointer(window, "pointerup", x, y);
      expect(handle("Soften").hasAttribute("data-grabbed")).toBe(false);
      const before = said();
      await dragBy("Soften", 10);
      await pointer(window, "pointerup", x, y + 10);
      expect(order(element)).toEqual(names);
      expect(onReorder).not.toHaveBeenCalled();
      await expect.poll(said).toBe("Soften dropped. Position 2 of 4.");
      expect(before).not.toBe("Soften dropped. Position 2 of 4.");
    });

    it("puts the row back when the browser cancels the drag or the user presses Escape", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      const [x, y] = await dragBy("Sear", 120);
      freeze();
      await pointer(window, "pointercancel", x, y);
      expect(order(element)).toEqual(names);
      expect(element.hasAttribute("data-dragging")).toBe(false);
      // It springs back from where it was let go.
      expect(shifted(rows(element)[0]!)).toBe(120);
      await rest(element);
      for (const row of rows(element)) expect(row.style.transform).toBe("");
      await expect.poll(said).toBe("Sear put back. Position 1 of 4.");

      await dragBy("Deglaze", -120);
      const seen: boolean[] = [];
      const listener = (event: KeyboardEvent) => seen.push(event.defaultPrevented);
      document.addEventListener("keydown", listener);
      await press("a");
      expect(element.hasAttribute("data-dragging")).toBe(true);
      await press("{Escape}");
      document.removeEventListener("keydown", listener);
      // The Escape that cancelled the drag stopped there.
      expect(seen).toEqual([false]);
      expect(order(element)).toEqual(names);
      expect(element.hasAttribute("data-dragging")).toBe(false);
      await expect.poll(said).toBe("Deglaze put back. Position 3 of 4.");
      // The drag is over: the pointer, still down, moves nothing, and its release does nothing more.
      await pointer(window, "pointermove", 0, 0);
      expect(element.hasAttribute("data-dragging")).toBe(false);
      await rest(element);
      for (const row of rows(element)) expect(row.style.transform).toBe("");
      await pointer(window, "pointerup", 0, 0);
      expect(onReorder).not.toHaveBeenCalled();
    });

    it("ignores Escape before the press has become a drag", async () => {
      const element = await render(list());
      const [x, y] = middle(handle("Sear"));
      await pointer(handle("Sear"), "pointerdown", x, y);
      await press("{Escape}");
      await pointer(window, "pointermove", x, y + 80);
      expect(element.hasAttribute("data-dragging")).toBe(true);
      await pointer(window, "pointerup", x, y + 80);
      expect(order(element)).toEqual(["Soften", "Sear", "Deglaze", "Braise"]);
    });

    it("drags with one pointer and its primary button only", async () => {
      const element = await render(list());
      const [x, y] = middle(handle("Sear"));
      const right = await pointer(handle("Sear"), "pointerdown", x, y, { button: 2 });
      expect(right.defaultPrevented).toBe(false);
      await pointer(handle("Sear"), "pointerdown", x, y, { isPrimary: false, pointerId: 5 });
      await pointer(window, "pointermove", x, y + 100, { pointerId: 5 });
      expect(element.hasAttribute("data-dragging")).toBe(false);

      await pointer(handle("Sear"), "pointerdown", x, y);
      // A press on another handle mid-drag starts nothing, and other pointers do not steer or end it.
      await pointer(handle("Braise"), "pointerdown", ...middle(handle("Braise")), { pointerId: 2, isPrimary: false });
      await pointer(window, "pointermove", x, y + 300, { pointerId: 2 });
      expect(element.hasAttribute("data-dragging")).toBe(false);
      await pointer(window, "pointermove", x, y + 80);
      await pointer(window, "pointerup", x, y + 80, { pointerId: 2 });
      await pointer(window, "pointercancel", x, y + 80, { pointerId: 2 });
      expect(element.hasAttribute("data-dragging")).toBe(true);
      await pointer(window, "pointerup", x, y + 80);
      expect(order(element)).toEqual(["Soften", "Sear", "Deglaze", "Braise"]);
    });

    it("drops a row the keyboard holds before a pointer starts a drag", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      await focus("Sear");
      await press(" ");
      await press("{ArrowDown}");
      await dragBy("Braise", -200);
      expect(handle("Sear").hasAttribute("data-grabbed")).toBe(false);
      expect(onReorder.mock.calls).toEqual([[["soften", "sear", "deglaze", "braise"], { id: "sear", from: 0, to: 1 }]]);
      // While a pointer drags, another handle's activation opens no menu.
      await act(async () => handle("Soften").click());
      expect(handle("Soften").getAttribute("aria-expanded")).toBe("false");
      expect(document.querySelector('[role="menu"]')).toBeNull();
      await pointer(window, "pointerup", 0, 0);
      expect(order(element)).toEqual(["Braise", "Soften", "Sear", "Deglaze"]);
      expect(onReorder).toHaveBeenCalledTimes(2);
    });

    it("reports nothing when the app replaces the rows under a drag", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      const [x, y] = await dragBy("Sear", 120);
      await render(<Reorderable label="Steps" items={steps(["Braise", "Sear"])} onReorder={onReorder} />);
      await pointer(window, "pointerup", x, y);
      expect(order(element)).toEqual(["Braise", "Sear"]);
      expect(onReorder).not.toHaveBeenCalled();
      expect(element.hasAttribute("data-dragging")).toBe(false);
      for (const row of rows(element)) expect(row.style.transform).toBe("");
    });

    it("drops the row in the gap shown on screen, however fast it was let go", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      const height = rows(element)[0]!.getBoundingClientRect().height;
      const [x, y] = middle(handle("Sear"));
      // 0.6 of a row down, the pointer still moving fast when it lifts: the second row has
      // not moved aside, so the row goes back, although a flick was carrying it that way.
      wait(1000);
      await pointer(handle("Sear"), "pointerdown", x, y);
      for (let step = 1; step <= 4; step++) {
        wait(16);
        await pointer(window, "pointermove", x, y + (height * 0.6 * step) / 4);
      }
      expect(rows(element)[1]!.style.transform).toBe("");
      wait(16);
      await pointer(window, "pointerup", x, y + height * 0.6);
      expect(order(element)).toEqual(names);
      expect(onReorder).not.toHaveBeenCalled();
      await rest(element);

      // 1.3 rows down and then flicked back up, to just short of where the second row gave
      // way: the gap is still open on screen, so that is where the row drops.
      wait(1000);
      await pointer(handle("Sear"), "pointerdown", x, y);
      for (let step = 1; step <= 4; step++) {
        wait(16);
        await pointer(window, "pointermove", x, y + (height * 1.3 * step) / 4);
      }
      for (let step = 1; step <= 4; step++) {
        wait(16);
        await pointer(window, "pointermove", x, y + height * (1.3 - 0.06 * step));
      }
      expect(rows(element)[1]!.style.transform).toBe(`translateY(${-height}px)`);
      wait(16);
      await pointer(window, "pointerup", x, y + height * 1.06);
      expect(order(element)).toEqual(["Soften", "Sear", "Deglaze", "Braise"]);
      expect(onReorder.mock.calls).toEqual([[["soften", "sear", "deglaze", "braise"], { id: "sear", from: 0, to: 1 }]]);
      await rest(element);
    });

    it("springs a dropped row into its place with the speed it was let go at, and a row still sliding out of its way with none", async () => {
      const element = await render(list());
      const height = rows(element)[0]!.getBoundingClientRect().height;
      const [x, y] = middle(handle("Sear"));
      const dragged = rows(element)[0]!;
      const passed = rows(element)[1]!;
      wait(1000);
      await pointer(handle("Sear"), "pointerdown", x, y);
      for (let step = 1; step <= 6; step++) {
        wait(16);
        await pointer(window, "pointermove", x, y + (height * 1.8 * step) / 6);
      }
      // The row it passed has only begun to slide out of the way when the pointer lifts:
      // hold its slide at the start, so it is where it stood on any machine.
      for (const animation of passed.getAnimations()) {
        animation.pause();
        animation.currentTime = 0;
      }
      wait(16);
      freeze();
      await pointer(window, "pointerup", x, y + height * 1.8);
      // Dropped in the second place, where the gap was, 0.8 of a row past it and still moving down fast.
      expect(order(element)).toEqual(["Soften", "Sear", "Deglaze", "Braise"]);
      // Where each is at every 16ms frame until all are at rest.
      const seen = [shifted(dragged)];
      const others = [shifted(passed)];
      while (element.hasAttribute("data-ouro-settling")) {
        frames!.step(16);
        seen.push(shifted(dragged));
        others.push(shifted(passed));
      }
      await rest(element);
      expect(seen[0]).toBeCloseTo(height * 0.8, 1);
      // Its speed carried it on, further from its place, before the spring brought it back.
      expect(Math.max(...seen)).toBeGreaterThan(height * 0.8 + 2);
      expect(seen.at(-1)).toBe(0);
      // The row it passed starts where it stood, a row lower, and closes in without passing its place.
      expect(others[0]).toBe(height);
      expect(Math.min(...others)).toBe(0);
      for (let index = 1; index < others.length; index++) expect(others[index]!).toBeLessThanOrEqual(others[index - 1]!);
      expect(dragged.style.transform).toBe("");
      // No CSS transition moves any row once the drag is over.
      for (const row of rows(element)) expect(getComputedStyle(row).transitionDuration).toBe("0s");
    });

    it("can be picked up again while it springs into place, and carries on from where it was caught", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      const height = rows(element)[0]!.getBoundingClientRect().height;
      const dragged = rows(element)[0]!;
      const [x, y] = await dragBy("Sear", height * 1.6);
      freeze();
      await pointer(window, "pointerup", x, y);
      expect(order(element)).toEqual(["Soften", "Sear", "Deglaze", "Braise"]);
      expect(element.hasAttribute("data-ouro-settling")).toBe(true);
      frames!.until(() => shifted(dragged) < height * 0.6 - 1);
      expect(shifted(dragged)).toBeGreaterThan(0);
      // A press on its handle stops it there, under the pointer, before the press has moved.
      const [hx, hy] = middle(handle("Sear"));
      wait(1000);
      await pointer(handle("Sear"), "pointerdown", hx, hy);
      expect(dragged.hasAttribute("data-ouro-settling")).toBe(false);
      expect(dragged.hasAttribute("data-dropped")).toBe(false);
      expect(element.hasAttribute("data-ouro-settling")).toBe(false);
      const caught = shifted(dragged);
      expect(caught).toBeGreaterThan(0);
      expect(caught).toBeLessThan(height * 0.6);
      // No frame moves it now.
      frames!.step(32);
      expect(shifted(dragged)).toBe(caught);
      // Once the press is a drag, it goes on from there.
      wait(16);
      await pointer(window, "pointermove", hx, hy + 12);
      expect(shifted(dragged)).toBeCloseTo(caught + 12, 1);
      // The drag goes on from there, 1:1 with the pointer.
      wait(16);
      await pointer(window, "pointermove", hx, hy + 20);
      expect(shifted(dragged)).toBeCloseTo(caught + 20, 1);
      wait(300);
      await pointer(window, "pointerup", hx, hy + 20);
      await rest(element);
      expect(order(element)).toEqual(["Soften", "Sear", "Deglaze", "Braise"]);
      expect(dragged.style.transform).toBe("");

      // A press and release without a drag stops a settling row only for as long as the press: it then goes on into its place.
      const [x2, y2] = await dragBy("Sear", height * 0.8);
      freeze();
      await pointer(window, "pointerup", x2, y2);
      frames!.step(16);
      expect(element.hasAttribute("data-ouro-settling")).toBe(true);
      const [hx2, hy2] = middle(handle("Sear"));
      wait(1000);
      await pointer(handle("Sear"), "pointerdown", hx2, hy2);
      expect(element.hasAttribute("data-ouro-settling")).toBe(false);
      const stopped = shifted(dragged);
      expect(stopped).not.toBe(0);
      await pointer(window, "pointerup", hx2, hy2);
      expect(dragged.hasAttribute("data-ouro-settling")).toBe(true);
      expect(dragged.hasAttribute("data-dropped")).toBe(true);
      expect(shifted(dragged)).toBe(stopped);
      await rest(element);
      expect(dragged.style.transform).toBe("");
      expect(onReorder).toHaveBeenCalledTimes(1);
    });

    it("lets another row be dragged while the last one settles, measuring places from where rows rest", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      const height = rows(element)[0]!.getBoundingClientRect().height;
      const [x, y] = await dragBy("Sear", height * 1.6);
      freeze();
      await pointer(window, "pointerup", x, y);
      frames!.step(16);
      frames!.step(16);
      expect(element.hasAttribute("data-ouro-settling")).toBe(true);
      // Sear is still on its way to the second place when Braise is dragged up past it.
      const top = element.getBoundingClientRect().top;
      const [bx, by] = middle(handle("Braise"));
      wait(1000);
      await pointer(handle("Braise"), "pointerdown", bx, by);
      for (let step = 1; step <= 4; step++) {
        wait(16);
        await pointer(window, "pointermove", bx, by - (height * 2.2 * step) / 4);
      }
      // The drag took the rows over: none is settling, and the passed rows make room.
      expect(element.hasAttribute("data-ouro-settling")).toBe(false);
      expect(shifted(rows(element)[1]!)).toBe(height);
      expect(shifted(rows(element)[2]!)).toBe(height);
      wait(300);
      await pointer(window, "pointerup", bx, by - height * 2.2);
      expect(order(element)).toEqual(["Soften", "Braise", "Sear", "Deglaze"]);
      await rest(element);
      // Soften was caught mid-spring when the drag began and slid home with the rows making room, a CSS transition: wait for it too.
      await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
      expect(rows(element).map((row) => Math.round(row.getBoundingClientRect().top - top))).toEqual([0, 1, 2, 3].map((index) => Math.round(index * height)));
    });

    it("captures the pointer once the press has become a drag, not before", async () => {
      await render(list());
      const capture = vi.spyOn(handle("Sear"), "setPointerCapture");
      const [x, y] = middle(handle("Sear"));
      await pointer(handle("Sear"), "pointerdown", x, y);
      await pointer(window, "pointermove", x, y + 9);
      expect(capture).not.toHaveBeenCalled();
      await pointer(window, "pointermove", x, y + 12);
      expect(capture.mock.calls).toEqual([[1]]);
      await pointer(window, "pointermove", x, y + 30);
      expect(capture).toHaveBeenCalledTimes(1);
      await pointer(window, "pointerup", x, y + 30);
    });

    it("holds a lone row in place", async () => {
      const onReorder = vi.fn();
      const element = await render(<Reorderable label="Steps" items={steps(["Sear"])} onReorder={onReorder} />);
      const [x, y] = await dragBy("Sear", 200);
      expect(element.hasAttribute("data-dragging")).toBe(true);
      // With nowhere to go it gives a little under the pointer, and springs back.
      const height = rows(element)[0]!.getBoundingClientRect().height;
      expect(shifted(rows(element)[0]!)).toBeCloseTo(rubberband(200, height), 1);
      await pointer(window, "pointerup", x, y);
      await rest(element);
      expect(rows(element)[0]!.style.transform).toBe("");
      expect(onReorder).not.toHaveBeenCalled();
      await expect.poll(said).toBe("Sear dropped. Position 1 of 1.");
    });

    it("stops listening when it unmounts mid-drag", async () => {
      await render(list());
      const removed = vi.spyOn(window, "removeEventListener");
      const cancelled = vi.spyOn(window, "cancelAnimationFrame");
      const [x, y] = await dragBy("Sear", 60);
      await act(async () => root!.unmount());
      root = undefined;
      expect(removed.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(["pointermove", "pointerup", "pointercancel"]));
      expect(cancelled).toHaveBeenCalled();
      await pointer(window, "pointermove", x, y + 40);
      await pointer(window, "pointerup", x, y + 40);
    });

    it("scrolls a list that scrolls in place while the pointer is held near its bottom edge, then near its top", async () => {
      const many = Array.from({ length: 12 }, (_, index) => `Step ${index + 1}`);
      const onReorder = vi.fn();
      const element = await render(<Reorderable label="Steps" items={steps(many)} onReorder={onReorder} className="h-60 overflow-auto" />);
      const scroller = element.parentElement!;
      expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight);
      const end = scroller.scrollHeight - scroller.clientHeight;
      const box = scroller.getBoundingClientRect();
      const [x, y] = middle(handle("Step 1"));
      // The list scrolls a little each frame; the test steps the frames, so it does not wait on the machine.
      freeze();
      await pointer(handle("Step 1"), "pointerdown", x, y);
      await pointer(window, "pointermove", x, y + 40);
      // In the middle of the list nothing scrolls.
      frames!.step(16);
      frames!.step(16);
      expect(scroller.scrollTop).toBe(0);
      await pointer(window, "pointermove", x, box.bottom - 6);
      frames!.step(16);
      // One frame scrolls part of the way, not all of it.
      expect(scroller.scrollTop).toBeGreaterThan(0);
      expect(scroller.scrollTop).toBeLessThan(end);
      frames!.until(() => scroller.scrollTop === end);
      // The row came along: it is still under the pointer, at the end of the list.
      const dragged = rows(element)[0]!.getBoundingClientRect();
      expect(dragged.bottom).toBeGreaterThan(box.bottom - 60);
      expect(dragged.top).toBeLessThan(box.bottom);
      await pointer(window, "pointermove", x, box.top + 6);
      frames!.until(() => scroller.scrollTop === 0);
      await pointer(window, "pointermove", x, box.bottom - 6);
      frames!.until(() => scroller.scrollTop === end);
      // At the end it stays there: it cannot scroll into room the dragged row would make.
      frames!.step(16);
      expect(scroller.scrollTop).toBe(end);
      await pointer(window, "pointerup", x, box.bottom - 6);
      expect(onReorder.mock.calls).toEqual([[[...many.slice(1), "Step 1"].map((name) => name.toLowerCase()), { id: "step 1", from: 0, to: 11 }]]);
      // Dropped, the list stops scrolling.
      frames!.step(16);
      frames!.step(16);
      expect(scroller.scrollTop).toBe(end);
      await rest(element);
    });

    chromiumOnly("reorders with a real mouse drag on the handle", async () => {
      const onReorder = vi.fn();
      const element = await render(list({ onReorder }));
      const [x, y] = middle(handle("Sear"));
      const [, target] = middle(rows(element)[2]!);
      await commands.drag({ from: [x, y], to: [x + 10, target + 8], steps: 8, durationMs: 160 });
      await expect.poll(() => onReorder.mock.calls.length).toBe(1);
      expect(order(element)).toEqual(["Soften", "Deglaze", "Sear", "Braise"]);
      expect(onReorder).toHaveBeenCalledWith(["soften", "deglaze", "sear", "braise"], { id: "sear", from: 0, to: 2 });
      // The mouse's click at the end of the drag picks nothing up and opens no menu.
      expect(handle("Sear").hasAttribute("data-grabbed")).toBe(false);
      expect(handle("Sear").getAttribute("aria-expanded")).toBe("false");
      expect(document.querySelector('[role="menu"]')).toBeNull();
    });

    chromiumOnly("scrolls the page while a real mouse holds a row near the bottom of the window", async () => {
      const many = Array.from({ length: 30 }, (_, index) => `Step ${index + 1}`);
      const element = await render(<Reorderable label="Steps" items={steps(many)} />);
      expect(document.documentElement.scrollHeight).toBeGreaterThan(innerHeight);
      const [x, y] = middle(handle("Step 1"));
      await commands.drag({ from: [x, y], to: [x, innerHeight - 8], steps: 6, durationMs: 120, hold: true });
      await expect.poll(() => scrollY).toBeGreaterThan(200);
      expect(element.hasAttribute("data-dragging")).toBe(true);
      await commands.pointerPress({ action: "up" });
      await expect.poll(() => element.hasAttribute("data-dragging")).toBe(false);
      expect(order(element).indexOf("Step 1")).toBeGreaterThan(8);
    });
  });

  it("has helpers that place, move and scroll", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    // A row passes another when its center reaches the other's, from either side.
    expect(dropIndex([10, 30, 50], 0, 29)).toBe(0);
    expect(dropIndex([10, 30, 50], 0, 30)).toBe(1);
    expect(dropIndex([10, 30, 50], 0, 50)).toBe(2);
    expect(dropIndex([10, 30, 50], 2, 31)).toBe(2);
    expect(dropIndex([10, 30, 50], 2, 30)).toBe(1);
    expect(dropIndex([10, 30, 50], 2, 5)).toBe(0);
    expect(dropIndex([10, 30, 50], 1, 30)).toBe(1);
    // Nothing in the middle, full speed at an edge and past it, and upward near the top.
    expect(edgeSpeed(300, 0, 600)).toBe(0);
    expect(edgeSpeed(600, 0, 600)).toBe(MAX_SPEED);
    expect(edgeSpeed(700, 0, 600)).toBe(MAX_SPEED);
    expect(edgeSpeed(0, 0, 600)).toBe(-MAX_SPEED);
    expect(edgeSpeed(600 - EDGE / 2, 0, 600)).toBe(MAX_SPEED / 2);
    // Px per millisecond: 840px a second at an edge, whatever the screen's frame rate.
    expect(MAX_SPEED * 1000).toBe(840);
    // An element that is not in the page scrolls with the page.
    expect(scrollParent(document.createElement("div"))).toBe(document.documentElement);
    const fixed = document.createElement("div");
    fixed.style.cssText = "height:40px;overflow:scroll";
    const inner = document.createElement("div");
    fixed.append(inner);
    document.body.append(fixed);
    nodes.push(fixed);
    // A scroller with nothing to scroll is passed over.
    expect(scrollParent(inner)).toBe(document.documentElement);
    inner.style.height = "400px";
    expect(scrollParent(inner)).toBe(fixed);
  });

  it.each([
    ["no label", { label: "" }, "label is required; it names the list for screen readers", '<Reorderable label="Steps">'],
    [
      "two rows with one id",
      { items: [{ id: "a", label: "One" }, { id: "a", label: "Two" }] },
      "two rows have the same id, so only the first shows",
      'give each row its own id: items={[{ id: "1", label: "…" }, { id: "2", label: "…" }]}',
    ],
    ["a row with no label", { items: [{ id: "a", label: "" }] }, "a row has no label; it names the row's handle", '{ id: "1", label: "Sear the ribs" }'],
    ["values", { values: [] }, "values is not a prop", 'items={[{ id: "1", label: "Sear the ribs", content: <Item title="Sear the ribs" /> }]}'],
    ["children", { children: "x" }, "children is not a prop; rows are data", 'items={[{ id: "1", label: "Sear the ribs", content: <Item title="Sear the ribs" /> }]}'],
    [
      "renderItem",
      { renderItem: () => null },
      "renderItem is not a prop; each row's content is in its item",
      'items={[{ id: "1", label: "Sear the ribs", content: <Item title="Sear the ribs" /> }]}',
    ],
    ["onChange", { onChange: () => {} }, "onChange is not a prop", "onReorder={(ids) => save(ids)}"],
    ["onDragEnd", { onDragEnd: () => {} }, "onDragEnd is not a prop", "onReorder={(ids) => save(ids)}"],
    ["axis", { axis: "y" }, "axis is not a prop; Reorderable is a vertical list", '<Reorderable label="Steps" items={…}>'],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    await render(list(extra as unknown as Partial<ReorderableProps>));
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Reorderable: ${problem}. Fix: ${fix}.`);
  });

  it("shows only the first of two rows with one id", async () => {
    const element = await render(<Reorderable label="Tags" items={[{ id: "a", label: "One" }, { id: "a", label: "Two" }, { id: "b", label: "Three" }]} />);
    expect(order(element)).toEqual(["One", "Three"]);
  });

  it("takes layout classes and warns about appearance classes", async () => {
    const element = await render(list({ className: "mt-2" }));
    expect(element.parentElement!.classList.contains("mt-2")).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    await act(async () => root!.unmount());
    root = undefined;
    await render(list({ className: "bg-red-500" }));
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Reorderable: "bg-red-500" sets appearance, and className is for layout only. Fix: remove "bg-red-500"; style the content you give each row.',
    );
  });

  it("renders to a string as a named list with labelled handles, without warnings", () => {
    const html = renderToString(list());
    expect(html).toContain('data-ouro="reorderable"');
    expect(html).toMatch(/<ol[^>]* role="list"[^>]* aria-label="Steps"/);
    expect(html).toContain('aria-label="Reorder Sear"');
    expect(html).not.toContain("aria-pressed");
    expect(html).toContain("Press Enter for a menu of moves. Press Space to pick up,");
    expect(html).toContain('aria-haspopup="menu"');
    expect(warn).not.toHaveBeenCalled();
  });
});
