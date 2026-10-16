import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { AspectRatio } from "~/components/ouro/aspect-ratio/aspect-ratio";
import { Button } from "~/components/ouro/button/button";
import { Card } from "~/components/ouro/card/card";
import { Item } from "~/components/ouro/item/item";
import { Link } from "~/components/ouro/link/link";
import { ScrollArea } from "~/components/ouro/scroll-area/scroll-area";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.width = "360px";
  host.style.padding = "16px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return { host, card: host.querySelector<HTMLElement>('[data-ouro="card"]')! };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await commands.emulateMedia({ reducedMotion: "no-preference" });
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

describe("Card", () => {
  it("renders its slots in order: media, title as <h3>, description, action, body, footer", async () => {
    const { card } = await render(
      <Card
        media={
          <AspectRatio ratio={4 / 3}>
            <img src={pixel} alt="" />
          </AspectRatio>
        }
        title="Weeknight dinners"
        description="12 recipes"
        action={<Button variant="plain">Share</Button>}
        footer={<Button>Open</Button>}
      >
        <p data-body="">Fast, one-pan dinners.</p>
      </Card>,
    );
    expect(card.tagName).toBe("DIV");
    await expect.element(page.getByRole("heading", { level: 3, name: "Weeknight dinners" })).toBeVisible();
    const order = [
      card.querySelector('[data-ouro="aspect-ratio"]')!,
      page.getByRole("heading").element(),
      page.getByText("12 recipes").element(),
      page.getByRole("button", { name: "Share" }).element(),
      card.querySelector("[data-body]")!,
      page.getByRole("button", { name: "Open" }).element(),
    ];
    const tops = order.map((element) => Math.round(element.getBoundingClientRect().top));
    expect(tops[0]).toBeLessThan(tops[1]!);
    expect(tops[1]).toBeLessThan(tops[2]!);
    expect(tops[2]).toBeLessThan(tops[4]!);
    expect(tops[4]).toBeLessThan(tops[5]!);
    // The action sits beside the title, at the end.
    expect(order[3]!.getBoundingClientRect().left).toBeGreaterThan(order[1]!.getBoundingClientRect().right);
    // Media runs edge to edge, from the card's top.
    const media = order[0]!.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    expect(media.width).toBe(box.width - 2);
    expect(media.top).toBe(box.top + 1);
  });

  it("is a bordered surface in the card colors, with 24px padding", async () => {
    const { card } = await render(
      <Card title="Pantry">
        <span data-body="">Flour, rice, beans.</span>
      </Card>,
    );
    const style = getComputedStyle(card);
    expect(style.borderTopWidth).toBe("1px");
    expect(style.paddingTop).toBe("24px");
    const probe = document.createElement("span");
    probe.style.backgroundColor = "var(--card)";
    document.body.append(probe);
    mounted.push(probe);
    expect(style.backgroundColor).toBe(getComputedStyle(probe).backgroundColor);
    const body = card.querySelector("[data-body]")!;
    expect(body.getBoundingClientRect().left - card.getBoundingClientRect().left).toBe(25);
  });

  it("is tighter with size=sm", async () => {
    const { card } = await render(
      <Card title="Pantry" size="sm">
        <span data-body="">Flour</span>
      </Card>,
    );
    expect(getComputedStyle(card).paddingTop).toBe("16px");
    const body = card.querySelector("[data-body]")!;
    expect(body.getBoundingClientRect().left - card.getBoundingClientRect().left).toBe(17);
  });

  it("has no frame or padding with variant=plain", async () => {
    const { card } = await render(
      <Card title="Passkeys" variant="plain">
        Two passkeys
      </Card>,
    );
    const style = getComputedStyle(card);
    expect(style.borderTopWidth).toBe("0px");
    expect(style.paddingTop).toBe("0px");
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    const body = page.getByText("Two passkeys").element();
    expect(body.getBoundingClientRect().left).toBe(card.getBoundingClientRect().left);
  });

  it.each(["sm", "md"] as const)("drops the action under the title below %s with stackBelow", async (breakpoint) => {
    await page.viewport(breakpoint === "sm" ? 390 : 700, 844);
    await render(<Card title="Passkeys" description="Sign in with your face" action={<Button>Add</Button>} stackBelow={breakpoint} />);
    const title = page.getByText("Passkeys").element().getBoundingClientRect();
    const description = page.getByText("Sign in with your face").element().getBoundingClientRect();
    const add = page.getByRole("button", { name: "Add" }).element();
    expect(add.getBoundingClientRect().top).toBeGreaterThanOrEqual(description.bottom);
    expect(Math.round(add.getBoundingClientRect().left)).toBe(Math.round(title.left));
    await page.viewport(1280, 800);
    await expect.poll(() => add.getBoundingClientRect().top < title.bottom).toBe(true);
  });

  it("keeps the action beside the title on a phone without stackBelow", async () => {
    await page.viewport(390, 844);
    await render(<Card title="Passkeys" action={<Button>Add</Button>} />);
    const title = page.getByText("Passkeys").element().getBoundingClientRect();
    expect(page.getByRole("button", { name: "Add" }).element().getBoundingClientRect().top).toBeLessThan(title.bottom);
  });

  it("rounds plain media itself", async () => {
    const { card } = await render(
      <Card variant="plain" media={<img src={pixel} alt="" style={{ height: 40 }} />} title="Cover" />,
    );
    const media = card.firstElementChild as HTMLElement;
    expect(getComputedStyle(media).borderTopLeftRadius).not.toBe("0px");
    expect(getComputedStyle(media).overflow).toBe("hidden");
  });

  it.each([2, 4, 5, 6] as const)("renders the title at headingLevel %i", async (level) => {
    await render(<Card title="Pantry" headingLevel={level} />);
    await expect.element(page.getByRole("heading", { level, name: "Pantry" })).toBeVisible();
  });

  it.each(["article", "section", "li"] as const)("renders as %s", async (as) => {
    const { card } = await render(as === "li" ? <ul><Card as="li" title="x" /></ul> : <Card as={as} title="x" />);
    expect(card.tagName).toBe(as.toUpperCase());
  });

  it("renders only the body without a title, description or action", async () => {
    const { card } = await render(<Card>Just a body</Card>);
    expect(card.querySelector("h3")).toBeNull();
    expect(card.children).toHaveLength(1);
  });

  it("passes attributes and a ref through, and lets layout classes win", async () => {
    let node: HTMLElement | null = null;
    const { card } = await render(
      <Card title="x" id="pantry" className="mt-4 w-48" ref={(element) => void (node = element)}>
        y
      </Card>,
    );
    expect(card.id).toBe("pantry");
    expect(node).toBe(card);
    expect(getComputedStyle(card).marginTop).toBe("16px");
    expect(getComputedStyle(card).width).toBe("192px");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("Card with href", () => {
  it("is one link named by its title, which covers the whole card", async () => {
    const { card } = await render(
      <Card href="/cookbooks/1" title="Weeknight dinners" description="12 recipes" footer={<span>Updated today</span>}>
        <p data-body="">Fast dinners</p>
      </Card>,
    );
    const links = card.querySelectorAll("a");
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link.getAttribute("href")).toBe("/cookbooks/1");
    await expect.element(page.getByRole("link", { name: "Weeknight dinners" })).toBeVisible();
    // The link's hit area covers the description, the body and the footer.
    for (const selector of ["[data-body]", "span"]) {
      const [x, y] = center(card.querySelector(selector)!);
      expect(document.elementFromPoint(x, y)).toBe(link);
    }
    const [x, y] = center(page.getByText("12 recipes").element());
    expect(document.elementFromPoint(x, y)).toBe(link);
    expect(getComputedStyle(card).cursor === "pointer" || getComputedStyle(link).cursor === "pointer").toBe(true);
  });

  it("keeps the action and footer controls on top, as their own tab stops", async () => {
    const onShare = vi.fn();
    const { card } = await render(
      <Card href="/cookbooks/1" title="Weeknight dinners" action={<Button onClick={onShare}>Share</Button>} footer={<Button>Cook</Button>}>
        Fast dinners
      </Card>,
    );
    const share = page.getByRole("button", { name: "Share" }).element() as HTMLElement;
    const cook = page.getByRole("button", { name: "Cook" }).element() as HTMLElement;
    for (const button of [share, cook]) {
      const [x, y] = center(button);
      expect(button.contains(document.elementFromPoint(x, y))).toBe(true);
    }
    share.click();
    expect(onShare).toHaveBeenCalledTimes(1);
    // Tab order: the link, then the action, then the footer.
    const before = document.createElement("button");
    before.textContent = "before";
    card.parentElement!.prepend(before);
    before.focus();
    await pressTab();
    expect(document.activeElement).toBe(card.querySelector("a"));
    await pressTab();
    expect(document.activeElement).toBe(share);
    await pressTab();
    expect(document.activeElement).toBe(cook);
  });

  it("keeps every control in media and the body clickable on a phone, while the rest opens the card", async () => {
    await page.viewport(390, 844);
    const onShare = vi.fn();
    const { card } = await render(
      <Card
        href="/cookbooks/1"
        media={
          <>
            <AspectRatio ratio={4 / 3}>
              <img src={pixel} alt="" data-cover="" />
            </AspectRatio>
            <Button className="absolute end-2 top-2" onClick={onShare}>
              Share
            </Button>
          </>
        }
        title="Weeknight dinners"
        description="12 recipes"
      >
        <p>
          By <a href="/cooks/ari">Ari</a>, after <Link href="/cooks/sam">Sam</Link>
        </p>
      </Card>,
    );
    const cardLink = card.querySelector("[data-card-link]")!;
    const share = page.getByRole("button", { name: "Share" }).element() as HTMLElement;
    // The share button keeps its own position over the cover.
    expect(getComputedStyle(share).position).toBe("absolute");
    for (const control of [share, page.getByRole("link", { name: "Ari" }).element(), page.getByRole("link", { name: "Sam" }).element()]) {
      const [x, y] = center(control);
      expect(control.contains(document.elementFromPoint(x, y))).toBe(true);
    }
    await userEvent.click(share);
    expect(onShare).toHaveBeenCalledTimes(1);
    // The cover and the text around the links still open the card.
    const [x, y] = center(card.querySelector("[data-cover]")!);
    expect(document.elementFromPoint(x, y)).toBe(cardLink);
    expect(getComputedStyle(cardLink).position).toBe("static");
  });

  it("outlines the whole card when the link has keyboard focus", async () => {
    const { card } = await render(<Card href="/x" title="Go" />);
    expect(getComputedStyle(card).outlineStyle).toBe("none");
    const before = document.createElement("button");
    card.parentElement!.prepend(before);
    before.focus();
    await pressTab();
    expect(getComputedStyle(card).outlineStyle).toBe("solid");
  });

  it("opens the card from text in an element that only takes focus from code, such as a ScrollArea that fits", async () => {
    const { card } = await render(
      <Card href="/cookbooks/1" title="Weeknight dinners">
        <ScrollArea className="h-40" label="Notes">
          <p>Short notes</p>
        </ScrollArea>
        <div tabIndex={-1}>
          <p>Focus target</p>
        </div>
      </Card>,
    );
    const viewport = card.querySelector<HTMLElement>("[data-scroll-viewport]")!;
    await expect.poll(() => viewport.tabIndex).toBe(-1);
    const link = card.querySelector("[data-card-link]")!;
    for (const text of ["Short notes", "Focus target"]) {
      const [x, y] = center(page.getByText(text).element());
      expect(document.elementFromPoint(x, y)).toBe(link);
    }
  });

  it("keeps a linked Item inside it a whole-row link to its own page, and the rest opens the card", async () => {
    await page.viewport(390, 844);
    const { card } = await render(
      <Card href="#cookbook" title="Weeknight dinners" description="12 recipes">
        <Item href="#ribs" title="Braised short ribs" description="Four hours, mostly hands-off" data-row="" />
      </Card>,
    );
    const row = card.querySelector<HTMLElement>("[data-row]")!;
    const itemLink = row.querySelector<HTMLAnchorElement>("[data-item-link]")!;
    const box = row.getBoundingClientRect();
    for (const [x, y] of [
      center(page.getByText("Four hours, mostly hands-off").element()),
      [box.left + 4, box.top + box.height / 2],
      [box.right - 4, box.bottom - 4],
    ] as const) {
      expect(document.elementFromPoint(x, y)).toBe(itemLink);
    }
    const [x, y] = center(page.getByText("Four hours, mostly hands-off").element());
    (document.elementFromPoint(x, y) as HTMLElement).click();
    expect(location.hash).toBe("#ribs");
    const [cx, cy] = center(page.getByText("12 recipes").element());
    expect(document.elementFromPoint(cx, cy)).toBe(card.querySelector("[data-card-link]"));
    history.replaceState(null, "", location.pathname + location.search);
  });

  it("keeps its focus outline inside the card, so a scrolling parent does not clip it", async () => {
    const { card } = await render(<Card href="/x" title="Go" />);
    expect(getComputedStyle(card).outlineOffset).toBe("-2px");
  });

  it("scales to --ouro-press-scale while pressed, and not with reduced motion", async () => {
    async function pressedScale(card: HTMLElement) {
      await commands.pointerPress({ selector: "[data-press-probe]", action: "down" });
      try {
        let last = "";
        await expect
          .poll(() => {
            const scale = getComputedStyle(card).scale;
            const still = scale === last && card.getAnimations().length === 0;
            last = scale;
            return still;
          }, { interval: 50 })
          .toBe(true);
        return last;
      } finally {
        await commands.pointerPress({ action: "up" });
      }
    }
    const { card } = await render(
      <Card href="#pressed" title="Press" data-press-probe="">
        Body
      </Card>,
    );
    expect(getComputedStyle(card).scale).toBe("none");
    expect(await pressedScale(card)).toBe("0.97");
    await commands.emulateMedia({ reducedMotion: "reduce" });
    expect(await pressedScale(card)).toBe("none");
  });

  it("renders the provider's linkComponent and forwards linkRef to the anchor", async () => {
    let anchor: HTMLAnchorElement | null = null;
    const { card } = await render(
      <OuroProvider linkComponent={RouterLink}>
        <Card href="/cookbooks/1" title="Dinners" linkRef={(node) => void (anchor = node)} />
      </OuroProvider>,
    );
    const link = card.querySelector("a")!;
    expect(link.hasAttribute("data-router")).toBe(true);
    expect(anchor).toBe(link);
  });

  it("opens in a new tab with external, and says so", async () => {
    const { card } = await render(<Card href="https://ouro.bot" external title="Ouro" />);
    const link = card.querySelector("a")!;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    await expect.element(page.getByRole("link", { name: "Ouro (opens in a new tab)" })).toBeVisible();
  });
});

describe("Card development messages", () => {
  it.each([
    ["href without title", { href: "/x" }, "href needs a title, which is the link's text", '<Card href="/x" title="Weeknight dinners">'],
    ["subtitle", { title: "x", subtitle: "12 recipes" }, "subtitle is not a prop", '<Card description="12 recipes">'],
    ["image", { title: "x", image: "/a.jpg" }, "image is not a prop", "<Card media={<AspectRatio ratio={4 / 3}><img src=… alt=\"\" /></AspectRatio>}>"],
    ["header", { title: "x", header: "y" }, "header is not a prop", '<Card title="…" description="…" action={…}>'],
    ["actions", { title: "x", actions: "y" }, "actions is not a prop", "<Card action={<Button>…</Button>}> beside the title, or footer={…} below"],
    ["to", { title: "x", to: "/x" }, "to is not a prop", '<Card href="/x" title="…">'],
    ["to object", { title: "x", to: { pathname: "/x" } }, "to is not a prop", '<Card href="/path" title="…">'],
    ["asChild", { title: "x", asChild: true }, "asChild is not a prop", '<Card href="/path" title="…">'],
    ["variant", { title: "x", variant: "elevated" }, 'variant="elevated" is not a variant; use "outline", "plain"', '<Card variant="outline">'],
    ["size", { title: "x", size: "lg" }, 'size="lg" is not a size; use "md", "sm"', '<Card size="md">'],
    ["as", { title: "x", as: "a" }, 'as="a" is not an element Card renders; use "div", "article", "section", "li"', '<Card href="/path" title="…">'],
    ["as span", { title: "x", as: "span" }, 'as="span" is not an element Card renders; use "div", "article", "section", "li"', '<Card as="div">'],
    ["stackBelow", { title: "x", stackBelow: "lg" }, 'stackBelow="lg" is not a breakpoint; use "sm", "md"', '<Card stackBelow="sm">'],
    ["headingLevel", { title: "x", headingLevel: 1 }, "headingLevel must be 2, 3, 4, 5 or 6, got 1", "<Card headingLevel={2}>"],
  ])("warns for %s with the fix", async (_name, props, problem, fix) => {
    const { card } = await render(<Card {...(props as unknown as Parameters<typeof Card>[0])} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Card: ${problem}. Fix: ${fix}.`);
    for (const attribute of ["subtitle", "image", "header", "actions", "to", "aschild"]) expect(card.hasAttribute(attribute)).toBe(false);
  });

  it("renders the defaults for unknown values", async () => {
    const { card } = await render(
      <Card {...({ title: "x", variant: "elevated", size: "lg", as: "span", headingLevel: 9 } as unknown as Parameters<typeof Card>[0])} />,
    );
    expect(card.tagName).toBe("DIV");
    expect(getComputedStyle(card).borderTopWidth).toBe("1px");
    expect(getComputedStyle(card).paddingTop).toBe("24px");
    expect(card.querySelector("h3")).not.toBeNull();
  });

  it.each([
    ["bg-white", '<Card variant="plain"> inside your own surface, or the theme\'s --card color'],
    ["rounded-none", ":root { --radius: 0px }"],
    ["shadow-lg", '<Card variant="plain"> inside your own surface, or the theme\'s --card color'],
  ])("checks the className %s", async (className, fix) => {
    await render(<Card title="x" className={className} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Card: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <>
        <Card title="Dinners" description="12 recipes" className="bg-red-500">
          Body
        </Card>
        <Card href="/x" title="Linked" />
      </>,
    );
    expect(html).toContain('data-ouro="card"');
    expect(html).toContain('href="/x"');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
