import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page } from "vitest/browser";
import { Link } from "~/components/ouro/link/link";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { act } from "~/lib/ouro/testing/act";

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
    get link() {
      return host.querySelector<HTMLAnchorElement>('[data-ouro="link"]')!;
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

const RouterLink: OuroLinkComponent = (props) => <a data-router="" {...props} />;

describe("Link", () => {
  it("renders an <a> with href and data-ouro by default", async () => {
    const { link } = await render(<Link href="/recipes">Recipes</Link>);
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/recipes");
    expect(link.hasAttribute("target")).toBe(false);
    expect(link.hasAttribute("rel")).toBe(false);
    await expect.element(page.getByRole("link", { name: "Recipes" })).toBeVisible();
  });

  it("renders the provider's linkComponent for an internal href", async () => {
    const onClick = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    const { link } = await render(
      <OuroProvider linkComponent={RouterLink}>
        <Link href="/recipes" onClick={onClick}>
          Recipes
        </Link>
      </OuroProvider>,
    );
    expect(link.hasAttribute("data-router")).toBe(true);
    expect(link.getAttribute("href")).toBe("/recipes");
    link.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("treats only a present download as document navigation, including an empty filename", async () => {
    const { host } = await render(
      <OuroProvider linkComponent={RouterLink}>
        <Link href="/export.csv" download>Export</Link>
        <Link href="/export.csv" download="recipes.csv">Named export</Link>
        <Link href="/export.csv" download="">Unnamed export</Link>
        <Link href="/recipes" download={false}>Not a download</Link>
        <Link href="/recipes" download={null}>No download</Link>
      </OuroProvider>,
    );
    const links = [...host.querySelectorAll<HTMLAnchorElement>('[data-ouro="link"]')];
    expect(links.map((link) => link.hasAttribute("data-router"))).toEqual([false, false, false, true, true]);
    expect(links.map((link) => link.getAttribute("download"))).toEqual(["", "recipes.csv", "", null, null]);
  });

  it("renders an absolute URL as a plain <a>, bypassing linkComponent", async () => {
    const { link } = await render(
      <OuroProvider linkComponent={RouterLink}>
        <Link href="https://ouro.bot">Ouro</Link>
      </OuroProvider>,
    );
    expect(link.hasAttribute("data-router")).toBe(false);
    expect(link.getAttribute("href")).toBe("https://ouro.bot");
  });

  it("renders a plain <a> with reloadDocument or download, skipping the router's link, in the same look", async () => {
    const onClick = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    const { host } = await render(
      <OuroProvider linkComponent={RouterLink}>
        <Link href="/recipes">Recipes</Link>
        <Link href="/mcp" reloadDocument onClick={onClick}>
          MCP server
        </Link>
        <Link href="/export.csv" download>
          Export
        </Link>
        <Link href="/settings" reloadDocument={false}>
          Settings
        </Link>
      </OuroProvider>,
    );
    const [recipes, mcp, csv, settings] = [...host.querySelectorAll<HTMLAnchorElement>('[data-ouro="link"]')];
    expect(recipes!.hasAttribute("data-router")).toBe(true);
    expect(settings!.hasAttribute("data-router")).toBe(true);
    for (const link of [mcp!, csv!]) {
      expect(link.tagName).toBe("A");
      expect(link.hasAttribute("data-router")).toBe(false);
      expect(link.className).toBe(recipes!.className);
      expect(link.getAttribute("data-ouro-control")).toBe("link");
    }
    expect(mcp!.getAttribute("href")).toBe("/mcp");
    expect(mcp!.hasAttribute("reloaddocument")).toBe(false);
    expect(mcp!.hasAttribute("target")).toBe(false);
    expect(csv!.getAttribute("download")).toBe("");
    mcp!.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    await expect.element(page.getByRole("link", { name: "MCP server" })).toBeVisible();
  });

  it("opens a reloadDocument link in a new tab safely with external", async () => {
    const { link } = await render(
      <OuroProvider linkComponent={RouterLink}>
        <Link href="/auth/github" reloadDocument external>
          Sign in with GitHub
        </Link>
      </OuroProvider>,
    );
    expect(link.hasAttribute("data-router")).toBe(false);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("opens in a new tab with external, with rel and a label that says so", async () => {
    const { link } = await render(
      <Link href="https://ouro.bot" external>
        Ouro
      </Link>,
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    await expect.element(page.getByRole("link", { name: "Ouro (opens in a new tab)" })).toBeVisible();
  });

  it("keeps the app's rel tokens with external", async () => {
    const { link } = await render(
      <Link href="/report.pdf" external rel="nofollow">
        Report
      </Link>,
    );
    expect(link.getAttribute("rel")).toBe("nofollow noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("forwards a ref to the anchor", async () => {
    let element: HTMLAnchorElement | null = null;
    await render(
      <Link href="/x" ref={(node) => void (element = node)}>
        Go
      </Link>,
    );
    expect(element).toBeInstanceOf(HTMLAnchorElement);
  });

  it("is underlined in the primary color by default", async () => {
    const { link } = await render(<Link href="/x">Go</Link>);
    const style = getComputedStyle(link);
    expect(style.textDecorationLine).toBe("underline");
    const probe = document.createElement("span");
    probe.style.color = "var(--primary)";
    document.body.append(probe);
    mounted.push(probe);
    expect(style.color).toBe(getComputedStyle(probe).color);
  });

  it("gives every tone a distinct color", async () => {
    const tones = ["primary", "secondary", "destructive", "success", "warning"] as const;
    const { host } = await render(
      <>
        {tones.map((tone) => (
          <Link key={tone} href="/x" tone={tone}>
            {tone}
          </Link>
        ))}
      </>,
    );
    const colors = [...host.querySelectorAll("a")].map((a) => getComputedStyle(a).color);
    expect(new Set(colors).size).toBe(tones.length);
  });

  it("shows a focus outline on keyboard focus", async () => {
    const { link } = await render(<Link href="/x">Go</Link>);
    link.focus();
    expect(getComputedStyle(link).outlineStyle).toBe("solid");
  });

  it("marks keyboard focus in running text with a thick underline in the ring's colour, not an outline drawn over the next character", async () => {
    const { host } = await render(
      <>
        <Link href="/alone">Alone</Link>
        <p>
          From <Link href="/ari">Ari</Link>, with lemon.
        </p>
        <div>
          From <Link href="/inline" inline>Sam</Link>, with salt.
        </div>
        <p>
          <Link href="/own" inline={false}>On its own</Link>
        </p>
      </>,
    );
    const focused = (href: string) => {
      const link = host.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)!;
      link.focus();
      // The underline's colour eases in; its end is what focus shows.
      for (const animation of link.getAnimations()) animation.finish();
      const style = getComputedStyle(link);
      return { outline: `${style.outlineStyle} ${style.outlineColor}`, underline: `${style.textDecorationThickness} ${style.textDecorationColor}` };
    };
    const ring = getComputedStyle(host.querySelector('a[href="/alone"]')!).outlineColor;
    const alone = focused("/alone");
    expect(alone.outline).toBe(`solid ${ring}`);
    // A transparent outline draws nothing, and forced colours show it, as they drop the underline's colour.
    expect(focused("/ari")).toEqual({ outline: "solid rgba(0, 0, 0, 0)", underline: `2px ${ring}` });
    expect(focused("/inline")).toEqual({ outline: "solid rgba(0, 0, 0, 0)", underline: `2px ${ring}` });
    expect(focused("/own")).toEqual(alone);
  });

  it("lets app layout classes win", async () => {
    const { link } = await render(
      <Link href="/x" className="ms-2 inline-block">
        Go
      </Link>,
    );
    expect(getComputedStyle(link).marginInlineStart).toBe("8px");
    expect(getComputedStyle(link).display).toBe("inline-block");
  });
});

describe("Link with a mouse", () => {
  it("is as tall as its text with a fine pointer, standing alone or in a sentence", async () => {
    expect(matchMedia("(pointer: fine)").matches).toBe(true);
    const { host } = await render(
      <>
        <div>
          <Link href="/forgot">Forgot password?</Link>
        </div>
        <p>
          Read the <Link href="/terms">terms</Link> first.
        </p>
      </>,
    );
    for (const link of host.querySelectorAll<HTMLElement>('[data-ouro="link"]')) {
      expect(getComputedStyle(link).display).toBe("inline");
      expect(link.getBoundingClientRect().height).toBeLessThan(30);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("Link development messages", () => {
  it.each([
    ["to", { to: "/recipes" }, "to is not a prop", '<Link href="/recipes">'],
    ["isExternal", { isExternal: true }, "isExternal is not a prop", '<Link href="https://…" external>'],
    ["color", { color: "red" }, "color is not a prop", '<Link tone="destructive">'],
    ["tone", { tone: "danger" }, 'tone="danger" is not a tone', '<Link tone="destructive">'],
    ["tone", { tone: "blue" }, 'tone="blue" is not a tone; use "primary", "secondary", "destructive", "success", "warning"', '<Link tone="primary">'],
    ["target", { target: "_blank" }, 'target="_blank" opens a new tab without saying so', '<Link href="https://…" external>'],
  ])("warns for %s with the fix", async (_name, extra, problem, fix) => {
    const props = { href: "/x", children: "Go", ...extra } as unknown as Parameters<typeof Link>[0];
    const { link } = await render(<Link {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Link: ${problem}. Fix: ${fix}.`);
    expect(link.hasAttribute("to")).toBe(false);
    expect(link.hasAttribute("isexternal")).toBe(false);
    expect(link.hasAttribute("color")).toBe(false);
  });

  it("points a to that is not a string to href", async () => {
    const props = { to: { pathname: "/x" }, href: "/x", children: "Go" } as unknown as Parameters<typeof Link>[0];
    await render(<Link {...props} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Link: to is not a prop. Fix: <Link href="/path">.');
  });

  it("renders the primary color for an unknown tone", async () => {
    const props = { tone: "blue", href: "/x", children: "Go" } as unknown as Parameters<typeof Link>[0];
    const { host } = await render(
      <>
        <Link {...props} />
        <Link href="/x">Go</Link>
      </>,
    );
    const [unknown, plain] = [...host.querySelectorAll("a")];
    expect(getComputedStyle(unknown!).color).toBe(getComputedStyle(plain!).color);
  });

  it.each([
    ["text-red-500", 'tone="destructive"'],
    ["font-bold", 'remove "font-bold"; Link sets its own weight'],
    ["no-underline", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(
      <Link href="/x" className={className}>
        Go
      </Link>,
    );
    if (fix) {
      expect(warn).toHaveBeenCalledWith(`[ouro-ui] Link: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    } else {
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <>
        <Link href="/x" className="bg-red-500">
          In
        </Link>
        <Link href="https://ouro.bot" external>
          Out
        </Link>
      </>,
    );
    expect(html).toContain('data-ouro="link"');
    expect(html).toContain("opens in a new tab");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("Link press feedback", () => {
  it("dims while the pointer is down, like an Accordion trigger, and never scales", async () => {
    // Releasing the press clicks the link; keep the test page where it is.
    const { link } = await render(
      <Link href="/recipes" onClick={(event) => event.preventDefault()}>
        Recipes
      </Link>,
    );
    expect(getComputedStyle(link).opacity).toBe("1");
    await commands.pointerPress({ selector: '[data-ouro="link"]', action: "down" });
    try {
      expect(getComputedStyle(link).opacity).toBe("0.7");
      expect(getComputedStyle(link).scale).toBe("none");
    } finally {
      await commands.pointerPress({ action: "up" });
    }
  });

  it("eases its underline color with the plain ease curve", async () => {
    const { link } = await render(<Link href="/recipes">Recipes</Link>);
    expect(getComputedStyle(link).transitionTimingFunction).toBe("ease");
    expect(getComputedStyle(link).transitionDuration).toBe("0.15s");
  });
});
