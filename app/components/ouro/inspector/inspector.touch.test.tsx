import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { Inspector } from "~/components/ouro/inspector/inspector";
import { Menu, MenuItem } from "~/components/ouro/menu/menu";
import { act } from "~/lib/ouro/testing/act";

// Runs in the `touch` project: Chromium as a 390x844 phone with a coarse pointer.

let root: Root | undefined;
const nodes: Element[] = [];
afterEach(async () => {
  await act(async () => root?.unmount());
  for (const node of nodes.splice(0)) node.remove();
});

const live = (tag: Element) => getComputedStyle(tag).visibility === "visible";
const settled = () => expect.poll(() => document.getAnimations().filter((animation) => animation.playState === "running").length).toBe(0);
const tags = () => [...document.querySelectorAll('[data-ouro-control="inspector"][data-ouro-part="tag"]')].map((tag) => tag.textContent);

function Host({ onCopy }: { onCopy: () => void }) {
  const [xray, setXray] = useState(true);
  return (
    <div style={{ display: "grid", gap: 16, padding: 16 }}>
      <Button>Save recipe</Button>
      <Dialog title="Share" trigger={<Button data-testid="share">Share</Button>}>
        <Button onClick={onCopy}>Copy link</Button>
      </Dialog>
      <Inspector open={xray} onOpenChange={setXray} />
    </div>
  );
}

it("leaves a phone's open dialog within reach of a tap, and outlines only what is in it", async () => {
  const onCopy = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () => root!.render(<Host onCopy={onCopy} />));
  await expect.poll(tags).toEqual(["button", "button"]);
  await commands.tap('[data-testid="share"]');
  await expect.element(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await settled();
  await expect.poll(tags).toEqual(["sheet", "button"]);
  await commands.tap('[role="dialog"] [data-ouro="button"]');
  expect(onCopy).toHaveBeenCalledOnce();
}, 15_000);

it("hides the page's tags under a phone's menu sheet, whose items stay within reach of a tap", async () => {
  const onEdit = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  nodes.push(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <div style={{ display: "grid", gap: 16, padding: 16 }}>
        <Menu trigger={<Button data-testid="actions">Actions</Button>}>
          <MenuItem onClick={onEdit}>Edit</MenuItem>
          <MenuItem>Print</MenuItem>
        </Menu>
        {Array.from({ length: 12 }, (_, index) => (
          <Button key={index}>Step {index + 1}</Button>
        ))}
        <Inspector open onOpenChange={() => {}} />
      </div>,
    ),
  );
  const pageTags = () => [...host.querySelectorAll('[data-ouro="button"]')].map((button) => document.querySelector(`[data-ouro-inspector-outline]:nth-child(${[...host.querySelectorAll('[data-ouro="button"]')].indexOf(button) + 1}) [data-ouro-part="tag"]`)!);
  await expect.poll(() => pageTags().every(live)).toBe(true);
  await commands.tap('[data-testid="actions"]');
  await expect.element(page.getByRole("menu")).toBeVisible();
  await settled();
  // The sheet's backdrop lies over the whole page, so none of its tags show over the sheet.
  await expect.poll(() => pageTags().some(live)).toBe(false);
  await commands.tap('[role="menu"] [role="menuitem"]:has-text("Edit")');
  expect(onEdit).toHaveBeenCalledOnce();
}, 15_000);
