import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Badge } from "~/components/ouro/badge/badge";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    get badge() {
      return host.querySelector<HTMLElement>('[data-ouro="badge"]')!;
    },
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

/** The computed value of a theme color, so the test holds under any shadcn theme. */
function themeColor(variable: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${variable})`;
  document.body.append(probe);
  mounted.push(probe);
  return getComputedStyle(probe).color;
}

const RouterLink: OuroLinkComponent = (props) => <a data-router="" {...props} />;

describe("Badge", () => {
  it("is a quiet secondary label by default", async () => {
    const { badge } = await render(<Badge>Draft</Badge>);
    expect(badge.tagName).toBe("SPAN");
    expect(badge.textContent).toBe("Draft");
    const style = getComputedStyle(badge);
    expect(style.color).toBe(themeColor("--secondary-foreground"));
    const surface = document.createElement("span");
    surface.style.backgroundColor = "var(--secondary)";
    document.body.append(surface);
    mounted.push(surface);
    expect(style.backgroundColor).toBe(getComputedStyle(surface).backgroundColor);
    expect(badge.querySelector("[data-ouro-touch-target]")).toBeNull();
  });

  it("gives every tone and variant a distinct look", async () => {
    const tones = ["primary", "secondary", "destructive", "success", "warning"] as const;
    const variants = ["solid", "soft", "outline"] as const;
    const { host } = await render(
      <>
        {variants.flatMap((variant) =>
          tones.map((tone) => (
            <Badge key={`${variant}-${tone}`} tone={tone} variant={variant}>
              {tone}
            </Badge>
          )),
        )}
      </>,
    );
    const looks = [...host.querySelectorAll<HTMLElement>('[data-ouro="badge"]')].map((badge) => {
      const style = getComputedStyle(badge);
      return `${style.color}|${style.backgroundColor}|${style.borderColor}`;
    });
    expect(new Set(looks).size).toBe(tones.length * variants.length);
  });

  it("renders a button with onClick, with a touch target and press feedback", async () => {
    const onClick = vi.fn();
    const { badge } = await render(<Badge onClick={onClick}>Vegetarian</Badge>);
    expect(badge.tagName).toBe("BUTTON");
    expect(badge.getAttribute("type")).toBe("button");
    expect(badge.querySelector("[data-ouro-touch-target]")).not.toBeNull();
    expect(badge.className).toContain("press");
    await userEvent.click(page.getByRole("button", { name: "Vegetarian" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows a focus outline on keyboard focus", async () => {
    const { badge } = await render(<Badge onClick={() => {}}>Vegetarian</Badge>);
    await pressTab();
    expect(document.activeElement).toBe(badge);
    expect(getComputedStyle(badge).outlineStyle).toBe("solid");
  });

  it("passes aria-pressed through for a filter badge", async () => {
    await render(
      <Badge onClick={() => {}} aria-pressed>
        Vegan
      </Badge>,
    );
    await expect.element(page.getByRole("button", { name: "Vegan", pressed: true })).toBeVisible();
  });

  it("disables a button badge", async () => {
    const onClick = vi.fn();
    const { badge } = await render(
      <Badge onClick={onClick} disabled>
        Vegan
      </Badge>,
    );
    expect((badge as HTMLButtonElement).disabled).toBe(true);
    // data-disabled turns off the hover and press state layer (`not-data-disabled:`).
    expect(badge.hasAttribute("data-disabled")).toBe(true);
    await userEvent.click(badge, { force: true });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders a link with href through the provider's linkComponent", async () => {
    const { badge } = await render(
      <OuroProvider linkComponent={RouterLink}>
        <Badge href="/tags/vegan">Vegan</Badge>
      </OuroProvider>,
    );
    expect(badge.tagName).toBe("A");
    expect(badge.hasAttribute("data-router")).toBe(true);
    expect(badge.getAttribute("href")).toBe("/tags/vegan");
    expect(badge.querySelector("[data-ouro-touch-target]")).not.toBeNull();
    await expect.element(page.getByRole("link", { name: "Vegan" })).toBeVisible();
  });

  it("renders an absolute URL as a plain <a> with a safe rel in a new tab", async () => {
    const { badge } = await render(
      <OuroProvider linkComponent={RouterLink}>
        <Badge href="https://ouro.bot" target="_blank">
          Ouro
        </Badge>
      </OuroProvider>,
    );
    expect(badge.hasAttribute("data-router")).toBe(false);
    expect(badge.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("shows an icon before the label", async () => {
    const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg data-icon="" {...props} />;
    const { badge } = await render(<Badge icon={Icon}>Spicy</Badge>);
    const icon = badge.querySelector("[data-icon]")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(badge.firstElementChild).toBe(icon);
  });

  it("forwards a ref and lets app layout classes win", async () => {
    let element: HTMLElement | null = null;
    const { badge } = await render(
      <Badge className="ms-2" ref={(node) => void (element = node)}>
        New
      </Badge>,
    );
    expect(element).toBe(badge);
    expect(getComputedStyle(badge).marginInlineStart).toBe("8px");
  });
});

describe("Badge development messages", () => {
  it.each([
    ["shadcn's default variant", { variant: "default" }, 'variant="default" is not a variant', '<Badge tone="primary" variant="solid">'],
    ["shadcn's secondary variant", { variant: "secondary" }, 'variant="secondary" is not a variant', '<Badge tone="secondary">'],
    ["shadcn's destructive variant", { variant: "destructive" }, 'variant="destructive" is not a variant', '<Badge tone="destructive">'],
    ["shadcn's ghost variant", { variant: "ghost" }, 'variant="ghost" is not a variant', '<Badge variant="soft">'],
    ["an unknown variant", { variant: "pill" }, 'variant="pill" is not a variant; use "solid", "soft", "outline"', '<Badge variant="solid">'],
    ["a danger tone", { tone: "danger" }, 'tone="danger" is not a tone', '<Badge tone="destructive">'],
    ["a color", { color: "red" }, "color is not a prop", '<Badge tone="destructive">'],
    ["asChild", { asChild: true }, "asChild is not a prop", '<Badge href="/path">'],
    ["disabled on a static badge", { disabled: true }, "disabled does nothing on a Badge without onClick, because a static Badge is not a button", "<Badge onClick={…} disabled>"],
    ["type on a static badge", { type: "submit" }, 'type="submit" does nothing on a Badge without onClick, because a static Badge is not a button', '<Button type="submit">'],
    ["a link with type", { href: "/x", type: "submit" }, 'a link has no type, so type="submit" is ignored', '<Badge onClick={…} type="submit"> without href'],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const props = { children: "Tag", ...extra } as unknown as Parameters<typeof Badge>[0];
    const { badge } = await render(<Badge {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Badge: ${problem}. Fix: ${fix}.`);
    expect(badge.hasAttribute("color")).toBe(false);
    expect(badge.hasAttribute("aschild")).toBe(false);
    expect(badge.hasAttribute("type") && badge.tagName === "A").toBe(false);
  });

  it("keeps button attributes off a static badge", async () => {
    const props = { disabled: true, type: "submit", name: "tag", value: "vegan", form: "filters", children: "Tag" } as unknown as Parameters<typeof Badge>[0];
    const { badge } = await render(<Badge {...props} />);
    expect(badge.tagName).toBe("SPAN");
    for (const attribute of ["disabled", "type", "name", "value", "form"]) expect(badge.hasAttribute(attribute)).toBe(false);
  });

  it("renders the defaults for an unknown tone and variant", async () => {
    const props = { tone: "blue", variant: "pill", children: "Tag" } as unknown as Parameters<typeof Badge>[0];
    const { host } = await render(
      <>
        <Badge {...props} />
        <Badge>Tag</Badge>
      </>,
    );
    const [unknown, plain] = [...host.querySelectorAll<HTMLElement>('[data-ouro="badge"]')];
    expect(unknown!.className).toBe(plain!.className);
  });

  it.each([
    ["bg-red-500", 'tone="destructive"'],
    ["text-lg", 'remove "text-lg"; Badge sets its own size'],
    ["rounded-full", ':root { --radius: 999px }'],
    ["border-green-500", 'variant="outline" tone="success"'],
    ["font-bold", 'remove "font-bold"; Badge sets its own weight'],
    ["ms-2", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<Badge className={className}>Tag</Badge>);
    if (fix) {
      expect(warn).toHaveBeenCalledWith(`[ouro-ui] Badge: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    } else {
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <>
        <Badge className="bg-red-500">Plain</Badge>
        <Badge href="/x">Link</Badge>
        <Badge onClick={() => {}}>Button</Badge>
      </>,
    );
    expect(html.match(/data-ouro="badge"/g)).toHaveLength(3);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("Badge under more contrast", () => {
  it("gives the soft look a visible border with prefers-contrast: more", async () => {
    const { badge } = await render(<Badge variant="soft">Soft</Badge>);
    expect(getComputedStyle(badge).borderTopColor).toBe("rgba(0, 0, 0, 0)");
    await commands.emulateMedia({ contrast: "more" });
    try {
      await expect.poll(() => getComputedStyle(badge).borderTopColor).toBe(getComputedStyle(badge).color);
    } finally {
      await commands.emulateMedia({ contrast: "no-preference" });
    }
  });
});
