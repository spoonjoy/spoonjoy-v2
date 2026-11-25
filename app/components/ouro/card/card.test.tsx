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
import { Text } from "~/components/ouro/text/text";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";
import { measureTextContrast } from "~/lib/ouro/testing/axe";
import { pageCss } from "~/lib/ouro/testing/page-css";
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
  await commands.resetMedia();
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

describe("Card", () => {
  it("names its root card, as shadcn does, for an app that styles it by part name", async () => {
    const { card } = await render(<Card title="Braising">Two hours.</Card>);
    expect(card.getAttribute("data-slot")).toBe("card");
  });

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

  it("lays a backdrop behind the whole card, edge to edge, clipping only the picture and not the card or its text", async () => {
    const { card } = await render(
      <Card
        backdrop={<img src={pixel} alt="" data-picture="" />}
        footer={<Button>Start cooking</Button>}
        className="min-h-80"
      >
        <Text>On the counter</Text>
      </Card>,
    );
    const backdrop = card.querySelector<HTMLElement>("[data-card-backdrop]")!;
    const picture = card.querySelector<HTMLElement>("[data-picture]")!;
    const box = card.getBoundingClientRect();
    // It covers the card's border box, behind its content, and the picture fills it.
    expect(backdrop.getBoundingClientRect().toJSON()).toEqual(box.toJSON());
    expect(picture.getBoundingClientRect().toJSON()).toEqual(box.toJSON());
    expect(getComputedStyle(picture).objectFit).toBe("cover");
    expect(getComputedStyle(backdrop).zIndex).toBe("-1");
    expect(getComputedStyle(backdrop).pointerEvents).toBe("none");
    // The picture takes the card's corner and clips itself; the card and its text and controls don't clip.
    expect(getComputedStyle(backdrop).borderTopLeftRadius).toBe(getComputedStyle(card).borderTopLeftRadius);
    expect(parseFloat(getComputedStyle(backdrop).borderTopLeftRadius)).toBeGreaterThan(1);
    expect(getComputedStyle(backdrop).overflow).toBe("clip");
    expect(getComputedStyle(card).overflow).toBe("visible");
    for (const part of [page.getByText("On the counter").element(), page.getByRole("button", { name: "Start cooking" }).element()]) {
      for (let node: Element | null = part; node && node !== card; node = node.parentElement) {
        expect(getComputedStyle(node).clipPath).toBe("none");
        expect(backdrop.contains(node)).toBe(false);
      }
    }
    const [x, y] = center(page.getByRole("button", { name: "Start cooking" }).element() as HTMLElement);
    expect(document.elementFromPoint(x, y)?.closest("button")?.textContent).toBe("Start cooking");
  });

  it("rounds a plain card's backdrop itself, as plain media is rounded", async () => {
    const { card } = await render(<Card variant="plain" backdrop={<img src={pixel} alt="" />} title="Cover" />);
    const backdrop = card.querySelector<HTMLElement>("[data-card-backdrop]")!;
    expect(parseFloat(getComputedStyle(backdrop).borderTopLeftRadius)).toBeGreaterThan(1);
    expect(getComputedStyle(backdrop).overflow).toBe("clip");
  });

  it("tints a linked backdrop card on hover inside the picture's clip, not as a square over its corners", async () => {
    const { card } = await render(<Card href="/recipes/1" title="Ribs" backdrop={<img src={pixel} alt="" />} className="min-h-40" />);
    const backdrop = card.querySelector<HTMLElement>("[data-card-backdrop]")!;
    const link = card.querySelector<HTMLElement>("[data-card-link]")!;
    const tint = backdrop.querySelector<HTMLElement>("[data-card-tint]")!;
    const clear = "rgba(0, 0, 0, 0)";
    expect(tint.style.backgroundColor).toBe("transparent");
    expect(tint.getBoundingClientRect().toJSON()).toEqual(backdrop.getBoundingClientRect().toJSON());
    expect(tint.style.transition).toContain("background-color");
    await userEvent.hover(link);
    await expect.poll(() => getComputedStyle(tint).backgroundColor).not.toBe(clear);
    expect(getComputedStyle(link, "::after").backgroundColor).toBe(clear);
    expect(getComputedStyle(backdrop).overflow).toBe("clip");
    await commands.parkPointer();
  });

  it("deepens and clears a linked backdrop card's tint on a press when the app passes no pointer handlers", async () => {
    const { card } = await render(<Card href="/recipes/1" title="Ribs" backdrop={<img src={pixel} alt="" />} className="min-h-40" />);
    const tint = card.querySelector<HTMLElement>("[data-card-tint]")!;
    const link = card.querySelector<HTMLElement>("[data-card-link]")!;
    const fire = (type: string) => act(() => link.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse" })));
    await fire("pointerover");
    const hover = tint.style.backgroundColor;
    await fire("pointerdown");
    expect(tint.style.backgroundColor).not.toBe(hover);
    await fire("pointerup");
    expect(tint.style.backgroundColor).toBe(hover);
    await fire("pointerdown");
    await fire("pointercancel");
    expect(tint.style.backgroundColor).toBe("transparent");
  });

  it("fills the backdrop with a picture drawn by an inline element, such as a <picture>", async () => {
    const { card } = await render(<Card title="Ribs" backdrop={<span data-picture="" />} className="min-h-40" />);
    const backdrop = card.querySelector<HTMLElement>("[data-card-backdrop]")!;
    const picture = backdrop.querySelector<HTMLElement>("[data-picture]")!;
    expect(picture.getBoundingClientRect().toJSON()).toEqual(backdrop.getBoundingClientRect().toJSON());
  });

  it("deepens a linked backdrop card's tint while its link is pressed, never for a touch, and clears it when the pointer leaves", async () => {
    const calls: string[] = [];
    const own = (name: string) => () => calls.push(name);
    const { card } = await render(
      <Card
        href="/recipes/1"
        title="Ribs"
        backdrop={<img src={pixel} alt="" style={{ opacity: 0.5 }} />}
        className="min-h-40"
        onPointerOver={own("over")}
        onPointerDown={own("down")}
        onPointerUp={own("up")}
        onPointerCancel={own("cancel")}
        onPointerLeave={own("leave")}
      />,
    );
    const tint = card.querySelector<HTMLElement>("[data-card-tint]")!;
    const link = card.querySelector<HTMLElement>("[data-card-link]")!;
    const fire = (target: Element, type: string, pointerType = "mouse", relatedTarget: Element | null = null) =>
      act(() => target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType, relatedTarget })));
    // The colour the tint is set to, not where its transition has reached.
    const shade = () => tint.style.backgroundColor;
    const clear = "transparent";
    await fire(link, "pointerover");
    const hover = shade();
    expect(hover).not.toBe(clear);
    await fire(link, "pointerdown");
    const press = shade();
    expect(press).not.toBe(hover);
    // A press holds through moving over another part of the card.
    await fire(card.querySelector("h3")!, "pointerover");
    expect(shade()).toBe(press);
    await fire(link, "pointerup");
    expect(shade()).toBe(hover);
    // React's onPointerLeave comes from the pointer moving out to something outside the card.
    await fire(link, "pointerout", "mouse", document.body);
    expect(shade()).toBe(clear);
    // A touch leaves no hover behind, and a cancelled press clears.
    await fire(link, "pointerover", "touch");
    expect(shade()).toBe(clear);
    await fire(link, "pointerdown", "touch");
    expect(shade()).toBe(press);
    await fire(link, "pointerup", "touch");
    expect(shade()).toBe(clear);
    await fire(link, "pointerdown", "touch");
    await fire(link, "pointercancel", "touch");
    expect(shade()).toBe(clear);
    // A press that starts off the link isn't the link's.
    await fire(card, "pointerdown");
    expect(shade()).toBe(clear);
    // The app's own pointer handlers still run, and the picture keeps its own style beside the fill.
    expect(new Set(calls)).toEqual(new Set(["over", "down", "up", "cancel", "leave"]));
    const picture = card.querySelector<HTMLImageElement>("[data-card-backdrop] img")!;
    expect([picture.style.opacity, picture.style.objectFit]).toEqual(["0.5", "cover"]);
  });

  it("lays a backdrop that isn't an element as it is, and an unlinked card's backdrop has no tint", async () => {
    const { card } = await render(<Card title="Ribs" backdrop="A photo of ribs" className="min-h-40" />);
    const backdrop = card.querySelector<HTMLElement>("[data-card-backdrop]")!;
    expect(backdrop.textContent).toBe("A photo of ribs");
    expect(backdrop.querySelector("[data-card-tint]")).toBeNull();
  });

  it("keeps a plain card's backdrop inside the plain card, inside an outlined one", async () => {
    await render(
      <Card title="Outer">
        <Card variant="plain" backdrop={<img src={pixel} alt="" />} className="min-h-20" data-inner="">
          x
        </Card>
      </Card>,
    );
    const inner = document.querySelector<HTMLElement>("[data-inner]")!;
    const backdrop = inner.querySelector<HTMLElement>("[data-card-backdrop]")!;
    expect(backdrop.getBoundingClientRect().toJSON()).toEqual(inner.getBoundingClientRect().toJSON());
  });

  it("warns that backdrop and media are two pictures", async () => {
    await render(<Card backdrop={<img src={pixel} alt="" />} media={<img src={pixel} alt="" />} title="Cover" />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Card: backdrop and media are two pictures; use one. Fix: <Card backdrop={<img src=… alt="" />}>.');
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
    // size="md" (the default) sizes an untouched title at Heading's own "md" step, not "sm" or the inherited body size.
    const title = card.querySelector('[data-slot="card-title"]')!;
    expect(getComputedStyle(title).fontSize).toBe("18px");
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
    // size="sm" sizes an untouched title at Heading's "sm" step, smaller than the default "md" title above.
    const title = card.querySelector('[data-slot="card-title"]')!;
    expect(getComputedStyle(title).fontSize).toBe("16px");
  });

  it('sizes the title from the surrounding text with titleSize="inherit", staying semibold', async () => {
    const host = document.createElement("div");
    host.style.fontSize = "14px";
    host.style.padding = "16px";
    document.body.append(host);
    mounted.push(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <Card title="Weeknight dinners" variant="plain" titleSize="inherit">
          Fast dinners
        </Card>,
      ),
    );
    const title = host.querySelector('[data-slot="card-title"]')!;
    const style = getComputedStyle(title);
    expect(style.fontSize).toBe("14px");
    expect(style.fontWeight).toBe("600");
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
    expect(card.querySelectorAll(":scope > *")).toHaveLength(1);
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
          By <a href="/cooks/ari">Ari</a>, after <Link href="/cooks/jo">Jo</Link>
        </p>
      </Card>,
    );
    const cardLink = card.querySelector("[data-card-link]")!;
    const share = page.getByRole("button", { name: "Share" }).element() as HTMLElement;
    // The share button keeps its own position over the cover.
    expect(getComputedStyle(share).position).toBe("absolute");
    for (const control of [share, page.getByRole("link", { name: "Ari" }).element(), page.getByRole("link", { name: "Jo" }).element()]) {
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

  // An app's layout that positions the card's body over its media, as a front door's tiles do: the link's layer then
  // covers the body alone, which is the box it is positioned in.
  const overMedia = '[data-consumer] [data-ouro="card"] > div:last-child { position: absolute; inset: auto 0 0 0; background: var(--card); }';
  const consumerCard = (extra: ReactNode = null) => (
    <div data-consumer="">
      <style>{overMedia}</style>
      <Card
        href="#opened"
        title="Braising"
        description="Low heat, a lid, and time"
        media={
          <AspectRatio ratio={4 / 3}>
            <img src={pixel} alt="" data-picture="" />
          </AspectRatio>
        }
        action={extra}
      />
    </div>
  );

  it("opens its link from a click anywhere on it, though the app positions its body over the media, with the same button and keys", async () => {
    const { card } = await render(consumerCard());
    expect(card.getAttribute("data-follows-link")).toBe("");
    const link = card.querySelector<HTMLAnchorElement>("[data-card-link]")!;
    const picture = card.querySelector("[data-picture]")!.getBoundingClientRect();
    // The app's layout leaves the top of the picture outside the link's layer.
    expect(document.elementFromPoint(picture.left + 8, picture.top + 8)?.closest("a")).toBeNull();
    const clicks: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }[] = [];
    link.addEventListener("click", (event) => {
      event.preventDefault();
      clicks.push({ button: event.button, metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey });
    });
    // A middle or modified click opens the address in a new tab: Safari ignores the keys on a click a script hands on.
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const at = { position: { x: 8, y: 8 } };
    await userEvent.click(card.querySelector("[data-picture]")!, at);
    expect(clicks).toEqual([{ button: 0, metaKey: false, ctrlKey: false, shiftKey: false }]);
    await userEvent.click(card.querySelector("[data-picture]")!, { ...at, modifiers: ["ControlOrMeta"] } as never);
    await userEvent.click(card.querySelector("[data-picture]")!, { ...at, modifiers: ["Shift"] } as never);
    await userEvent.click(card.querySelector("[data-picture]")!, { ...at, button: "middle" } as never);
    expect(clicks).toHaveLength(1);
    expect(open.mock.calls).toEqual(Array.from({ length: 3 }, () => [link.href, "_blank", "noopener"]));
  });

  it("hands its click on out of a shadow root, as the browser's own click goes, so the page's link handler sees it", async () => {
    const outer = document.createElement("div");
    document.body.append(outer);
    mounted.push(outer);
    const host = document.createElement("div");
    outer.attachShadow({ mode: "open" }).append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<Card href="#shadow" title="Searing" media={<img src={pixel} alt="" data-picture="" />} />));
    const link = host.querySelector<HTMLAnchorElement>("[data-card-link]")!;
    const seen: EventTarget[] = [];
    const onPage = (event: MouseEvent) => {
      seen.push(event.composedPath()[0]!);
      event.preventDefault();
    };
    document.addEventListener("click", onPage);
    try {
      host.querySelector<HTMLElement>("[data-picture]")!.click();
    } finally {
      document.removeEventListener("click", onPage);
    }
    // The root hands the click on as the browser's own passes it, so the link's reaches the page first.
    expect(seen).toEqual([link, host.querySelector("[data-picture]")]);
  });

  it("hands a plain click to the app's router link, whose own handler sees it and can stop the browser's navigation", async () => {
    const seen: boolean[] = [];
    const Router: OuroLinkComponent = ({ onClick, ...props }) => (
      <a
        {...props}
        onClick={(event) => {
          onClick?.(event);
          event.preventDefault();
          // The browser's own event, which a click it cannot cancel would leave to navigate.
          seen.push(event.nativeEvent.defaultPrevented);
        }}
      />
    );
    const { card } = await render(<OuroProvider linkComponent={Router}>{consumerCard()}</OuroProvider>);
    await userEvent.click(card.querySelector("[data-picture]")!, { position: { x: 8, y: 8 } });
    expect(seen).toEqual([true]);
  });

  it("opens nothing from a right click, or a click the app's own handler cancels, and a card with no link takes its clicks as it is", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { card } = await render(consumerCard());
    const link = card.querySelector<HTMLAnchorElement>("[data-card-link]")!;
    const opened = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener("click", opened);
    await userEvent.click(card.querySelector("[data-picture]")!, { position: { x: 8, y: 8 }, button: "right" } as never);
    expect(opened).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    const cancelled = await render(
      <div data-consumer="">
        <style>{overMedia}</style>
        <Card href="#opened" title="Searing" media={<AspectRatio ratio={4 / 3}><img src={pixel} alt="" data-picture="" /></AspectRatio>} onClick={(event) => event.preventDefault()} />
      </div>,
    );
    const second = vi.fn((event: Event) => event.preventDefault());
    cancelled.card.querySelector("[data-card-link]")!.addEventListener("click", second);
    await userEvent.click(cancelled.card.querySelector("[data-picture]")!, { position: { x: 8, y: 8 } });
    expect(second).not.toHaveBeenCalled();
    const onClick = vi.fn();
    const plain = await render(<Card title="Pantry" description="What you have on hand" onClick={onClick} />);
    await userEvent.click(page.getByText("What you have on hand"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(plain.card.hasAttribute("data-follows-link")).toBe(false);
  });

  it("opens nothing from a click that ends a text selection, or one a control of its own takes", async () => {
    const onClick = vi.fn();
    const { card } = await render(consumerCard(<Button variant="plain" onClick={onClick}>Save</Button>));
    const link = card.querySelector<HTMLAnchorElement>("[data-card-link]")!;
    const opened = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener("click", opened);
    await userEvent.click(page.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(opened).not.toHaveBeenCalled();
    const picture = card.querySelector("[data-picture]")!;
    const range = document.createRange();
    range.selectNodeContents(page.getByText("Low heat, a lid, and time").element());
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    picture.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(opened).not.toHaveBeenCalled();
    // Text selected elsewhere on the page, which a press on a picture leaves selected, does not stop the card.
    const elsewhere = document.createElement("p");
    elsewhere.textContent = "Notes beside the card";
    card.parentElement!.after(elsewhere);
    mounted.push(elsewhere);
    range.selectNodeContents(elsewhere);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    picture.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(opened).toHaveBeenCalledTimes(1);
    getSelection()!.removeAllRanges();
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

describe("Card with href, zoomMedia and revealDescription", () => {
  function settled(element: Element, read: () => string) {
    let last = "";
    return expect
      .poll(() => {
        const value = read();
        const still = value === last && element.getAnimations().length === 0;
        last = value;
        return still ? value : undefined;
      }, { interval: 50 });
  }
  const tile = (props: { zoomMedia?: boolean; revealDescription?: boolean | "rise" }) => (
    <Card
      href="#braising"
      title="Braising"
      description="Low heat, a lid, and time"
      media={
        <>
          <AspectRatio ratio={4 / 3}>
            <img src={pixel} alt="" data-picture="" />
          </AspectRatio>
          <Button variant="soft" size="sm" className="absolute end-2 top-2" data-share="">
            Share
          </Button>
        </>
      }
      {...props}
    />
  );

  it("grows the media's picture 3% inside its frame while the pointer rests on the card or keyboard focus is in it, and not with reduced motion", async () => {
    const { card } = await render(tile({ zoomMedia: true }));
    const picture = card.querySelector<HTMLImageElement>("[data-picture]")!;
    const share = card.querySelector<HTMLElement>("[data-share]")!;
    const frame = picture.parentElement!.parentElement!;
    const before = card.getBoundingClientRect();
    expect(warn).not.toHaveBeenCalled();
    expect(getComputedStyle(picture).scale).toBe("none");
    await userEvent.hover(card.querySelector("h3")!);
    await settled(picture, () => getComputedStyle(picture).scale).toBe("1.03");
    expect(card.getBoundingClientRect().height).toBe(before.height);
    expect(getComputedStyle(frame).overflow).toBe("hidden");
    expect(getComputedStyle(share).scale).toBe("none");
    const [x, y] = center(share);
    expect(document.elementFromPoint(x, y)?.closest("[data-share]")).toBe(share);
    await commands.parkPointer();
    await settled(picture, () => getComputedStyle(picture).scale).toBe("none");
    const start = document.createElement("button");
    card.parentElement!.prepend(start);
    start.focus();
    await pressTab();
    await settled(picture, () => getComputedStyle(picture).scale).toBe("1.03");
    start.focus();
    await commands.emulateMedia({ reducedMotion: "reduce" });
    await userEvent.hover(card.querySelector("h3")!);
    await settled(picture, () => getComputedStyle(picture).scale).toBe("none");
  });

  it("hides a revealDescription card's description only where the pointer can hover, so a stylus that cannot still sees it", () => {
    const conditions = hidingConditions(CSS.escape("group/card"));
    expect(conditions).not.toEqual([]);
    for (const chain of conditions) expect(chain).toContain("(hover: hover)");
  });

  it('rises the description over the media with revealDescription="rise", taking no room before, and the card\'s box never changes', async () => {
    const { card } = await render(tile({ revealDescription: "rise" }));
    const reveal = card.querySelector<HTMLElement>('[data-card-reveal="rise"]')!;
    const picture = card.querySelector("[data-picture]")!.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const title = page.getByRole("heading", { name: "Braising" }).element();
    // At rest: the title sits on the media's bottom, and the description takes no room.
    expect(title.getBoundingClientRect().bottom).toBeLessThanOrEqual(picture.bottom);
    expect(reveal.getBoundingClientRect().height).toBe(0);
    expect(getComputedStyle(reveal).opacity).toBe("0");
    await expect.element(page.getByRole("link", { name: "Braising" })).toHaveAccessibleDescription("Low heat, a lid, and time");
    const titleTop = title.getBoundingClientRect().top;
    await userEvent.hover(title);
    await settled(reveal, () => getComputedStyle(reveal).opacity).toBe("1");
    expect(reveal.getBoundingClientRect().height).toBeGreaterThan(0);
    // Without zoomMedia the picture keeps its size.
    expect(getComputedStyle(card.querySelector("[data-picture]")!).scale).toBe("none");
    // It rose: the title moved up over the media, and the card kept its box.
    expect(title.getBoundingClientRect().top).toBeLessThan(titleTop);
    expect(reveal.getBoundingClientRect().bottom).toBeLessThanOrEqual(picture.bottom);
    expect(card.getBoundingClientRect().toJSON()).toEqual(box.toJSON());
    // The link's layer covers the picture too, so the browser's own link handles a click there: its address, its menu.
    expect(document.elementFromPoint(picture.left + 8, picture.top + 8)?.closest("a")).toBe(card.querySelector("[data-card-link]"));
    await commands.parkPointer();
    await settled(reveal, () => getComputedStyle(reveal).opacity).toBe("0");
    expect(reveal.getBoundingClientRect().height).toBe(0);
    const start = document.createElement("button");
    card.parentElement!.prepend(start);
    start.focus();
    await pressTab();
    await pressTab();
    expect(document.activeElement).toBe(card.querySelector("[data-card-link]"));
    await settled(reveal, () => getComputedStyle(reveal).opacity).toBe("1");
    // The button before it moved the card down; its size is the same.
    expect([card.getBoundingClientRect().width, card.getBoundingClientRect().height]).toEqual([box.width, box.height]);
  });

  it("lays a rising title on glass over the picture, solid without a blur, with less transparency or more contrast, and the page's background under a theme with no card color", async () => {
    const { card } = await render(<div style={{ "--card": "initial", "--card-foreground": "initial" } as never}>{tile({ revealDescription: "rise" })}</div>);
    // The block that holds the title and the rising description, over the media.
    const band = card.querySelector<HTMLElement>("[data-card-glass]")!;
    const title = card.querySelector('[data-card-reveal="rise"]')!.parentElement!.parentElement!;
    // The glass lies under the whole of the title's block, and is no content of its own.
    expect(band.getAttribute("aria-hidden")).toBe("true");
    expect(band.getBoundingClientRect().toJSON()).toEqual(title.getBoundingClientRect().toJSON());
    const probe = document.createElement("div");
    probe.style.cssText = "background-color:var(--background);color:var(--foreground)";
    card.parentElement!.append(probe);
    const solid = getComputedStyle(probe).backgroundColor;
    expect(solid).not.toBe("rgba(0, 0, 0, 0)");
    // Glass: the page's background, partly see-through, blurred behind.
    expect(getComputedStyle(band).backgroundColor).not.toBe(solid);
    expect(getComputedStyle(band).backgroundColor).toMatch(/\/ 0\.78\)$|, 0\.78\)$/);
    expect(getComputedStyle(band).backdropFilter).toBe("blur(12px) saturate(1.5)");
    expect(getComputedStyle(title).color).toBe(getComputedStyle(probe).color);
    // Test browsers cannot ask for less transparency or lack backdrop-filter, so the page's own rules for them apply to every page here.
    for (const query of [/@media ?\(prefers-reduced-transparency: ?reduce\)/g, /@supports +not \(backdrop-filter: ?blur\(1px\)\)/g]) {
      const rule = document.createElement("style");
      rule.textContent = pageCss().replace(query, "@media all");
      expect(rule.textContent).not.toBe(pageCss());
      document.head.append(rule);
      try {
        expect(getComputedStyle(band).backgroundColor).toBe(solid);
        if (String(query).includes("transparency")) expect(getComputedStyle(band).backdropFilter).toBe("none");
      } finally {
        rule.remove();
      }
    }
    await commands.emulateMedia({ contrast: "more" });
    try {
      expect(getComputedStyle(band).backgroundColor).toBe(solid);
      expect(getComputedStyle(band).backdropFilter).toBe("none");
      expect(getComputedStyle(band).borderTopStyle).toBe("solid");
    } finally {
      await commands.emulateMedia({ contrast: "no-preference" });
    }
    await commands.emulateMedia({ forcedColors: "active" });
    try {
      expect(getComputedStyle(band).backdropFilter).toBe("none");
      expect(getComputedStyle(band).borderTopStyle).toBe("solid");
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });

  it("keeps a rising title and description at 4.5:1 on its glass over a bright picture and a dark one, in light and dark", async () => {
    const picture = (fill: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="${fill}"/></svg>`)}`;
    try {
      for (const scheme of ["light", "dark"]) {
        document.documentElement.classList.toggle("dark", scheme === "dark");
        for (const fill of ["#ffffff", "#000000"]) {
          const { card, host } = await render(
            <Card href="#braising" title="Braising" description="Low heat, a lid, and time" media={<AspectRatio ratio={4 / 3}><img src={picture(fill)} alt="" /></AspectRatio>} revealDescription="rise" />,
          );
          card.querySelector<HTMLElement>("[data-card-link]")!.focus({ focusVisible: true } as FocusOptions);
          const reveal = card.querySelector<HTMLElement>('[data-card-reveal="rise"]')!;
          await settled(reveal, () => getComputedStyle(reveal).opacity).toBe("1");
          for (const text of [card.querySelector("[data-card-link]")!, reveal.firstElementChild!]) {
            expect(await measureTextContrast(text, 4.5), `${scheme}, ${fill}: ${text.textContent}`).toEqual({ pass: true });
          }
          host.remove();
        }
      }
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });

  it("mutes only its own description on the glass, leaving a tone the app gives text inside it", async () => {
    const { card } = await render(
      <Card href="#braising" title="Braising" description={<>Ready in 20 min · <Text as="span" tone="destructive">Sold out</Text></>} media={<AspectRatio ratio={4 / 3}><img src={pixel} alt="" /></AspectRatio>} revealDescription="rise" />,
    );
    const probe = document.createElement("span");
    probe.style.color = "var(--destructive)";
    card.append(probe);
    expect(getComputedStyle(card.querySelector('[data-card-reveal] span[data-ouro="text"]')!).color).toBe(getComputedStyle(probe).color);
  });

  it("insets a plain rising card's title from the edges of its band, as an outlined card's", async () => {
    for (const [size, inset] of [["md", 24], ["sm", 16]] as const) {
      const { card } = await render(
        <Card variant="plain" size={size} href="#braising" title="Braising" description="Low heat, a lid, and time" media={<AspectRatio ratio={4 / 3}><img src={pixel} alt="" /></AspectRatio>} revealDescription="rise" />,
      );
      const band = card.querySelector('[data-card-reveal="rise"]')!.parentElement!.parentElement!.getBoundingClientRect();
      const title = card.querySelector("h3")!.getBoundingClientRect();
      expect(title.left - band.left, size).toBe(inset);
      expect(band.right - title.right, size).toBeGreaterThanOrEqual(inset);
    }
  });

  it("grows a rising card to fit a title and description taller than its media, rather than cutting the title off", async () => {
    const long = "Low heat, a lid, and time: brown the meat well, add the liquid halfway up, and leave it in a slow oven for hours.";
    const { card } = await render(
      <Card
        href="#braising"
        title="Braising"
        description={long}
        media={
          <AspectRatio ratio={4}>
            <img src={pixel} alt="" />
          </AspectRatio>
        }
        revealDescription="rise"
      />,
    );
    const title = page.getByRole("heading", { name: "Braising" }).element();
    await userEvent.hover(title);
    const reveal = card.querySelector<HTMLElement>('[data-card-reveal="rise"]')!;
    await settled(reveal, () => getComputedStyle(reveal).opacity).toBe("1");
    expect(title.getBoundingClientRect().top).toBeGreaterThanOrEqual(card.getBoundingClientRect().top);
    expect(reveal.getBoundingClientRect().bottom).toBeLessThanOrEqual(card.getBoundingClientRect().bottom);
  });

  it("grows a rising card's picture with zoomMedia too", async () => {
    const { card } = await render(tile({ revealDescription: "rise", zoomMedia: true }));
    const picture = card.querySelector<HTMLElement>("[data-picture]")!;
    await userEvent.hover(page.getByRole("heading", { name: "Braising" }));
    await settled(picture, () => getComputedStyle(picture).scale).toBe("1.03");
  });

  it("with reduced motion, a rising description only fades, and nothing moves", async () => {
    const { card } = await render(tile({ revealDescription: "rise" }));
    const reveal = card.querySelector<HTMLElement>('[data-card-reveal="rise"]')!;
    expect(getComputedStyle(reveal).transitionProperty).toContain("grid-template-rows");
    await commands.emulateMedia({ reducedMotion: "reduce" });
    // WebKit hasn't always applied the emulated media by the next statement (#3518): poll instead of reading once.
    await expect.poll(() => getComputedStyle(reveal).transitionProperty).toBe("opacity");
  });

  it("shows the description on hover or keyboard focus, keeping its room, and names it as the link's description", async () => {
    const { card } = await render(tile({ revealDescription: true }));
    const reveal = card.querySelector<HTMLElement>("[data-card-reveal]")!;
    const link = card.querySelector<HTMLAnchorElement>("[data-card-link]")!;
    const height = card.getBoundingClientRect().height;
    expect(reveal.getAttribute("data-card-reveal")).toBe("");
    expect(warn).not.toHaveBeenCalled();
    expect(link.getAttribute("aria-describedby")).toBe(reveal.id);
    expect(getComputedStyle(reveal).opacity).toBe("0");
    expect(reveal.getBoundingClientRect().height).toBeGreaterThan(0);
    await expect.element(page.getByRole("link", { name: "Braising" })).toHaveAccessibleDescription("Low heat, a lid, and time");
    await userEvent.hover(card.querySelector("h3")!);
    await settled(reveal, () => getComputedStyle(reveal).opacity).toBe("1");
    expect(card.getBoundingClientRect().height).toBe(height);
    await commands.parkPointer();
    await settled(reveal, () => getComputedStyle(reveal).opacity).toBe("0");
    const start = document.createElement("button");
    card.parentElement!.prepend(start);
    start.focus();
    await pressTab();
    await pressTab();
    expect(document.activeElement).toBe(link);
    await settled(reveal, () => getComputedStyle(reveal).opacity).toBe("1");
  });

  it.each([
    ["no href", { title: "Static", description: "Here", media: <img src={pixel} alt="" />, zoomMedia: true, revealDescription: true }, ["zoomMedia", "revealDescription"]],
    ["no media", { href: "#x", title: "No media", description: "Here", zoomMedia: true }, ["zoomMedia"]],
    ["no description", { href: "#x", title: "No description", media: <img src={pixel} alt="" />, revealDescription: true }, ["revealDescription"]],
    ["neither prop", { href: "#x", title: "Plain", description: "Here", media: <img src={pixel} alt="" /> }, []],
  ] as const)("leaves a card with %s as it is, and says what each prop needs", async (_name, props, warned) => {
    const { card } = await render(<Card {...(props as Parameters<typeof Card>[0])} />);
    expect(card.classList.contains("group/card")).toBe(false);
    expect(card.querySelector("[data-card-reveal]")).toBeNull();
    expect(card.querySelector("[aria-describedby]")).toBeNull();
    const messages = {
      zoomMedia: '[ouro-ui] Card: zoomMedia needs href, a title and media. Fix: <Card href="/path" title="…" media={…} zoomMedia>.',
      revealDescription:
        '[ouro-ui] Card: revealDescription needs href, a title and a description. Fix: <Card href="/path" title="…" description="…" revealDescription>.',
    };
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual(warned.map((name) => messages[name]));
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
    ["interactive", { title: "x", interactive: true }, "interactive is not a prop; a card with href is a link", '<Card href="/path" title="…" zoomMedia revealDescription>'],
    ["variant", { title: "x", variant: "elevated" }, 'variant="elevated" is not a variant; use "outline", "plain"', '<Card variant="outline">'],
    ["size", { title: "x", size: "lg" }, 'size="lg" is not a size; use "md", "sm"', '<Card size="md">'],
    ["as", { title: "x", as: "a" }, 'as="a" is not an element Card renders; use "div", "article", "section", "li"', '<Card href="/path" title="…">'],
    ["as span", { title: "x", as: "span" }, 'as="span" is not an element Card renders; use "div", "article", "section", "li"', '<Card as="div">'],
    ["stackBelow", { title: "x", stackBelow: "lg" }, 'stackBelow="lg" is not a breakpoint; use "sm", "md"', '<Card stackBelow="sm">'],
    ["headingLevel", { title: "x", headingLevel: 1 }, "headingLevel must be 2, 3, 4, 5 or 6, got 1", "<Card headingLevel={2}>"],
    ["titleSize", { title: "x", titleSize: "lg" }, 'titleSize="lg" is not a size; use "inherit"', '<Card titleSize="inherit">'],
    ["revealDescription", { href: "#x", title: "x", description: "y", revealDescription: "slide" }, 'revealDescription="slide" is not a reveal; use revealDescription or "rise"', '<Card revealDescription="rise">'],
    ["rise without href", { title: "x", description: "y", media: <div />, revealDescription: "rise" }, "revealDescription needs href, a title and a description", '<Card href="/path" title="…" description="…" revealDescription>'],
    ["rise without media", { href: "#x", title: "x", description: "y", revealDescription: "rise" }, 'revealDescription="rise" needs media to rise over', '<Card href="/path" title="…" description="…" media={…} revealDescription="rise">'],
  ])("warns for %s with the fix", async (_name, props, problem, fix) => {
    const { card } = await render(<Card {...(props as unknown as Parameters<typeof Card>[0])} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Card: ${problem}. Fix: ${fix}.`);
    for (const attribute of ["subtitle", "image", "header", "actions", "to", "aschild", "interactive"]) expect(card.hasAttribute(attribute)).toBe(false);
  });

  it.each([undefined, false, true, "rise"] as const)("says nothing of revealDescription=%s, which is a reveal", async (value) => {
    await render(<Card href="#x" title="x" description="y" media={<div />} revealDescription={value} />);
    expect(warn.mock.calls.filter((call: unknown[]) => String(call[0]).includes("is not a reveal"))).toEqual([]);
  });

  it.each([undefined, "inherit"] as const)("says nothing of titleSize=%s, which is a size", async (value) => {
    await render(<Card title="x" titleSize={value} />);
    expect(warn.mock.calls.filter((call: unknown[]) => String(call[0]).includes("is not a size; use \"inherit\""))).toEqual([]);
  });

  it("renders no box for an action it is not given", async () => {
    const { card } = await render(<Card title="Pantry" description="What you have on hand" />);
    const title = page.getByRole("heading", { name: "Pantry" }).element();
    // The title's column is the header's only child.
    expect(title.parentElement!.parentElement!.children).toHaveLength(1);
    expect(card.textContent).toBe("PantryWhat you have on hand");
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
