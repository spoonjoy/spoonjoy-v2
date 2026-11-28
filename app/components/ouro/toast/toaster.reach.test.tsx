import { afterEach, describe, expect, it } from "vitest";
import "~/components/ouro/toast/toaster-parts";

afterEach(() => {
  document.body.replaceChildren();
});

function build(options: { modal?: boolean; hideSibling?: boolean; dialogButtons?: number; toastButtons?: number; dialogInViewport?: boolean } = {}) {
  const { modal = true, hideSibling = false, dialogButtons = 2, toastButtons = 2, dialogInViewport = false } = options;
  const viewport = document.createElement("div");
  viewport.dataset.ouro = "toaster";
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("data-open", "");
  if (modal) dialog.setAttribute("data-ouro-modal", "");
  const make = (parent: HTMLElement, n: number, name: string) =>
    Array.from({ length: n }, (_, i) => {
      const b = document.createElement("button");
      b.textContent = `${name}${i}`;
      parent.append(b);
      return b;
    });
  const inside = make(dialog, dialogButtons, "d");
  const toasts = make(viewport, toastButtons, "t");
  if (dialogInViewport) viewport.append(dialog);
  else document.body.append(dialog);
  document.body.append(viewport);
  if (hideSibling) {
    const sibling = document.createElement("div");
    sibling.setAttribute("aria-hidden", "true");
    document.body.append(sibling);
  }
  return { viewport, dialog, inside, toasts };
}

const press = (target: Element, key = "Tab", shiftKey = false) => {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe("reachModal", () => {
  it("lands on a toast's action when it has one, and on the toast when it has none", () => {
    const { inside, toasts } = build();
    const action = document.createElement("button");
    action.dataset.ouroPart = "action";
    toasts[0]!.append(action);
    inside[1]!.focus();
    press(inside[1]!);
    expect(document.activeElement).toBe(action);
    action.remove();
    inside[1]!.focus();
    press(inside[1]!);
    expect(document.activeElement).toBe(toasts[0]);
  });

  it("goes to the last toast control, not an action, on Shift+Tab, and to the dialog's first control, not a nested action, on Tab out of the toasts", () => {
    const { inside, toasts, dialog } = build();
    const action = document.createElement("button");
    action.dataset.ouroPart = "action";
    toasts[0]!.append(action);
    inside[0]!.focus();
    press(inside[0]!, "Tab", true);
    expect(document.activeElement).toBe(toasts[1]);
    const link = document.createElement("a");
    link.href = "#x";
    const nested = document.createElement("button");
    nested.dataset.ouroPart = "action";
    link.append(nested);
    dialog.prepend(link);
    toasts[1]!.focus();
    press(toasts[1]!);
    expect(document.activeElement).toBe(link);
  });

  it("hands over even when the target stops the event from bubbling", () => {
    const { inside, toasts } = build();
    inside[1]!.addEventListener("keydown", (event) => event.stopPropagation());
    inside[1]!.focus();
    expect(press(inside[1]!).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(toasts[0]);
  });

  it("sends Tab from a dialog's last control to the first toast control, and Shift+Tab back", () => {
    const { inside, toasts } = build();
    inside[1]!.focus();
    expect(press(inside[1]!).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(toasts[0]);
    expect(press(toasts[0]!, "Tab", true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(inside[1]);
  });

  it("sends Shift+Tab from a dialog's first control to the last toast control, and Tab from the last toast to the first control", () => {
    const { inside, toasts } = build();
    inside[0]!.focus();
    expect(press(inside[0]!, "Tab", true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(toasts[1]);
    expect(press(toasts[1]!).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(inside[0]);
  });

  it("leaves Tab in the middle of either list to the browser", () => {
    const { inside, toasts } = build();
    inside[0]!.focus();
    expect(press(inside[0]!).defaultPrevented).toBe(false);
    toasts[0]!.focus();
    expect(press(toasts[0]!).defaultPrevented).toBe(false);
    inside[1]!.focus();
    expect(press(inside[1]!, "Tab", true).defaultPrevented).toBe(false);
    toasts[1]!.focus();
    expect(press(toasts[1]!, "Tab", true).defaultPrevented).toBe(false);
  });

  it("does nothing for another key", () => {
    const { inside } = build();
    inside[1]!.focus();
    expect(press(inside[1]!, "Enter").defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(inside[1]);
  });

  it("does nothing when focus is on the page body, not in a dialog or toast", () => {
    build();
    (document.activeElement as HTMLElement).blur();
    expect(press(document.body).defaultPrevented).toBe(false);
  });

  it("does nothing for focus outside any dialog", () => {
    build();
    const outside = document.body.appendChild(document.createElement("button"));
    outside.focus();
    expect(press(outside).defaultPrevented).toBe(false);
  });

  it("does nothing when the dialog neither is marked modal nor hides the page", () => {
    const { inside } = build({ modal: false });
    document.body.append(document.createElement("div"));
    inside[1]!.focus();
    expect(press(inside[1]!).defaultPrevented).toBe(false);
  });

  it("acts on a dialog that hides the rest of the page without the modal mark", () => {
    const { inside, toasts } = build({ modal: false, hideSibling: true });
    inside[1]!.focus();
    expect(press(inside[1]!).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(toasts[0]);
  });

  it("does nothing when the toasts hold no control, or the dialog holds none", () => {
    const noToast = build({ toastButtons: 0 });
    noToast.inside[1]!.focus();
    expect(press(noToast.inside[1]!).defaultPrevented).toBe(false);
    document.body.replaceChildren();
    const noInside = build({ dialogButtons: 0 });
    const t = noInside.toasts[1]!;
    t.focus();
    expect(press(t).defaultPrevented).toBe(false);
  });

  it("skips a toast control that is not rendered when finding the toasts' ends", () => {
    const { inside, toasts } = build();
    toasts[0]!.style.display = "none";
    inside[1]!.focus();
    expect(press(inside[1]!).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(toasts[1]);
  });

  it("does nothing for a dialog inside the toasts' own viewport", () => {
    const { inside } = build({ dialogInViewport: true });
    inside[1]!.focus();
    expect(press(inside[1]!).defaultPrevented).toBe(false);
  });

  it("finds the dialog that holds focus, not the last one open", () => {
    const first = build();
    const second = document.createElement("div");
    second.setAttribute("role", "dialog");
    second.setAttribute("data-open", "");
    second.setAttribute("data-ouro-modal", "");
    second.append(document.createElement("button"), document.createElement("button"));
    document.body.append(second);
    first.inside[1]!.focus();
    expect(press(first.inside[1]!).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first.toasts[0]);
  });

  it("copes with no focused element at all", () => {
    build();
    const errors: unknown[] = [];
    const record = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener("error", record);
    const real = Object.getOwnPropertyDescriptor(Document.prototype, "activeElement")!;
    Object.defineProperty(document, "activeElement", { configurable: true, get: () => null });
    try {
      expect(press(document.body).defaultPrevented).toBe(false);
    } finally {
      delete (document as { activeElement?: unknown }).activeElement;
      window.removeEventListener("error", record);
      expect(Object.getOwnPropertyDescriptor(Document.prototype, "activeElement")).toEqual(real);
    }
    expect(errors).toEqual([]);
  });

  it.each([
    ["inert", ""],
    ["aria-hidden", "true"],
  ])("skips a toast control inside a wrapper marked %s, though it has a box", (attribute, value) => {
    const { inside, toasts, viewport } = build();
    const holder = document.createElement("div");
    holder.setAttribute(attribute, value);
    viewport.prepend(holder);
    holder.append(toasts[0]!);
    inside[1]!.focus();
    expect(press(inside[1]!).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(toasts[1]);
  });

  it("does nothing once the toasts' viewport is gone", () => {
    const { inside, viewport } = build();
    viewport.remove();
    inside[1]!.focus();
    expect(press(inside[1]!).defaultPrevented).toBe(false);
  });
});
