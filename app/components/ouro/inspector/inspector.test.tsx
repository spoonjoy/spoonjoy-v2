import { useLayoutEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Badge } from "~/components/ouro/badge/badge";
import { Button } from "~/components/ouro/button/button";
import { Card } from "~/components/ouro/card/card";
import { Checkbox } from "~/components/ouro/checkbox/checkbox";
import { Combobox } from "~/components/ouro/combobox/combobox";
import { Dialog } from "~/components/ouro/dialog/dialog";
import { Inspector, type InspectorProps } from "~/components/ouro/inspector/inspector";
import { Menu, MenuItem } from "~/components/ouro/menu/menu";
import { Popover } from "~/components/ouro/popover/popover";
import { RadioGroup } from "~/components/ouro/radio-group/radio-group";
import { Select } from "~/components/ouro/select/select";
import { act } from "~/lib/ouro/testing/act";
import { expectMotion, expectNoMotion, parseDuration } from "~/lib/ouro/testing/motion";

const roots: Root[] = [];
let mounted: Element[] = [];

/** A docs address of the app's own, so the tests tell it from the default. */
const docsHref = (item: string) => `https://docs.example.com/ui/${item}`;

/** A page of Ouro components with X-ray over it, whose state the test reads and sets. */
let setOpen: (open: boolean) => void = () => {};
let onOpenChange = vi.fn();

function Page(props: { children?: ReactNode; inspector?: Partial<InspectorProps>; open?: boolean }) {
  const [open, setState] = useState(props.open ?? true);
  useLayoutEffect(() => {
    setOpen = setState;
  }, []);
  return (
    <div>
      <div style={{ display: "grid", gap: 16, padding: 24, maxWidth: 420 }}>
        <Button>Save recipe</Button>
        <Badge>New</Badge>
        <Checkbox label="Vegetarian" />
        {props.children}
      </div>
      <div style={{ height: 1600 }} />
      <Inspector
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          setState(next);
        }}
        docsHref={docsHref}
        {...props.inspector}
      />
    </div>
  );
}

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
  };
}

const layer = () => document.querySelector<HTMLElement>('[data-ouro="inspector"]');
const outlines = () => [...document.querySelectorAll<HTMLElement>("[data-ouro-inspector-outline]")];
const tags = () => [...document.querySelectorAll<HTMLAnchorElement>('[data-ouro-control="inspector"][data-ouro-part="tag"]')];
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Waits until X-ray has measured the page and drawn an outline per component. */
async function drawn(count: number) {
  await expect.poll(() => outlines().length).toBe(count);
  await frame();
  await frame();
}

/** Whether an outline sits on its component's box, to within a pixel. */
function onTarget(outline: HTMLElement, target: Element) {
  const a = outline.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  return [a.left - b.left, a.top - b.top, a.width - b.width, a.height - b.height].every((delta) => Math.abs(delta) <= 1);
}

/** The tag of the outline on a component, once the outline is on it. */
const tagOn = (target: Element) => outlines().find((outline) => onTarget(outline, target))?.querySelector<HTMLElement>('[data-ouro-part="tag"]');

/** Whether a tag shows and takes a pointer. */
const live = (tag: HTMLElement | null | undefined) => !!tag && getComputedStyle(tag).visibility === "visible";

/** Whether the tag on a component, its outline on it, is hidden. */
const hidden = (target: Element) => {
  const tag = tagOn(target);
  return !!tag && getComputedStyle(tag).visibility === "hidden";
};

/** Waits until nothing on the page is moving. */
const settled = () => expect.poll(() => document.getAnimations().filter((animation) => animation.playState === "running").length).toBe(0);

/** The page's own component roots, in document order, as X-ray should see them. */
const pageRoots = (host: HTMLElement) => [...host.querySelectorAll('[data-ouro]:not([data-ouro$="-portal"])')];

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  onOpenChange = vi.fn();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  scrollTo(0, 0);
  await page.viewport(414, 896);
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

describe("Inspector", () => {
  it("outlines every Ouro component on the page, each tagged with its item and linked to its docs", async () => {
    const { host } = await render(<Page />);
    const components = pageRoots(host);
    expect(components.map((root) => root.getAttribute("data-ouro"))).toEqual(["button", "badge", "checkbox"]);
    await drawn(components.length);
    expect(tags().map((tag) => tag.textContent)).toEqual(["button", "badge", "checkbox"]);
    expect(tags().map((tag) => tag.getAttribute("href"))).toEqual(["button", "badge", "checkbox"].map(docsHref));
    outlines().forEach((outline, index) => expect(onTarget(outline, components[index]!), `outline ${index}`).toBe(true));
  });

  it("does not outline itself, an overlay's wrappers, a hidden component or a part apart from its component", async () => {
    const { host } = await render(
      <Page>
        <RadioGroup
          legend="Size"
          defaultValue="s"
          options={[
            { value: "s", label: "Small" },
            { value: "m", label: "Medium" },
            { value: "l", label: "Large" },
            { value: "xl", label: "Extra large" },
          ]}
        />
        <div hidden>
          <Button>Hidden</Button>
        </div>
        {/* A visually hidden root, one pixel square. */}
        <span data-ouro="badge" className="sr-only">
          Hidden badge
        </span>
      </Page>,
    );
    await drawn(4);
    // A Radio's root is a part of the radio-group around it, so the group counts once, not once per option.
    expect(host.querySelectorAll('[data-ouro="radio"]')).toHaveLength(4);
    expect(tags().map((tag) => tag.textContent)).toEqual(["button", "badge", "checkbox", "radio-group"]);
    await expect.element(page.getByRole("button", { name: "4 components", exact: true })).toBeVisible();
    // X-ray's own bar holds Buttons, which it leaves out.
    expect(layer()!.querySelectorAll('[data-ouro="button"]').length).toBeGreaterThan(0);
    expect(host.querySelector("[hidden] [data-ouro]")).not.toBeNull();
    // A visually hidden root has nothing to outline.
    expect(host.querySelector<HTMLElement>(".sr-only[data-ouro]")!.getBoundingClientRect().width).toBe(1);
  });

  it("follows its components as the page scrolls and resizes", async () => {
    const { host } = await render(<Page />);
    const components = pageRoots(host);
    await drawn(components.length);
    scrollBy(0, 200);
    await expect.poll(() => outlines().every((outline, index) => onTarget(outline, components[index]!))).toBe(true);
    expect(components[0]!.getBoundingClientRect().top).toBeLessThan(0);
    await page.viewport(800, 600);
    await expect.poll(() => outlines().every((outline, index) => onTarget(outline, components[index]!))).toBe(true);
  }, 15_000);

  it("follows a component that moves inside a scrolled box, and one that changes size", async () => {
    const { host } = await render(
      <Page>
        <div data-testid="scroller" style={{ height: 80, overflow: "auto" }}>
          <div style={{ height: 120 }} />
          <Button>Deep</Button>
          <div style={{ height: 120 }} />
        </div>
      </Page>,
    );
    const components = pageRoots(host);
    await drawn(components.length);
    host.querySelector<HTMLElement>('[data-testid="scroller"]')!.scrollTop = 90;
    await expect.poll(() => outlines().every((outline, index) => onTarget(outline, components[index]!))).toBe(true);
    (components[1] as HTMLElement).style.padding = "20px";
    await expect.poll(() => outlines().every((outline, index) => onTarget(outline, components[index]!))).toBe(true);
  });

  it("hides the outline and tag of a component scrolled out of view inside a box, and clips one partly out", async () => {
    const { host } = await render(
      <Page>
        <div data-testid="scroller" style={{ height: 80, overflow: "auto" }}>
          <div style={{ height: 120 }} />
          <Button>Deep</Button>
          <div style={{ height: 120 }} />
        </div>
      </Page>,
    );
    const components = pageRoots(host);
    await drawn(components.length);
    const deep = outlines()[3]!;
    const tag = tags()[3]!;
    expect(tag.textContent).toBe("button");
    // Below the box's bottom edge: nothing of it shows, so neither does its outline, and its tag takes no tap.
    expect(getComputedStyle(deep).visibility).toBe("hidden");
    const at = tag.getBoundingClientRect();
    expect(document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2)).not.toBe(tag);
    // Half in view: the outline shows only the part in the box.
    const scroller = host.querySelector<HTMLElement>('[data-testid="scroller"]')!;
    scroller.scrollTop = 60;
    await expect.poll(() => getComputedStyle(deep).visibility).toBe("visible");
    const frame = deep.querySelector<HTMLElement>("[data-ouro-inspector-frame]")!;
    const box = scroller.getBoundingClientRect();
    const visible = (components[3] as HTMLElement).getBoundingClientRect();
    await expect.poll(() => Number.parseFloat(getComputedStyle(frame).clipPath.match(/inset\(([\d.]+)px ([\d.]+)px ([\d.]+)px/)?.[3] ?? "0")).toBeCloseTo(visible.bottom - box.bottom, 0);
    // Its tag sits inside the part that shows.
    expect(tag.getBoundingClientRect().top).toBeGreaterThanOrEqual(box.top - 1);
    // All in view: no clip.
    scroller.scrollTop = 90;
    await expect.poll(() => getComputedStyle(frame).clipPath).toBe("none");
    expect(onTarget(deep, components[3]!)).toBe(true);
  });

  it("clips by each box a component's overflow belongs to, from the start edge on either axis", async () => {
    const { host } = await render(
      <Page>
        <div style={{ position: "relative" }}>
          <div style={{ height: 40, overflow: "hidden" }}>
            <div style={{ height: 60 }} />
            <div style={{ position: "absolute", top: 50 }}>
              <Button>Pinned</Button>
            </div>
            <div style={{ position: "fixed", right: 8, bottom: 80 }}>
              <Badge>Fixed</Badge>
            </div>
          </div>
          <div data-testid="across" style={{ overflowX: "clip", paddingTop: 24 }}>
            <div style={{ marginInlineStart: -20 }}>
              <Button>Across</Button>
            </div>
          </div>
        </div>
      </Page>,
    );
    const components = pageRoots(host);
    await drawn(components.length);
    // Out of the hidden box's overflow by their position, the pinned button and the fixed badge show in full.
    for (const index of [3, 4]) {
      expect(getComputedStyle(outlines()[index]!).visibility).toBe("visible");
      expect(getComputedStyle(outlines()[index]!.querySelector("[data-ouro-inspector-frame]")!).clipPath).toBe("none");
      expect(onTarget(outlines()[index]!, components[index]!)).toBe(true);
    }
    // Cut at its start edge, the button's outline starts at the box, and so does its tag.
    const across = outlines()[5]!;
    const box = host.querySelector('[data-testid="across"]')!.getBoundingClientRect();
    expect(getComputedStyle(across.querySelector("[data-ouro-inspector-frame]")!).clipPath).toBe("inset(0px 0px 0px 20px)");
    expect(tags()[5]!.getBoundingClientRect().left).toBeCloseTo(box.left, 0);
  });

  it("outlines only the components of an open modal, whose controls stay within reach", async () => {
    await page.viewport(390, 844);
    const onCopy = vi.fn();
    await render(
      <Page>
        <Dialog title="Share" trigger={<Button>Share</Button>}>
          <Button onClick={onCopy}>Copy link</Button>
        </Dialog>
      </Page>,
    );
    await drawn(4);
    await userEvent.click(page.getByRole("button", { name: "Share" }));
    const copy = page.getByRole("button", { name: "Copy link" }).element() as HTMLElement;
    await expect.poll(() => document.getAnimations().filter((animation) => animation.playState === "running").length).toBe(0);
    // The page behind the modal is out of reach, so X-ray leaves it: only the dialog (a sheet at this width) and its button.
    await expect.poll(() => tags().map((tag) => tag.textContent)).toEqual(["sheet", "button"]);
    await expect.poll(() => onTarget(outlines()[1]!, copy)).toBe(true);
    // Nothing of X-ray's lies over the dialog's controls, its bar included.
    await expect
      .poll(() => {
        const box = copy.getBoundingClientRect();
        return copy.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
      })
      .toBe(true);
    expect(getComputedStyle(layer()!.querySelector('[role="group"]')!).visibility).toBe("hidden");
    await userEvent.click(page.getByRole("button", { name: "Copy link" }));
    expect(onCopy).toHaveBeenCalledOnce();
  }, 15_000);

  it("hides the tag of a component an open menu covers, and leaves the menu's items within reach", async () => {
    await page.viewport(1280, 800);
    const onEdit = vi.fn();
    await render(
      <Page>
        <Menu trigger={<Button>Actions</Button>}>
          <MenuItem onClick={onEdit}>Edit</MenuItem>
          <MenuItem>Print</MenuItem>
          <MenuItem>Duplicate</MenuItem>
          <MenuItem>Delete</MenuItem>
        </Menu>
        <Button>Under</Button>
      </Page>,
    );
    await drawn(5);
    const under = page.getByRole("button", { name: "Under" }).element();
    await expect.poll(() => live(tagOn(under))).toBe(true);
    await userEvent.click(page.getByRole("button", { name: "Actions" }));
    await expect.element(page.getByRole("menu")).toBeVisible();
    await settled();
    await expect.poll(() => hidden(under)).toBe(true);
    await expect.poll(() => live(tagOn(page.getByRole("button", { name: "Actions" }).element()))).toBe(true);
    await userEvent.click(page.getByRole("menuitem", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledOnce();
    // With the menu gone, the tag is back.
    await expect.poll(() => live(tagOn(under))).toBe(true);
  }, 15_000);

  it("hides the tag of a component an open select list covers, and leaves its options within reach", async () => {
    await page.viewport(1280, 800);
    const onValueChange = vi.fn();
    await render(
      <Page>
        <Select
          label="Course"
          placeholder="Choose a course"
          onValueChange={onValueChange}
          options={["Starter", "Main", "Side", "Dessert", "Drink"].map((label) => ({ value: label.toLowerCase(), label }))}
        />
        <Button>Under</Button>
      </Page>,
    );
    await drawn(5);
    const under = page.getByRole("button", { name: "Under" }).element();
    await expect.poll(() => live(tagOn(under))).toBe(true);
    await userEvent.click(page.getByRole("combobox", { name: "Course" }));
    await expect.element(page.getByRole("listbox")).toBeVisible();
    await settled();
    await expect.poll(() => hidden(under)).toBe(true);
    await userEvent.click(page.getByRole("option", { name: "Dessert" }));
    expect(onValueChange).toHaveBeenCalledWith("dessert");
  }, 15_000);

  it("hides a tag an overlay lies over though its component shows", async () => {
    const { host } = await render(
      <Page>
        <Button>Under</Button>
      </Page>,
    );
    await drawn(4);
    const under = host.querySelectorAll('[data-ouro="button"]')[1]!;
    await expect.poll(() => tagOn(under)).toBeTruthy();
    const tag = tagOn(under)!;
    const box = tag.getBoundingClientRect();
    // An overlay's popup in its portal, lying over the tag but not the button.
    const portal = document.createElement("div");
    portal.setAttribute("data-ouro", "popover-portal");
    portal.style.cssText = `position: fixed; left: ${box.left}px; top: ${box.top}px; width: ${box.width}px; height: ${box.height}px; background: white`;
    document.body.append(portal);
    mounted.push(portal);
    await expect.poll(() => live(tag)).toBe(false);
    portal.style.left = `${box.right + 40}px`;
    await expect.poll(() => live(tag)).toBe(true);
  });

  it("hides the tag of a component the page covers where its tag points, right to left too", async () => {
    const { host } = await render(
      <Page>
        <div dir="rtl" style={{ position: "relative" }}>
          <Button>Covered</Button>
          <div data-testid="cover" style={{ position: "absolute", top: 0, insetInlineStart: 0, width: 24, height: 24, background: "white" }} />
        </div>
      </Page>,
    );
    await drawn(4);
    await expect.poll(() => tagOn(host.querySelectorAll('[data-ouro="button"]')[1]!)).toBeTruthy();
    const tag = tagOn(host.querySelectorAll('[data-ouro="button"]')[1]!)!;
    await expect.poll(() => live(tag)).toBe(false);
    // Moved to the far end, the cover leaves the corner the tag points to.
    const cover = host.querySelector<HTMLElement>('[data-testid="cover"]')!;
    cover.style.insetInlineStart = "auto";
    cover.style.insetInlineEnd = "0";
    await expect.poll(() => live(tag)).toBe(true);
  });

  it("keeps the tags of components inside a linked card, whose link stretches over them", async () => {
    const { host } = await render(
      <Page>
        <Card title="Overnight oats" href="/recipes/oats">
          <Badge>Vegan</Badge>
        </Card>
      </Page>,
    );
    await drawn(pageRoots(host).length);
    const badge = host.querySelectorAll('[data-ouro="badge"]')[1]!;
    // The card's link lies over the badge, but it is the card's own: the badge still shows its tag.
    const box = badge.getBoundingClientRect();
    expect(document.elementFromPoint(box.left + 4, box.top + 4)?.closest("[data-stretched-link]")).not.toBeNull();
    await expect.poll(() => live(tagOn(badge))).toBe(true);
    const tag = tagOn(badge)!;
    const at = tag.getBoundingClientRect();
    expect(document.elementFromPoint(at.left + at.width / 2, at.top + at.height / 2)).toBe(tag);
  });

  it("keeps its bar while a combobox list is open inside a popover, which leaves the page within reach", async () => {
    await page.viewport(1280, 800);
    await render(
      <Page>
        <Popover title="Filters" trigger={<Button>Filters</Button>}>
          <Combobox label="Herb" items={["Basil", "Dill", "Thyme"]} />
        </Popover>
      </Page>,
    );
    await drawn(4);
    await userEvent.click(page.getByRole("button", { name: "Filters" }));
    await userEvent.click(page.getByRole("combobox", { name: "Herb" }));
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(page.getByRole("listbox")).toBeVisible();
    await settled();
    // The open list hides the page from assistive technology, X-ray included, but no modal dialog shuts it off.
    expect(layer()!.closest('[aria-hidden="true"], [inert]')).not.toBeNull();
    await frame();
    expect(layer()!.hasAttribute("data-modal")).toBe(false);
    expect(getComputedStyle(layer()!.querySelector('[role="group"]')!).visibility).toBe("visible");
    expect(tags().slice(0, 4).map((tag) => tag.textContent)).toEqual(["button", "badge", "checkbox", "button"]);
  }, 15_000);

  it("keeps its bar while a popover is open, which leaves the page within reach", async () => {
    await page.viewport(1280, 800);
    await render(
      <Page>
        <Popover title="Share recipe" trigger={<Button>Share</Button>}>
          <p>Send it to a friend.</p>
        </Popover>
      </Page>,
    );
    await drawn(4);
    await userEvent.click(page.getByRole("button", { name: "Share" }));
    await expect.element(page.getByRole("dialog", { name: "Share recipe" })).toBeVisible();
    await settled();
    await frame();
    expect(layer()!.hasAttribute("data-modal")).toBe(false);
    const bar = layer()!.querySelector<HTMLElement>('[role="group"]')!;
    expect(getComputedStyle(bar).visibility).toBe("visible");
    // The page's own components keep their tags.
    expect(tags().slice(0, 4).map((tag) => tag.textContent)).toEqual(["button", "badge", "checkbox", "button"]);
    await userEvent.click(page.getByRole("group", { name: "X-ray" }).getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  }, 15_000);

  it("outlines a component added while it is open, and drops one that goes", async () => {
    const { rerender } = await render(<Page />);
    await drawn(3);
    await rerender(
      <Page>
        <Button>Added</Button>
      </Page>,
    );
    await drawn(4);
    expect(tags().map((tag) => tag.textContent)).toEqual(["button", "badge", "checkbox", "button"]);
    await rerender(<Page />);
    await drawn(3);
  });

  it("follows a component inside an overlay as it opens", async () => {
    // A centered dialog, not the sheet a phone width shows.
    await page.viewport(1280, 800);
    await render(
      <Page>
        <Dialog title="Share" trigger={<Button>Share</Button>}>
          <Button>Copy link</Button>
        </Dialog>
      </Page>,
    );
    await drawn(4);
    await userEvent.click(page.getByRole("button", { name: "Share" }));
    const copy = page.getByRole("button", { name: "Copy link" }).element();
    await expect.poll(() => tags().some((tag) => tag.textContent === "dialog")).toBe(true);
    await expect.poll(() => document.getAnimations().filter((animation) => animation.playState === "running").length).toBe(0);
    // The outlines follow on the inspector's next frame, which a loaded runner can draw late.
    await expect.poll(() => tags().some((tag, index) => tag.textContent === "button" && outlines()[index] !== undefined && onTarget(outlines()[index]!, copy))).toBe(true);
    // The outlines are above the dialog, so its components show theirs.
    expect(Number(getComputedStyle(layer()!).zIndex)).toBeGreaterThan(Number(getComputedStyle(document.querySelector('[data-ouro="dialog-portal"]')!).zIndex));
  }, 15_000);

  it("lets a click through an outline reach the control underneath, and only the tags take a pointer", async () => {
    const onClick = vi.fn();
    await render(
      <Page>
        <Button onClick={onClick}>Underneath</Button>
      </Page>,
    );
    await drawn(4);
    const button = page.getByRole("button", { name: "Underneath" }).element();
    const box = button.getBoundingClientRect();
    expect(document.elementFromPoint(box.left + box.width / 2, box.bottom - 4)).toBe(button);
    await userEvent.click(button, { position: { x: box.width / 2, y: box.height - 4 } });
    expect(onClick).toHaveBeenCalledOnce();
    for (const outline of outlines()) expect(getComputedStyle(outline).pointerEvents).toBe("none");
    for (const tag of tags()) expect(getComputedStyle(tag).pointerEvents).toBe("auto");
  });

  it("lists every component in document order in its sheet, with docs and source links", async () => {
    const sourceHref = (item: string, element: Element) => (item === "badge" ? undefined : `https://github.com/spoonjoy/spoonjoy-v2/blob/main/app/${item}.tsx#${element.tagName.toLowerCase()}`);
    await render(<Page inspector={{ sourceHref }} />);
    await drawn(3);
    await userEvent.click(page.getByRole("button", { name: "3 components" }));
    const sheet = page.getByRole("dialog", { name: "X-ray" });
    await expect.element(sheet).toBeVisible();
    const items = [...sheet.element().querySelectorAll("[data-ouro-inspector-list] li")];
    expect(items.map((item) => item.querySelector("code")!.textContent)).toEqual(["button", "badge", "checkbox"]);
    await expect.element(page.getByRole("link", { name: "Docs for checkbox (opens in a new tab)" })).toHaveAttribute("href", docsHref("checkbox"));
    await expect.element(page.getByRole("link", { name: "Source of button (opens in a new tab)" })).toHaveAttribute("href", "https://github.com/spoonjoy/spoonjoy-v2/blob/main/app/button.tsx#button");
    expect(items[1]!.textContent).not.toContain("Source");
    // The outlines hide while the list is open, so none crosses it.
    expect(getComputedStyle(layer()!).visibility).toBe("hidden");
    // Escape closes the list first, and X-ray stays on.
    await userEvent.keyboard("{Escape}");
    await expect.element(sheet).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(getComputedStyle(layer()!).visibility).toBe("visible");
  }, 15_000);

  it("closes with Escape and with its Close button, and gives focus back", async () => {
    await render(<Page open={false} />);
    const before = page.getByRole("button", { name: "Save recipe" }).element() as HTMLElement;
    before.focus();
    await act(() => setOpen(true));
    await drawn(3);
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await expect.poll(layer).toBeNull();
    expect(document.activeElement).toBe(before);
    await act(() => setOpen(true));
    await drawn(3);
    await userEvent.click(page.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledTimes(2);
    await expect.poll(layer).toBeNull();
    expect(document.activeElement).toBe(before);
  }, 15_000);

  it("leaves Escape to another overlay that has focus", async () => {
    await render(
      <Page>
        <Dialog title="Share" trigger={<Button>Share</Button>}>
          <p>Send it to a friend.</p>
        </Dialog>
      </Page>,
    );
    await drawn(4);
    await userEvent.click(page.getByRole("button", { name: "Share" }));
    await expect.element(page.getByRole("dialog", { name: "Share" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog", { name: "Share" })).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(layer()).not.toBeNull();
  }, 15_000);

  it("leaves an Escape the page has handled", async () => {
    await render(
      <Page>
        <input aria-label="Note" onKeyDown={(event) => event.key === "Escape" && event.preventDefault()} />
      </Page>,
    );
    await drawn(3);
    await userEvent.click(page.getByRole("textbox", { name: "Note" }));
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(layer()).not.toBeNull();
  });

  it("leaves Escape to an open combobox list, and closes on the next one", async () => {
    await render(
      <Page>
        <Combobox label="Herb" items={["Basil", "Dill", "Thyme"]} />
      </Page>,
    );
    await drawn(4);
    const input = page.getByRole("combobox", { name: "Herb" });
    await userEvent.click(input);
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(page.getByRole("listbox")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("listbox")).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(layer()).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await expect.poll(layer).toBeNull();
  }, 15_000);

  it("fades in when it opens, and appears at once with reduced motion", async () => {
    const base = parseDuration(getComputedStyle(document.documentElement).getPropertyValue("--ouro-duration-base"));
    await render(<Page open={false} />);
    for (const reduced of [false, true]) {
      await commands.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
      // Opened synchronously, so the check runs before the frame in which a layer with nothing to fade drops its entering state.
      flushSync(() => setOpen(true));
      const opened = layer()!;
      if (reduced) {
        await expectNoMotion(opened, { stem: "inspector", state: "data-starting-style", reduced });
        // Nothing moves: no transform runs on any outline either.
        for (const animation of document.getAnimations()) expect((animation as CSSTransition).transitionProperty).not.toMatch(/transform|translate|scale/);
      } else {
        await expectMotion(opened, { stem: "inspector", state: "data-starting-style", properties: { opacity: base }, reduced });
      }
      await expect.poll(() => opened.hasAttribute("data-starting-style")).toBe(false);
      expect(getComputedStyle(opened).opacity).toBe("1");
      await act(() => setOpen(false));
    }
  }, 15_000);

  it("puts a tag inside its outline at the top of the screen", async () => {
    const { host } = await render(<Page />);
    await drawn(3);
    scrollTo(0, pageRoots(host)[0]!.getBoundingClientRect().top + scrollY - 4);
    await expect.poll(() => tags()[0]!.hasAttribute("data-inside")).toBe(true);
    expect(tags()[1]!.hasAttribute("data-inside")).toBe(false);
  });

  it("counts one component in the singular, and links Ouro's public docs by default", async () => {
    await render(
      <div>
        <Button>Only one</Button>
        <Inspector open onOpenChange={() => {}} />
      </div>,
    );
    await drawn(1);
    await expect.element(page.getByRole("button", { name: "1 component", exact: true })).toBeVisible();
    expect(tags()[0]!.getAttribute("href")).toBe("https://ourostack.github.io/ouro-ui/docs/button/");
  });

  it("renders nothing while closed, and nothing on the server", async () => {
    await render(<Page open={false} />);
    expect(layer()).toBeNull();
    expect(renderToString(<Inspector open onOpenChange={() => {}} docsHref={docsHref} />)).toBe("");
  });

  it("names a guessed prop, and has no messages for valid props", async () => {
    await render(<Page inspector={{ label: "Components" }} />);
    await act(async () => {});
    expect(warn).not.toHaveBeenCalled();
    const guessed = { isOpen: true, onClose: () => {}, label: "" } as unknown as Partial<InspectorProps>;
    await render(<Inspector open={false} onOpenChange={() => {}} docsHref={docsHref} {...guessed} />);
    await expect.poll(() => warn.mock.calls.map((call: unknown[]) => String(call[0]))).toEqual([
      '[ouro-ui] Inspector: label is empty; it names the bar and its list. Fix: <Inspector label="X-ray">.',
      "[ouro-ui] Inspector: isOpen is not a prop. Fix: <Inspector open={xray} onOpenChange={setXray}>.",
      "[ouro-ui] Inspector: onClose is not a prop; onOpenChange gets false when X-ray closes. Fix: <Inspector open={xray} onOpenChange={setXray}>.",
    ]);
  });
});
