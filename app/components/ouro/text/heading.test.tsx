import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Heading } from "~/components/ouro/text/heading";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.width = "200px";
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

describe("Heading", () => {
  it.each([1, 2, 3, 4, 5, 6] as const)("renders level %i as <h%i>", async (level) => {
    const { el } = await render(<Heading level={level}>Title</Heading>);
    expect(el.tagName).toBe(`H${level}`);
    expect(el.getAttribute("data-ouro")).toBe("heading");
    expect(getComputedStyle(el).marginTop).toBe("0px");
  });

  it("derives a smaller default size for deeper levels", async () => {
    const { host } = await render(
      <>
        {([1, 2, 3, 4, 5, 6] as const).map((level) => (
          <Heading key={level} level={level}>
            Title
          </Heading>
        ))}
      </>,
    );
    const sizes = [...host.children].map((el) => parseFloat(getComputedStyle(el).fontSize));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThanOrEqual(sizes[i - 1]!);
    expect(sizes[0]).toBeGreaterThan(sizes[3]!);
  });

  it("lets size override the level's default without changing the tag", async () => {
    const { host } = await render(
      <>
        <Heading level={1} size="sm">
          Small h1
        </Heading>
        <Heading level={6} size="2xl">
          Big h6
        </Heading>
        <Heading level={1}>Default h1</Heading>
      </>,
    );
    const [small, big, h1] = [...host.children] as HTMLElement[];
    expect(small!.tagName).toBe("H1");
    expect(big!.tagName).toBe("H6");
    expect(parseFloat(getComputedStyle(big!).fontSize)).toBe(parseFloat(getComputedStyle(h1!).fontSize));
    expect(parseFloat(getComputedStyle(small!).fontSize)).toBeLessThan(parseFloat(getComputedStyle(h1!).fontSize));
  });

  it("sets display larger than 2xl, and larger again from the sm breakpoint, for a hero headline", async () => {
    const { host } = await render(
      <>
        <Heading level={1} size="display">
          Hero
        </Heading>
        <Heading level={1}>Page</Heading>
      </>,
    );
    const [display, h1] = [...host.children] as HTMLElement[];
    expect(display!.tagName).toBe("H1");
    const px = parseFloat(getComputedStyle(display!).fontSize);
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    expect(px).toBeGreaterThan(parseFloat(getComputedStyle(h1!).fontSize));
    // 2.5rem below the `sm` breakpoint (640px), Tailwind's text-6xl (3.75rem) from it.
    expect(px).toBe((window.innerWidth >= 640 ? 3.75 : 2.5) * rem);
  });

  it.each([
    ["3xl", '[ouro-ui] Heading: size="3xl" is not a size; use "sm", "md", "lg", "xl", "2xl", "display". Fix: <Heading level={1} size="display">.'],
    ["huge", '[ouro-ui] Heading: size="huge" is not a size; use "sm", "md", "lg", "xl", "2xl", "display". Fix: <Heading level={1} size="2xl">.'],
  ])("renders the level's default size for size=%j and warns once with the fix", async (size, message) => {
    const { host } = await render(
      <>
        <Heading level={1} {...({ size } as object)}>
          Odd
        </Heading>
        <Heading level={1}>Default</Heading>
      </>,
    );
    const [odd, plain] = [...host.children].map((el) => getComputedStyle(el).fontSize);
    expect(odd).toBe(plain);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([message]);
  });

  it("renders inherited alignment for align=\"left\" and warns once with the fix", async () => {
    const { el } = await render(
      <Heading level={2} {...({ align: "left" } as object)}>
        Title
      </Heading>,
    );
    expect(el.className).not.toMatch(/text-(start|center|end|left)/);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '[ouro-ui] Heading: align="left" is not an alignment; use "start", "center", "end". Fix: <Heading align="start">.',
    ]);
  });

  it("aligns center and passes attributes through", async () => {
    const { el } = await render(
      <Heading level={2} align="center" id="t">
        Title
      </Heading>,
    );
    expect(getComputedStyle(el).textAlign).toBe("center");
    expect(el.id).toBe("t");
  });

  it.each([
    ["text-3xl", 'size="2xl"'],
    ["text-6xl", 'size="display"'],
    ["text-center", 'align="center"'],
    ["bg-black", "<Heading level={2}>…</Heading>"],
    ["font-serif", '<div className="font-serif"><Heading /></div>'],
  ])("warns for %s, pointing to %s", async (className, fix) => {
    await render(
      <Heading level={2} className={className}>
        Title
      </Heading>,
    );
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^\[ouro-ui\] Heading: /);
    expect(String(warn.mock.calls[0]?.[0])).toContain(`Fix: ${fix}.`);
  });
});

describe("runtime guards", () => {
  const UntypedHeading = Heading as unknown as (props: Record<string, unknown>) => React.ReactElement;

  it("strips color and as from Heading and warns with the fix", async () => {
    const { el } = await render(
      <UntypedHeading level={2} color="red" as="h3">
        a
      </UntypedHeading>,
    );
    expect(el.tagName).toBe("H2");
    expect(el.hasAttribute("color")).toBe(false);
    expect(el.hasAttribute("as")).toBe(false);
    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(messages).toEqual([
      '[ouro-ui] Heading: color is not a prop; headings use the theme foreground color. Fix: <Text tone="destructive">.',
      "[ouro-ui] Heading: as is not a prop; level sets the tag. Fix: <Heading level={3}>.",
    ]);
  });

  it("points an as that is not a heading tag to level={2}", async () => {
    await render(
      <UntypedHeading level={1} as="div">
        a
      </UntypedHeading>,
    );
    expect(String(warn.mock.calls[0]?.[0])).toContain("Fix: <Heading level={2}>.");
  });

  it.each([undefined, 0, 7, "2"])("throws for level=%s with the fix", (level) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderToString(<UntypedHeading level={level}>a</UntypedHeading>)).toThrow(
      `[ouro-ui] Heading: level must be 1, 2, 3, 4, 5 or 6, got ${JSON.stringify(level)}. Fix: <Heading level={2}>.`,
    );
    error.mockRestore();
  });
});

describe("Heading server rendering", () => {
  it("renders to a string without warnings", () => {
    const html = renderToString(<Heading level={3}>Title</Heading>);
    expect(html).toContain("<h3");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("Heading tracking", () => {
  it("tightens as the text grows: none at body size, more at each larger size", async () => {
    const { host } = await render(
      <>
        {(["sm", "md", "lg", "xl", "2xl"] as const).map((size) => (
          <Heading key={size} level={2} size={size}>
            {size}
          </Heading>
        ))}
      </>,
    );
    const em = (el: Element) => {
      const style = getComputedStyle(el);
      const spacing = style.letterSpacing === "normal" ? 0 : Number.parseFloat(style.letterSpacing);
      return Math.round((spacing / Number.parseFloat(style.fontSize)) * 1000) / 1000;
    };
    expect([...host.children].map(em)).toEqual([0, -0.01, -0.015, -0.02, -0.025]);
  });
});
