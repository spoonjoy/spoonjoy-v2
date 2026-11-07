import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { Button } from "~/components/ouro/button/button";
import { Empty } from "~/components/ouro/empty/empty";
import { act } from "~/lib/ouro/testing/act";

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
  return { host, el: host.firstElementChild as HTMLElement };
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

const Icon = () => (
  <svg viewBox="0 0 24 24" data-testid="icon">
    <circle cx="12" cy="12" r="8" />
  </svg>
);

describe("Empty", () => {
  it("renders the title as an <h3>, the description, the icon and the action", async () => {
    const { el } = await render(
      <Empty
        icon={<Icon />}
        title="No recipes yet"
        description="Start by creating your first recipe."
        action={<Button href="/recipes/new">Create recipe</Button>}
      />,
    );
    expect(el.getAttribute("data-ouro")).toBe("empty");
    await expect.element(page.getByRole("heading", { level: 3, name: "No recipes yet" })).toBeVisible();
    await expect.element(page.getByText("Start by creating your first recipe.")).toBeVisible();
    await expect.element(page.getByRole("link", { name: "Create recipe" })).toBeVisible();
    const icon = el.querySelector("[data-testid=icon]")!;
    expect(icon.closest("[aria-hidden=true]")).not.toBeNull();
  });

  it("centers its content and draws a dashed outline by default", async () => {
    const { el } = await render(<Empty title="Nothing here" />);
    const style = getComputedStyle(el);
    expect(style.alignItems).toBe("center");
    expect(style.textAlign).toBe("center");
    expect(style.borderTopStyle).toBe("dashed");
  });

  it("has no outline with variant=plain, and aligns to the start with align=start", async () => {
    const { el } = await render(<Empty title="Nothing here" variant="plain" align="start" />);
    const style = getComputedStyle(el);
    expect(style.borderTopWidth).toBe("0px");
    expect(style.alignItems).toBe("flex-start");
    expect(style.textAlign).toBe("start");
  });

  it.each([2, 4, 5, 6] as const)("renders the title at headingLevel %i", async (level) => {
    await render(<Empty title="Nothing here" headingLevel={level} />);
    await expect.element(page.getByRole("heading", { level, name: "Nothing here" })).toBeVisible();
  });

  it("renders children below the description", async () => {
    const { el } = await render(
      <Empty title="No results" description="Try another search.">
        <input aria-label="Search" />
      </Empty>,
    );
    const text = el.textContent!;
    expect(text.indexOf("Try another search.")).toBeLessThan(text.length);
    expect(el.lastElementChild!.querySelector("input")).not.toBeNull();
  });

  it("passes attributes and a ref through, and lets layout classes win", async () => {
    let node: HTMLDivElement | null = null;
    const { el } = await render(<Empty title="Nothing" id="empty" className="mt-6" ref={(element) => void (node = element)} />);
    expect(el.id).toBe("empty");
    expect(node).toBe(el);
    expect(getComputedStyle(el).marginTop).toBe("24px");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("Empty development messages", () => {
  it.each([
    ["heading", { title: "x", heading: "No recipes" }, "heading is not a prop", '<Empty title="No recipes">'],
    ["message", { title: "x", message: "Add one" }, "message is not a prop", '<Empty description="Add one">'],
    ["actions", { title: "x", actions: "y" }, "actions is not a prop", "<Empty action={<Button>…</Button>}>"],
    ["image", { title: "x", image: "y" }, "image is not a prop", "<Empty icon={<Icon />}>"],
    ["variant", { title: "x", variant: "dashed" }, 'variant="dashed" is not a variant; use "outline", "plain"', '<Empty variant="outline">'],
    ["align", { title: "x", align: "left" }, 'align="left" is not an alignment; use "center", "start"', '<Empty align="start">'],
    ["headingLevel", { title: "x", headingLevel: 1 }, "headingLevel must be 2, 3, 4, 5 or 6, got 1", "<Empty headingLevel={2}>"],
  ])("warns for %s with the fix", async (_name, props, problem, fix) => {
    const { el } = await render(<Empty {...(props as unknown as Parameters<typeof Empty>[0])} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Empty: ${problem}. Fix: ${fix}.`);
    expect(el.hasAttribute("heading")).toBe(false);
    expect(el.hasAttribute("message")).toBe(false);
  });

  it("renders an <h3> for an unknown headingLevel", async () => {
    await render(<Empty {...({ title: "Nothing", headingLevel: 9 } as unknown as Parameters<typeof Empty>[0])} />);
    await expect.element(page.getByRole("heading", { level: 3, name: "Nothing" })).toBeVisible();
  });

  it("warns when there is no title", async () => {
    await render(<Empty {...({ description: "Nothing yet" } as unknown as Parameters<typeof Empty>[0])} />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Empty: title is required; it says what is empty. Fix: <Empty title="No recipes yet">.');
  });

  it("checks the className", async () => {
    await render(<Empty title="Nothing" className="bg-muted" />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Empty: "bg-muted" sets appearance, and className is for layout only. Fix: <Empty variant="plain"> inside a <Card>.',
    );
  });

  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(<Empty title="No recipes yet" description="Add one." className="text-red-500" />);
    expect(html).toContain('data-ouro="empty"');
    expect(html).toContain("<h3");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
