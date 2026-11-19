import { type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Link } from "~/components/ouro/link/link";
import { Menu, MenuItem } from "~/components/ouro/menu/menu";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.width = "480px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return { host, item: host.querySelector<HTMLElement>('[data-ouro="item"]')! };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await page.viewport(1280, 800);
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

const pixel = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
const RouterLink: OuroLinkComponent = (props) => <a data-router="" {...props} />;

/** The @media conditions around each of the page's rules that make an element under this group transparent. */
function hidingConditions(group: string): string[][] {
  const found: string[][] = [];
  const walk = (rules: CSSRuleList, chain: string[]) => {
    for (const rule of rules) {
      // Tailwind 4.1 leaves the rule nested in the class's own rule and writes `opacity: 0%`; 4.3 flattens it.
      if (rule instanceof CSSStyleRule && rule.selectorText.includes(`.${group}`) && Number.parseFloat(rule.style.opacity) === 0) found.push(chain);
      if (rule instanceof CSSMediaRule) walk(rule.cssRules, [...chain, rule.conditionText]);
      else if (rule instanceof CSSGroupingRule || rule instanceof CSSStyleRule) walk(rule.cssRules, chain);
    }
  };
  for (const sheet of document.styleSheets) walk(sheet.cssRules, []);
  return found;
}

function center(element: Element) {
  const rect = element.getBoundingClientRect();
  return [rect.left + rect.width / 2, rect.top + rect.height / 2] as const;
}

describe("Item", () => {
  it("lays out media, title and description, and actions side by side", async () => {
    const { item } = await render(
      <Item
        media={<img src={pixel} alt="" data-media="" />}
        title="Braised short ribs"
        description="Four hours, mostly hands-off."
        actions={<Button variant="plain">Share</Button>}
      />,
    );
    expect(item.tagName).toBe("DIV");
    const media = item.querySelector("[data-media]")!.getBoundingClientRect();
    const title = page.getByText("Braised short ribs").element().getBoundingClientRect();
    const description = page.getByText("Four hours, mostly hands-off.").element().getBoundingClientRect();
    const share = page.getByRole("button", { name: "Share" }).element().getBoundingClientRect();
    expect(media.right).toBeLessThan(title.left);
    expect(title.bottom).toBeLessThanOrEqual(description.top);
    expect(share.left).toBeGreaterThan(title.right);
    expect(Math.round(share.right)).toBe(Math.round(item.getBoundingClientRect().right));
  });

  it("sizes its media: sm 40px by default, md 64px, lg 112px, and an icon in a 40px tile", async () => {
    for (const [mediaSize, px] of [
      [undefined, 40],
      ["sm", 40],
      ["md", 64],
      ["lg", 112],
      ["icon", 40],
    ] as const) {
      const { item } = await render(<Item media={<img src={pixel} alt="" />} mediaSize={mediaSize} title={`Media ${String(mediaSize)}`} />);
      const frame = item.querySelector("img")!.parentElement!.getBoundingClientRect();
      expect([mediaSize, frame.width, frame.height]).toEqual([mediaSize, px, px]);
    }
  });

  it("gives an icon a muted tile and hides it from screen readers", async () => {
    const { item } = await render(
      <Item
        media={
          <svg viewBox="0 0 24 24" data-icon="">
            <circle cx="12" cy="12" r="8" />
          </svg>
        }
        mediaSize="icon"
        title="Notifications"
      />,
    );
    const tile = item.querySelector("[data-icon]")!.parentElement!;
    expect(tile.getAttribute("aria-hidden")).toBe("true");
    expect(item.querySelector("[data-icon]")!.getBoundingClientRect().width).toBe(20);
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--muted)";
    document.body.append(probe);
    mounted.push(probe);
    expect(getComputedStyle(tile).backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
  });

  it("keeps the media level with the title when the description runs past one line, and centered beside shorter text", async () => {
    const long = "Seared hard, then braised low in red wine and stock until the meat falls apart, then rested overnight so the flavors settle. ".repeat(2);
    const middle = (rect: DOMRect) => rect.top + rect.height / 2;
    for (const mediaSize of ["icon", "sm", "md"] as const) {
      const media = mediaSize === "icon" ? <svg viewBox="0 0 24 24" /> : <img src={pixel} alt="" />;
      const { item } = await render(<Item media={media} mediaSize={mediaSize} title="Short ribs" description={long} />);
      const [frame, text] = [item.children[0]!.getBoundingClientRect(), item.children[1]!.getBoundingClientRect()];
      expect(text.height).toBeGreaterThan(frame.height);
      // Within the band of the title and the description's first line, 46px, where centering a 40px media put it.
      expect(frame.top - text.top).toBe(mediaSize === "md" ? 0 : 3);
    }
    for (const description of ["Four hours", undefined]) {
      const { item } = await render(<Item media={<img src={pixel} alt="" />} title="Short ribs" description={description} />);
      const [frame, text] = [item.children[0]!.getBoundingClientRect(), item.children[1]!.getBoundingClientRect()];
      expect(Math.abs(middle(frame) - middle(text))).toBeLessThanOrEqual(1);
    }
  });

  it("keeps a lifted media's place beside long text at widths where it sits beside it", async () => {
    const long = "Seared hard, then braised low in red wine and stock until the meat falls apart. ".repeat(4);
    const { item } = await render(<Item media={<img src={pixel} alt="" data-photo="" />} mediaSize="lg" mediaAbove="sm" title="Short ribs" description={long} />);
    const [frame, text] = [item.children[0]!.getBoundingClientRect(), item.children[1]!.getBoundingClientRect()];
    expect(text.height).toBeGreaterThan(frame.height);
    expect(Math.abs(frame.top + frame.height / 2 - (text.top + text.height / 2))).toBeLessThanOrEqual(1);
  });

  it("reveals its actions with revealActions on hover, on focus anywhere in the row and while a menu of theirs is open, keeping their room", async () => {
    const { item } = await render(
      <Item href="#soup" title="Lentil soup" description="Forty minutes" actions={<Button variant="plain" size="sm">Edit</Button>} revealActions />,
    );
    const actions = item.querySelector<HTMLElement>("[data-item-actions]")!;
    const edit = page.getByRole("button", { name: "Edit" });
    // The opacity once its fade has ended.
    const settled = (opacity: string) => expect.poll(() => (actions.getAnimations().length === 0 ? getComputedStyle(actions).opacity : "fading")).toBe(opacity);
    expect(getComputedStyle(actions).opacity).toBe("0");
    expect(actions.getBoundingClientRect().width).toBeGreaterThan(0);
    await expect.element(edit).toBeInTheDocument();
    await userEvent.hover(page.getByRole("link", { name: "Lentil soup" }));
    await settled("1");
    await commands.parkPointer();
    await settled("0");
    const before = document.createElement("button");
    item.before(before);
    mounted.push(before);
    before.focus();
    await pressTab();
    expect(document.activeElement).toBe(page.getByRole("link", { name: "Lentil soup" }).element());
    await settled("1");
    await pressTab();
    expect(document.activeElement).toBe(edit.element());
    await settled("1");
    before.focus();
    await settled("0");
    edit.element().setAttribute("aria-expanded", "true");
    await settled("1");
  });

  it("hides revealActions' actions only where the pointer can hover, so a stylus that cannot still sees them", () => {
    const conditions = hidingConditions(CSS.escape("group/item"));
    expect(conditions).not.toEqual([]);
    for (const chain of conditions) expect(chain).toContain("(hover: hover)");
  });

  it("finds the hiding rule where the app's Tailwind leaves it nested, as 4.1 does, so the check above holds there too", () => {
    const style = document.createElement("style");
    style.textContent =
      ".probe-nested { @media (pointer: fine) { @media (hover: hover) { &:not(*:is(:where(.group\\/probe):hover *)) { opacity: 0%; } } } }";
    document.head.append(style);
    try {
      expect(hidingConditions(CSS.escape("group/probe"))).toEqual([["(pointer: fine)", "(hover: hover)"]]);
    } finally {
      style.remove();
    }
  });

  it("shows its actions from the start without revealActions", async () => {
    const { item } = await render(<Item title="Lentil soup" actions={<Button variant="plain" size="sm">Edit</Button>} />);
    expect(getComputedStyle(item.querySelector("[data-item-actions]")!).opacity).toBe("1");
    expect(item.classList.contains("group/item")).toBe(false);
  });

  it("keeps the actions beside the text on a phone by default", async () => {
    await page.viewport(390, 844);
    const { item } = await render(<Item title="Bearer token" description="Created today" actions={<Button>Revoke</Button>} />);
    const title = page.getByText("Bearer token").element().getBoundingClientRect();
    const revoke = page.getByRole("button", { name: "Revoke" }).element().getBoundingClientRect();
    expect(revoke.top).toBeLessThan(title.bottom);
    expect(item).toBeTruthy();
  });

  it("drops the actions under the text below the breakpoint with stackBelow, lined up with the title", async () => {
    await page.viewport(390, 844);
    await render(
      <Item media={<img src={pixel} alt="" />} title="Bearer token" description="Created today" actions={<Button>Revoke</Button>} stackBelow="sm" />,
    );
    const title = page.getByText("Bearer token").element().getBoundingClientRect();
    const description = page.getByText("Created today").element().getBoundingClientRect();
    const revoke = page.getByRole("button", { name: "Revoke" }).element();
    expect(revoke.getBoundingClientRect().top).toBeGreaterThanOrEqual(description.bottom);
    expect(Math.round(revoke.getBoundingClientRect().left)).toBe(Math.round(title.left));
    await page.viewport(1280, 800);
    await expect.poll(() => revoke.getBoundingClientRect().top < title.bottom).toBe(true);
  });

  it("stacks without media below md too", async () => {
    await page.viewport(700, 800);
    await render(<Item title="Token" actions={<Button>Revoke</Button>} stackBelow="md" />);
    const title = page.getByText("Token").element().getBoundingClientRect();
    const revoke = page.getByRole("button", { name: "Revoke" }).element().getBoundingClientRect();
    expect(revoke.top).toBeGreaterThanOrEqual(title.bottom);
    expect(Math.round(revoke.left)).toBe(Math.round(title.left));
  });

  it("is a bordered box with padding with variant=outline, and tighter with size=sm", async () => {
    const { item } = await render(<Item title="Outlined" variant="outline" />);
    expect(getComputedStyle(item).borderTopWidth).toBe("1px");
    expect(getComputedStyle(item).paddingInlineStart).toBe("16px");
    const { item: plain } = await render(<Item title="Plain" />);
    expect(getComputedStyle(plain).borderTopWidth).toBe("0px");
    expect(getComputedStyle(plain).paddingInlineStart).toBe("0px");
    expect(getComputedStyle(plain).paddingTop).toBe("12px");
    const { item: small } = await render(<Item title="Small" size="sm" />);
    expect(getComputedStyle(small).paddingTop).toBe("8px");
  });

  it.each(["sm", "md"] as const)("puts the media above the text, full width at 4:3, below %s with mediaAbove", async (breakpoint) => {
    await page.viewport(breakpoint === "sm" ? 390 : 700, 844);
    const { item } = await render(
      <Item href="/recipes/1" media={<img src={pixel} alt="" data-photo="" />} mediaSize="lg" mediaAbove={breakpoint} title="Braised short ribs" description="Four hours" />,
    );
    const media = item.querySelector("[data-photo]")!.parentElement!;
    const title = page.getByText("Braised short ribs").element();
    const box = media.getBoundingClientRect();
    expect(Math.round(box.width)).toBe(Math.round(item.getBoundingClientRect().width));
    expect(box.height).toBeCloseTo((box.width * 3) / 4, 0);
    expect(title.getBoundingClientRect().top).toBeGreaterThanOrEqual(box.bottom);
    expect(Math.round(title.getBoundingClientRect().left)).toBe(Math.round(box.left));
    // At desktop width the photo sits beside the text again, at its own size.
    await page.viewport(1280, 800);
    await expect.poll(() => media.getBoundingClientRect().width).toBe(112);
    expect(title.getBoundingClientRect().left).toBeGreaterThan(media.getBoundingClientRect().right);
  });

  it("always puts the media above the text with mediaAbove=always, with the actions beside the title", async () => {
    const { item } = await render(
      <Item media={<img src={pixel} alt="" data-photo="" />} mediaAbove="always" title="Ribs" actions={<Button>Save</Button>} />,
    );
    const media = item.querySelector("[data-photo]")!.parentElement!.getBoundingClientRect();
    const title = page.getByText("Ribs").element().getBoundingClientRect();
    const save = page.getByRole("button", { name: "Save" }).element().getBoundingClientRect();
    expect(Math.round(media.width)).toBe(480);
    expect(title.top).toBeGreaterThanOrEqual(media.bottom);
    expect(save.top).toBeGreaterThanOrEqual(media.bottom);
    expect(save.left).toBeGreaterThan(title.right);
  });

  it("stacks the media and the actions together with mediaAbove and stackBelow", async () => {
    await page.viewport(390, 844);
    const { item } = await render(
      <Item media={<img src={pixel} alt="" data-photo="" />} mediaAbove="md" stackBelow="sm" title="Ribs" description="Four hours" actions={<Button>Save</Button>} />,
    );
    const mediaElement = item.querySelector("[data-photo]")!.parentElement!;
    const title = page.getByText("Ribs").element();
    const save = page.getByRole("button", { name: "Save" }).element();
    expect(title.getBoundingClientRect().top).toBeGreaterThanOrEqual(mediaElement.getBoundingClientRect().bottom);
    expect(save.getBoundingClientRect().top).toBeGreaterThanOrEqual(page.getByText("Four hours").element().getBoundingClientRect().bottom);
    expect(Math.round(save.getBoundingClientRect().left)).toBe(Math.round(title.getBoundingClientRect().left));
    // Between sm and md the photo is still above, and the actions are back beside the text.
    await page.viewport(700, 844);
    await expect.poll(() => save.getBoundingClientRect().top < title.getBoundingClientRect().bottom).toBe(true);
    expect(title.getBoundingClientRect().top).toBeGreaterThanOrEqual(mediaElement.getBoundingClientRect().bottom);
  });

  it.each([
    ["always", "sm", 390],
    ["md", "md", 700],
  ] as const)("stacks the actions under the text with mediaAbove=%s and stackBelow=%s", async (mediaAbove, stackBelow, width) => {
    await page.viewport(width, 844);
    const { item } = await render(
      <Item media={<img src={pixel} alt="" data-photo="" />} mediaAbove={mediaAbove} stackBelow={stackBelow} title="Ribs" description="Four hours" actions={<Button>Save</Button>} />,
    );
    const media = item.querySelector("[data-photo]")!.parentElement!.getBoundingClientRect();
    const title = page.getByText("Ribs").element().getBoundingClientRect();
    const save = page.getByRole("button", { name: "Save" }).element().getBoundingClientRect();
    expect(title.top).toBeGreaterThanOrEqual(media.bottom);
    expect(save.top).toBeGreaterThanOrEqual(page.getByText("Four hours").element().getBoundingClientRect().bottom);
    expect(Math.round(save.left)).toBe(Math.round(title.left));
  });

  it("stacks the actions beside media below md and the media above below sm", async () => {
    await page.viewport(390, 844);
    const { item } = await render(
      <Item media={<img src={pixel} alt="" data-photo="" />} mediaAbove="sm" stackBelow="md" title="Ribs" actions={<Button>Save</Button>} />,
    );
    const media = item.querySelector("[data-photo]")!.parentElement!;
    const title = page.getByText("Ribs").element();
    const save = page.getByRole("button", { name: "Save" }).element();
    expect(Math.round(save.getBoundingClientRect().left)).toBe(Math.round(title.getBoundingClientRect().left));
    expect(title.getBoundingClientRect().top).toBeGreaterThanOrEqual(media.getBoundingClientRect().bottom);
    await page.viewport(700, 844);
    await expect.poll(() => title.getBoundingClientRect().left > media.getBoundingClientRect().right).toBe(true);
    expect(Math.round(save.getBoundingClientRect().left)).toBe(Math.round(title.getBoundingClientRect().left));
    expect(save.getBoundingClientRect().top).toBeGreaterThanOrEqual(title.getBoundingClientRect().bottom);
  });

  it.each(["li", "article"] as const)("renders as %s", async (as) => {
    const { item } = await render(as === "li" ? <ul><Item as="li" title="x" /></ul> : <Item as={as} title="x" />);
    expect(item.tagName).toBe(as.toUpperCase());
  });

  it("passes attributes and a ref through, and lets layout classes win", async () => {
    let node: HTMLElement | null = null;
    const { item } = await render(<Item title="x" id="row" className="mt-2" ref={(element) => void (node = element)} />);
    expect(item.id).toBe("row");
    expect(node).toBe(item);
    expect(getComputedStyle(item).marginTop).toBe("8px");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("Item with href", () => {
  it("opens its link from a click on its media, though the app positions its text, which the link's layer then covers alone", async () => {
    const { item } = await render(
      <div data-consumer="">
        <style>{'[data-consumer] [data-ouro="item"] > div:nth-child(2) { position: relative; }'}</style>
        <Item href="#soup" title="Lentil soup" description="Forty minutes" media={<img src={pixel} alt="" data-media="" style={{ width: 40, height: 40 }} />} />
      </div>,
    );
    const media = item.querySelector("[data-media]")!;
    const [x, y] = center(media);
    expect(document.elementFromPoint(x, y)?.closest("a")).toBeNull();
    const link = page.getByRole("link", { name: "Lentil soup" }).element();
    const opened = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener("click", opened);
    await userEvent.click(media);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("opens nothing from a choice in its actions' menu, which React hands up from the menu's portal outside the row", async () => {
    const shared = vi.fn();
    await render(
      <Item
        href="#soup"
        title="Lentil soup"
        actions={
          <Menu trigger={<Button variant="plain" size="sm" aria-label="More for Lentil soup">More</Button>}>
            <MenuItem onClick={shared}>Share</MenuItem>
          </Menu>
        }
      />,
    );
    const link = page.getByRole("link", { name: "Lentil soup" }).element();
    const opened = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener("click", opened);
    await userEvent.click(page.getByRole("button", { name: "More for Lentil soup" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Share" }));
    expect(shared).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
  });

  it("opens a linked row in a new tab from a middle click on its media, with no handler of the app's", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { item } = await render(
      <div data-consumer="">
        <style>{'[data-consumer] [data-ouro="item"] > div:nth-child(2) { position: relative; }'}</style>
        <Item href="#soup" title="Lentil soup" media={<img src={pixel} alt="" data-media="" style={{ width: 40, height: 40 }} />} />
      </div>,
    );
    expect(item.getAttribute("data-follows-link")).toBe("");
    await userEvent.click(item.querySelector("[data-media]")!, { button: "middle" } as never);
    expect(open).toHaveBeenCalledWith((page.getByRole("link", { name: "Lentil soup" }).element() as HTMLAnchorElement).href, "_blank", "noopener");
  });

  it("chooses its row from a click on its media, though the app positions its text", async () => {
    const onSelect = vi.fn();
    const { item } = await render(
      <div data-consumer="">
        <style>{'[data-consumer] [data-ouro="item"] > div:nth-child(2) { position: relative; }'}</style>
        <Item onSelect={onSelect} title="Lentil soup" media={<img src={pixel} alt="" data-media="" style={{ width: 40, height: 40 }} />} />
      </div>,
    );
    expect(item.getAttribute("data-follows-link")).toBe("");
    await userEvent.click(item.querySelector("[data-media]")!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    // A Ctrl or Cmd click chooses it too: a row's button has no tab to open.
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    await userEvent.click(item.querySelector("[data-media]")!, { modifiers: ["ControlOrMeta"] } as never);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
    const { item: plain } = await render(<Item title="Lentil soup" media={<img src={pixel} alt="" />} />);
    expect(plain.hasAttribute("data-follows-link")).toBe(false);
  });

  it("is one link named by its title, covering the row, with the actions above it", async () => {
    const onSave = vi.fn();
    const { item } = await render(
      <Item
        href="/recipes/1"
        media={<img src={pixel} alt="" data-media="" />}
        title="Braised short ribs"
        description="Four hours"
        actions={<Button onClick={onSave}>Save</Button>}
      />,
    );
    const link = item.querySelector("a")!;
    expect(item.querySelectorAll("a")).toHaveLength(1);
    await expect.element(page.getByRole("link", { name: "Braised short ribs" })).toBeVisible();
    for (const element of [item.querySelector("[data-media]")!, page.getByText("Four hours").element()]) {
      const [x, y] = center(element);
      expect(document.elementFromPoint(x, y)).toBe(link);
    }
    const save = page.getByRole("button", { name: "Save" }).element() as HTMLElement;
    const [x, y] = center(save);
    expect(save.contains(document.elementFromPoint(x, y))).toBe(true);
    const before = document.createElement("button");
    item.parentElement!.prepend(before);
    before.focus();
    await pressTab();
    expect(document.activeElement).toBe(link);
    expect(getComputedStyle(item).outlineStyle).toBe("solid");
    await pressTab();
    expect(document.activeElement).toBe(save);
  });

  it("describes the row's link by its description, which keeps its place under the title", async () => {
    const { item } = await render(
      <Item
        href="/search/ribs"
        title="Braised short ribs"
        description={
          <>
            <span>By Ana · 4 hours</span> <span>Short ribs braised in stock until they fall apart.</span>
          </>
        }
      />,
    );
    const link = page.getByRole("link", { name: "Braised short ribs" });
    await expect.element(link).toHaveAccessibleName("Braised short ribs");
    await expect.element(link).toHaveAccessibleDescription("By Ana · 4 hours Short ribs braised in stock until they fall apart.");
    const description = item.querySelector<HTMLElement>("[data-ouro-text]")!;
    expect(link.element().getAttribute("aria-describedby")).toBe(description.id);
    // The visible layout is unchanged: the description sits under the title, outside the link.
    expect(link.element().contains(description)).toBe(false);
    expect(description.getBoundingClientRect().top).toBeGreaterThanOrEqual(link.element().getBoundingClientRect().bottom);
  });

  it("gives each row's link its own description, and none without a description or a link", async () => {
    const { host } = await render(
      <>
        <Item href="/recipes/1" title="Short ribs" description="Four hours" />
        <Item href="/recipes/2" title="Focaccia" description="Overnight" />
        <Item href="/recipes/3" title="Toast" />
        <Item title="Passkey" description="Added May 2" />
      </>,
    );
    await expect.element(page.getByRole("link", { name: "Short ribs" })).toHaveAccessibleDescription("Four hours");
    await expect.element(page.getByRole("link", { name: "Focaccia" })).toHaveAccessibleDescription("Overnight");
    expect(page.getByRole("link", { name: "Toast" }).element().hasAttribute("aria-describedby")).toBe(false);
    const ids = [...host.querySelectorAll("[data-ouro-text]")].map((element) => element.id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[2]).toBe("");
  });

  it("keeps links in the description and controls in the media clickable on a phone", async () => {
    await page.viewport(390, 844);
    const onPlay = vi.fn();
    const { item } = await render(
      <Item
        href="/recipes/1"
        media={
          <span style={{ position: "relative", display: "block" }}>
            <img src={pixel} alt="" data-photo="" />
            <button type="button" style={{ position: "absolute", inset: 0, opacity: 0.5 }} onClick={onPlay}>
              Play
            </button>
          </span>
        }
        mediaSize="lg"
        title="Braised short ribs"
        description={
          <>
            From <a href="/cookbooks/sunday">Sunday bakes</a> by <Link href="/cooks/ari">Ari</Link>
          </>
        }
      />,
    );
    const link = item.querySelector("[data-item-link]")!;
    for (const control of [
      page.getByRole("link", { name: "Sunday bakes" }).element(),
      page.getByRole("link", { name: "Ari" }).element(),
      page.getByRole("button", { name: "Play" }).element(),
    ]) {
      const [x, y] = center(control);
      expect(control.contains(document.elementFromPoint(x, y))).toBe(true);
    }
    await userEvent.click(page.getByRole("button", { name: "Play" }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    const [x, y] = center(page.getByText("Braised short ribs").element());
    expect(document.elementFromPoint(x, y)).toBe(link);
  });

  it("opens the row from text in an element that only takes focus from code", async () => {
    const { item } = await render(
      <Item href="/recipes/1" title="Ribs" description={<span tabIndex={-1}>Four hours</span>} />,
    );
    const [x, y] = center(page.getByText("Four hours").element());
    expect(document.elementFromPoint(x, y)).toBe(item.querySelector("[data-item-link]"));
  });

  it("rounds the link's hover layer with variant=outline", async () => {
    const { item } = await render(<Item href="/recipes/1" title="Ribs" variant="outline" />);
    expect(getComputedStyle(item.querySelector("a")!, "::after").borderTopLeftRadius).not.toBe("0px");
  });

  it("renders the provider's linkComponent, forwards linkRef and opens external links in a new tab", async () => {
    let anchor: HTMLAnchorElement | null = null;
    const { host } = await render(
      <OuroProvider linkComponent={RouterLink}>
        <Item href="/recipes/1" title="Internal" linkRef={(node) => void (anchor = node)} />
        <Item href="https://ouro.bot" external title="Ouro" />
      </OuroProvider>,
    );
    const [internal, outside] = [...host.querySelectorAll("a")];
    expect(internal!.hasAttribute("data-router")).toBe(true);
    expect(anchor).toBe(internal);
    expect(outside!.getAttribute("target")).toBe("_blank");
    expect(outside!.getAttribute("rel")).toBe("noopener noreferrer");
    await expect.element(page.getByRole("link", { name: "Ouro (opens in a new tab)" })).toBeVisible();
  });
});

describe("Item with onSelect", () => {
  // The theme's value of a colour variable, as the browser computes it.
  const themeColor = (variable: string) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(${variable})`;
    document.body.append(probe);
    mounted.push(probe);
    return getComputedStyle(probe).backgroundColor;
  };

  it("is one button named by its title, covering the row, that calls onSelect, with the actions above it", async () => {
    const onSelect = vi.fn();
    const onSave = vi.fn();
    const { item } = await render(
      <Item onSelect={onSelect} media={<img src={pixel} alt="" data-media="" />} title="Braised short ribs" description="Four hours" actions={<Button onClick={onSave}>Save</Button>} />,
    );
    const button = page.getByRole("button", { name: "Braised short ribs" });
    await expect.element(button).toHaveAccessibleDescription("Four hours");
    expect(button.element().getAttribute("type")).toBe("button");
    for (const element of [item.querySelector("[data-media]")!, page.getByText("Four hours").element()]) {
      const [x, y] = center(element);
      expect(document.elementFromPoint(x, y)).toBe(button.element());
    }
    // A press on the description lands on the row's button, which covers it.
    await userEvent.click(page.getByText("Four hours"), { force: true });
    expect(onSelect).toHaveBeenCalledTimes(1);
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const before = document.createElement("button");
    item.parentElement!.prepend(before);
    before.focus();
    await pressTab();
    expect(document.activeElement).toBe(button.element());
    expect(getComputedStyle(item).outlineStyle).toBe("solid");
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(2);
    await pressTab();
    expect(document.activeElement).toBe(page.getByRole("button", { name: "Save" }).element());
  });

  it("marks the chosen row current, in the selected colour, and leaves the others plain", async () => {
    const { host } = await render(
      <ItemGroup aria-label="Recipes">
        <Item onSelect={() => {}} selected title="Short ribs" description="Four hours" data-row="chosen" />
        <Item onSelect={() => {}} selected={false} title="Lentil soup" description="Forty minutes" data-row="other" />
      </ItemGroup>,
    );
    await expect.element(page.getByRole("button", { name: "Short ribs" })).toHaveAttribute("aria-current", "true");
    expect(page.getByRole("button", { name: "Lentil soup" }).element().hasAttribute("aria-current")).toBe(false);
    const chosen = host.querySelector<HTMLElement>('[data-row="chosen"]')!;
    const other = host.querySelector<HTMLElement>('[data-row="other"]')!;
    expect(getComputedStyle(chosen).backgroundColor).toBe(themeColor("--accent"));
    expect(getComputedStyle(other).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    // The selected row's description mixes 20% toward the foreground, for contrast on the selected colour.
    const probe = document.createElement("div");
    probe.style.color = "color-mix(in oklab, var(--muted-foreground) 80%, var(--foreground))";
    document.body.append(probe);
    mounted.push(probe);
    expect(getComputedStyle(chosen.querySelector("[data-ouro-text]")!).color).toBe(getComputedStyle(probe).color);
    expect(getComputedStyle(other.querySelector("[data-ouro-text]")!).color).not.toBe(getComputedStyle(probe).color);
  });

  it("keeps its padding and corners in a divided or plain group, so the selected colour has room, and a plain row keeps none", async () => {
    for (const variant of ["divided", "plain"] as const) {
      const { host } = await render(
        <ItemGroup aria-label="Recipes" variant={variant}>
          <Item onSelect={() => {}} selected title="Short ribs" data-row="chosen" />
          <Item title="Lentil soup" data-row="plain" />
        </ItemGroup>,
      );
      const chosen = getComputedStyle(host.querySelector('[data-row="chosen"]')!);
      expect(chosen.paddingInlineStart, variant).toBe("12px");
      expect(parseFloat(chosen.borderTopLeftRadius), variant).toBeGreaterThan(0);
      expect(getComputedStyle(host.querySelector('[data-row="plain"]')!).paddingInlineStart, variant).toBe("0px");
    }

  });

  it("keeps an outlined row's corners and padding, and rounds its press layer to them", async () => {
    const { item } = await render(<Item onSelect={() => {}} selected variant="outline" title="Short ribs" />);
    expect(getComputedStyle(item.querySelector("button")!, "::after").borderTopLeftRadius).toBe(getComputedStyle(item).borderTopLeftRadius);
    const outline = (await render(<Item variant="outline" title="Lentil soup" />)).item;
    expect(getComputedStyle(item).borderTopLeftRadius).toBe(getComputedStyle(outline).borderTopLeftRadius);
    expect(getComputedStyle(item).paddingInlineStart).toBe(getComputedStyle(outline).paddingInlineStart);
  });

  it("marks a linked row as the page shown with selected", async () => {
    await render(
      <ItemGroup aria-label="Sections">
        <Item href="/profile" selected title="Profile" />
        <Item href="/billing" selected={false} title="Billing" />
      </ItemGroup>,
    );
    await expect.element(page.getByRole("link", { name: "Profile" })).toHaveAttribute("aria-current", "page");
    expect(page.getByRole("link", { name: "Billing" }).element().hasAttribute("aria-current")).toBe(false);
  });

  it("gives a row on its own room for the selected colour, and a static row none", async () => {
    const { item } = await render(<Item onSelect={() => {}} title="Short ribs" />);
    expect(getComputedStyle(item).paddingInlineStart).toBe("12px");
    expect(parseFloat(getComputedStyle(item).borderTopLeftRadius)).toBeGreaterThan(0);
    const still = (await render(<Item title="Lentil soup" />)).item;
    expect(getComputedStyle(still).paddingInlineStart).toBe("0px");
    expect(getComputedStyle(still).borderTopLeftRadius).toBe("0px");
  });

  it("marks a row a person presses or chooses for the stretched layer, and a static row not", async () => {
    const { host } = await render(
      <ItemGroup aria-label="Rows">
        <Item onSelect={() => {}} title="Pressed" data-row="pressed" actions={<Button>Save</Button>} />
        <Item href="/a" title="Linked" data-row="linked" />
        <Item href="/b" selected={false} title="Chosen link" data-row="chosen-link" />
        <Item title="Static" data-row="static" actions={<Button>Keep</Button>} />
      </ItemGroup>,
    );
    const row = (name: string) => host.querySelector<HTMLElement>(`[data-row="${name}"]`)!;
    expect(row("pressed").getAttribute("data-linked")).toBe("");
    expect(row("linked").getAttribute("data-linked")).toBe("");
    expect(row("static").hasAttribute("data-linked")).toBe(false);
    expect(row("pressed").getAttribute("data-choosable")).toBe("");
    expect(row("chosen-link").getAttribute("data-choosable")).toBe("");
    expect(row("linked").hasAttribute("data-choosable")).toBe(false);
    expect(row("static").hasAttribute("data-choosable")).toBe(false);
    // A link row told whether it is shown keeps its padding in a divided group; a plain link row does not.
    expect(getComputedStyle(row("chosen-link")).paddingInlineStart).toBe("12px");
    expect(getComputedStyle(row("linked")).paddingInlineStart).toBe("0px");
    // The press look and the raised controls are a pressable row's, not a static one's.
    expect(getComputedStyle(row("pressed")).cursor).toBe("pointer");
    expect(getComputedStyle(row("static")).cursor).toBe("auto");
    expect(getComputedStyle(page.getByRole("button", { name: "Save" }).element()).zIndex).toBe("10");
    expect(getComputedStyle(page.getByRole("button", { name: "Keep" }).element()).zIndex).toBe("auto");
  });

  it("colours the shown row's title with the selected colour's text, and the others' with the page's", async () => {
    const { host } = await render(
      <div style={{ ["--accent-foreground" as string]: "rgb(200, 0, 0)", ["--foreground" as string]: "rgb(0, 0, 200)" }}>
        <Item onSelect={() => {}} selected title="Shown" data-row="shown" />
        <Item onSelect={() => {}} selected={false} title="Other" data-row="other" />
      </div>,
    );
    const titleOf = (name: string) => getComputedStyle(host.querySelector(`[data-row="${name}"] button`)!.parentElement!).color;
    expect(titleOf("shown")).toBe("rgb(200, 0, 0)");
    expect(titleOf("other")).toBe("rgb(0, 0, 200)");
  });

  it("rounds a button or link row's press layer to the row, and sets its title at the start", async () => {
    const { host } = await render(
      <div>
        <Item onSelect={() => {}} title={"A title long enough to wrap onto a second line in a narrow row ".repeat(2)} data-row="button" />
        <Item href="/a" selected title="Link" data-row="link" />
        <Item href="/b" selected variant="outline" title="Outlined link" data-row="outlined" />
      </div>,
    );
    for (const name of ["button", "link", "outlined"]) {
      const row = host.querySelector<HTMLElement>(`[data-row="${name}"]`)!;
      const layer = row.querySelector("[data-stretched-link]")!;
      expect(getComputedStyle(layer, "::after").borderTopLeftRadius, name).toBe(getComputedStyle(row).borderTopLeftRadius);
    }
    expect(getComputedStyle(host.querySelector('[data-row="button"] button')!).textAlign).toBe("start");
  });

  it("draws an edge round each row a person chooses under forced colours, and a thicker Highlight one round the row shown", async () => {
    try {
      await render(
        <div>
          <Item onSelect={() => {}} selected title="Shown" />
          <Item onSelect={() => {}} selected={false} title="Other" />
          <Item href="/a" selected title="Linked shown" />
        </div>,
      );
      const after = (name: string, role: "button" | "link" = "button") => getComputedStyle(page.getByRole(role, { name }).element(), "::after");
      expect(after("Other").borderTopWidth).toBe("0px");
      expect(after("Shown").borderTopWidth).toBe("0px");
      await commands.emulateMedia({ forcedColors: "active" });
      expect(after("Other").borderTopStyle).toBe("solid");
      expect(after("Other").borderTopWidth).toBe("1px");
      expect(after("Shown").borderTopWidth).toBe("2px");
      expect(after("Linked shown", "link").borderTopWidth).toBe("2px");
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

  it("forwards buttonRef to the row's button", async () => {
    let button: HTMLButtonElement | null = null;
    await render(<Item onSelect={() => {}} buttonRef={(node) => void (button = node)} title="Short ribs" />);
    expect(button).toBe(page.getByRole("button", { name: "Short ribs" }).element());
  });
});

describe("Item development messages", () => {
  it.each([
    ["subtitle", { subtitle: "Four hours" }, "subtitle is not a prop", '<Item description="Four hours">'],
    ["icon", { icon: "x" }, "icon is not a prop", '<Item media={<Icon />} mediaSize="icon">'],
    ["avatar", { avatar: "x" }, "avatar is not a prop", "<Item media={<Avatar … />}>"],
    ["image", { image: "/a.jpg" }, "image is not a prop", '<Item media={<img src="/a.jpg" alt="" />}>'],
    ["thumbnail", { thumbnail: "/a.jpg" }, "thumbnail is not a prop", '<Item media={<img src="/a.jpg" alt="" />}>'],
    ["action", { action: "x" }, "action is not a prop", "<Item actions={<Button>…</Button>}>"],
    ["label", { label: "Ribs" }, "label is not a prop", '<Item title="Ribs">'],
    ["to", { to: "/recipes/1" }, "to is not a prop", '<Item href="/recipes/1" title="…">'],
    ["to object", { to: { pathname: "/recipes/1" } }, "to is not a prop", '<Item href="/path" title="…">'],
    ["asChild", { asChild: true }, "asChild is not a prop", '<Item href="/path" title="…">'],
    ["variant", { variant: "muted" }, 'variant="muted" is not a variant; use "plain", "outline"', '<Item variant="plain">'],
    ["size", { size: "lg" }, 'size="lg" is not a size; use "md", "sm"', '<Item size="md">'],
    ["mediaSize", { mediaSize: "xl" }, 'mediaSize="xl" is not a media size; use "icon", "sm", "md", "lg"', '<Item mediaSize="lg">'],
    ["stackBelow", { stackBelow: "lg" }, 'stackBelow="lg" is not a breakpoint; use "sm", "md"', '<Item stackBelow="sm">'],
    ["mediaAbove", { mediaAbove: "lg", media: "x" }, 'mediaAbove="lg" is not a breakpoint; use "always", "sm", "md"', '<Item mediaAbove="sm">'],
    ["mediaAbove without media", { mediaAbove: "sm" }, "mediaAbove needs media", '<Item media={<img src="…" alt="" />} mediaAbove="sm">'],
    ["mediaAbove with an icon", { mediaAbove: "sm", media: "x", mediaSize: "icon" }, "mediaAbove is for a photo, not an icon", '<Item media={<img src="…" alt="" />} mediaSize="lg" mediaAbove="sm">'],
    ["as", { as: "a" }, 'as="a" is not an element Item renders; use "div", "li", "article"', '<Item href="/path" title="…">'],
    ["as span", { as: "span" }, 'as="span" is not an element Item renders; use "div", "li", "article"', '<Item as="div">'],
    ["selected without onSelect or href", { selected: true }, "selected marks a row a person chooses; give it onSelect, or href", '<Item selected={row.id === openId} onSelect={() => open(row.id)} title="…">'],
    ["active", { active: true }, "active is not a prop", "<Item selected={row.id === openId} onSelect={() => open(row.id)}>"],
    ["isSelected", { isSelected: true }, "isSelected is not a prop", "<Item selected={row.id === openId} onSelect={() => open(row.id)}>"],
    ["current", { current: true }, "current is not a prop", "<Item selected={row.id === openId} onSelect={() => open(row.id)}>"],
    ["revealActions without actions", { revealActions: true }, "revealActions needs actions to reveal", "<Item actions={<Button>…</Button>} revealActions>"],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const { item } = await render(<Item {...({ title: "Ribs", ...extra } as unknown as Parameters<typeof Item>[0])} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Item: ${problem}. Fix: ${fix}.`);
    for (const attribute of ["subtitle", "icon", "avatar", "image", "thumbnail", "action", "label", "to", "aschild", "selected", "active", "isselected", "current", "revealactions"]) {
      expect(item.hasAttribute(attribute)).toBe(false);
    }
  });

  it("warns when there is no title", async () => {
    await render(<Item {...({ description: "Four hours" } as unknown as Parameters<typeof Item>[0])} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Item: title is required; it names the row. Fix: <Item title="Braised short ribs">.');
  });

  it("renders the defaults for unknown values", async () => {
    const { item } = await render(
      <Item
        {...({ title: "x", variant: "muted", size: "lg", as: "span", mediaSize: "xl", stackBelow: "lg", media: <img src={pixel} alt="" /> } as unknown as Parameters<
          typeof Item
        >[0])}
      />,
    );
    expect(item.tagName).toBe("DIV");
    expect(getComputedStyle(item).borderTopWidth).toBe("0px");
    expect(getComputedStyle(item).paddingTop).toBe("12px");
    expect(item.querySelector("img")!.parentElement!.getBoundingClientRect().width).toBe(40);
  });

  it("checks the className", async () => {
    await render(<Item title="x" className="bg-muted" />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Item: "bg-muted" sets appearance, and className is for layout only. Fix: <Item variant="outline">, or <ItemGroup variant="outline"> around the rows.',
    );
  });

  it("ties the link to its description in server HTML and hydrates without a mismatch", async () => {
    const node = <Item href="/recipes/1" title="Short ribs" description="Four hours" />;
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    const link = host.querySelector("a")!;
    expect(link.getAttribute("aria-describedby")).toBe(host.querySelector("[data-ouro-text]")!.id);
    const recoverable = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => {
      roots.push(hydrateRoot(host, node, { onRecoverableError: recoverable }));
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await expect.element(page.getByRole("link", { name: "Short ribs" })).toHaveAccessibleDescription("Four hours");
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <>
        <Item title="Plain" className="bg-red-500" />
        <Item href="/x" title="Linked" />
      </>,
    );
    expect(html).toContain('data-ouro="item"');
    expect(html).toContain('href="/x"');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
