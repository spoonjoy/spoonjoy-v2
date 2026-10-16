import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Item } from "~/components/ouro/item/item";
import { Link } from "~/components/ouro/link/link";
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
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const { item } = await render(<Item {...({ title: "Ribs", ...extra } as unknown as Parameters<typeof Item>[0])} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Item: ${problem}. Fix: ${fix}.`);
    for (const attribute of ["subtitle", "icon", "avatar", "image", "thumbnail", "action", "label", "to", "aschild"]) {
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
