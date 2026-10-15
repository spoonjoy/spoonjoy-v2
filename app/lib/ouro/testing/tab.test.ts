import { afterEach, describe, expect, it } from "vitest";
import { pressTab } from "~/lib/ouro/testing/tab";

// In WebKit on a Mac with the system's "Keyboard navigation" setting off, plain Tab goes from
// the first text field straight to the last one. These pass there too.

afterEach(() => {
  document.body.innerHTML = "";
});

function mount() {
  document.body.innerHTML =
    '<input aria-label="First"><button type="button">Button</button><a href="#top">Link</a><span role="radio" aria-checked="false" tabindex="0">Radio</span><input aria-label="Last">';
  return [...document.body.children] as HTMLElement[];
}

describe("pressTab", () => {
  it("moves focus to the next tab stop: a button, a link and a control with a tabindex", async () => {
    const [first, button, link, radio, last] = mount();
    first!.focus();
    await pressTab();
    expect(document.activeElement).toBe(button);
    await pressTab();
    expect(document.activeElement).toBe(link);
    await pressTab();
    expect(document.activeElement).toBe(radio);
    await pressTab();
    expect(document.activeElement).toBe(last);
  });

  it("moves focus back with shift", async () => {
    const [, button, link, radio, last] = mount();
    last!.focus();
    await pressTab({ shift: true });
    expect(document.activeElement).toBe(radio);
    await pressTab({ shift: true });
    expect(document.activeElement).toBe(link);
    await pressTab({ shift: true });
    expect(document.activeElement).toBe(button);
  });
});
