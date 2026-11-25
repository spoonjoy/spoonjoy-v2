import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "~/components/ouro/button/button";
import { commands } from "vitest/browser";
import { act } from "~/lib/ouro/testing/act";

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

async function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(node));
  return host.querySelector<HTMLElement>('[data-ouro="button"]')!;
}

describe("Button glass", () => {
  it("is 40px tall, and a circle when it holds only an icon", async () => {
    const button = await mount(
      <Button variant="glass" aria-label="Back">
        <svg aria-hidden="true" viewBox="0 0 24 24" />
      </Button>,
    );
    const { width, height } = button.getBoundingClientRect();
    expect(height).toBe(40);
    expect(width).toBe(40);
  });

  it("is 36px tall at size sm, and a 36 circle when it holds only an icon, while the default stays 40", async () => {
    const icon = await mount(
      <Button variant="glass" size="sm" aria-label="Back">
        <svg aria-hidden="true" viewBox="0 0 24 24" />
      </Button>,
    );
    expect(icon.getBoundingClientRect().height).toBe(36);
    expect(icon.getBoundingClientRect().width).toBe(36);
    const labelled = await mount(
      <Button variant="glass" size="sm">
        Filters
      </Button>,
    );
    expect(labelled.getBoundingClientRect().height).toBe(36);
    const base = await mount(<Button variant="glass">Filters</Button>);
    expect(base.getBoundingClientRect().height).toBe(40);
  });

  it("holds its pressed layer while the popup it opened is open", async () => {
    const button = await mount(
      <Button variant="glass" aria-expanded="true">
        Filters
      </Button>,
    );
    await expect.poll(() => getComputedStyle(button, "::before").opacity).not.toBe("0");
  });

  it("rests with no pressed layer while its popup is closed", async () => {
    const button = await mount(
      <Button variant="glass" aria-expanded="false">
        Filters
      </Button>,
    );
    expect(getComputedStyle(button, "::before").opacity).toBe("0");
  });

  it("is a translucent capsule with a rim, rounded to the full height", async () => {
    const button = await mount(
      <Button variant="glass" aria-label="Back">
        <svg aria-hidden="true" viewBox="0 0 24 24" />
      </Button>,
    );
    const style = getComputedStyle(button);
    expect(style.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.backgroundColor).not.toMatch(/^rgb\(/);
    expect(style.borderTopColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(Number.parseFloat(style.borderTopLeftRadius)).toBeGreaterThanOrEqual(20);
  });

  it("draws solid and unblurred under more contrast", async () => {
    await commands.emulateMedia({ contrast: "more" });
    try {
      const button = await mount(<Button variant="glass">Filters</Button>);
      expect(getComputedStyle(button).backdropFilter).toBe("none");
    } finally {
      await commands.emulateMedia({ contrast: "no-preference" });
    }
  });
});
