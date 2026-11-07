import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { PageHeader } from "~/components/ouro/page-header/page-header";
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
    root,
    get header() {
      return host.querySelector<HTMLElement>('[data-ouro="page-header"]')!;
    },
    part(name: string) {
      return host.querySelector<HTMLElement>(`[data-slot="${name}"]`);
    },
  };
}

function muted() {
  const element = document.createElement("span");
  element.style.color = "var(--muted-foreground)";
  document.body.append(element);
  mounted.push(element);
  return getComputedStyle(element).color;
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await page.viewport(414, 896);
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

const full = (
  <PageHeader
    breadcrumb={<nav aria-label="Breadcrumb">Home / Settings</nav>}
    media={<img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='200'/%3E" />}
    eyebrow="Settings"
    title="Billing"
    description="Your plan, invoices and payment method."
    actions={<button type="button">Change plan</button>}
  >
    <span>Pro plan</span>
  </PageHeader>
);

describe("PageHeader", () => {
  it("is the page's h1 with the eyebrow above it and the description under it, both muted", async () => {
    const { header, part } = await render(full);
    await expect.element(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();
    expect(header.tagName).toBe("DIV");
    expect(part("eyebrow")!.textContent).toBe("Settings");
    expect(getComputedStyle(part("eyebrow")!).color).toBe(muted());
    expect(getComputedStyle(part("description")!).color).toBe(muted());
    const heading = header.querySelector("h1")!;
    expect(part("eyebrow")!.getBoundingClientRect().bottom).toBeLessThanOrEqual(heading.getBoundingClientRect().top);
    expect(part("description")!.getBoundingClientRect().top).toBeGreaterThanOrEqual(heading.getBoundingClientRect().bottom);
    expect(getComputedStyle(part("eyebrow")!).marginTop).toBe("0px");
    expect(header.textContent).toContain("Pro plan");
  });

  it("puts the trail and the image above the title, the image at full width", async () => {
    const { header, part } = await render(<div style={{ width: 800 }}>{full}</div>);
    const title = header.querySelector("h1")!.getBoundingClientRect();
    const media = part("media")!.getBoundingClientRect();
    expect(part("breadcrumb")!.getBoundingClientRect().bottom).toBeLessThanOrEqual(media.top);
    expect(media.bottom).toBeLessThanOrEqual(title.top);
    expect(media.width).toBe(800);
    expect(part("media")!.querySelector("img")!.getBoundingClientRect().width).toBe(800);
  });

  it("puts the actions beside the title on a wide screen and under it on a phone", async () => {
    await page.viewport(1024, 768);
    const { header, part } = await render(full);
    const title = header.querySelector("h1")!.getBoundingClientRect();
    expect(part("actions")!.getBoundingClientRect().left).toBeGreaterThanOrEqual(title.right);
    await page.viewport(390, 844);
    await expect.poll(() => part("actions")!.getBoundingClientRect().top).toBeGreaterThanOrEqual(header.querySelector("h1")!.getBoundingClientRect().bottom);
  });

  it("heads a section as an h2 with level={2}", async () => {
    await render(<PageHeader level={2} title="Members" />);
    await expect.element(page.getByRole("heading", { level: 2, name: "Members" })).toBeVisible();
  });

  it("sets a larger title with size lg", async () => {
    const { host } = await render(
      <>
        <PageHeader title="Regular" />
        <PageHeader title="Large" size="lg" />
        <PageHeader title="Section" level={2} />
      </>,
    );
    const [regular, large, section] = [...host.querySelectorAll("h1, h2")].map((element) => parseFloat(getComputedStyle(element).fontSize));
    expect(large).toBeGreaterThan(regular!);
    expect(regular).toBeGreaterThan(section!);
  });

  it("renders only the title when it has nothing else", async () => {
    const { header } = await render(<PageHeader title="Plain" />);
    expect(header.querySelectorAll("[data-slot]")).toHaveLength(0);
    expect(header.textContent).toBe("Plain");
  });

  it("draws a line under itself with divider", async () => {
    const { header } = await render(<PageHeader title="Ruled" divider />);
    const style = getComputedStyle(header);
    expect(style.borderBottomWidth).toBe("1px");
    expect(style.borderTopWidth).toBe("0px");
    const probe = document.createElement("span");
    probe.style.borderColor = "var(--border)";
    document.body.append(probe);
    mounted.push(probe);
    expect(style.borderBottomColor).toBe(getComputedStyle(probe).borderTopColor);
  });

  it("forwards a ref, passes attributes through, and its margin is the app's", async () => {
    let element: HTMLDivElement | null = null;
    const { header } = await render(<PageHeader title="Ref" className="mb-8" id="top" ref={(node) => void (element = node)} />);
    expect(element).toBe(header);
    expect(header.id).toBe("top");
    expect(getComputedStyle(header).marginBottom).toBe("32px");
  });
});

describe("PageHeader development messages", () => {
  it.each([
    ["level", { level: 3 }, "level={3} is not a level; use 1 or 2", "<PageHeader level={2} />"],
    ["size", { size: "xl" }, 'size="xl" is not a size; use "md" or "lg"', '<PageHeader size="lg" />'],
    ["subtitle", { subtitle: "Plan" }, "subtitle is not a prop", '<PageHeader description="Plan" />'],
    ["subtitle", { subtitle: <b>Plan</b> }, "subtitle is not a prop", '<PageHeader description="..." />'],
    ["overline", { overline: "Settings" }, "overline is not a prop", '<PageHeader eyebrow="Settings" />'],
    ["overline", { overline: 1 }, "overline is not a prop", '<PageHeader eyebrow="..." />'],
    ["action", { action: <button type="button">Edit</button> }, "action is not a prop", "<PageHeader actions={<Button>Edit</Button>} />"],
    ["image", { image: "/a.png" }, "image is not a prop", '<PageHeader media={<img src={src} alt="" />} />'],
    ["heading", { heading: "Billing" }, "heading is not a prop", '<PageHeader title="Billing" />'],
    ["heading", { heading: true }, "heading is not a prop", '<PageHeader title="..." />'],
  ])("explains %s with the fix", async (_name, extra, problem, fix) => {
    const props = { title: "T", ...extra } as unknown as Parameters<typeof PageHeader>[0];
    const { header } = await render(<PageHeader {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] PageHeader: ${problem}. Fix: ${fix}.`);
    for (const name of ["subtitle", "overline", "action", "image", "heading"]) expect(header.hasAttribute(name)).toBe(false);
  });

  it("renders an h1 at the regular size for an unknown level and size", async () => {
    const props = { title: "T", level: 4, size: "xl" } as unknown as Parameters<typeof PageHeader>[0];
    const { header } = await render(<PageHeader {...props} />);
    expect(header.querySelector("h1")).not.toBeNull();
    expect(header.getAttribute("data-size")).toBe("md");
  });

  it.each([
    ["bg-muted", 'remove "bg-muted"; PageHeader sets its own look from the theme'],
    ["text-center", "text-center"],
    ["max-w-5xl", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<PageHeader title="T" className={className} />);
    if (fix) expect(warn).toHaveBeenCalledWith(expect.stringContaining(`[ouro-ui] PageHeader: "${className}"`));
    else expect(warn).not.toHaveBeenCalled();
  });

  it("renders to a string", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(full);
    expect(html).toContain('data-ouro="page-header"');
    expect(html).toContain("<h1");
    expect(error).not.toHaveBeenCalled();
  });
});
