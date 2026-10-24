import axe from "axe-core";
import { createRef, StrictMode, useState, type AnchorHTMLAttributes, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Tooltip } from "~/components/ouro/tooltip/tooltip";
import {
  Menu,
  MenuBar,
  MenuCheckboxItem,
  MenuGroup,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  type MenuEntry,
  type MenuProps,
} from "~/components/ouro/menu/menu";
import { OuroProvider } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";
import { isTransparent } from "~/lib/ouro/testing/color";
import { axeExclude } from "~/lib/ouro/testing/axe";

/** The colour behind an element: the nearest background around it that is not transparent. */
function behind(element: Element): string {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return "rgb(255, 255, 255)";
}


// Runs in Chromium and WebKit.

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "160px 400px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return { host, rerender: (next: ReactNode) => act(async () => root.render(next)) };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  await page.viewport(1280, 800);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await userEvent.unhover(document.body);
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  await commands.emulateMedia({ reducedMotion: "no-preference", forcedColors: "none" });
});

const warnings = () => warn.mock.calls.map((call: unknown[]) => call[0]);
const menus = () => [...document.querySelectorAll<HTMLElement>('[data-ouro="menu"]')];
const menu = () => menus()[0] ?? null;
const trigger = () => document.querySelector<HTMLElement>('[data-ouro="button"]')!;

describe("Menu current-page forced colors", () => {
  afterEach(() => document.documentElement.removeAttribute("dir"));
  /** The highlighted item's fill against its popup's, under forced colours, which paint plain fills in the canvas colour. */
  const highlightShows = (highlighted: Element) => getComputedStyle(highlighted).backgroundColor !== behind(highlighted);

  it("shows the highlighted item in the system's highlight colours, where its fill is dropped", async () => {
    await render(<Menu trigger={<Button>Account</Button>}><MenuItem onClick={() => {}}>Edit</MenuItem><MenuItem onClick={() => {}}>Duplicate</MenuItem></Menu>);
    trigger().focus();
    await userEvent.keyboard("{Enter}");
    const edit = page.getByRole("menuitem", { name: "Edit", exact: true });
    await expect.element(edit).toHaveAttribute("data-highlighted");
    await commands.emulateMedia({ forcedColors: "active" });
    expect(highlightShows(edit.element())).toBe(true);
    expect(getComputedStyle(edit.element()).color).not.toBe(getComputedStyle(page.getByRole("menuitem", { name: "Duplicate", exact: true }).element()).color);
  });

  for (const direction of ["ltr", "rtl"] as const) {
    it(`keeps its ${direction} start-edge mark visible in the system palette`, async () => {
      document.documentElement.dir = direction;
      await render(<Menu trigger={<Button>Account</Button>}><MenuItem href="/settings" current>Settings</MenuItem></Menu>);
      await userEvent.click(trigger());
      const current = page.getByRole("menuitem", { name: "Settings", exact: true });
      await expect.element(current).toBeVisible();
      await commands.emulateMedia({ forcedColors: "active" });
      expect(matchMedia("(forced-colors: active)").matches).toBe(true);
      const marker = getComputedStyle(current.element(), "::before");
      expect(marker[direction === "rtl" ? "borderRightWidth" : "borderLeftWidth"]).toBe("2px");
      expect(marker.borderInlineStartColor).toBe(getComputedStyle(current.element()).color);
      expect(marker.borderInlineStartColor).not.toBe(getComputedStyle(current.element()).backgroundColor);
    });
  }
});
const item = (name: string) => page.getByRole("menuitem", { name: new RegExp(`^${name}`) });
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Waits until the open menu has finished any entrance. */
async function settled() {
  await expect
    .poll(() => {
      const element = menu();
      return Boolean(element && !element.hasAttribute("data-starting-style") && element.getAnimations().length === 0);
    })
    .toBe(true);
  return menu()!;
}

const basicItems = (
  <>
    <MenuItem onClick={() => {}}>Edit</MenuItem>
    <MenuItem onClick={() => {}}>Duplicate</MenuItem>
  </>
);

async function openDropdown(props: Partial<MenuProps> = {}, children: ReactNode = basicItems) {
  await render(
    <Menu trigger={<Button>Actions</Button>} {...(props as object)}>
      {children}
    </Menu>,
  );
  await userEvent.click(trigger());
  return settled();
}

describe("Menu dropdown", () => {
  it("opens a menu below its trigger, aligned to its start, named by the trigger", async () => {
    const element = await openDropdown();
    await expect.element(page.getByRole("menu", { name: "Actions" })).toBeVisible();
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(element.getAttribute("data-ouro-presentation")).toBe("menu");
    const box = element.getBoundingClientRect();
    const anchor = trigger().getBoundingClientRect();
    expect(Math.abs(box.top - anchor.bottom - 4)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.left - anchor.left)).toBeLessThanOrEqual(1);
    expect(document.querySelector('[data-ouro="menu-backdrop"]')).toBeNull();
  });

  it("runs an item's onClick, closes and returns focus to the trigger after a mouse open", async () => {
    // Safari does not focus a button on click, so focus must go back to the trigger by name.
    const onClick = vi.fn();
    await openDropdown({}, <MenuItem onClick={onClick}>Edit</MenuItem>);
    await userEvent.click(item("Edit"));
    expect(onClick).toHaveBeenCalledOnce();
    await expect.poll(menu).toBeNull();
    await expect.poll(() => document.activeElement).toBe(trigger());
  });

  it("leaves focus with the action destination when the menu finishes closing", async () => {
    const destination = createRef<HTMLButtonElement>();
    const content = (open: boolean) => (
      <>
        <Menu open={open} onOpenChange={() => {}} trigger={<Button>Actions</Button>}>
          {basicItems}
        </Menu>
        <button ref={destination}>Next action</button>
      </>
    );
    const { rerender } = await render(content(true));
    await settled();
    await expect.poll(() => menu()?.contains(document.activeElement)).toBe(true);
    destination.current!.focus();
    expect(document.activeElement).toBe(destination.current);
    await rerender(content(false));
    await expect.poll(menu).toBeNull();
    await nextFrame();
    expect(document.activeElement).toBe(destination.current);
  });

  it("opens from the keyboard on its first item, moves with the arrows and closes on Escape", async () => {
    await render(<Menu trigger={<Button>Actions</Button>}>{basicItems}</Menu>);
    trigger().focus();
    await userEvent.keyboard("{Enter}");
    await settled();
    await expect.poll(() => document.activeElement?.textContent).toBe("Edit");
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toBe("Duplicate");
    await userEvent.keyboard("{Escape}");
    await expect.poll(menu).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it.each([
    ["top", "end"],
    ["right", "start"],
  ] as const)("sits on side %s, aligned %s", async (side, align) => {
    const element = await openDropdown({ side, align });
    const box = element.getBoundingClientRect();
    const anchor = trigger().getBoundingClientRect();
    if (side === "top") expect(Math.abs(anchor.top - box.bottom - 4)).toBeLessThanOrEqual(1);
    if (side === "right") expect(Math.abs(box.left - anchor.right - 4)).toBeLessThanOrEqual(1);
    if (align === "end") expect(Math.abs(box.right - anchor.right)).toBeLessThanOrEqual(1);
    if (align === "start") expect(Math.abs(box.top - anchor.top)).toBeLessThanOrEqual(1);
  });

  it("is at least 12rem wide, and className sets layout", async () => {
    expect((await openDropdown()).getBoundingClientRect().width).toBeGreaterThanOrEqual(192);
    await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    expect((await openDropdown({ className: "w-80" })).getBoundingClientRect().width).toBe(320);
  });

  it("keeps the trigger's own ref and onClick", async () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    await render(
      <Menu
        trigger={
          <Button ref={ref} onClick={onClick}>
            Actions
          </Button>
        }
      >
        {basicItems}
      </Menu>,
    );
    expect(ref.current).toBe(trigger());
    await userEvent.click(trigger());
    expect(onClick).toHaveBeenCalledOnce();
    await settled();
  });

  it("shares its trigger with a Tooltip, which still shows on hover", async () => {
    await render(
      <Menu
        trigger={
          <Tooltip content="More actions">
            <Button aria-label="More">…</Button>
          </Tooltip>
        }
      >
        {basicItems}
      </Menu>,
    );
    const button = page.getByRole("button", { name: "More" });
    await userEvent.hover(button);
    await expect.poll(() => document.querySelector('[data-ouro="tooltip"]')?.textContent).toBe("More actions");
    await userEvent.click(button);
    await settled();
    expect(button.element().getAttribute("aria-haspopup")).toBe("menu");
    await userEvent.keyboard("{Escape}");
    await expect.poll(menu).toBeNull();
    expect(warnings()).toEqual([]);
  });

  it("can be controlled with open and onOpenChange", async () => {
    function Controlled() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <span data-testid="state">{open ? "open" : "closed"}</span>
          <Menu trigger={<Button>Actions</Button>} open={open} onOpenChange={setOpen}>
            {basicItems}
          </Menu>
        </>
      );
    }
    await render(<Controlled />);
    await userEvent.click(trigger());
    await settled();
    expect(page.getByTestId("state").element().textContent).toBe("open");
    await userEvent.keyboard("{Escape}");
    await expect.poll(menu).toBeNull();
    expect(page.getByTestId("state").element().textContent).toBe("closed");
  });
});

describe("Menu items", () => {
  it("shows a shortcut with Kbd at the end of the item", async () => {
    await openDropdown({}, <MenuItem shortcut={["mod", "e"]}>Edit</MenuItem>);
    const kbd = item("Edit").element().querySelector<HTMLElement>('[data-ouro="kbd"]')!;
    expect(kbd).not.toBeNull();
    expect(kbd.textContent).toMatch(/E$/);
    const box = item("Edit").element().getBoundingClientRect();
    expect(Math.abs(kbd.getBoundingClientRect().right - (box.right - 8))).toBeLessThanOrEqual(1);
  });

  it("paints tone destructive in the destructive color", async () => {
    await openDropdown({}, <MenuItem tone="destructive">Delete</MenuItem>);
    const element = item("Delete").element() as HTMLElement;
    expect(element.getAttribute("data-tone")).toBe("destructive");
    const probe = document.createElement("span");
    probe.style.color = "color-mix(in oklab, var(--destructive) 80%, var(--foreground))";
    document.body.append(probe);
    mounted.push(probe);
    expect(getComputedStyle(element).color).toBe(getComputedStyle(probe).color);
  });

  it("keeps the shortcut out of the item's name and announces it with aria-keyshortcuts", async () => {
    await openDropdown(
      {},
      <>
        <MenuItem shortcut={["mod", "shift", "e"]}>Edit</MenuItem>
        <MenuCheckboxItem shortcut={["alt", "backspace"]}>Pin</MenuCheckboxItem>
      </>,
    );
    const edit = page.getByRole("menuitem", { name: "Edit", exact: true }).element();
    expect(edit.getAttribute("aria-keyshortcuts")).toBe("Control+Shift+E Meta+Shift+E");
    expect(edit.querySelector('[data-ouro="kbd"]')!.getAttribute("aria-hidden")).toBe("true");
    const pin = page.getByRole("menuitemcheckbox", { name: "Pin", exact: true }).element();
    expect(pin.getAttribute("aria-keyshortcuts")).toBe("Alt+Backspace");
  });

  it("lets a modifier-click on an href item through, so the browser opens the link in a new tab", async () => {
    await render(
      <Menu trigger={<Button>Actions</Button>}>
        <MenuItem href="/recipes/1">Open recipe</MenuItem>
        <MenuItem href="https://example.com/recipes">Website</MenuItem>
      </Menu>,
    );
    const prevented: boolean[] = [];
    // Runs after every handler of the page; it records the outcome, then keeps the test page from opening tabs.
    const record = (event: MouseEvent) => {
      prevented.push(event.defaultPrevented);
      event.preventDefault();
    };
    window.addEventListener("click", record);
    try {
      for (const name of ["Open recipe", "Website"]) {
        await userEvent.click(trigger());
        await settled();
        await userEvent.click(item(name), { modifiers: ["ControlOrMeta"] });
        await expect.poll(menu).toBeNull();
      }
    } finally {
      window.removeEventListener("click", record);
    }
    expect(prevented.slice(-2)).toEqual([false, false]);
  });

  it("marks a link item as the current page with current, and shows it", async () => {
    await render(
      <Menu trigger={<Button>Settings</Button>}>
        <MenuItem href="/settings/profile">Profile</MenuItem>
        <MenuItem href="/settings/billing" current>
          Billing
        </MenuItem>
        <MenuItem onClick={() => {}} current>
          Sign out
        </MenuItem>
      </Menu>,
    );
    await userEvent.click(trigger());
    await settled();
    const element = (name: string) => item(name).element() as HTMLElement;
    expect(element("Billing").getAttribute("aria-current")).toBe("page");
    expect(element("Profile").hasAttribute("aria-current")).toBe(false);
    // Only a link can be the current page.
    expect(element("Sign out").hasAttribute("aria-current")).toBe(false);
  });

  it("tells the current item from the highlighted one without relying on color", async () => {
    await render(
      <Menu trigger={<Button>Settings</Button>}>
        <MenuItem href="/settings/profile">Profile</MenuItem>
        <MenuItem href="/settings/billing" current>
          Billing
        </MenuItem>
      </Menu>,
    );
    await userEvent.click(trigger());
    await settled();
    const element = (name: string) => item(name).element() as HTMLElement;
    const look = (target: HTMLElement) => {
      const style = getComputedStyle(target);
      return { background: style.backgroundColor, weight: style.fontWeight, bar: getComputedStyle(target, "::before").width };
    };
    element("Profile").setAttribute("data-highlighted", "");
    element("Billing").removeAttribute("data-highlighted");
    const highlighted = look(element("Profile"));
    const current = look(element("Billing"));
    // The highlight is a tint; the current page is a heavier label with a bar at the start edge.
    expect(isTransparent(highlighted.background)).toBe(false);
    expect(isTransparent(current.background)).toBe(true);
    expect(Number(current.weight)).toBeGreaterThan(Number(highlighted.weight));
    expect(parseFloat(current.bar)).toBeGreaterThan(0);
    expect(highlighted.bar).not.toBe(current.bar);
  });

  it("renders href as a link through OuroProvider's linkComponent, and closes on click", async () => {
    const seen: string[] = [];
    function AppLink(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
      seen.push(props.href);
      return <a {...props} data-app-link="" onClick={(event) => (event.preventDefault(), props.onClick?.(event))} />;
    }
    await render(
      <OuroProvider linkComponent={AppLink}>
        <Menu trigger={<Button>Actions</Button>}>
          <MenuItem href="/recipes/1">Open recipe</MenuItem>
          <MenuItem href="https://example.com" disabled>
            Website
          </MenuItem>
        </Menu>
      </OuroProvider>,
    );
    await userEvent.click(trigger());
    await settled();
    const link = item("Open recipe").element();
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/recipes/1");
    expect(link.hasAttribute("data-app-link")).toBe(true);
    expect(seen).toContain("/recipes/1");
    // A disabled link is a disabled item, with no href to follow.
    const disabled = item("Website").element();
    expect(disabled.hasAttribute("href")).toBe(false);
    expect(disabled.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(link);
    await expect.poll(menu).toBeNull();
  });

  it("toggles a checkbox item and stays open", async () => {
    const onCheckedChange = vi.fn();
    await openDropdown(
      {},
      <MenuCheckboxItem defaultChecked onCheckedChange={onCheckedChange} shortcut={["mod", "b"]}>
        Show ingredients
      </MenuCheckboxItem>,
    );
    const box = page.getByRole("menuitemcheckbox", { name: /Show ingredients/ });
    expect(box.element().getAttribute("aria-checked")).toBe("true");
    expect(box.element().querySelector("[data-ouro-menu-indicator] svg")).not.toBeNull();
    await userEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(false);
    expect(box.element().getAttribute("aria-checked")).toBe("false");
    expect(menu()).not.toBeNull();
  });

  it("picks one radio item in a labelled group", async () => {
    const onValueChange = vi.fn();
    await openDropdown(
      {},
      <MenuRadioGroup label="Sort by" defaultValue="name" onValueChange={onValueChange}>
        <MenuRadioItem value="name">Name</MenuRadioItem>
        <MenuRadioItem value="date">Date</MenuRadioItem>
      </MenuRadioGroup>,
    );
    await expect.element(page.getByRole("group", { name: "Sort by" })).toBeVisible();
    const name = page.getByRole("menuitemradio", { name: "Name" });
    const date = page.getByRole("menuitemradio", { name: "Date" });
    expect(name.element().getAttribute("aria-checked")).toBe("true");
    await userEvent.click(date);
    expect(onValueChange).toHaveBeenCalledWith("date");
    expect(date.element().getAttribute("aria-checked")).toBe("true");
    expect(name.element().getAttribute("aria-checked")).toBe("false");
  });

  it("indents every item when the menu has checkbox or radio items, so labels line up", async () => {
    await openDropdown(
      {},
      <>
        <MenuItem>Plain</MenuItem>
        <MenuCheckboxItem>Checked</MenuCheckboxItem>
      </>,
    );
    const plain = item("Plain").element().getBoundingClientRect();
    const plainText = (item("Plain").element().firstChild as Text | null)?.parentElement;
    const range = document.createRange();
    range.selectNodeContents(plainText!);
    const checked = page.getByRole("menuitemcheckbox", { name: "Checked" }).element();
    const label = checked.querySelector<HTMLElement>("[data-ouro-menu-label]")!.getBoundingClientRect();
    const plainLabel = item("Plain").element().querySelector<HTMLElement>("[data-ouro-menu-label]")!.getBoundingClientRect();
    expect(Math.round(plainLabel.left)).toBe(Math.round(label.left));
    expect(plainLabel.left - plain.left).toBeGreaterThan(20);
  });

  it("labels a group, and separates items with a separator", async () => {
    await openDropdown(
      {},
      <>
        <MenuGroup label="Recipe">
          <MenuItem>Edit</MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuItem>Sign out</MenuItem>
      </>,
    );
    await expect.element(page.getByRole("group", { name: "Recipe" })).toBeVisible();
    expect(menu()!.querySelector('[role="separator"]')).not.toBeNull();
  });

  it("opens a submenu beside its item from the keyboard, and closes it with ArrowLeft", async () => {
    await render(
      <Menu trigger={<Button>Actions</Button>}>
        <MenuItem>Edit</MenuItem>
        <MenuSub label="Share">
          <MenuItem>Copy link</MenuItem>
        </MenuSub>
      </Menu>,
    );
    trigger().focus();
    await userEvent.keyboard("{Enter}");
    await settled();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement?.textContent).toContain("Share");
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => menus().length).toBe(2);
    await expect.poll(() => document.activeElement?.textContent).toBe("Copy link");
    const [parent, child] = menus();
    expect(child!.getBoundingClientRect().left).toBeGreaterThanOrEqual(parent!.getBoundingClientRect().right - 8);
    // The Back item is for the phone sheet only.
    expect(child!.querySelector("[data-ouro-menu-back]")).toBeNull();
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(() => menus().length).toBe(1);
  });

  it("renders every entry type from items", async () => {
    const onClick = vi.fn();
    const entries: MenuEntry[] = [
      { label: "Edit", onClick, shortcut: ["mod", "e"] },
      { label: "Open", href: "/recipes/1" },
      { type: "separator" },
      { type: "checkbox", label: "Pin", defaultChecked: true },
      { type: "radio", label: "Sort", defaultValue: "a", options: [{ value: "a", label: "A" }, { value: "b", label: "B", disabled: true }] },
      { type: "group", label: "Danger", items: [{ label: "Delete", tone: "destructive", disabled: true }] },
      { type: "submenu", label: "Share", items: [{ label: "Copy link" }] },
    ];
    await render(<Menu trigger={<Button>Actions</Button>} items={entries} />);
    await userEvent.click(trigger());
    await settled();
    expect([...menu()!.querySelectorAll("[role^=menuitem]")].map((element) => element.getAttribute("role"))).toEqual([
      "menuitem",
      "menuitem",
      "menuitemcheckbox",
      "menuitemradio",
      "menuitemradio",
      "menuitem",
      "menuitem",
    ]);
    expect(menu()!.querySelectorAll('[role="separator"]')).toHaveLength(1);
    await expect.element(page.getByRole("group", { name: "Danger" })).toBeVisible();
    await expect.element(page.getByRole("group", { name: "Sort" })).toBeVisible();
    expect(page.getByRole("menuitemradio", { name: "B" }).element().getAttribute("aria-disabled")).toBe("true");
    expect(item("Open").element().getAttribute("href")).toBe("/recipes/1");
    expect(item("Edit").element().querySelector('[data-ouro="kbd"]')).not.toBeNull();
    await userEvent.click(item("Edit"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("takes a submenu's backLabel from items, for the phone sheet's Back item", async () => {
    await page.viewport(390, 844);
    await render(<Menu trigger={<Button>Actions</Button>} items={[{ type: "submenu", label: "Partager", backLabel: "Retour", items: [{ label: "Copier le lien" }] }]} />);
    await userEvent.click(trigger());
    await settled();
    await userEvent.click(item("Partager"));
    await expect.element(item("Retour")).toBeVisible();
    expect(document.body.textContent).not.toContain("Back");
  });

  it("has no axe violations open, with every item type", async () => {
    await openDropdown(
      {},
      <>
        <MenuGroup label="Recipe">
          <MenuItem shortcut={["mod", "e"]}>Edit</MenuItem>
          <MenuItem tone="destructive">Delete</MenuItem>
        </MenuGroup>
        <MenuSeparator />
        <MenuCheckboxItem defaultChecked>Pin</MenuCheckboxItem>
        <MenuRadioGroup label="Sort" defaultValue="a">
          <MenuRadioItem value="a">A</MenuRadioItem>
        </MenuRadioGroup>
        <MenuSub label="Share">
          <MenuItem>Copy link</MenuItem>
        </MenuSub>
      </>,
    );
    for (const scheme of ["light", "dark"]) {
      document.documentElement.classList.toggle("dark", scheme === "dark");
      const result = await axe.run(
        { include: [document.documentElement], exclude: axeExclude.map((selector) => [selector]) },
        { resultTypes: ["violations"], rules: { region: { enabled: false }, "landmark-one-main": { enabled: false }, "page-has-heading-one": { enabled: false } } },
      );
      expect(result.violations.map((violation) => violation.id)).toEqual([]);
    }
    document.documentElement.classList.remove("dark");
  });
});

describe("Menu presentation", () => {
  it("is a bottom sheet below 640px, with a backdrop, and its submenu is a sheet with a Back item", async () => {
    await page.viewport(390, 844);
    await render(
      <Menu trigger={<Button>Actions</Button>}>
        <MenuItem>Edit</MenuItem>
        <MenuSub label="Share" backLabel="Return">
          <MenuItem>Copy link</MenuItem>
        </MenuSub>
      </Menu>,
    );
    await userEvent.click(trigger());
    const element = await settled();
    expect(element.getAttribute("data-ouro-presentation")).toBe("sheet");
    const box = element.getBoundingClientRect();
    expect(Math.round(box.bottom)).toBe(innerHeight);
    expect(Math.round(box.left)).toBe(0);
    expect(Math.round(box.width)).toBe(innerWidth);
    expect(document.querySelector('[data-ouro="menu-backdrop"]')).not.toBeNull();
    await userEvent.click(item("Share"));
    await expect.poll(() => menus().length).toBe(2);
    const sub = menus()[1]!;
    expect(sub.getAttribute("data-ouro-presentation")).toBe("sheet");
    await expect.poll(() => Math.round(sub.getBoundingClientRect().bottom)).toBe(innerHeight);
    await userEvent.click(item("Return"));
    await expect.poll(() => menus().length).toBe(1);
    expect(menu()).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(menu).toBeNull();
    await expect.poll(() => document.activeElement).toBe(trigger());
  });

  it("ends the phone sheet with a Close item that screen-reader and switch users can reach, and closes on Escape", async () => {
    await page.viewport(390, 844);
    await render(
      <Menu trigger={<Button>Actions</Button>} closeLabel="Fermer">
        <MenuItem>Edit</MenuItem>
      </Menu>,
    );
    await userEvent.click(trigger());
    const element = await settled();
    const entries = [...element.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const close = entries.at(-1)!;
    expect(close.textContent).toBe("Fermer");
    expect(close.getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
    expect(getComputedStyle(close).visibility).toBe("visible");
    await userEvent.click(close);
    await expect.poll(menu).toBeNull();
    await expect.poll(() => document.activeElement).toBe(trigger());
    // Escape closes the sheet too, from the keyboard (and from VoiceOver's escape gesture, which sends it).
    await userEvent.click(trigger());
    await settled();
    await userEvent.keyboard("{Escape}");
    await expect.poll(menu).toBeNull();
  });

  it("labels the sheet's Close item Close by default, and has none beside its trigger", async () => {
    await page.viewport(390, 844);
    const { rerender } = await render(
      <Menu trigger={<Button>Actions</Button>}>
        <MenuItem>Edit</MenuItem>
      </Menu>,
    );
    await userEvent.click(trigger());
    await settled();
    await expect.element(page.getByRole("menuitem", { name: "Close", exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.poll(menu).toBeNull();
    await page.viewport(1280, 800);
    await rerender(
      <Menu trigger={<Button>Actions</Button>}>
        <MenuItem>Edit</MenuItem>
      </Menu>,
    );
    await userEvent.click(trigger());
    await settled();
    expect(menu()!.querySelector("[data-ouro-menu-close]")).toBeNull();
  });

  it("labels the submenu's Back item Back by default", async () => {
    await page.viewport(390, 844);
    await render(
      <Menu trigger={<Button>Actions</Button>}>
        <MenuSub label="Share">
          <MenuItem>Copy link</MenuItem>
        </MenuSub>
      </Menu>,
    );
    await userEvent.click(trigger());
    await settled();
    await userEvent.click(item("Share"));
    await expect.element(item("Back")).toBeVisible();
  });

  it("stays open, with the same trigger node, when a resize crosses 640px", async () => {
    await openDropdown();
    const node = trigger();
    await page.viewport(390, 844);
    await expect.poll(() => menu()?.getAttribute("data-ouro-presentation")).toBe("sheet");
    expect(trigger()).toBe(node);
    await page.viewport(1280, 800);
    await expect.poll(() => menu()?.getAttribute("data-ouro-presentation")).toBe("menu");
  });

  it("slides the sheet up on the drawer easing token, and only fades under reduced motion", async () => {
    await page.viewport(390, 844);
    const element = await openDropdown();
    expect(getComputedStyle(element).transitionTimingFunction.split(/,\s(?![^(]*\))/)[0]).toBe("cubic-bezier(0.32, 0.72, 0, 1)");
    expect(getComputedStyle(element).transitionDuration.split(", ")[0]).toBe("0.5s");
    element.style.transition = "none";
    element.setAttribute("data-starting-style", "");
    expect(new DOMMatrix(getComputedStyle(element).transform).f).toBeGreaterThan(10);
    element.removeAttribute("data-starting-style");
    element.style.transition = "";
    await userEvent.keyboard("{Escape}");
    await expect.poll(menu).toBeNull();
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await userEvent.click(trigger());
    const reduced = await settled();
    reduced.style.transition = "none";
    reduced.setAttribute("data-starting-style", "");
    expect(getComputedStyle(reduced).transform).toBe("none");
    expect(getComputedStyle(reduced).opacity).toBe("0");
    reduced.removeAttribute("data-starting-style");
  });
});

describe("Menu modal", () => {
  /** Whether the page's scroll is locked: Base UI hides the overflow of the element that scrolls the page. */
  const locked = () => [document.documentElement, document.body].some((element) => /hidden|clip/.test(getComputedStyle(element).overflowY));

  it("holds the page while open: its scroll is locked, and a click outside only closes it", async () => {
    const outside = vi.fn();
    await render(
      <>
        <Menu trigger={<Button>Actions</Button>}>{basicItems}</Menu>
        <button type="button" data-testid="outside" onClick={outside}>
          Outside
        </button>
      </>,
    );
    await expect.poll(locked).toBe(false);
    await userEvent.click(trigger());
    await settled();
    await expect.poll(locked).toBe(true);
    // Forced: the open menu keeps the pointer from the page, so the click lands where the button is.
    await userEvent.click(document.querySelector<HTMLElement>("[data-testid=outside]")!, { force: true });
    await expect.poll(menu).toBeNull();
    expect(outside).not.toHaveBeenCalled();
    await expect.poll(locked).toBe(false);
  });

  it("with modal={false}, leaves the page's scroll alone while a modal Menu's lock comes and goes", async () => {
    function Pair() {
      const [held, setHeld] = useState(false);
      return (
        <>
          <Menu modal={false} open onOpenChange={() => {}} trigger={<Button>Light</Button>}>
            <MenuItem onClick={() => {}}>Paint</MenuItem>
          </Menu>
          <Menu open={held} onOpenChange={setHeld} trigger={<Button>Heavy</Button>}>
            <MenuItem onClick={() => {}}>Hoist</MenuItem>
          </Menu>
        </>
      );
    }
    await render(<Pair />);
    await expect.element(page.getByRole("menuitem", { name: "Paint", exact: true })).toBeVisible();
    // The positive control: the modal Menu, opened while the light one stays open, locks the page...
    await userEvent.click(page.getByRole("button", { name: "Heavy", exact: true }));
    await expect.poll(locked).toBe(true);
    // ...and unlocks it as it closes, which a lock of the light menu's own would prevent.
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.body.textContent?.includes("Hoist")).toBe(false);
    await expect.poll(locked).toBe(false);
    await expect.element(page.getByRole("menuitem", { name: "Paint", exact: true })).toBeVisible();
  });

  it("with modal={false}, leaves the page's controls live: a click outside reaches them and closes the menu", async () => {
    const outside = vi.fn();
    await render(
      <>
        <Menu modal={false} trigger={<Button>Actions</Button>}>
          {basicItems}
        </Menu>
        <button type="button" onClick={outside}>
          Outside
        </button>
      </>,
    );
    await userEvent.click(trigger());
    await settled();
    await userEvent.click(page.getByRole("button", { name: "Outside", exact: true }));
    expect(outside).toHaveBeenCalledOnce();
    await expect.poll(menu).toBeNull();
    // A dropdown takes modal without a word.
    expect(warnings()).toEqual([]);
  });

  it("keeps the phone sheet holding the page with modal={false}", async () => {
    await page.viewport(390, 844);
    await render(
      <Menu modal={false} trigger={<Button>Actions</Button>}>
        {basicItems}
      </Menu>,
    );
    await userEvent.click(trigger());
    expect((await settled()).getAttribute("data-ouro-presentation")).toBe("sheet");
    await expect.poll(locked).toBe(true);
  });

  it("warns that a context menu does not use modal, and drops it", async () => {
    await render(
      <Menu contextTrigger={<div>Area</div>} {...({ modal: false } as object)}>
        {basicItems}
      </Menu>,
    );
    await act(nextFrame);
    expect(warnings()).toEqual(["[ouro-ui] Menu: modal is not used by a context menu, which holds the page while open. Fix: remove modal."]);
  });

  it("warns that a menu in a MenuBar does not use modal: the bar decides", async () => {
    await render(
      <MenuBar aria-label="Recipe editor">
        <Menu label="File" {...({ modal: false } as object)}>
          {basicItems}
        </Menu>
      </MenuBar>,
    );
    await act(nextFrame);
    expect(warnings()).toEqual(["[ouro-ui] Menu: modal is not used by a menu in <MenuBar>; the bar decides. Fix: remove modal."]);
  });
});

describe("Menu context trigger", () => {
  const area = () => document.querySelector<HTMLElement>("[data-testid=area]")!;

  async function renderContext(onClick = vi.fn()) {
    await render(
      <Menu contextTrigger={<div data-testid="area" style={{ width: 300, height: 200 }}>Recipe card text</div>}>
        <MenuItem onClick={onClick}>Copy</MenuItem>
      </Menu>,
    );
    return onClick;
  }

  it("opens at the pointer on right-click", async () => {
    const onClick = await renderContext();
    expect(area().hasAttribute("aria-haspopup")).toBe(false);
    await userEvent.click(area(), { button: "right", position: { x: 40, y: 30 } });
    const element = await settled();
    expect(element.getAttribute("data-ouro-presentation")).toBe("menu");
    const box = element.getBoundingClientRect();
    const where = area().getBoundingClientRect();
    expect(Math.abs(box.left - (where.left + 40))).toBeLessThanOrEqual(12);
    expect(Math.abs(box.top - (where.top + 30))).toBeLessThanOrEqual(12);
    await userEvent.click(item("Copy"));
    expect(onClick).toHaveBeenCalledOnce();
    await expect.poll(menu).toBeNull();
  });

  it("stays a menu at the pointer on a phone, not a sheet", async () => {
    await page.viewport(390, 844);
    await renderContext();
    await userEvent.click(area(), { button: "right", position: { x: 20, y: 20 } });
    expect((await settled()).getAttribute("data-ouro-presentation")).toBe("menu");
  });

  it("keeps the area's text selectable and its callout until a press starts", async () => {
    await renderContext();
    expect(area().style.getPropertyValue("-webkit-touch-callout")).toBe("");
    expect(getComputedStyle(area()).userSelect).not.toBe("none");
    expect(area().hasAttribute("data-ouro-pressing")).toBe(false);
  });
});

describe("MenuBar", () => {
  async function renderBar() {
    await render(
      <MenuBar aria-label="Recipe editor">
        <Menu label="File">
          <MenuItem>New</MenuItem>
          <MenuItem>Open</MenuItem>
        </Menu>
        <Menu label="Edit">
          <MenuItem>Undo</MenuItem>
        </Menu>
      </MenuBar>,
    );
  }
  const barTrigger = (name: string) => page.getByRole("menuitem", { name, exact: true });

  it("is a menubar of menus that the arrow keys move between", async () => {
    await renderBar();
    const bar = page.getByRole("menubar", { name: "Recipe editor" });
    await expect.element(bar).toBeVisible();
    expect(bar.element().getAttribute("data-ouro")).toBe("menu-bar");
    (barTrigger("File").element() as HTMLElement).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement?.textContent).toBe("Edit");
    await userEvent.keyboard("{ArrowDown}");
    await settled();
    await expect.poll(() => document.activeElement?.textContent).toBe("Undo");
    await userEvent.keyboard("{Escape}");
    await expect.poll(menu).toBeNull();
  });

  it("switches instantly to the next menu on hover once one is open", async () => {
    await renderBar();
    await userEvent.click(barTrigger("File"));
    await settled();
    expect(item("New").element()).toBeTruthy();
    await userEvent.hover(barTrigger("Edit"));
    await expect.poll(() => menu()?.textContent).toBe("Undo");
    expect(barTrigger("Edit").element().hasAttribute("data-popup-open")).toBe(true);
  });

  it("gives its triggers a 32px row with a fine pointer", async () => {
    await renderBar();
    expect(Math.round(barTrigger("File").element().getBoundingClientRect().height)).toBe(32);
  });

  it("opens each menu as a bottom sheet below 640px", async () => {
    await page.viewport(390, 844);
    await renderBar();
    await userEvent.click(barTrigger("Edit"));
    const element = await settled();
    expect(element.getAttribute("data-ouro-presentation")).toBe("sheet");
    expect(Math.round(element.getBoundingClientRect().bottom)).toBe(innerHeight);
    expect(Math.round(element.getBoundingClientRect().width)).toBe(innerWidth);
    // The bar decides how its menus hold the page: a menu in it passes Base UI no modal, which would warn.
    expect(warnings().filter((message: unknown) => String(message).includes("modal"))).toEqual([]);
  });
});

describe("Menu motion", () => {
  it("opens instantly and closes with a quick scale and fade from its origin", async () => {
    const element = await openDropdown();
    // No entrance: the popup is at full size and opacity as soon as it mounts.
    element.style.transition = "none";
    element.setAttribute("data-starting-style", "");
    expect(getComputedStyle(element).opacity).toBe("1");
    expect(getComputedStyle(element).transform).toBe("none");
    element.removeAttribute("data-starting-style");
    element.setAttribute("data-ending-style", "");
    expect(new DOMMatrix(getComputedStyle(element).transform).a).toBeCloseTo(0.96, 3);
    expect(getComputedStyle(element).opacity).toBe("0");
    element.style.transition = "";
    // The fast duration on the ease-out token; `ease-in` is never used.
    expect(getComputedStyle(element).transitionDuration.split(", ")[0]).toBe("0.15s");
    expect(getComputedStyle(element).transitionTimingFunction.split(/,\s(?![^(]*\))/)[0]).toBe("cubic-bezier(0.23, 1, 0.32, 1)");
    element.removeAttribute("data-ending-style");
  });

  it("scales about the point Base UI computes next to its trigger", async () => {
    const element = await openDropdown();
    element.style.setProperty("--transform-origin", "7px 3px");
    expect(getComputedStyle(element).transformOrigin).toBe("7px 3px");
  });

  it("closes with only a fade under reduced motion", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const element = await openDropdown();
    element.style.transition = "none";
    element.setAttribute("data-ending-style", "");
    expect(getComputedStyle(element).transform).toBe("none");
    expect(getComputedStyle(element).opacity).toBe("0");
    element.removeAttribute("data-ending-style");
  });
});

describe("Menu stacking", () => {
  it("puts the portal on the --ouro-layer level, as its own stacking context", async () => {
    await openDropdown();
    const layer = Number(getComputedStyle(document.documentElement).getPropertyValue("--ouro-layer"));
    const portal = document.querySelector<HTMLElement>('[data-ouro="menu-portal"]')!;
    const style = getComputedStyle(portal);
    expect(style.position).toBe("relative");
    expect(style.isolation).toBe("isolate");
    expect(style.zIndex).toBe(String(layer));
  });
});

describe("Menu server rendering", () => {
  it("renders the trigger on the server without the menu, and hydrates at 390px without errors", async () => {
    await page.viewport(390, 844);
    const app = () => (
      <Menu trigger={<Button>Actions</Button>}>
        <MenuItem>Edit</MenuItem>
      </Menu>
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(app());
    expect(html).toContain(">Actions<");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain("data-ouro-presentation");
    const host = document.createElement("div");
    document.body.append(host);
    mounted.push(host);
    host.innerHTML = html;
    const serverTrigger = host.querySelector('[data-ouro="button"]');
    const recoverable = vi.fn();
    await act(async () => {
      roots.push(hydrateRoot(host, <StrictMode>{app()}</StrictMode>, { onRecoverableError: recoverable }));
    });
    await act(nextFrame);
    expect(error).not.toHaveBeenCalled();
    expect(recoverable).not.toHaveBeenCalled();
    expect(host.querySelector('[data-ouro="button"]')).toBe(serverTrigger);
    await userEvent.click(trigger());
    expect((await settled()).getAttribute("data-ouro-presentation")).toBe("sheet");
  });

  it("renders a menubar and a context area on the server", () => {
    const html = renderToString(
      <>
        <MenuBar>
          <Menu label="File">
            <MenuItem>New</MenuItem>
          </Menu>
        </MenuBar>
        <Menu contextTrigger={<div>Area</div>}>
          <MenuItem>Copy</MenuItem>
        </Menu>
      </>,
    );
    expect(html).toContain('role="menubar"');
    expect(html).toContain(">File<");
    expect(html).toContain(">Area<");
  });
});

describe("Menu dev messages", () => {
  const OPEN_FIX = "Pass trigger={<Button>…</Button>} for a dropdown, contextTrigger={<div>…</div>} for a right-click or long-press area, or label inside <MenuBar>";

  it("throws the exact fix with no way to open", () => {
    // @ts-expect-error -- no trigger, contextTrigger or label
    const element = <Menu>{basicItems}</Menu>;
    expect(() => renderToString(element)).toThrow(`[ouro-ui] Menu: needs trigger, contextTrigger or label. Fix: ${OPEN_FIX}.`);
  });

  it("throws the exact fix with two ways to open", () => {
    // @ts-expect-error -- both trigger and contextTrigger
    const element = <Menu trigger={<Button>A</Button>} contextTrigger={<div>B</div>}>{basicItems}</Menu>;
    expect(() => renderToString(element)).toThrow(`[ouro-ui] Menu: takes one of trigger, contextTrigger and label. Fix: ${OPEN_FIX}.`);
  });

  it("throws the exact fix for label outside a MenuBar, and for a trigger inside one", () => {
    expect(() => renderToString(<Menu label="File">{basicItems}</Menu>)).toThrow(
      '[ouro-ui] Menu: label is for a Menu inside <MenuBar>. Fix: <MenuBar><Menu label="File">…</Menu></MenuBar>, or trigger={<Button>File</Button>} for a dropdown.',
    );
    expect(() =>
      renderToString(
        <MenuBar>
          <Menu trigger={<Button>File</Button>}>{basicItems}</Menu>
        </MenuBar>,
      ),
    ).toThrow('[ouro-ui] Menu: a Menu inside <MenuBar> takes label, not trigger or contextTrigger. Fix: <MenuBar><Menu label="File">…</Menu></MenuBar>.');
  });

  it("throws the exact fix without items or children, and with both", () => {
    expect(() => renderToString(<Menu trigger={<Button>A</Button>} />)).toThrow(
      '[ouro-ui] Menu: needs items or children. Fix: <Menu trigger={…} items={[{ label: "Edit", onClick: edit }]} />.',
    );
    expect(() => renderToString(<Menu trigger={<Button>A</Button>} items={[{ label: "Edit" }]}>{basicItems}</Menu>)).toThrow(
      "[ouro-ui] Menu: takes items or children, not both. Fix: move the children into items, or the items into <MenuItem> children.",
    );
  });

  it.each([
    ["MenuItem", <MenuItem key="i">Edit</MenuItem>, "<MenuItem>Edit</MenuItem>"],
    ["MenuCheckboxItem", <MenuCheckboxItem key="c">Pin</MenuCheckboxItem>, "<MenuCheckboxItem>Pin</MenuCheckboxItem>"],
    ["MenuRadioGroup", <MenuRadioGroup key="r">x</MenuRadioGroup>, '<MenuRadioGroup><MenuRadioItem value="a">A</MenuRadioItem></MenuRadioGroup>'],
    ["MenuGroup", <MenuGroup key="g" label="G">x</MenuGroup>, '<MenuGroup label="Recipe">…</MenuGroup>'],
    ["MenuSub", <MenuSub key="s" label="S">x</MenuSub>, '<MenuSub label="Share">…</MenuSub>'],
    ["MenuSeparator", <MenuSeparator key="sep" />, "<MenuSeparator />"],
  ])("%s outside a Menu throws with the correct JSX shape", (name, element, inner) => {
    expect(() => renderToString(element)).toThrow(
      `[ouro-ui] ${name}: must be rendered inside <Menu>. Fix: <Menu trigger={<Button>Actions</Button>}>${inner}</Menu>.`,
    );
  });

  it("MenuRadioItem outside a MenuRadioGroup throws with the correct JSX shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      render(
        <Menu trigger={<Button>A</Button>} open onOpenChange={() => {}}>
          <MenuRadioItem value="a">A</MenuRadioItem>
        </Menu>,
      ),
    ).rejects.toThrow(
      '[ouro-ui] MenuRadioItem: must be rendered inside <MenuRadioGroup>. Fix: <MenuRadioGroup value={sort} onValueChange={setSort}><MenuRadioItem value="name">Name</MenuRadioItem></MenuRadioGroup>.',
    );
  });

  it("throws the exact fix for open without onOpenChange", () => {
    const element = <Menu trigger={<Button>A</Button>} open>{basicItems}</Menu>;
    expect(() => renderToString(element)).toThrow("[ouro-ui] Menu: open needs onOpenChange. Fix: <Menu open={open} onOpenChange={setOpen} trigger={…}>.");
  });

  it("warns once about guessed Menu props and drops them from the DOM", async () => {
    await openDropdown({ isOpen: true, onClose: () => {}, placement: "bottom-start", asChild: true, options: [] } as object);
    expect(warnings()).toEqual([
      '[ouro-ui] Menu: placement is not a prop; Ouro UI splits it into side and align. Fix: <Menu side="bottom" align="start">.',
      "[ouro-ui] Menu: isOpen is not a prop. Fix: <Menu open={open} onOpenChange={setOpen} trigger={…}>.",
      "[ouro-ui] Menu: onClose is not a prop. Fix: <Menu open={open} onOpenChange={setOpen} trigger={…}>.",
      "[ouro-ui] Menu: asChild is not a prop; the trigger element is the button. Fix: trigger={<Button>Actions</Button>}.",
      '[ouro-ui] Menu: options is not a prop; the entries are items. Fix: <Menu trigger={…} items={[{ label: "Edit", onClick: edit }]} />.',
    ]);
    expect(trigger().hasAttribute("isopen")).toBe(false);
  });

  it("warns about side and align on a context menu, which opens at the pointer", async () => {
    await render(
      <Menu contextTrigger={<div>Area</div>} {...({ side: "top", align: "end" } as object)}>
        {basicItems}
      </Menu>,
    );
    await act(nextFrame);
    expect(warnings()).toEqual([
      "[ouro-ui] Menu: side is not used by a context menu, which opens at the pointer. Fix: remove side.",
      "[ouro-ui] Menu: align is not used by a context menu, which opens at the pointer. Fix: remove align.",
    ]);
  });

  it("renders the defaults for side and align that are not Ouro UI's, and warns once with each fix", async () => {
    const element = await openDropdown({ side: "under", align: "middle" } as object);
    expect(element.getAttribute("data-side")).toBe("bottom");
    expect(element.getAttribute("data-align")).toBe("start");
    expect(warnings()).toEqual([
      '[ouro-ui] Menu: side="under" is not a side; use "top", "bottom", "left", "right". Fix: <Menu side="bottom">.',
      '[ouro-ui] Menu: align="middle" is not an alignment; use "start", "center", "end" (left is "start", right is "end"). Fix: <Menu align="start">.',
    ]);
  });

  it("warns about an appearance class on the menu", async () => {
    const element = await openDropdown({ className: "mt-2 bg-white" });
    expect(element.classList.contains("mt-2")).toBe(true);
    expect(warnings()).toEqual(['[ouro-ui] Menu: "bg-white" sets appearance, and className is for layout only. Fix: :root { --popover: …; } .dark { --popover: …; }.']);
  });

  it("warns once about guessed MenuItem props, a tone that is not one, and a shortcut string", async () => {
    await openDropdown(
      {},
      <>
        <MenuItem {...({ onSelect: () => {}, variant: "destructive", asChild: true, checked: true } as object)}>Edit</MenuItem>
        <MenuItem tone={"danger" as "destructive"} shortcut={"mod+d" as unknown as string[]}>
          Delete
        </MenuItem>
        <MenuItem tone={"primary" as "destructive"}>Share</MenuItem>
      </>,
    );
    expect(item("Delete").element().getAttribute("data-tone")).toBeNull();
    expect(item("Delete").element().querySelector('[data-ouro="kbd"]')).not.toBeNull();
    expect(warnings()).toEqual([
      "[ouro-ui] MenuItem: onSelect is not a prop. Fix: <MenuItem onClick={edit}>.",
      '[ouro-ui] MenuItem: variant is not a prop; a menu item takes tone. Fix: <MenuItem tone="destructive">.',
      "[ouro-ui] MenuItem: asChild is not a prop. Fix: <MenuItem href=\"/recipes/1\"> for a link.",
      "[ouro-ui] MenuItem: checked is not a prop; a checkable item is a MenuCheckboxItem. Fix: <MenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>.",
      '[ouro-ui] MenuItem: tone="danger" is not a tone. Fix: <MenuItem tone="destructive">.',
      '[ouro-ui] MenuItem: shortcut="mod+d" is a string; shortcut takes an array. Fix: <MenuItem shortcut={["mod", "k"]}>.',
      '[ouro-ui] MenuItem: tone="primary" is not a tone; use "destructive". Fix: <MenuItem tone="destructive">.',
    ]);
  });

  it("warns about a MenuGroup without a label", async () => {
    await openDropdown(
      {},
      <MenuGroup {...({} as { label: string })}>
        <MenuItem>Edit</MenuItem>
      </MenuGroup>,
    );
    expect(warnings()).toEqual(['[ouro-ui] MenuGroup: label is required; it names the group for screen readers. Fix: <MenuGroup label="Recipe">.']);
  });

  it("warns about an appearance class on MenuBar", async () => {
    await render(
      <MenuBar className="bg-muted">
        <Menu label="File">{basicItems}</Menu>
      </MenuBar>,
    );
    expect(warnings()).toEqual(['[ouro-ui] MenuBar: "bg-muted" sets appearance, and className is for layout only. Fix: wrap the MenuBar in an element with that class.']);
  });
});
