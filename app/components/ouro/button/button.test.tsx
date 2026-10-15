import { type ReactNode, type SVGProps } from "react";
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

  it("disables natively with disabled and fades", async () => {
    const onClick = vi.fn();
    const { button } = await render(
      <Button disabled onClick={onClick}>
        Go
      </Button>,
    );
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(getComputedStyle(button).opacity).toBe("0.5");
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

  it("keeps a disabled button natively disabled while loading", async () => {
    const { button } = await render(
      <Button disabled loading>
        Save
      </Button>,
    );
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(getComputedStyle(button).opacity).toBe("0.5");
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

describe("density", () => {
  afterEach(async () => {
    await page.viewport(414, 896);
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
    expect(button.classList.contains("h-(--ouro-button-h)")).toBe(false);
    expect(button.getBoundingClientRect().height).toBe(80);
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
  it("follows an app theme that sets --primary on a wrapper, solid and soft", async () => {
    const { host } = await render(
      <>
        <Button>Plain</Button>
        <Button variant="soft">Plain soft</Button>
        <div style={{ "--primary": "rgb(255, 0, 0)" } as React.CSSProperties}>
          <Button>Scoped</Button>
          <Button variant="soft">Scoped soft</Button>
        </div>
      </>,
    );
    const [plain, plainSoft, scoped, scopedSoft] = [...host.querySelectorAll("button")].map(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(scoped).toBe("rgb(255, 0, 0)");
    expect(scoped).not.toBe(plain);
    expect(scopedSoft).not.toBe(plainSoft);
    expect(scopedSoft).toMatch(/^(color\(srgb 1 0 0 \/ 0\.1\)|rgba\(255, 0, 0, 0\.1\)|oklab\(.*\/ 0\.1\))/);
  });

  it("switches to the dark values under a .dark ancestor", async () => {
    const { host } = await render(
      <>
        <Button>Light</Button>
        <div className="dark">
          <Button>Dark</Button>
        </div>
      </>,
    );
    const [light, dark] = [...host.querySelectorAll("button")].map((el) => getComputedStyle(el).backgroundColor);
    expect(light).toBe(themeColor("--primary"));
    expect(dark).toBe(themeColor("--primary", "dark"));
    expect(dark).not.toBe(light);
  });

  it("follows the .dark class on the root", async () => {
    document.documentElement.classList.add("dark");
    try {
      const { button } = await render(<Button>Theme</Button>);
      expect(getComputedStyle(button).backgroundColor).toBe(themeColor("--primary"));
      expect(getComputedStyle(button).color).toBe(themeColor("--primary-foreground"));
    } finally {
      document.documentElement.classList.remove("dark");
    }
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
    await userEvent.hover(button);
    await expect.poll(wash).toBe("0.08");
    await commands.pointerPress({ selector: "[data-ouro]", action: "down" });
    try {
      await expect.poll(wash).toBe("0.14");
    } finally {
      await commands.pointerPress({ action: "up" });
    }
  });
});
