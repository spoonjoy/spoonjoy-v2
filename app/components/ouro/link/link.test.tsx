import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
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

  it("renders an absolute URL as a plain <a>, bypassing linkComponent", async () => {
    const { link } = await render(
      <OuroProvider linkComponent={RouterLink}>
        <Link href="https://ouro.bot">Ouro</Link>
      </OuroProvider>,
    );
    expect(link.hasAttribute("data-router")).toBe(false);
    expect(link.getAttribute("href")).toBe("https://ouro.bot");
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
