import { useState, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { Switch, type SwitchProps } from "~/components/ouro/switch/switch";
import { Form, type FormErrors } from "~/components/ouro/form/form";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];

async function render(node: ReactNode) {
  const host = document.createElement("div");
  host.style.padding = "24px";
  host.style.maxWidth = "420px";
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return {
    host,
    rerender: (next: ReactNode) => act(async () => root.render(next)),
    get root() {
      return host.querySelector<HTMLElement>('[data-ouro="switch"]')!;
    },
    get track() {
      return host.querySelector<HTMLElement>('[role="switch"]')!;
    },
    get thumb() {
      return host.querySelector<HTMLElement>("[data-ouro-switch-thumb]")!;
    },
    get input() {
      return host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    },
    get label() {
      return host.querySelector<HTMLLabelElement>("label")!;
    },
  };
}

const describedBy = (element: Element) => (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);

/** A theme variable as the browser computes it, so the test holds under any shadcn theme. */
function themeColor(variable: string): string {
  const probe = document.createElement("div");
  probe.style.color = `var(${variable})`;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/** A color as sRGB 0-255 channels, composited over `under` when it is translucent. */
function rgb(color: string, under = "white"): [number, number, number] {
  const context = document.createElement("canvas").getContext("2d")!;
  context.fillStyle = under;
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!];
}

/** The WCAG contrast ratio of two opaque sRGB colors. */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const luminance = (channels: [number, number, number]) => {
    const [r, g, b] = channels.map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

/** Waits until the thumb's running transitions settle, so its box is final. */
const settled = (element: Element) => Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {})));

/** A Form whose errors arrive when "Fail" is clicked, as a server action's result does. */
function Arriving({ errors, children }: { errors: FormErrors; children: ReactNode }) {
  const [shown, setShown] = useState<FormErrors | undefined>();
  return (
    <Form errors={shown}>
      <button type="button" onClick={() => setShown(errors)}>
        Fail
      </button>
      {children}
    </Form>
  );
}
const fail = () => userEvent.click(page.getByRole("button", { name: "Fail" }));

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

describe("Switch", () => {
  it("is a switch named by its label, with the label to its right", async () => {
    const { root, track, label } = await render(<Switch label="Wi-Fi" />);
    expect(root).not.toBeNull();
    await expect.element(page.getByRole("switch", { name: "Wi-Fi" })).not.toBeChecked();
    expect(label.getBoundingClientRect().left).toBeGreaterThan(track.getBoundingClientRect().right);
  });

  it("toggles with Space, and with a click on the track or the label", async () => {
    const onCheckedChange = vi.fn();
    const { track, label } = await render(<Switch label="Wi-Fi" onCheckedChange={onCheckedChange} />);
    track.focus();
    await userEvent.keyboard(" ");
    expect(track.getAttribute("aria-checked")).toBe("true");
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(label);
    expect(track.getAttribute("aria-checked")).toBe("false");
    await userEvent.click(track);
    expect(track.getAttribute("aria-checked")).toBe("true");
    expect(onCheckedChange).toHaveBeenCalledTimes(3);
  });

  it("follows a controlled checked value", async () => {
    function Controlled() {
      const [on, setOn] = useState(true);
      return (
        <>
          <Switch label="Wi-Fi" checked={on} onCheckedChange={setOn} />
          <output>{String(on)}</output>
        </>
      );
    }
    const { track, host } = await render(<Controlled />);
    await userEvent.click(track);
    expect(host.querySelector("output")!.textContent).toBe("false");
  });

  it("submits name=value with its form when on", async () => {
    const { host, track } = await render(
      <form>
        <Switch label="Wi-Fi" name="wifi" />
        <Switch label="Bluetooth" name="bluetooth" value="yes" defaultChecked />
      </form>,
    );
    const form = host.querySelector("form")!;
    expect([...new FormData(form)]).toEqual([["bluetooth", "yes"]]);
    await userEvent.click(track);
    expect([...new FormData(form)]).toEqual([
      ["wifi", "on"],
      ["bluetooth", "yes"],
    ]);
  });

  it("describes the switch with its description and error, and marks it invalid", async () => {
    const { track } = await render(<Switch label="Backups" description="Every night." error="Turn on backups to continue." required />);
    expect(describedBy(track).map((id) => document.getElementById(id)!.textContent)).toEqual(["Every night.", "Turn on backups to continue."]);
    expect(track.getAttribute("aria-invalid")).toBe("true");
    expect(track.getAttribute("aria-required")).toBe("true");
  });

  it("disables the switch and fades it", async () => {
    const onCheckedChange = vi.fn();
    const { track, input } = await render(<Switch label="Wi-Fi" disabled onCheckedChange={onCheckedChange} />);
    expect(input.disabled).toBe(true);
    expect(getComputedStyle(track).opacity).toBe("0.5");
    await userEvent.click(track, { force: true });
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("forwards ref to the track", async () => {
    let element: HTMLElement | null = null;
    const { track } = await render(<Switch label="Wi-Fi" ref={(node) => void (element = node)} />);
    expect(element).toBe(track);
  });
});

describe("Switch in a Form", () => {
  it("shows a Form error for its name without blocking the form, and drops it once flipped", async () => {
    const { host, track } = await render(
      <Form errors={{ backups: "Backups must be on." }}>
        <Switch label="Nightly backups" name="backups" />
      </Form>,
    );
    expect(track.getAttribute("aria-invalid")).toBe("true");
    expect(describedBy(track).map((id) => document.getElementById(id)?.textContent)).toEqual(["Backups must be on."]);
    expect(host.querySelector("form")!.checkValidity()).toBe(true);
    await userEvent.click(track);
    await expect.poll(() => track.getAttribute("aria-invalid")).toBeNull();
    expect(describedBy(track)).toEqual([]);
  });
});

describe("Switch focus when Form errors arrive", () => {
  it("takes focus, unless it is disabled", async () => {
    const { host } = await render(
      <Arriving errors={{ offline: "Not available.", backups: "Backups must be on." }}>
        <Switch label="Offline mode" name="offline" disabled />
        <Switch label="Nightly backups" name="backups" />
      </Arriving>,
    );
    await fail();
    const [offline, backups] = [...host.querySelectorAll<HTMLElement>('[role="switch"]')];
    expect(offline!.getAttribute("aria-invalid")).toBe("true");
    await expect.poll(() => document.activeElement).toBe(backups);
  });
});

describe("Switch look and motion", () => {
  it("tells on from off without hue, with an off outline at 3:1 against the page, in light and dark", async () => {
    const measured: Record<string, number[]> = {};
    for (const scheme of ["light", "dark"] as const) {
      document.documentElement.classList.toggle("dark", scheme === "dark");
      try {
        const { host } = await render(
          <>
            <Switch label="Off" />
            <Switch label="On" defaultChecked />
          </>,
        );
        const [off, on] = [...host.querySelectorAll<HTMLElement>('[role="switch"]')];
        const [offThumb, onThumb] = [...host.querySelectorAll<HTMLElement>("[data-ouro-switch-thumb]")];
        await Promise.all([settled(off!), settled(on!), settled(offThumb!), settled(onThumb!)]);
        const page = rgb(themeColor("--background"));
        const over = `rgb(${page.join(",")})`;
        const offStyle = getComputedStyle(off!);
        // Off is an outline: its border is the boundary WCAG 1.4.11 asks to stand out.
        expect(Number.parseFloat(offStyle.borderTopWidth)).toBeGreaterThan(0);
        expect(contrast(rgb(offStyle.borderTopColor, over), page)).toBeGreaterThanOrEqual(3);
        // On is a solid fill that differs from the off fill by lightness, not only hue.
        const offFill = rgb(offStyle.backgroundColor, over);
        const onFill = rgb(getComputedStyle(on!).backgroundColor, over);
        expect(contrast(onFill, offFill)).toBeGreaterThanOrEqual(3);
        // And the thumbs differ too.
        expect(rgb(getComputedStyle(offThumb!).backgroundColor, over)).not.toEqual(rgb(getComputedStyle(onThumb!).backgroundColor, over));
        measured[scheme] = page;
      } finally {
        document.documentElement.classList.remove("dark");
      }
      await act(async () => roots.splice(0).forEach((root) => root.unmount()));
    }
    // The dark run measured the dark theme, not the light one twice.
    expect(measured.dark).not.toEqual(measured.light);
  });

  it("fills the track with the primary color and moves the thumb to the end when on", async () => {
    const { track, thumb } = await render(<Switch label="Wi-Fi" />);
    const offLeft = thumb.getBoundingClientRect().left - track.getBoundingClientRect().left;
    await userEvent.click(track);
    await settled(thumb);
    expect(getComputedStyle(track).backgroundColor).toBe(themeColor("--primary"));
    const trackBox = track.getBoundingClientRect();
    const thumbBox = thumb.getBoundingClientRect();
    expect(thumbBox.left - trackBox.left).toBeGreaterThan(offLeft);
    expect(trackBox.right - thumbBox.right).toBeCloseTo(offLeft, 0);
  });

  it("widens the thumb toward its travel while the pointer is down", async () => {
    const { track, thumb } = await render(<Switch label="Wi-Fi" />);
    await settled(thumb);
    const rest = thumb.getBoundingClientRect();
    await commands.pointerPress({ selector: '[role="switch"]', action: "down" });
    await settled(thumb);
    const pressed = thumb.getBoundingClientRect();
    expect(pressed.width).toBeGreaterThan(rest.width);
    // Off, it travels right: the left edge stays and the thumb grows to the right.
    expect(pressed.left).toBeCloseTo(rest.left, 0);
    await commands.pointerPress({ selector: '[role="switch"]', action: "up" });
    await settled(thumb);
    expect(track.getAttribute("aria-checked")).toBe("true");

    // On, it travels left: the right edge stays and the thumb grows to the left.
    const on = thumb.getBoundingClientRect();
    expect(on.width).toBeCloseTo(rest.width, 0);
    await commands.pointerPress({ selector: '[role="switch"]', action: "down" });
    await settled(thumb);
    const pressedOn = thumb.getBoundingClientRect();
    expect(pressedOn.width).toBeGreaterThan(on.width);
    expect(pressedOn.right).toBeCloseTo(on.right, 0);
    await commands.pointerPress({ selector: '[role="switch"]', action: "up" });
  });

  it("does not stretch or slide with reduced motion", async () => {
    await commands.emulateMedia({ reducedMotion: "reduce" });
    const { thumb } = await render(<Switch label="Wi-Fi" />);
    const rest = thumb.getBoundingClientRect();
    expect(getComputedStyle(thumb).transitionProperty).not.toMatch(/translate|width/);
    await commands.pointerPress({ selector: '[role="switch"]', action: "down" });
    expect(thumb.getBoundingClientRect().width).toBe(rest.width);
    await commands.pointerPress({ selector: '[role="switch"]', action: "up" });
  });

  it("does not stretch while disabled", async () => {
    const { thumb } = await render(<Switch label="Wi-Fi" disabled />);
    const rest = thumb.getBoundingClientRect();
    await commands.pointerPress({ selector: '[role="switch"]', action: "down" });
    await settled(thumb);
    expect(thumb.getBoundingClientRect().width).toBe(rest.width);
    await commands.pointerPress({ selector: '[role="switch"]', action: "up" });
  });

  it("steps down to desktop size with a fine pointer from sm, centered on the label's first line", async () => {
    await page.viewport(1280, 800);
    const { track, label } = await render(<Switch label="Wi-Fi" />);
    expect(track.getBoundingClientRect().height).toBe(20);
    expect(getComputedStyle(label).fontSize).toBe("14px");
    const center = track.getBoundingClientRect().top + 10 - label.getBoundingClientRect().top;
    expect(center).toBeCloseTo(parseFloat(getComputedStyle(label).lineHeight) / 2, 0);
  });
});

describe("Switch development messages", () => {
  const messages = () => warn.mock.calls.map((call: unknown[]) => String(call[0]));

  it("names the real prop for guessed ones", async () => {
    const guesses = {
      onChange: () => {},
      isChecked: true,
      defaultValue: true,
      errorMessage: "Required.",
      isDisabled: true,
    } as unknown as Partial<SwitchProps>;
    await render(<Switch label="Wi-Fi" {...guesses} />);
    expect(messages()).toEqual([
      '[ouro-ui] Switch: errorMessage is not a prop. Fix: <Switch error="Required.">.',
      "[ouro-ui] Switch: isDisabled is not a prop. Fix: <Switch disabled>.",
      "[ouro-ui] Switch: onChange is not a prop; onCheckedChange gets the new state. Fix: <Switch onCheckedChange={(checked) => setOn(checked)}>.",
      "[ouro-ui] Switch: isChecked is not a prop. Fix: <Switch checked={true}>.",
      "[ouro-ui] Switch: defaultValue is not a prop; a switch starts on with defaultChecked. Fix: <Switch defaultChecked>.",
    ]);
  });

  it("names Switch for a missing label", async () => {
    const { root } = await render(<Switch {...({} as SwitchProps)} />);
    expect(root.getAttribute("data-ouro")).toBe("switch");
    expect(messages()).toContain('[ouro-ui] Switch: label is missing, so the control has no name. Fix: <Switch label="Email" hideLabel> to hide a label you still need.');
  });

  it("warns when checked has no onCheckedChange", async () => {
    await render(<Switch label="Wi-Fi" checked />);
    expect(messages()).toEqual([
      "[ouro-ui] Switch: checked without onCheckedChange never changes. Fix: <Switch checked={on} onCheckedChange={setOn}>, or defaultChecked.",
    ]);
  });

  it("has no messages for valid props", async () => {
    await render(<Switch label="Wi-Fi" name="wifi" value="on" description="Faster." error="Required." required defaultChecked readOnly className="mt-4" />);
    expect(messages()).toEqual([]);
  });
});

describe("Switch on the server", () => {
  const node = <Switch label="Backups" name="backups" description="Every night." error="Turn on backups." defaultChecked />;

  it("renders the name, description, error and state in the server HTML", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = new DOMParser().parseFromString(renderToString(node), "text/html");
    const track = doc.querySelector('[role="switch"]')!;
    expect(describedBy(track).map((id) => doc.getElementById(id)!.textContent)).toEqual(["Every night.", "Turn on backups."]);
    expect(doc.getElementById(track.getAttribute("aria-labelledby")!)!.textContent).toBe("Backups");
    expect(track.getAttribute("aria-checked")).toBe("true");
    expect(track.getAttribute("aria-invalid")).toBe("true");
    expect(error).not.toHaveBeenCalled();
  });

  it("hydrates with the same ids and no hydration warning", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(node);
    document.body.append(host);
    mounted.push(host);
    const snapshot = () =>
      [...host.querySelectorAll("*")].map((el) => [
        el.tagName,
        el.id,
        el.getAttribute("for"),
        el.getAttribute("aria-labelledby"),
        el.getAttribute("aria-hidden") === "true" ? null : el.getAttribute("aria-describedby"),
      ]);
    const before = snapshot();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const recoverable = vi.fn();
    let root!: Root;
    await act(async () => {
      root = hydrateRoot(host, node, { onRecoverableError: recoverable });
    });
    roots.push(root);
    expect(snapshot()).toEqual(before);
    expect(recoverable).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const track = host.querySelector<HTMLElement>('[role="switch"]')!;
    await userEvent.click(track);
    expect(track.getAttribute("aria-checked")).toBe("false");
  });
});
