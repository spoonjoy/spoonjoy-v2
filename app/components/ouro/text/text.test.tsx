import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Text } from "~/components/ouro/text/text";
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

const long = "A long sentence about braising short ribs low and slow until they fall apart.";

describe("Text", () => {
  it("renders a <p> with data-ouro and no browser margins", async () => {
    const { el } = await render(<Text>Hello</Text>);
    expect(el.tagName).toBe("P");
    expect(el.getAttribute("data-ouro")).toBe("text");
    expect(getComputedStyle(el).marginTop).toBe("0px");
    expect(getComputedStyle(el).marginBottom).toBe("0px");
  });

  it.each(["span", "div"] as const)("renders as %s", async (as) => {
    const { el } = await render(<Text as={as}>Hello</Text>);
    expect(el.tagName).toBe(as.toUpperCase());
  });

  it("passes HTML attributes and a ref through", async () => {
    let node: HTMLElement | null = null;
    const { el } = await render(
      <Text id="intro" aria-live="polite" ref={(element) => void (node = element)}>
        Hello
      </Text>,
    );
    expect(el.id).toBe("intro");
    expect(el.getAttribute("aria-live")).toBe("polite");
    expect(node).toBe(el);
  });

  it("has ellipsis on one line with truncate", async () => {
    const { el } = await render(<Text truncate>{long}</Text>);
    const style = getComputedStyle(el);
    expect(style.textOverflow).toBe("ellipsis");
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.overflow).toBe("hidden");
    expect(el.scrollWidth).toBeGreaterThan(el.clientWidth);
  });

  it("clamps to a number of lines", async () => {
    const { el } = await render(
      <>
        <Text lines={2}>{long}</Text>
        <Text>{long}</Text>
      </>,
    );
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    expect(el.getBoundingClientRect().height).toBeCloseTo(lineHeight * 2, 0);
    expect(el.nextElementSibling!.getBoundingClientRect().height).toBeGreaterThan(lineHeight * 2);
  });

  it("keeps a caller's style when clamping", async () => {
    const { el } = await render(
      <Text lines={3} style={{ maxWidth: 120 }}>
        {long}
      </Text>,
    );
    expect(el.style.maxWidth).toBe("120px");
    expect(getComputedStyle(el).webkitLineClamp).toBe("3");
  });

  it("orders sizes sm < md < lg, with md the default", async () => {
    const { host } = await render(
      <>
        <Text size="sm">a</Text>
        <Text>a</Text>
        <Text size="md">a</Text>
        <Text size="lg">a</Text>
      </>,
    );
    const [sm, def, md, lg] = [...host.children].map((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(sm).toBeLessThan(md!);
    expect(def).toBe(md);
    expect(md).toBeLessThan(lg!);
  });

  it("maps tones to theme colors", async () => {
    const { host } = await render(
      <>
        <Text>a</Text>
        <Text tone="default">a</Text>
        <Text tone="muted">a</Text>
        <Text tone="secondary">a</Text>
        <Text tone="primary">a</Text>
        <Text tone="success">a</Text>
        <Text tone="warning">a</Text>
        <Text tone="destructive">a</Text>
        <i className="text-foreground" />
        <i className="text-muted-foreground" />
        <i className="text-primary" />
      </>,
    );
    const colors = [...host.children].map((el) => getComputedStyle(el).color);
    const [none, def, muted, secondary, accent] = colors;
    expect(none).toBe(def);
    expect(def).toBe(colors[8]);
    expect(muted).toBe(colors[9]);
    // shadcn's --secondary is a surface, so secondary text is the muted foreground.
    expect(secondary).toBe(muted);
    expect(accent).toBe(colors[10]);
    expect(new Set(colors.slice(1, 8)).size).toBe(6);
  });

  it.each([
    ["start", "start"],
    ["center", "center"],
    ["end", "end"],
  ] as const)("aligns %s", async (align, expected) => {
    const { el } = await render(<Text align={align}>a</Text>);
    expect(getComputedStyle(el).textAlign).toBe(expected);
  });

  it.each([
    ["text-red-500", 'tone="destructive"'],
    ["text-gray-500", 'tone="muted"'],
    ["text-sm", 'size="sm"'],
    ["font-bold", "<Text><strong>…</strong></Text>"],
    ["font-mono", '<div className="font-mono"><Text /></div>'],
    ["text-center", 'align="center"'],
  ])("warns once for %s, pointing to %s", async (className, fix) => {
    await render(<Text className={className}>a</Text>);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^\[ouro-ui\] Text: /);
    expect(String(warn.mock.calls[0]?.[0])).toContain(`Fix: ${fix}.`);
  });

  it("allows layout classes", async () => {
    await render(<Text className="mt-4 max-w-prose text-balance">a</Text>);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("runtime guards", () => {
  const UntypedText = Text as unknown as (props: Record<string, unknown>) => React.ReactElement;

  it("strips color from Text and warns with the fix", async () => {
    const { el } = await render(<UntypedText color="red">a</UntypedText>);
    expect(el.hasAttribute("color")).toBe(false);
    expect(String(warn.mock.calls[0]?.[0])).toBe('[ouro-ui] Text: color is not a prop. Fix: <Text tone="destructive">.');
  });

  it.each([
    [{ as: "h2" }, "P", 'as="h2" is not an element Text renders; use "p", "span", "div". Fix: <Heading level={2}>.'],
    [{ as: "label" }, "P", 'as="label" is not an element Text renders; use "p", "span", "div". Fix: <Text as="span">.'],
    [{ size: "xl" }, "P", 'size="xl" is not a size; use "sm", "md", "lg". Fix: <Heading level={2}>.'],
    [{ size: "xs" }, "P", 'size="xs" is not a size; use "sm", "md", "lg". Fix: <Text size="md">.'],
    [{ align: "left" }, "P", 'align="left" is not an alignment; use "start", "center", "end". Fix: <Text align="start">.'],
    [{ align: "right" }, "P", 'align="right" is not an alignment; use "start", "center", "end". Fix: <Text align="end">.'],
  ])("renders the default for %j and warns once with the fix", async (props, tag, message) => {
    const { el } = await render(<UntypedText {...props}>a</UntypedText>);
    const reference = await render(<Text>a</Text>);
    expect(el.tagName).toBe(tag);
    expect(el.className).toBe(reference.el.className);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([`[ouro-ui] Text: ${message}`]);
  });

  it("strips variant from Text and warns with the fix", async () => {
    const { el } = await render(<UntypedText variant="muted">a</UntypedText>);
    expect(el.hasAttribute("variant")).toBe(false);
    expect(String(warn.mock.calls[0]?.[0])).toBe(
      '[ouro-ui] Text: variant is not a prop; Text has no variants. Fix: <Text size="sm" tone="muted">.',
    );
  });

  it.each([
    ["danger", 'tone="danger" is not a tone. Fix: <Text tone="destructive">.'],
    ["accent", 'tone="accent" is not a tone. Fix: <Text tone="primary">.'],
    [
      "blue",
      'tone="blue" is not a tone; use "default", "muted", "primary", "secondary", "destructive", "success", "warning". Fix: <Text tone="default">.',
    ],
  ])("renders the default color for tone=%j and warns once with the fix", async (tone, message) => {
    const { el } = await render(<UntypedText tone={tone}>a</UntypedText>);
    const reference = await render(<Text>a</Text>);
    expect(getComputedStyle(el).color).toBe(getComputedStyle(reference.el).color);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toBe(`[ouro-ui] Text: ${message}`);
  });
});

describe("Text server rendering", () => {
  it("renders to a string without warnings", () => {
    const html = renderToString(<Text lines={2}>Body</Text>);
    expect(html).toContain("--ouro-lines:2");
    expect(warn).not.toHaveBeenCalled();
  });
});
