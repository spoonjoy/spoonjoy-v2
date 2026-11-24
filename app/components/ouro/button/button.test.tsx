import { type ReactNode, type SVGProps } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { OuroProvider, type OuroLinkComponent } from "~/lib/ouro/ouro-provider";
import { Button } from "~/components/ouro/button/button";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";



const roots: Root[] = [];
let mounted: Element[] = [];

const actionThemes = ["inherited", "action overrides", "constant action"] as const;
function applyActionTheme(theme: (typeof actionThemes)[number]) {
  if (theme === "inherited") return;
  const style = document.createElement("style");
  style.textContent = `
    :root {
      --ouro-action: rgb(10, 20, 30);
      --ouro-action-foreground: rgb(250, 240, 230);
      --ouro-action-disabled-opacity: 0.75;
    }
    .dark {
      --ouro-action: ${theme === "constant action" ? "rgb(10, 20, 30)" : "rgb(50, 60, 70)"};
      --ouro-action-foreground: ${theme === "constant action" ? "rgb(250, 240, 230)" : "rgb(230, 240, 250)"};
      --ouro-action-disabled-opacity: 0.8;
    }
  `;
  document.head.append(style);
  mounted.push(style);
}

function disabledOpacity(button: HTMLElement): string {
  const probe = document.createElement("span");
  probe.style.opacity = "var(--ouro-action-disabled-opacity, 0.5)";
  button.append(probe);
  const value = getComputedStyle(probe).opacity;
  probe.remove();
  return value;
}

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get button() {
      return host.querySelector<HTMLElement>("[data-ouro]")!;
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
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

const Star = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 16 16" data-testid="icon" {...props}>
    <path d="M8 1l2 5h5l-4 3 2 6-5-4-5 4 2-6-4-3h5z" />
  </svg>
);

describe("button branch", () => {
  it("renders a native button with type=button and data-ouro", async () => {
    const { button } = await render(<Button>Go</Button>);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("data-ouro")).toBe("button");
    expect(button.textContent).toBe("Go");
  });

  // An app's theme may change the medium weight and the radius, on the root or on its buttons alone, and may give its
  // controls their own radius (--ouro-control-radius, which falls back to Ouro's lg step), so compare with a probe
  // inside the button that wears the same steps. A control's radius stops at half its height, so a theme's 9999px
  // capsule is compared at that.
  function expectThemeLook(button: HTMLElement) {
    const style = getComputedStyle(button);
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.borderTopStyle).toBe("solid");
    expect(style.borderTopWidth).toBe("1px");
    const step = button.appendChild(document.createElement("div"));
    mounted.push(step);
    step.className = "absolute font-medium";
    const half = `${button.getBoundingClientRect().height / 2}px`;
    step.style.borderRadius = `calc(min(calc(var(--ouro-control-radius, var(--radius)) * var(--ouro-radius-scale, 1)), ${half}))`;
    expect(style.fontWeight).toBe(getComputedStyle(step).fontWeight);
    expect(style.borderTopLeftRadius).toBe(getComputedStyle(step).borderTopLeftRadius);
  }

  it("is a medium-weight label on one line, in a 1px solid border, rounded on Ouro's lg step", async () => {
    const { button } = await render(<Button>Save the draft</Button>);
    expectThemeLook(button);
  });

  it("takes the weight and radius an app sets on its buttons alone", async () => {
    const { button } = await render(<Button>Save the draft</Button>);
    const root = getComputedStyle(button).borderTopLeftRadius;
    const scoped = document.head.appendChild(document.createElement("style"));
    mounted.push(scoped);
    scoped.textContent = '[data-ouro="button"] { --font-weight-medium: 600; --radius: 0.125rem; --ouro-control-radius: 0.125rem; }';
    expect(getComputedStyle(button).fontWeight).toBe("600");
    expect(getComputedStyle(button).borderTopLeftRadius).not.toBe(root);
    expectThemeLook(button);
  });

  it("is a capsule, its radius half its height, when a theme sets its controls to 9999px", async () => {
    const { button } = await render(<Button>Save the draft</Button>);
    const scoped = document.head.appendChild(document.createElement("style"));
    mounted.push(scoped);
    scoped.textContent = ":root { --ouro-control-radius: 9999px; }";
    const half = button.getBoundingClientRect().height / 2;
    expect(Number.parseFloat(getComputedStyle(button).borderTopLeftRadius)).toBeCloseTo(half, 1);
    expectThemeLook(button);
  });

  it("names its variant in data-variant, on buttons and links, so groups can style by look", async () => {
    const { host } = await render(
      <>
        <Button>Solid</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="plain" href="/recipes">
          Plain link
        </Button>
        <Button variant={"default" as "solid"}>Unknown</Button>
      </>,
    );
    expect([...host.querySelectorAll('[data-ouro="button"]')].map((button) => button.getAttribute("data-variant"))).toEqual([
      "solid",
      "outline",
      "plain",
      "solid",
    ]);
  });

  it("names its tone in data-tone, on buttons and links, so one tone's look is compared with itself", async () => {
    const { host } = await render(
      <>
        <Button>Primary</Button>
        <Button tone="destructive">Destructive</Button>
        <Button tone="secondary" href="/recipes">
          Secondary link
        </Button>
      </>,
    );
    expect([...host.querySelectorAll('[data-ouro="button"]')].map((button) => button.getAttribute("data-tone"))).toEqual([
      "primary",
      "destructive",
      "secondary",
    ]);
  });

  it("passes type, onClick and other button attributes through", async () => {
    const onClick = vi.fn();
    const { button } = await render(
      <Button type="submit" onClick={onClick} aria-label="Send now" name="intent" value="send">
        Send
      </Button>,
    );
    expect(button.getAttribute("type")).toBe("submit");
    expect(button.getAttribute("aria-label")).toBe("Send now");
    expect(button.getAttribute("name")).toBe("intent");
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("forwards a ref to the button element", async () => {
    let element: HTMLButtonElement | null = null;
    await render(
      <Button
        ref={(node) => {
          element = node;
        }}
      >
        Go
      </Button>,
    );
    expect(element).toBeInstanceOf(HTMLButtonElement);
  });

  it.each(actionThemes)("disables natively with the theme's disabled opacity (%s)", async (theme) => {
    applyActionTheme(theme);
    const onClick = vi.fn();
    const { button } = await render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(getComputedStyle(button).opacity).toBe(disabledOpacity(button));
    if (theme !== "inherited") expect(getComputedStyle(button).opacity).toBe("0.75");
    button.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders start and end icons, hidden from assistive technology", async () => {
    const { host } = await render(
      <Button startIcon={Star} endIcon={Star}>
        Star
      </Button>,
    );
    const icons = host.querySelectorAll('[data-testid="icon"]');
    expect(icons).toHaveLength(2);
    for (const icon of icons) expect(icon.getAttribute("aria-hidden")).toBe("true");
  });

  it("stretches to its container with fullWidth", async () => {
    const { host, button } = await render(
      <div style={{ width: 300 }}>
        <Button fullWidth>Go</Button>
      </div>,
    );
    expect(host.firstElementChild!.getBoundingClientRect().width).toBe(300);
    expect(button.getBoundingClientRect().width).toBe(300);
  });

  it.each(["ltr", "rtl"] as const)("puts an end icon at the inline end of a button wider than its label, %s", async (dir) => {
    const { host } = await render(
      <div dir={dir} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", width: 300 }}>
        <Button fullWidth endIcon={Star}>
          Next
        </Button>
        <Button endIcon={Star}>Next</Button>
      </div>,
    );
    // Distances along the inline axis, from the button's start edge, whatever the direction.
    const measure = (button: HTMLElement) => {
      const box = button.getBoundingClientRect();
      const from = (rect: DOMRect) => (dir === "ltr" ? [rect.left - box.left, rect.right - box.left] : [box.right - rect.right, box.right - rect.left]);
      const range = document.createRange();
      range.selectNodeContents(button.querySelector("[data-ouro-label]")!);
      const [textStart, textEnd] = from(range.getBoundingClientRect());
      const [iconStart, iconEnd] = from(button.querySelector('[data-testid="icon"]')!.getBoundingClientRect());
      return { width: box.width, textStart: textStart!, textEnd: textEnd!, iconStart: iconStart!, iconEnd: iconEnd! };
    };
    const [wide, snug] = [...host.querySelectorAll<HTMLElement>("[data-ouro='button']")].map(measure);
    expect(wide!.width).toBe(300);
    // The icon is as far from the end edge as on a button that fits its label.
    expect(Math.abs(wide!.width - wide!.iconEnd - (snug!.width - snug!.iconEnd))).toBeLessThanOrEqual(0.5);
    // The text is centred in the room between the start padding and the gap before the icon.
    const room = (snug!.textStart + wide!.iconStart - (snug!.iconStart - snug!.textEnd)) / 2;
    expect(Math.abs((wide!.textStart + wide!.textEnd) / 2 - room)).toBeLessThanOrEqual(1);
  });

  it.each([
    ["with", Star],
    ["without", undefined],
  ] as const)("keeps an app's justify-start on a wide button %s an end icon", async (_, icon) => {
    const { button } = await render(
      <div style={{ width: 300 }}>
        <Button fullWidth className="justify-start" startIcon={Star} endIcon={icon}>
          Next
        </Button>
      </div>,
    );
    const box = button.getBoundingClientRect();
    const start = button.querySelector('[data-testid="icon"]')!.getBoundingClientRect();
    // The label starts at the button's start padding (less the start icon's -0.5 margin), not in the middle.
    expect(start.left - box.left).toBeLessThanOrEqual(parseFloat(getComputedStyle(button).paddingInlineStart));
  });

  it("fades an end icon with the label while loading, leaving only the spinner", async () => {
    const { button } = await render(
      <Button endIcon={Star} loading>
        Next
      </Button>,
    );
    const icon = button.querySelector<SVGElement>('[data-testid="icon"]')!;
    // The opacity it shows with: its own times every element's around it, up to the button.
    const shown = () => {
      let opacity = 1;
      for (let node: Element | null = icon; node && node !== button; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      return opacity;
    };
    await expect.poll(shown).toBe(0);
  });
});

describe("loading", () => {
  it("sets aria-busy, disables without losing focus, and keeps the width within 1px", async () => {
    const onClick = vi.fn();
    const screen = await render(
      <Button onClick={onClick} startIcon={Star}>
        Save recipe
      </Button>,
    );
    const button = screen.button as HTMLButtonElement;
    button.focus();
    const before = button.getBoundingClientRect();
    await screen.rerender(
      <Button onClick={onClick} startIcon={Star} loading>
        Save recipe
      </Button>,
    );
    const after = button.getBoundingClientRect();
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("data-disabled")).toBe(true);
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
    expect(document.activeElement).toBe(button);
    button.click();
    expect(onClick).not.toHaveBeenCalled();
    // Not faded like a disabled button: loading is still the primary action.
    expect(getComputedStyle(button).opacity).toBe("1");
  });

  it("draws the spinner at once when the button mounts loading, and fades it in when loading turns on later", async () => {
    await commands.emulateMedia({ reducedMotion: "no-preference" });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      const spinnerBox = () => host.querySelector("[data-ouro-spinner]")!.parentElement!;
      flushSync(() => root.render(<Button loading>Save</Button>));
      expect(getComputedStyle(spinnerBox()).opacity).toBe("1");
      expect(spinnerBox().getAnimations()).toEqual([]);
      flushSync(() => root.render(<Button>Save</Button>));
      flushSync(() => root.render(<Button loading>Save</Button>));
      expect(spinnerBox().getAnimations().some((a) => a instanceof CSSTransition && a.transitionProperty === "opacity")).toBe(true);
    } finally {
      root.unmount();
      host.remove();
    }
  });

  it("keeps the accessible name and centers the spinner", async () => {
    const { button } = await render(<Button loading>Save recipe</Button>);
    const spinner = button.querySelector<SVGElement>("[data-ouro-spinner]")!;
    expect(spinner).not.toBeNull();
    expect(spinner.closest("[aria-hidden='true']")).not.toBeNull();
    const label = button.querySelector<HTMLElement>("[data-ouro-label]")!;
    expect(label.textContent).toBe("Save recipe");
    expect(getComputedStyle(label).visibility).toBe("visible");
    const b = button.getBoundingClientRect();
    const s = spinner.getBoundingClientRect();
    expect(Math.abs(s.left + s.width / 2 - (b.left + b.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(s.top + s.height / 2 - (b.top + b.height / 2))).toBeLessThanOrEqual(1);
  });

  it("does not submit its form while loading", async () => {
    const onSubmit = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    const { host } = await render(
      <form onSubmit={onSubmit}>
        <Button type="submit" loading>
          Save
        </Button>
      </form>,
    );
    host.querySelector("button")!.click();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps an aria-busy and aria-disabled the app passes while it is not loading", async () => {
    const { button, rerender } = await render(
      <Button aria-busy aria-disabled>
        Save recipe
      </Button>,
    );
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await rerender(
      <Button href="/recipes" aria-busy aria-disabled>
        Recipes
      </Button>,
    );
    const link = document.querySelector<HTMLElement>('a[data-ouro="button"]')!;
    expect(link.getAttribute("aria-busy")).toBe("true");
    expect(link.getAttribute("aria-disabled")).toBe("true");
  });

  it("renders a busy link that cannot be followed", async () => {
    const onClick = vi.fn();
    const { button } = await render(
      <Button href="/recipes" loading onClick={onClick}>
        Recipes
      </Button>,
    );
    expect(button.tagName).toBe("A");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
    const aux = new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
    button.dispatchEvent(aux);
    expect(aux.defaultPrevented).toBe(true);
  });

  it.each(actionThemes)("keeps a disabled button natively disabled while loading (%s)", async (theme) => {
    applyActionTheme(theme);
    const { button } = await render(
      <Button disabled loading>
        Save
      </Button>,
    );
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(getComputedStyle(button).opacity).toBe(disabledOpacity(button));
    if (theme !== "inherited") expect(getComputedStyle(button).opacity).toBe("0.75");
  });

  it("keeps the accessible name exactly the label while loading", async () => {
    const screen = await render(<Button>Save</Button>);
    await screen.rerender(<Button loading>Save</Button>);
    expect(screen.button.textContent).toBe("Save");
    expect(screen.button.querySelector("[aria-live]")).toBeNull();
    await expect.element(page.getByRole("button", { name: "Save", exact: true })).toBeInTheDocument();
  });

  it("announces loadingLabel through one shared region when loading turns on", async () => {
    const announcer = () => document.querySelectorAll<HTMLElement>("[data-ouro-announcer]");
    const screen = await render(
      <>
        <Button>Save</Button>
        <Button href="/x">Open</Button>
      </>,
    );
    await screen.rerender(
      <>
        <Button loading loadingLabel="Saving recipe">
          Save
        </Button>
        <Button href="/x" loading>
          Open
        </Button>
      </>,
    );
    expect(announcer()).toHaveLength(1);
    expect(announcer()[0]!.getAttribute("role")).toBe("status");
    await expect.poll(() => announcer()[0]!.textContent).toMatch(/^(Saving recipe|Loading)$/);
    // Turning loading off announces nothing new; turning it on again re-announces.
    await screen.rerender(<Button>Save</Button>);
    await screen.rerender(<Button loading>Save</Button>);
    await expect.poll(() => announcer()[0]!.textContent).toBe("Loading");
    expect(announcer()).toHaveLength(1);
  });

  it("does not announce when it mounts already loading", async () => {
    for (const region of document.querySelectorAll("[data-ouro-announcer]")) region.remove();
    await render(<Button loading>Save</Button>);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(document.querySelector("[data-ouro-announcer]")).toBeNull();
  });

  it("spins, and pulses instead of rotating with reduced motion", async () => {
    const spinner = (host: HTMLElement) => host.querySelector<SVGElement>("[data-ouro-spinner]")!;
    const spinning = await render(<Button loading>Save</Button>);
    expect(getComputedStyle(spinner(spinning.host)).animationName).toBe("ouro-spin");
    await commands.emulateMedia({ reducedMotion: "reduce" });
    expect(getComputedStyle(spinner(spinning.host)).animationName).toBe("ouro-pulse");
  });
});

describe("link branch", () => {
  it("renders an internal href as an <a> by default", async () => {
    const { button } = await render(<Button href="/x">Go</Button>);
    expect(button.tagName).toBe("A");
    expect(button.getAttribute("href")).toBe("/x");
    expect(button.getAttribute("data-ouro")).toBe("button");
    expect(button.hasAttribute("type")).toBe(false);
  });

  it("renders internal hrefs through the provider's linkComponent", async () => {
    const RouterLink: OuroLinkComponent = (props) => <a data-router="" {...props} />;
    const onClick = vi.fn((event: { preventDefault(): void }) => event.preventDefault());
    const { button } = await render(
      <OuroProvider linkComponent={RouterLink}>
        <Button href="/recipes" onClick={onClick}>
          Recipes
        </Button>
      </OuroProvider>,
    );
    expect(button.hasAttribute("data-router")).toBe(true);
    expect(button.getAttribute("href")).toBe("/recipes");
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("uses the document for reloadDocument and downloads, retaining router navigation otherwise", async () => {
    const RouterLink: OuroLinkComponent = (props) => <a data-router="" {...props} />;
    const { host } = await render(
      <OuroProvider linkComponent={RouterLink}>
        <Button href="/recipes">Recipes</Button>
        <Button href="/auth/start" reloadDocument>Sign in</Button>
        <Button href="/export.csv" download>Export</Button>
        <Button href="/export.csv" download="recipes.csv">Named export</Button>
        <Button href="/export.csv" download="">Unnamed export</Button>
        <Button href="/recipes" download={false}>Not a download</Button>
        <Button href="/recipes" reloadDocument={false}>Router navigation</Button>
      </OuroProvider>,
    );
    const links = [...host.querySelectorAll<HTMLAnchorElement>('[data-ouro="button"]')];
    expect(links.map((link) => link.hasAttribute("data-router"))).toEqual([true, false, false, false, false, true, true]);
    expect(links.map((link) => link.getAttribute("download"))).toEqual([null, null, "", "recipes.csv", "", null, null]);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/recipes", "/auth/start", "/export.csv", "/export.csv", "/export.csv", "/recipes", "/recipes",
    ]);
    expect(new Set(links.map((link) => link.className)).size).toBe(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["https://ouro.bot", "http://ouro.bot", "mailto:hi@ouro.bot", "//cdn.ouro.bot/x"])(
    "renders %s as a plain <a>, bypassing linkComponent",
    async (href) => {
      const RouterLink: OuroLinkComponent = (props) => <a data-router="" {...props} />;
      const { button } = await render(
        <OuroProvider linkComponent={RouterLink}>
          <Button href={href}>Out</Button>
        </OuroProvider>,
      );
      expect(button.hasAttribute("data-router")).toBe(false);
      expect(button.getAttribute("href")).toBe(href);
      expect(button.hasAttribute("rel")).toBe(false);
    },
  );

  it('adds rel="noopener noreferrer" to an external link with target="_blank"', async () => {
    const { button } = await render(
      <Button href="https://ouro.bot" target="_blank">
        Ouro
      </Button>,
    );
    expect(button.getAttribute("target")).toBe("_blank");
    expect(button.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("merges an explicit rel with noopener noreferrer on an external _blank link", async () => {
    const { host } = await render(
      <>
        <Button href="https://ouro.bot" target="_blank" rel="noopener">
          Ouro
        </Button>
        <Button href="https://ouro.bot" target="_blank" rel="nofollow  noreferrer">
          Ouro
        </Button>
        <Button href="https://ouro.bot" rel="nofollow">
          Same tab
        </Button>
      </>,
    );
    const rels = [...host.querySelectorAll("a")].map((a) => a.getAttribute("rel"));
    expect(rels).toEqual(["noopener noreferrer", "nofollow noreferrer noopener", "nofollow"]);
  });

  it("forwards a ref to the anchor", async () => {
    let element: HTMLAnchorElement | null = null;
    await render(
      <Button
        href="/x"
        ref={(node) => {
          element = node;
        }}
      >
        Go
      </Button>,
    );
    expect(element).toBeInstanceOf(HTMLAnchorElement);
  });

  it("looks like a button, not a link", async () => {
    const { button } = await render(<Button href="/x">Go</Button>);
    expect(getComputedStyle(button).textDecorationLine).toBe("none");
    expect(getComputedStyle(button).display).toBe("inline-flex");
  });
});

describe("appearance", () => {
  const variants = ["solid", "soft", "outline", "plain"] as const;
  const tones = ["secondary", "primary", "success", "warning", "destructive"] as const;

  it("defaults to a solid primary button", async () => {
    const { host } = await render(
      <>
        <Button>Default</Button>
        <Button tone="primary" variant="solid">
          Explicit
        </Button>
      </>,
    );
    const [a, b] = [...host.querySelectorAll("button")].map((el) => getComputedStyle(el));
    expect(a!.backgroundColor).toBe(b!.backgroundColor);
    expect(a!.color).toBe(b!.color);
    expect(a!.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  it("gives every tone and variant a distinct, non-default look", async () => {
    const seen = new Set<string>();
    for (const variant of variants) {
      for (const tone of tones) {
        const { button } = await render(
          <Button tone={tone} variant={variant}>
            {tone}
          </Button>,
        );
        const style = getComputedStyle(button);
        seen.add(`${style.backgroundColor}|${style.color}|${style.borderTopColor}`);
      }
    }
    expect(seen.size).toBe(variants.length * tones.length);
  });

  it("uses the tone's color, a fifth of the way toward the foreground, for text on soft backgrounds", async () => {
    const { host } = await render(
      <>
        <Button variant="soft">Soft</Button>
        <i style={{ color: "color-mix(in oklab, var(--primary) 80%, var(--foreground))" }} />
      </>,
    );
    expect(getComputedStyle(host.querySelector("button")!).color).toBe(
      getComputedStyle(host.querySelector("i")!).color,
    );
  });

  it("does not inherit the browser's button chrome", async () => {
    const { button } = await render(<Button variant="plain">Plain</Button>);
    const style = getComputedStyle(button);
    expect(style.boxSizing).toBe("border-box");
    expect(style.borderTopStyle).toBe("solid");
    expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(style.borderTopColor).toBe("rgba(0, 0, 0, 0)");
  });

  it("orders sizes sm < md < lg", async () => {
    const { host } = await render(
      <>
        <Button size="sm">Small</Button>
        <Button>Medium</Button>
        <Button size="lg">Large</Button>
      </>,
    );
    const [sm, md, lg] = [...host.querySelectorAll("button")].map((el) => el.getBoundingClientRect().height);
    expect(sm).toBeLessThan(md!);
    expect(md).toBeLessThan(lg!);
  });

  it("shows a crisp focus ring in the theme's ring color on keyboard focus, whatever the tone", async () => {
    const { host } = await render(
      <>
        <Button tone="destructive">Delete</Button>
        <i className="bg-ring" />
      </>,
    );
    const button = host.querySelector("button")!;
    document.body.focus();
    await pressTab();
    expect(document.activeElement).toBe(button);
    expect(button.matches(":focus-visible")).toBe(true);
    const style = getComputedStyle(button);
    expect(style.outlineStyle).toBe("solid");
    expect(style.outlineWidth).toBe("2px");
    expect(style.outlineOffset).toBe("2px");
    expect(style.outlineColor).toBe(getComputedStyle(host.querySelector("i")!).backgroundColor);
  });
});

describe("inline size", () => {
  const line = { fontSize: "13px", lineHeight: "18px", margin: 0 } as const;
  const middle = (rect: DOMRect) => rect.top + rect.height / 2;
  afterEach(async () => {
    await page.viewport(414, 896);
  });

  it("sits in a line of text at the text's size without moving the line, and keeps a 24px target", async () => {
    await page.viewport(1280, 800);
    const { host } = await render(
      <>
        <p style={line}>
          Built from your folders. <span>Why</span>
        </p>
        <p style={line}>
          Built from your folders.{" "}
          <Button size="inline" variant="plain">
            Why
          </Button>
        </p>
      </>,
    );
    const [text, withButton] = [...host.querySelectorAll("p")];
    expect(withButton!.getBoundingClientRect().height).toBe(text!.getBoundingClientRect().height);
    const button = host.querySelector("button")!;
    expect(getComputedStyle(button).fontSize).toBe("13px");
    expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    const word = middle(text!.querySelector("span")!.getBoundingClientRect()) - text!.getBoundingClientRect().top;
    const label = middle(button.querySelector("[data-ouro-label]")!.getBoundingClientRect()) - withButton!.getBoundingClientRect().top;
    expect(Math.abs(label - word)).toBeLessThanOrEqual(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("is at least 24px wide around a one-letter label", async () => {
    await page.viewport(1280, 800);
    const { button } = await render(
      <Button size="inline" variant="plain" aria-label="Help">
        ?
      </Button>,
    );
    expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(24);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("icon-only size", () => {
  it.each([
    ["has no width or height", {}],
    ["is Lucide's 24px icon", { width: 24, height: 24 }],
  ])("sizes an icon-only button's icon, whose svg %s, as startIcon does", async (_, attributes) => {
    const { host } = await render(
      <>
        <Button aria-label="Add">
          <Star {...attributes} />
        </Button>
        <Button startIcon={Star}>Add</Button>
      </>,
    );
    const [iconOnly, withStart] = [...host.querySelectorAll<HTMLElement>('[data-ouro="button"]')];
    const icon = iconOnly!.querySelector("svg")!.getBoundingClientRect();
    const reference = withStart!.querySelector("svg")!.getBoundingClientRect();
    expect(icon.width).toBeGreaterThan(0);
    expect(icon.width).toBe(reference.width);
    expect(icon.height).toBe(reference.height);
    expect(warn).not.toHaveBeenCalled();
  });

  it("sizes an icon-only link's icon as startIcon does", async () => {
    const { host } = await render(
      <>
        <Button href="/add" aria-label="Add">
          <Star />
        </Button>
        <Button href="/add" startIcon={Star}>
          Add
        </Button>
      </>,
    );
    const [iconOnly, withStart] = [...host.querySelectorAll<HTMLElement>('[data-ouro="button"]')];
    const icon = iconOnly!.querySelector("svg")!.getBoundingClientRect();
    expect(icon.width).toBeGreaterThan(0);
    expect(icon.width).toBe(withStart!.querySelector("svg")!.getBoundingClientRect().width);
  });

  it("keeps a label's padding around a wide picture such as a logo, and squares a square one or an icon", async () => {
    const picture = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 50 32'/%3E";
    const { host } = await render(
      <>
        <Button aria-label="Home" variant="plain">
          <img src={picture} alt="" width={50} height={32} />
        </Button>
        <Button aria-label="Profile" variant="plain">
          <img src={picture} alt="" width={24} height={24} />
        </Button>
        <Button aria-label="Add" variant="plain">
          <Star width={30} height={24} />
        </Button>
      </>,
    );
    const [logo, square, icon] = [...host.querySelectorAll<HTMLElement>('[data-ouro="button"]')];
    const box = logo!.getBoundingClientRect();
    const image = logo!.querySelector("img")!.getBoundingClientRect();
    expect(image.width).toBe(50);
    expect(image.left).toBeGreaterThan(box.left);
    expect(image.right).toBeLessThan(box.right);
    for (const button of [square!, icon!]) {
      const squareBox = button.getBoundingClientRect();
      expect(squareBox.width).toBe(squareBox.height);
    }
  });

  it.each([
    ["md", "md"],
    ["sm", "sm"],
    ["lg", "lg"],
  ] as const)("is as wide as it is tall at size %s, with only an icon and a name", async (_, size) => {
    const { host } = await render(
      <>
        <Button aria-label="Add" size={size}>
          <Star />
        </Button>
        <Button href="/add" aria-labelledby="add-label" size={size}>
          <Star />
        </Button>
        <span id="add-label">Add</span>
      </>,
    );
    // On a phone and from the sm breakpoint up, where each size sets its own padding.
    try {
      for (const [width, height] of [[414, 896], [1280, 800]] as const) {
        await page.viewport(width, height);
        for (const button of host.querySelectorAll<HTMLElement>('[data-ouro="button"]')) {
          const box = button.getBoundingClientRect();
          expect(box.width).toBeGreaterThan(0);
          expect(box.width).toBe(box.height);
        }
      }
    } finally {
      await page.viewport(414, 896);
    }
  });

  it("keeps an image child at its own width, and the button is never narrower than it is tall", async () => {
    const logo = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20'><rect width='40' height='20'/></svg>")}`;
    const { host } = await render(
      <>
        <Button aria-label="Home" size="sm">
          <img src={logo} width={40} height={20} alt="" />
        </Button>
        <Button size="sm">Home</Button>
      </>,
    );
    const [logoButton, label] = [...host.querySelectorAll<HTMLElement>('[data-ouro="button"]')];
    const img = logoButton!.querySelector("img")!;
    await img.decode();
    const image = img.getBoundingClientRect();
    const box = logoButton!.getBoundingClientRect();
    expect(image.width).toBe(img.naturalWidth);
    expect(image.left).toBeGreaterThanOrEqual(box.left);
    expect(image.right).toBeLessThanOrEqual(box.right);
    expect(box.width).toBeGreaterThanOrEqual(box.height);
    expect(box.height).toBe(label!.getBoundingClientRect().height);
  });

  it("keeps a wide element child at its full width under its aria-label", async () => {
    const { button } = await render(
      <Button aria-label="Wide" size="sm">
        <span data-testid="wide" style={{ display: "block", width: 80, height: 20 }} />
      </Button>,
    );
    expect(button.querySelector("[data-testid=wide]")!.getBoundingClientRect().width).toBe(80);
    expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(80);
  });

  it("lets the app's width and padding win over an icon-only button's square", async () => {
    const { host } = await render(
      <>
        <Button aria-label="Add" className="w-20">
          <Star />
        </Button>
        <Button aria-label="Add" className="px-4">
          <Star />
        </Button>
      </>,
    );
    const [wide, padded] = [...host.querySelectorAll<HTMLElement>('[data-ouro="button"]')];
    expect(wide!.getBoundingClientRect().width).toBe(80);
    expect(getComputedStyle(padded!).paddingInlineStart).toBe("16px");
  });

  it("keeps a label's padding where the icon has text beside it, a start icon, no name, or the inline size", async () => {
    const { host } = await render(
      <>
        <Button aria-label="Add">
          <Star />
        </Button>
        <Button aria-label="Add">
          <Star /> Add
        </Button>
        <Button aria-label="Add">
          <>
            <Star />
          </>
        </Button>
        <Button aria-label="Add" startIcon={Star}>
          <Star />
        </Button>
        <Button aria-label="Add" endIcon={Star}>
          <Star />
        </Button>
        <Button>
          <Star />
        </Button>
        <Button aria-label="Add" size="inline">
          <Star />
        </Button>
      </>,
    );
    const [square, ...rest] = [...host.querySelectorAll<HTMLElement>('[data-ouro="button"]')];
    expect(getComputedStyle(square!).paddingInlineStart).toBe("0px");
    for (const button of rest) expect(getComputedStyle(button).paddingInlineStart).not.toBe("0px");
  });

  it("keeps the size an icon sets for itself", async () => {
    const { button } = await render(
      <Button aria-label="Add">
        <Star className="size-8" />
      </Button>,
    );
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    expect(button.querySelector("svg")!.getBoundingClientRect().width).toBe(2 * rootFontSize);
  });
});

describe("density", () => {
  afterEach(async () => {
    await page.viewport(414, 896);
  });

  it("keeps its fixed sizes at a compact --spacing: a fine pointer keeps a 24px floor, and an icon-only button stays square", async () => {
    await page.viewport(1280, 800);
    const Plus = (props: SVGProps<SVGSVGElement>) => (
      <svg viewBox="0 0 16 16" {...props}>
        <path d="M8 3v10M3 8h10" />
      </svg>
    );
    const { host } = await render(
      <>
        <Button>Density</Button>
        <Button aria-label="Add">
          <Plus />
        </Button>
      </>,
    );
    const [text, icon] = Array.from(host.querySelectorAll<HTMLElement>('[data-ouro="button"]'));
    const box = (element: HTMLElement) => [getComputedStyle(element).height, getComputedStyle(element).width].map((px) => parseFloat(px));
    expect(box(text!)[0]).toBeCloseTo(36);
    expect(box(icon!)).toEqual([expect.closeTo(36), expect.closeTo(36)]);
    host.style.setProperty("--spacing", "0.05rem");
    expect(box(text!)[0]).toBeCloseTo(24);
    expect(box(icon!)).toEqual([expect.closeTo(24), expect.closeTo(24)]);
  });

  it("is shorter at 1280px than at 390px", async () => {
    await page.viewport(390, 844);
    const { button } = await render(<Button>Density</Button>);
    const phone = button.getBoundingClientRect().height;
    await page.viewport(1280, 800);
    await expect.poll(() => button.getBoundingClientRect().height).toBeLessThan(phone);
    expect(phone).toBe(44);
  });
});

describe("press feedback", () => {
  /**
   * The button's scale once the press-in transition has finished: no transition is
   * running and two reads in a row agree. A single read can land mid-transition.
   */
  async function pressScale(button: HTMLElement) {
    await commands.pointerPress({ selector: `[data-press-probe]`, action: "down" });
    try {
      let last = "";
      await expect
        .poll(() => {
          const scale = getComputedStyle(button).scale;
          const still = scale === last && button.getAnimations().length === 0;
          last = scale;
          return still;
        }, { interval: 50 })
        .toBe(true);
      return last;
    } finally {
      await commands.pointerPress({ selector: `[data-press-probe]`, action: "up" });
    }
  }

  it("scales to --ouro-press-scale while pressed", async () => {
    const { button } = await render(<Button data-press-probe="">Press</Button>);
    expect(getComputedStyle(button).scale).toBe("none");
    expect(await pressScale(button)).toBe("0.97");
  });

  it("does not scale with reduced motion", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const { button } = await render(<Button data-press-probe="">Press</Button>);
    expect(await pressScale(button)).toBe("none");
  });

  it("does not scale while loading", async () => {
    const { button } = await render(
      <Button data-press-probe="" loading>
        Press
      </Button>,
    );
    expect(await pressScale(button)).toBe("none");
  });

  it("scales in and out in the press duration on the ease-out token", async () => {
    const { button } = await render(<Button>Spring</Button>);
    const style = getComputedStyle(button);
    const properties = style.transitionProperty.split(", ");
    const durations = style.transitionDuration.split(", ");
    const easings = style.transitionTimingFunction.split(/,\s(?![^(]*\))/);
    const scaleIndex = properties.indexOf("scale");
    expect(scaleIndex).toBeGreaterThanOrEqual(0);
    expect(durations[scaleIndex]).toBe("0.16s");
    expect(easings[scaleIndex]).toBe("cubic-bezier(0.23, 1, 0.32, 1)");
  });
});

describe("className", () => {
  it("lets app layout classes win over library styles", async () => {
    const { host, button } = await render(
      <div style={{ width: 320 }}>
        <Button className="mt-4 w-full">Go</Button>
      </div>,
    );
    // Button sets no margin of its own, so the app's mt-4 is the only one.
    expect(button.classList.contains("mt-4")).toBe(true);
    expect(button.classList.contains("m-0")).toBe(false);
    expect(getComputedStyle(button).marginTop).toBe("16px");
    expect(getComputedStyle(button).marginBottom).toBe("0px");
    expect(button.getBoundingClientRect().width).toBe(host.firstElementChild!.getBoundingClientRect().width);
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops its own class when the app's className sets the same property", async () => {
    const { button } = await render(<Button className="h-20">Tall</Button>);
    expect(button.classList.contains("h-20")).toBe(true);
    expect(button.classList.contains("h-[max(var(--ouro-button-h),var(--ouro-size-6))]")).toBe(false);
    expect(button.getBoundingClientRect().height).toBe(80);
  });

  it("takes a height class under its fine-pointer floor, as a compact row inside a message sets one", async () => {
    const { button } = await render(<Button size="sm" variant="plain" className="h-5">Reply</Button>);
    expect(button.getBoundingClientRect().height).toBe(20);
  });

  it("lets the app's height and padding win at desktop widths too", async () => {
    await page.viewport(1280, 800);
    try {
      const { button } = await render(<Button className="h-20 px-8">Tall</Button>);
      expect(button.getBoundingClientRect().height).toBe(80);
      expect(getComputedStyle(button).paddingLeft).toBe("32px");
    } finally {
      await page.viewport(414, 896);
    }
  });

  it("warns exactly once for an appearance class, pointing to tone", async () => {
    const screen = await render(<Button className="bg-red-500">Go</Button>);
    await screen.rerender(<Button className="bg-red-500">Go again</Button>);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toBe(
      '[ouro-ui] Button: "bg-red-500" sets appearance, and className is for layout only. Fix: tone="destructive".',
    );
  });

  it.each([
    ["text-lg", 'size="lg"'],
    ["rounded-full", ":root { --radius: 999px }"],
    ["md:border-2", 'variant="outline"'],
    ["bg-transparent", 'variant="plain"'],
    ["hover:bg-emerald-600", 'tone="success"'],
    ["font-bold", 'remove "font-bold"; Button sets its own weight'],
    ["font-serif", '<div className="font-serif"><Button /></div>'],
    ["text-center", '<div className="text-center"><Button /></div>'],
  ])("points %s to %s", async (className, fix) => {
    await render(<Button className={className}>Go</Button>);
    expect(String(warn.mock.calls[0]?.[0])).toContain(`Fix: ${fix}.`);
  });

  it("checks the className on links too", async () => {
    await render(
      <Button href="/x" className="shadow-lg">
        Go
      </Button>,
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("runtime guards", () => {
  // The guard props are typed `never`; these cast past the types the way an untyped
  // caller (or a dev server that does not typecheck) would.
  const Untyped = Button as unknown as (props: Record<string, unknown>) => React.ReactElement;

  it.each([
    ["isLoading", true, "<Button loading>"],
    ["color", "red", '<Button tone="destructive">'],
    ["asChild", true, '<Button href="/path">'],
    ["leftIcon", Star, "<Button startIcon={Icon}>"],
    ["rightIcon", Star, "<Button endIcon={Icon}>"],
  ])("strips %s from the DOM and warns once with the fix", async (prop, value, fix) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const screen = await render(<Untyped {...{ [prop]: value }}>Go</Untyped>);
    await screen.rerender(<Untyped {...{ [prop]: value }}>Go again</Untyped>);
    expect(screen.button.hasAttribute(prop)).toBe(false);
    expect(screen.button.hasAttribute(prop.toLowerCase())).toBe(false);
    expect(error).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toBe(`[ouro-ui] Button: ${prop} is not a prop. Fix: ${fix}.`);
  });

  it.each([
    ["primary", 'type="primary" is not a button type; use "button", "submit", "reset". Fix: <Button tone="primary">.'],
    ["link", 'type="link" is not a button type; use "button", "submit", "reset". Fix: <Button type="button">.'],
  ])("renders type=button for type=%j, so it never submits a form, and warns once with the fix", async (type, message) => {
    const { button } = await render(<Untyped type={type}>Go</Untyped>);
    expect(button.getAttribute("type")).toBe("button");
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([`[ouro-ui] Button: ${message}`]);
  });

  it("drops type on a link and warns", async () => {
    const { button } = await render(
      <Untyped href="/x" type="submit">
        Go
      </Untyped>,
    );
    expect(button.tagName).toBe("A");
    expect(button.hasAttribute("type")).toBe(false);
    expect(String(warn.mock.calls[0]?.[0])).toBe(
      '[ouro-ui] Button: a link has no type, so type="submit" is ignored. Fix: <Button type="submit"> without href.',
    );
  });

  it("drops disabled on a link and warns", async () => {
    const { button } = await render(
      <Untyped href="/x" disabled>
        Go
      </Untyped>,
    );
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(String(warn.mock.calls[0]?.[0])).toBe(
      "[ouro-ui] Button: a link cannot be disabled. Fix: <Button disabled> without href.",
    );
  });

  it.each([false, true])("drops reloadDocument=%s without href and explains the missing link", async (reloadDocument) => {
    const { button } = await render(<Untyped reloadDocument={reloadDocument}>Go</Untyped>);
    expect(button.tagName).toBe("BUTTON");
    expect(button.hasAttribute("reloaddocument")).toBe(false);
    expect(warn.mock.calls.map((call: unknown[]) => call[0])).toEqual([
      '[ouro-ui] Button: reloadDocument needs href. Fix: <Button href="/path" reloadDocument>.',
    ]);
  });

  it.each([
    ["tone", "danger", 'tone="danger" is not a tone. Fix: <Button tone="destructive">.'],
    ["tone", "accent", 'tone="accent" is not a tone. Fix: <Button tone="primary">.'],
    ["tone", "neutral", 'tone="neutral" is not a tone. Fix: <Button tone="secondary">.'],
    [
      "tone",
      "blue",
      'tone="blue" is not a tone; use "primary", "secondary", "destructive", "success", "warning". Fix: <Button tone="primary">.',
    ],
    ["variant", "destructive", 'variant="destructive" is not a variant. Fix: <Button tone="destructive">.'],
    ["variant", "default", 'variant="default" is not a variant. Fix: <Button>.'],
    ["variant", "secondary", 'variant="secondary" is not a variant. Fix: <Button tone="secondary">.'],
    ["variant", "ghost", 'variant="ghost" is not a variant. Fix: <Button variant="plain">.'],
    ["variant", "link", 'variant="link" is not a variant. Fix: <Button variant="plain" href="/path">.'],
    ["variant", "fancy", 'variant="fancy" is not a variant. Fix: <Button variant="solid">.'],
  ])("renders the default look for %s=%j and warns once with the fix", async (prop, value, message) => {
    const screen = await render(
      <div>
        <Button>Default</Button>
        <Untyped {...{ [prop]: value }}>Odd</Untyped>
      </div>,
    );
    const [plain, odd] = [...screen.host.querySelectorAll("button")].map((el) => getComputedStyle(el));
    expect(odd!.backgroundColor).toBe(plain!.backgroundColor);
    expect(odd!.color).toBe(plain!.color);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toBe(`[ouro-ui] Button: ${message}`);
  });

  it.each([
    ["default", 'size="default" is not a size. Fix: <Button size="md">.'],
    ["icon", 'size="icon" is not a size. Fix: <Button aria-label="Add"><PlusIcon /></Button>.'],
  ])("renders the md size for shadcn's size=%j and warns once with the fix", async (value, message) => {
    const screen = await render(
      <div>
        <Button>Default</Button>
        <Untyped size={value}>Odd</Untyped>
      </div>,
    );
    const [plain, odd] = [...screen.host.querySelectorAll("button")].map((el) => el.getBoundingClientRect().height);
    expect(odd).toBe(plain);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toBe(`[ouro-ui] Button: ${message}`);
  });

  it("does not warn on server render", () => {
    renderToString(<Untyped isLoading>Go</Untyped>);
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * A theme variable as the browser computes it, read from a probe element (inside a
 * `.dark` wrapper for `"dark"`), so the tests hold under any app theme.
 */
function themeColor(variable: string, scheme?: "dark"): string {
  const wrapper = document.createElement("div");
  if (scheme) wrapper.className = scheme;
  const probe = document.createElement("div");
  probe.style.backgroundColor = `var(${variable})`;
  wrapper.append(probe);
  document.body.append(wrapper);
  const value = getComputedStyle(probe).backgroundColor;
  wrapper.remove();
  return value;
}

describe("theme", () => {
  it.each(actionThemes)("follows scoped primary fallback and action overrides without repainting soft buttons (%s)", async (theme) => {
    applyActionTheme(theme);
    const { host } = await render(
      <>
        <Button>Plain</Button>
        <div style={{ "--primary": "rgb(255, 0, 0)", "--ouro-action": "initial" } as React.CSSProperties}>
          <Button>Scoped</Button>
          <Button variant="soft">Scoped soft</Button>
        </div>
        <div style={{ "--primary": "rgb(255, 0, 0)", "--ouro-action": "rgb(0, 0, 255)" } as React.CSSProperties}>
          <Button>Scoped action</Button>
          <Button variant="soft">Scoped action soft</Button>
        </div>
      </>,
    );
    const [plain, scoped, scopedSoft, action, actionSoft] = [...host.querySelectorAll("button")].map(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(plain).toBe(themeColor("--ouro-action, var(--primary)"));
    expect(scoped).toBe("rgb(255, 0, 0)");
    expect(scopedSoft).toMatch(/^(color\(srgb 1 0 0 \/ 0\.1\)|rgba\(255, 0, 0, 0\.1\)|oklab\(.*\/ 0\.1\))/);
    expect(action).toBe("rgb(0, 0, 255)");
    expect(actionSoft).toBe(scopedSoft);
  });

  it.each(actionThemes)("switches to the dark action values under a .dark ancestor (%s)", async (theme) => {
    applyActionTheme(theme);
    const { host } = await render(
      <>
        <Button>Light</Button>
        <div className="dark">
          <Button>Dark</Button>
        </div>
      </>,
    );
    const [light, dark] = [...host.querySelectorAll("button")].map((el) => getComputedStyle(el).backgroundColor);
    expect(light).toBe(themeColor("--ouro-action, var(--primary)"));
    expect(dark).toBe(themeColor("--ouro-action, var(--primary)", "dark"));
    if (theme !== "inherited") {
      expect(light).toBe("rgb(10, 20, 30)");
      expect(dark).toBe(theme === "constant action" ? "rgb(10, 20, 30)" : "rgb(50, 60, 70)");
    }
  });

  it.each(actionThemes)("follows the .dark class on the root with optional action colours (%s)", async (theme) => {
    applyActionTheme(theme);
    document.documentElement.classList.add("dark");
    try {
      const { button } = await render(<Button>Theme</Button>);
      expect(getComputedStyle(button).backgroundColor).toBe(themeColor("--ouro-action, var(--primary)"));
      expect(getComputedStyle(button).color).toBe(themeColor("--ouro-action-foreground, var(--primary-foreground)"));
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });
});

describe("the pointer between tests", () => {
  // The two tests run in order. The first leaves the pointer over a button at the top left, as an
  // earlier test can. The second renders a button in that place: the browser re-checks hover after
  // layout (WebKit late), so the button would turn :hover and fade to --ouro-action-hover, which the
  // theme tests do not set.
  it("hovers a button at the top left, leaving the pointer on it", async () => {
    const { button } = await render(<Button>Light</Button>);
    await userEvent.hover(button);
    await expect.poll(() => button.matches(":hover")).toBe(true);
  });

  it("renders a button under the old pointer without hovering it, under a theme with a hover colour", async () => {
    const style = document.createElement("style");
    style.textContent = ":root { --ouro-action: rgb(10, 20, 30); --ouro-action-hover: rgb(31, 27, 23); }";
    document.head.append(style);
    mounted.push(style);
    const { host } = await render(
      <>
        <Button>Light</Button>
        <div className="dark">
          <Button>Dark</Button>
        </div>
      </>,
    );
    const light = host.querySelector<HTMLElement>("button")!;
    for (let frame = 0; frame < 10; frame++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect({ hovered: light.matches(":hover"), background: getComputedStyle(light).backgroundColor }).toEqual({
      hovered: false,
      background: "rgb(10, 20, 30)",
    });
  });
});

describe("touch target", () => {
  it("does not grow the hit area for a fine pointer", async () => {
    const { button } = await render(<Button size="sm">Tap</Button>);
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top - 2);
    expect(hit?.closest("button")).not.toBe(button);
  });
});

describe("Button server rendering", () => {
  it("renders to a string without warnings", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(
      <>
        <Button className="bg-red-500">Go</Button>
        <Button href="/x">Link</Button>
        <Button loading>Busy</Button>
      </>,
    );
    expect(html).toContain('data-ouro="button"');
    expect(html).not.toContain("data-ouro-announcer");
    expect(html).not.toContain("aria-live");
    expect(html).toContain('href="/x"');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("Button under a parent's spacing", () => {
  it("keeps the 16px that space-y-4 puts under a button that is not the last child", async () => {
    const { host } = await render(
      <div className="space-y-4">
        <Button fullWidth>Save</Button>
        <Button fullWidth>Cancel</Button>
      </div>,
    );
    const [save, cancel] = [...host.querySelectorAll<HTMLElement>('[data-ouro="button"]')];
    expect(getComputedStyle(save!).marginBottom).toBe("16px");
    expect(getComputedStyle(cancel!).marginBottom).toBe("0px");
  });
});

describe("Button under more contrast", () => {
  it("gives the soft look a visible border with prefers-contrast: more", async () => {
    const { button } = await render(<Button variant="soft">Soft</Button>);
    expect(getComputedStyle(button).borderTopColor).toBe("rgba(0, 0, 0, 0)");
    await commands.emulateMedia({ contrast: "more" });
    try {
      await expect.poll(() => getComputedStyle(button).borderTopColor).toBe(getComputedStyle(button).color);
    } finally {
      await commands.emulateMedia({ contrast: "no-preference" });
    }
  });
});

describe("Button state layer", () => {
  it("shows the deeper pressed wash, not the hover wash, while a mouse presses a hovered button", async () => {
    const { button } = await render(<Button>Save</Button>);
    const wash = () => getComputedStyle(button, "::before").opacity;
    const token = (name: string) =>
      String(parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) / 100);
    await userEvent.hover(button);
    await expect.poll(wash).toBe(token("--ouro-state-hover"));
    await commands.pointerPress({ selector: "[data-ouro]", action: "down" });
    try {
      await expect.poll(wash).toBe(token("--ouro-state-pressed"));
    } finally {
      await commands.pointerPress({ action: "up" });
    }
  });
});

describe("Button under forced colours", () => {
  it("stays borderless on a plain button at rest, and keeps the outline variant's border (#3103)", async () => {
    const { host } = await render(
      <>
        <Button variant="plain">Plain</Button>
        <Button variant="outline">Outline</Button>
      </>,
    );
    const [plain, outline] = [...host.querySelectorAll<HTMLElement>("[data-ouro]")];
    await commands.emulateMedia({ forcedColors: "active" });
    try {
      await expect.poll(() => parseFloat(getComputedStyle(outline!).borderTopWidth)).toBeGreaterThan(0);
      expect(getComputedStyle(plain!).borderTopWidth).toBe("0px");
    } finally {
      await commands.emulateMedia({ forcedColors: "none" });
    }
  });
});

describe("Button and a page scroll at the press", () => {
  // A smooth scroll begins as the press goes down, ahead of the button's own handlers. A button that
  // opens a dialog stops it where it is; any other leaves the page alone.
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  afterEach(() => {
    document.documentElement.removeAttribute("style");
    window.scrollTo({ top: 0, behavior: "instant" });
  });

  /** Presses the button as a smooth scroll starts, and returns where the page is once the press is over. */
  async function pressAsScrollStarts(input: "pointer" | "Enter" | "ArrowDown") {
    // The page rests at 2000 for two frames before the press, so the compositor, which runs a
    // keyboard scroll, has it there too, and nothing from an earlier test is still moving it.
    for (let still = 0; still < 2; ) {
      if (window.scrollY !== 2000) window.scrollTo({ top: 2000, behavior: "instant" });
      await frame();
      still = window.scrollY === 2000 ? still + 1 : 0;
    }
    document.documentElement.style.scrollBehavior = "smooth";
    document.addEventListener(input === "pointer" ? "pointerdown" : "keydown", () => window.scrollTo({ top: 4000 }), { capture: true, once: true });
    if (input === "pointer") {
      await commands.pointerPress({ selector: '[data-ouro="button"]', action: "down" });
      for (let index = 0; index < 10; index++) await frame();
      await commands.pointerPress({ action: "up" });
    } else {
      document.querySelector<HTMLElement>('[data-ouro="button"]')!.focus({ preventScroll: true });
      await userEvent.keyboard(`{${input}}`);
    }
    for (let index = 0; index < 10; index++) await frame();
    return window.scrollY;
  }

  const page5000 = (button: ReactNode) => (
    <div style={{ height: 5000 }}>
      <header style={{ position: "sticky", top: 0, height: 100 }}>{button}</header>
    </div>
  );

  for (const input of ["pointer", "Enter"] as const) {
    it(`with aria-haspopup="dialog", stops the scroll where ${input === "pointer" ? "a press" : "Enter"} found it, and keeps its own handlers`, async () => {
      const pointerDown = vi.fn();
      const keyDown = vi.fn();
      await render(page5000(<Button aria-haspopup="dialog" onPointerDown={pointerDown} onKeyDown={keyDown}>Open</Button>));
      expect(await pressAsScrollStarts(input)).toBe(2000);
      expect((input === "pointer" ? pointerDown : keyDown).mock.calls.length).toBe(1);
    });
  }

  for (const input of ["pointer", "Enter"] as const) {
    it(`with aria-haspopup="dialog" and no handlers of its own, stops the scroll where ${input === "pointer" ? "a press" : "Enter"} found it, raising no error`, async () => {
      await render(page5000(<Button aria-haspopup="dialog">Open</Button>));
      const errors: string[] = [];
      const onError = (event: ErrorEvent) => {
        errors.push(event.message);
        event.preventDefault();
      };
      window.addEventListener("error", onError);
      expect(await pressAsScrollStarts(input)).toBe(2000);
      window.removeEventListener("error", onError);
      expect(errors).toEqual([]);
    });
  }

  for (const [name, button, input] of [
    ["without aria-haspopup", <Button key="plain">Save</Button>, "pointer"],
    ['with aria-haspopup="menu"', <Button key="menu" aria-haspopup="menu">More</Button>, "pointer"],
    ['with aria-haspopup="dialog", at an arrow key', <Button key="arrow" aria-haspopup="dialog">Open</Button>, "ArrowDown"],
  ] as const) {
    it(`${name}, leaves the scroll going`, async () => {
      await render(page5000(button));
      expect(await pressAsScrollStarts(input)).toBeGreaterThan(2000);
    });
  }
});

