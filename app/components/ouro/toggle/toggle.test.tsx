import { createRef, useState, type ReactNode, type SVGProps } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Toggle, type ToggleProps } from "~/components/ouro/toggle/toggle";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get toggle() {
      return host.querySelector<HTMLButtonElement>('[data-ouro="toggle"]')!;
    },
  };
}

function BoldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" data-testid="bold" {...props}>
      <path d="M4 3h5a3 3 0 0 1 0 6H4zM4 9h6a3 3 0 0 1 0 6H4z" />
    </svg>
  );
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
  await page.viewport(414, 896);
  await commands.emulateMedia({ reducedMotion: "no-preference" });
});

describe("Toggle", () => {
  it("is a button with a fixed name that reports its state with aria-pressed", async () => {
    const onPressedChange = vi.fn();
    const { toggle } = await render(<Toggle label="Bold" onPressedChange={onPressedChange} />);
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.type).toBe("button");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await expect.element(page.getByRole("button", { name: "Bold", pressed: false })).toBeVisible();
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.hasAttribute("data-pressed")).toBe(true);
    expect(onPressedChange).toHaveBeenLastCalledWith(true);
    // The name stays the same: the pressed state says whether it is on.
    expect(toggle.textContent).toBe("Bold");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(onPressedChange).toHaveBeenLastCalledWith(false);
  });

  it("names its variant in data-variant", async () => {
    const { toggle, rerender } = await render(<Toggle label="Bold" />);
    expect(toggle.getAttribute("data-variant")).toBe("plain");
    await rerender(<Toggle label="Bold" variant="outline" />);
    expect(toggle.getAttribute("data-variant")).toBe("outline");
  });

  it("starts pressed with defaultPressed and follows a controlled pressed", async () => {
    function Controlled() {
      const [on, setOn] = useState(true);
      return (
        <>
          <Toggle label="Italic" defaultPressed />
          <Toggle label="Mute" pressed={on} onPressedChange={setOn} />
          <output>{String(on)}</output>
        </>
      );
    }
    const { host } = await render(<Controlled />);
    const [italic, mute] = [...host.querySelectorAll("button")];
    expect(italic!.getAttribute("aria-pressed")).toBe("true");
    expect(mute!.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(mute!);
    expect(mute!.getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector("output")!.textContent).toBe("false");
  });

  it("toggles from the keyboard", async () => {
    const { toggle } = await render(<Toggle label="Bold" />);
    toggle.focus();
    await userEvent.keyboard(" ");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await userEvent.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows an icon before the label, hidden from screen readers", async () => {
    const { toggle } = await render(<Toggle label="Bold" icon={BoldIcon} />);
    const icon = toggle.querySelector("svg")!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(toggle.textContent).toBe("Bold");
  });

  it("with hideLabel shows only the icon, in a square, and keeps the label as the name", async () => {
    const { toggle, host } = await render(
      <>
        <Toggle label="Bold" icon={BoldIcon} hideLabel />
        <Toggle label="Bold text" icon={BoldIcon} />
      </>,
    );
    expect(toggle.getAttribute("aria-label")).toBe("Bold");
    expect(toggle.textContent).toBe("");
    await expect.element(page.getByRole("button", { name: "Bold", exact: true })).toBeVisible();
    const rect = toggle.getBoundingClientRect();
    expect(Math.round(rect.width)).toBe(Math.round(rect.height));
    const labeled = host.querySelectorAll<HTMLElement>('[data-ouro="toggle"]')[1]!;
    expect(labeled.hasAttribute("aria-label")).toBe(false);
  });

  it("disables the toggle", async () => {
    const onPressedChange = vi.fn();
    const { toggle } = await render(<Toggle label="Bold" disabled onPressedChange={onPressedChange} />);
    expect(toggle.disabled).toBe(true);
    await userEvent.click(toggle, { force: true });
    expect(onPressedChange).not.toHaveBeenCalled();
    expect(getComputedStyle(toggle).opacity).toBe("0.5");
  });

  it("forwards its ref and button attributes", async () => {
    const ref = createRef<HTMLButtonElement>();
    const onClick = vi.fn();
    const { toggle } = await render(<Toggle label="Bold" ref={ref} title="Bold (Ctrl+B)" onClick={onClick} />);
    expect(ref.current).toBe(toggle);
    expect(toggle.title).toBe("Bold (Ctrl+B)");
    await userEvent.click(toggle);
    expect(onClick).toHaveBeenCalled();
  });

  it("lets app layout classes win", async () => {
    const { toggle } = await render(<Toggle label="Bold" className="mt-6" />);
    expect(getComputedStyle(toggle).marginTop).toBe("24px");
  });
});

describe("Toggle looks", () => {
  it("tints the pressed toggle with the primary color", async () => {
    const { host } = await render(
      <>
        <Toggle label="Off" />
        <Toggle label="On" defaultPressed />
      </>,
    );
    const [off, on] = [...host.querySelectorAll<HTMLElement>('[data-ouro="toggle"]')];
    expect(getComputedStyle(off!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(on!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(on!).color).not.toBe(getComputedStyle(off!).color);
  });

  it("draws a border with variant outline", async () => {
    const { host } = await render(
      <>
        <Toggle label="Plain" />
        <Toggle label="Outline" variant="outline" />
      </>,
    );
    const [plain, outline] = [...host.querySelectorAll<HTMLElement>('[data-ouro="toggle"]')];
    expect(getComputedStyle(plain!).borderTopColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(outline!).borderTopColor).not.toBe("rgba(0, 0, 0, 0)");
  });

  it("is 44px tall on phones and steps down with a fine pointer from sm, per size", async () => {
    await page.viewport(390, 844);
    const { host } = await render(
      <>
        <Toggle label="Small" size="sm" />
        <Toggle label="Medium" />
        <Toggle label="Large" size="lg" />
      </>,
    );
    const [sm, md, lg] = [...host.querySelectorAll<HTMLElement>('[data-ouro="toggle"]')];
    const heights = () => [sm!, md!, lg!].map((element) => element.getBoundingClientRect().height);
    expect(heights()).toEqual([36, 44, 48]);
    expect(getComputedStyle(md!).fontSize).toBe("16px");
    await page.viewport(1280, 800);
    await expect.poll(heights).toEqual([32, 36, 44]);
    expect(getComputedStyle(md!).fontSize).toBe("14px");
  });

  it("outlines on keyboard focus in the ring color", async () => {
    const { toggle, host } = await render(
      <>
        <Toggle label="Bold" />
        <i className="bg-ring" />
      </>,
    );
    document.body.focus();
    await pressTab();
    expect(document.activeElement).toBe(toggle);
    const style = getComputedStyle(toggle);
    expect(style.outlineStyle).toBe("solid");
    expect(style.outlineColor).toBe(getComputedStyle(host.querySelector("i")!).backgroundColor);
  });

  /** The toggle's scale once the press-in transition has finished. */
  async function pressScale(toggle: HTMLElement) {
    await commands.pointerPress({ selector: '[data-ouro="toggle"]', action: "down" });
    try {
      let last = "";
      await expect
        .poll(() => {
          const scale = getComputedStyle(toggle).scale;
          const still = scale === last && toggle.getAnimations().length === 0;
          last = scale;
          return still;
        }, { interval: 50 })
        .toBe(true);
      return last;
    } finally {
      await commands.pointerPress({ selector: '[data-ouro="toggle"]', action: "up" });
    }
  }

  it("scales to --ouro-press-scale while pressed", async () => {
    const { toggle } = await render(<Toggle label="Bold" />);
    expect(await pressScale(toggle)).toBe("0.97");
  });

  it("does not scale with reduced motion", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const { toggle } = await render(<Toggle label="Bold" />);
    expect(await pressScale(toggle)).toBe("none");
  });
});

describe("Toggle development messages", () => {
  it.each([
    ["children", { children: "Bold" }, "children is not a prop; the label is", '<Toggle label="Bold">'],
    ["isPressed", { isPressed: true }, "isPressed is not a prop", "<Toggle pressed>"],
    ["checked", { checked: true }, "checked is not a prop; a toggle is pressed", "<Toggle pressed>"],
    ["defaultChecked", { defaultChecked: true }, "defaultChecked is not a prop", "<Toggle defaultPressed>"],
    ["onCheckedChange", { onCheckedChange: () => {} }, "onCheckedChange is not a prop", "<Toggle onPressedChange={(pressed) => …}>"],
    ["onChange", { onChange: () => {} }, "onChange never fires on a toggle", "<Toggle onPressedChange={(pressed) => …}>"],
    ["selected", { selected: true }, "selected is not a prop", "<Toggle pressed>"],
    ["isSelected", { isSelected: true }, "isSelected is not a prop", "<Toggle pressed>"],
    ["active", { active: true }, "active is not a prop", "<Toggle pressed>"],
    ["startIcon", { startIcon: BoldIcon }, "startIcon is not a prop", "<Toggle icon={BoldIcon}>"],
    ["tone", { tone: "primary" }, "tone is not a prop; a pressed toggle uses the primary tint", '<Toggle variant="outline">'],
  ])("warns for %s with the fix", async (name, extra, problem, fix) => {
    const props = { label: "Bold", ...extra } as unknown as ToggleProps;
    const { host } = await render(<Toggle {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Toggle: ${problem}. Fix: ${fix}.`);
    for (const element of host.querySelectorAll("*")) expect(element.hasAttribute(name.toLowerCase())).toBe(false);
  });

  it.each([
    ["variant", "default", 'variant="default" is not a variant', "<Toggle>"],
    ["variant", "ghost", 'variant="ghost" is not a variant', "<Toggle>"],
    ["variant", "solid", 'variant="solid" is not a variant', '<Toggle variant="plain">'],
    ["size", "default", 'size="default" is not a size', '<Toggle size="md">'],
    ["size", "xl", 'size="xl" is not a size', '<Toggle size="md">'],
  ])("renders the default and warns for %s=%s", async (prop, value, problem, fix) => {
    const props = { label: "Bold", [prop]: value } as unknown as ToggleProps;
    const { toggle } = await render(<Toggle {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] Toggle: ${problem}. Fix: ${fix}.`);
    expect(toggle.className).toContain("border-transparent");
  });

  it("warns when hideLabel would leave the toggle empty", async () => {
    await render(<Toggle label="Bold" hideLabel />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Toggle: hideLabel leaves nothing to see without an icon. Fix: <Toggle label="Bold" icon={BoldIcon} hideLabel>.',
    );
  });

  it("warns when the label is empty", async () => {
    await render(<Toggle label="" />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Toggle: label is empty, so the toggle has no name. Fix: <Toggle label="Bold">.');
  });

  it("warns for appearance classes with the prop to use", async () => {
    await render(<Toggle label="Bold" className="bg-red-500" />);
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Toggle: "bg-red-500" sets appearance, and className is for layout only. Fix: <Toggle variant="outline">.',
    );
  });

  it("names the label from element children, and picks the fix from the class", async () => {
    const props = { label: "Bold", children: <b>Bold</b> } as unknown as ToggleProps;
    await render(<Toggle {...props} className="rounded-full text-lg" />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Toggle: children is not a prop; the label is. Fix: <Toggle label="Bold">.');
    expect(warn).toHaveBeenCalledWith(
      '[ouro-ui] Toggle: "rounded-full" sets appearance, and className is for layout only. Fix: :root { --radius: 999px }.',
    );
    await render(<Toggle label="Bold" className="text-lg" />);
    expect(warn).toHaveBeenCalledWith('[ouro-ui] Toggle: "text-lg" sets appearance, and className is for layout only. Fix: <Toggle size="lg">.');
  });

  it("says nothing for a full, valid toggle", async () => {
    await render(<Toggle label="Bold" icon={BoldIcon} hideLabel variant="outline" size="sm" defaultPressed className="mt-2" />);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("Toggle server rendering", () => {
  const node = (
    <div>
      <Toggle label="Bold" icon={BoldIcon} hideLabel defaultPressed />
      <Toggle label="Italic" />
    </div>
  );

  it("renders the name and pressed state on the server", () => {
    const doc = new DOMParser().parseFromString(renderToString(node), "text/html");
    const [bold, italic] = [...doc.querySelectorAll("button")];
    expect(bold!.getAttribute("aria-label")).toBe("Bold");
    expect(bold!.getAttribute("aria-pressed")).toBe("true");
    expect(italic!.getAttribute("aria-pressed")).toBe("false");
    expect(italic!.textContent).toBe("Italic");
  });

  it("hydrates with no warning and works", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const italic = host.querySelectorAll("button")[1]!;
    await userEvent.click(italic);
    expect(italic.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Toggle under more contrast", () => {
  it("gives the pressed look a visible border with prefers-contrast: more", async () => {
    const { toggle } = await render(<Toggle label="Bold" defaultPressed />);
    expect(getComputedStyle(toggle).borderTopColor).toBe("rgba(0, 0, 0, 0)");
    await commands.emulateMedia({ contrast: "more" });
    try {
      await expect.poll(() => getComputedStyle(toggle).borderTopColor).toBe(getComputedStyle(toggle).color);
    } finally {
      await commands.emulateMedia({ contrast: "no-preference" });
    }
  });
});
