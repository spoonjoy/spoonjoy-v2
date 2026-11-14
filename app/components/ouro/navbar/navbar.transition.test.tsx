import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Navbar } from "~/components/ouro/navbar/navbar";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";

// Its own file, so React's startTransition can be held: a loaded runner can leave the content's transition uncommitted
// until the sheet has closed.
const transitions = vi.hoisted(() => ({ hold: false, held: [] as Array<() => void> }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    startTransition: (callback: () => void) => {
      if (transitions.hold) transitions.held.push(() => react.startTransition(callback));
      else react.startTransition(callback);
    },
  };
});

const StayLink: OuroLinkComponent = ({ onClick, ...props }: ComponentProps<OuroLinkComponent>) => (
  <a
    data-router=""
    {...props}
    onClick={(event) => {
      event.preventDefault();
      onClick?.(event);
    }}
  />
);

const items = [
  { label: "Recipes", href: "/recipes" },
  { label: "Cookbooks", href: "/cookbooks" },
];

let root: Root | undefined;
afterEach(async () => {
  // Unmounted first, so the effect's cleanup still finds the stubs it started with.
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  transitions.hold = false;
  transitions.held.splice(0);
  await page.viewport(414, 896);
});

it("asks for the fresh sheet's content turn after a close, even when the last content's transition had not committed", async () => {
  // The first idle turn (the frame) comes at once; every later one is held.
  const idle: Array<() => void> = [];
  let fired = false;
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    if (fired) return idle.push(callback);
    return setTimeout(() => {
      fired = true;
      callback();
    }, 0);
  });
  vi.stubGlobal("cancelIdleCallback", (id: number) => clearTimeout(id));
  await page.viewport(390, 844);
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<OuroProvider linkComponent={StayLink}><Navbar label="Main" items={items} /></OuroProvider>));
  await expect.poll(() => document.querySelector('[data-ouro="sheet"]')).not.toBeNull();
  await expect.poll(() => idle.length).toBe(1);
  await userEvent.click(page.getByRole("button", { name: "Menu", exact: true }));
  const dialog = page.getByRole("dialog", { name: "Menu" });
  await expect.element(dialog.getByRole("link", { name: "Recipes" })).toBeVisible();
  // The content's turn comes, but its transition is still waiting when the sheet closes.
  transitions.hold = true;
  for (const callback of idle.splice(0)) callback();
  expect(transitions.held).toHaveLength(1);
  await expect.poll(() => document.getAnimations().length).toBe(0);
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => document.querySelector<HTMLElement>('[data-ouro="sheet"]')?.hidden).toBe(true);
  // The fresh sheet asks for its content's turn all the same.
  await expect.poll(() => idle.length).toBeGreaterThan(0);
  expect(document.querySelectorAll('[data-ouro="sheet"] a[href]')).toHaveLength(0);
  transitions.hold = false;
  await act(async () => transitions.held.splice(0).forEach((run) => run()));
  for (const callback of idle.splice(0)) callback();
  await expect.poll(() => document.querySelectorAll('[data-ouro="sheet"] a[href]').length).toBe(items.length);
});
