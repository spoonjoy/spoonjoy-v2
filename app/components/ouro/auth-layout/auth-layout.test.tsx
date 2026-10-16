import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { AuthLayout, type AuthLayoutProps } from "~/components/ouro/auth-layout/auth-layout";
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
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="auth-layout"]')!;
    },
    get card() {
      return host.querySelector<HTMLElement>('[data-ouro="card"]')!;
    },
  };
}

let warn: ReturnType<typeof vi.spyOn>;
let margin = "";
beforeEach(async () => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  margin = document.body.style.margin;
  document.body.style.margin = "0";
  await page.viewport(1024, 768);
});
afterEach(async () => {
  vi.restoreAllMocks();
  document.body.style.margin = margin;
  await page.viewport(414, 896);
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

describe("AuthLayout", () => {
  it("renders the page's main landmark with the title as its h1 in a card", async () => {
    const { root, card } = await render(
      <AuthLayout title="Sign in" description="Welcome back to Spoonjoy.">
        <p>The form</p>
      </AuthLayout>,
    );
    expect(root.tagName).toBe("MAIN");
    await expect.element(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    expect(card.contains(page.getByRole("heading", { level: 1 }).element())).toBe(true);
    expect(card.textContent).toContain("Welcome back to Spoonjoy.");
    expect(card.textContent).toContain("The form");
  });

  it("renders a div with as, inside a page that has its own main landmark", async () => {
    const { root } = await render(
      <AuthLayout as="div" title="Sign in">
        <p>The form</p>
      </AuthLayout>,
    );
    expect(root.tagName).toBe("DIV");
    expect(document.querySelector("main")).toBeNull();
    await expect.element(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  it("centers the card on the screen", async () => {
    const { root, card } = await render(
      <AuthLayout title="Sign in">
        <p>The form</p>
      </AuthLayout>,
    );
    expect(root.getBoundingClientRect().height).toBeGreaterThanOrEqual(innerHeight);
    const box = card.getBoundingClientRect();
    expect(Math.abs(box.left + box.width / 2 - innerWidth / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.top + box.height / 2 - innerHeight / 2)).toBeLessThanOrEqual(1);
    expect(box.width).toBeLessThanOrEqual(384);
  });

  it("shows the brand above the title and the footer under the card", async () => {
    const { card, root } = await render(
      <AuthLayout title="Sign in" brand={<span data-testid="brand">Spoonjoy</span>} footer={<a href="/signup">Create an account</a>}>
        <p>The form</p>
      </AuthLayout>,
    );
    const brand = page.getByTestId("brand").element();
    const heading = page.getByRole("heading", { level: 1 }).element();
    expect(card.contains(brand)).toBe(true);
    expect(brand.getBoundingClientRect().bottom).toBeLessThanOrEqual(heading.getBoundingClientRect().top);
    const footer = page.getByRole("link", { name: "Create an account" }).element();
    expect(card.contains(footer)).toBe(false);
    expect(root.contains(footer)).toBe(true);
    expect(footer.getBoundingClientRect().top).toBeGreaterThanOrEqual(card.getBoundingClientRect().bottom);
  });

  it("renders the title and the form in the server HTML", () => {
    const html = renderToString(
      <AuthLayout title="Sign in">
        <p>The form</p>
      </AuthLayout>,
    );
    expect(html).toMatch(/<h1[^>]*>Sign in<\/h1>/);
    expect(html).toContain("The form");
  });

  it("fills a phone's width without scrolling sideways", async () => {
    await page.viewport(390, 844);
    const { root, card } = await render(
      <AuthLayout title="Sign in">
        <p>The form</p>
      </AuthLayout>,
    );
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    const box = card.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(16);
    expect(box.right).toBeLessThanOrEqual(390 - 16);
    expect(box.width).toBeGreaterThanOrEqual(340);
  });

  it("passes className, ref and other attributes to the main element", async () => {
    let node: HTMLElement | null = null;
    const { root } = await render(
      <AuthLayout
        title="Sign in"
        className="min-h-96"
        id="auth"
        ref={(element) => {
          node = element;
        }}
      >
        <p>The form</p>
      </AuthLayout>,
    );
    expect(root.classList.contains("min-h-96")).toBe(true);
    expect(root.id).toBe("auth");
    expect(node).toBe(root);
  });

  it("warns about appearance classes and the props agents guess", async () => {
    const guessed = { title: "Sign in", children: "Form", className: "bg-zinc-50", logo: "x", heading: "x", subtitle: "x" } as unknown as AuthLayoutProps;
    await render(<AuthLayout {...guessed} />);
    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(messages).toContain('[ouro-ui] AuthLayout: "bg-zinc-50" sets appearance, and className is for layout only. Fix: remove "bg-zinc-50"; AuthLayout sets its own look.');
    expect(messages).toContain("[ouro-ui] AuthLayout: logo is not a prop. Fix: <AuthLayout brand={<Logo />}>.");
    expect(messages).toContain('[ouro-ui] AuthLayout: heading is not a prop. Fix: <AuthLayout title="Sign in">.');
    expect(messages).toContain('[ouro-ui] AuthLayout: subtitle is not a prop. Fix: <AuthLayout description="Welcome back">.');
  });

  it("warns when the title is missing", async () => {
    const untitled = { children: "Form" } as unknown as AuthLayoutProps;
    await render(<AuthLayout {...untitled} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] AuthLayout: title is required; it is the page\'s heading. Fix: <AuthLayout title="Sign in">.');
  });
});
