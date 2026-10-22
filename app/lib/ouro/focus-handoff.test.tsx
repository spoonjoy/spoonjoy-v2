import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { handOffFocus, useFocusHandoff } from "~/lib/ouro/focus-handoff";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
const hosts: HTMLElement[] = [];

/** A host in the page holding `html`. */
function page(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  hosts.push(host);
  return host;
}

/** Focuses the button named `name`, then removes `element` as React would: hand off first, then remove. */
async function remove(element: Element, focus: HTMLElement | null) {
  focus?.focus();
  handOffFocus(element);
  element.remove();
  await Promise.resolve();
}

const button = (host: HTMLElement, name: string) => [...host.querySelectorAll("button")].find((element) => element.textContent === name)!;

afterEach(async () => {
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const host of hosts.splice(0)) host.remove();
});

describe("handOffFocus", () => {
  it("moves focus to the next control where the element stood", async () => {
    const host = page('<ul><li><button>a</button></li><li id="b"><button>b</button></li><li><button>c</button></li><li><button>d</button></li></ul>');
    await remove(host.querySelector("#b")!, button(host, "b"));
    expect(document.activeElement).toBe(button(host, "c"));
  });

  it("moves focus to the first control when the element had nothing before it", async () => {
    const host = page('<ul><li id="a"><button>a</button></li><li><button>b</button></li></ul>');
    await remove(host.querySelector("#a")!, button(host, "a"));
    expect(document.activeElement).toBe(button(host, "b"));
  });

  it("moves focus to the last control before it when nothing follows", async () => {
    const host = page('<ul><li><button>a</button></li><li><button>b</button></li><li id="c"><button>c</button></li></ul>');
    await remove(host.querySelector("#c")!, button(host, "c"));
    expect(document.activeElement).toBe(button(host, "b"));
  });

  it("skips controls that are hidden, inert or disabled", async () => {
    const host = page('<div><p id="gone"><button>gone</button></p><button hidden>hidden</button><div inert><button>inert</button></div><button disabled>disabled</button><button>next</button></div>');
    await remove(host.querySelector("#gone")!, button(host, "gone"));
    expect(document.activeElement).toBe(button(host, "next"));
  });

  it("looks one level up when the parent holds no other control, after the part that held the element", async () => {
    const host = page('<div><button>before</button><section><p id="gone"><button>gone</button></p></section><button>after</button></div>');
    await remove(host.querySelector("#gone")!, button(host, "gone"));
    expect(document.activeElement).toBe(button(host, "after"));
  });

  it("climbs no higher than `within`, then focuses `fallback`, or leaves focus on the page", async () => {
    const host = page('<button>origin</button><section id="region"><p id="gone"><button>gone</button></p></section><a href="#footer">footer</a>');
    const region = host.querySelector("#region")!;
    button(host, "gone").focus();
    handOffFocus(host.querySelector("#gone")!, { within: region, fallback: button(host, "origin") });
    host.querySelector("#gone")!.remove();
    await Promise.resolve();
    expect(document.activeElement).toBe(button(host, "origin"));

    region.innerHTML = '<p id="again"><button>again</button></p>';
    const detached = document.createElement("button");
    button(host, "again").focus();
    handOffFocus(host.querySelector("#again")!, { within: region, fallback: detached });
    host.querySelector("#again")!.remove();
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);

    region.innerHTML = '<p id="third"><button>third</button></p>';
    button(host, "third").focus();
    handOffFocus(host.querySelector("#third")!, { within: region });
    host.querySelector("#third")!.remove();
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves focus alone when the element does not hold it", async () => {
    const host = page('<div><p id="gone"><button>gone</button></p><button>other</button></div>');
    button(host, "other").focus();
    await remove(host.querySelector("#gone")!, null);
    expect(document.activeElement).toBe(button(host, "other"));
  });

  it("leaves focus alone once something else has taken it", async () => {
    const host = page('<div><p id="gone"><button>gone</button></p><button>next</button><button>chosen</button></div>');
    button(host, "gone").focus();
    handOffFocus(host.querySelector("#gone")!);
    host.querySelector("#gone")!.remove();
    button(host, "chosen").focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(button(host, "chosen"));
  });

  it("leaves focus to the app when the element's whole region left with it", async () => {
    const host = page('<section id="region"><p id="gone"><button>gone</button></p></section><button>elsewhere</button>');
    button(host, "gone").focus();
    handOffFocus(host.querySelector("#gone")!);
    host.querySelector("#region")!.remove();
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves focus on the page when no control is left anywhere", async () => {
    const host = page('<p id="gone"><button>gone</button></p>');
    const gone = host.querySelector("#gone")!;
    const others = [...document.body.children].filter((element) => element !== host) as HTMLElement[];
    for (const element of others) element.inert = true;
    try {
      await remove(gone, button(host, "gone"));
      expect(document.activeElement).toBe(document.body);
    } finally {
      for (const element of others) element.inert = false;
    }
  });
});

describe("useFocusHandoff", () => {
  it("hands focus to what replaced the element when React removes it", async () => {
    function Retry() {
      const [failed, setFailed] = useState(true);
      const handoff = useFocusHandoff<HTMLDivElement>();
      return (
        <div>
          {failed ? (
            <div ref={handoff}>
              <button onClick={() => setFailed(false)}>Try again</button>
            </div>
          ) : (
            <button>Saved</button>
          )}
        </div>
      );
    }
    const host = page("");
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<Retry />));
    button(host, "Try again").focus();
    await act(async () => button(host, "Try again").click());
    await expect.poll(() => document.activeElement).toBe(button(host, "Saved"));
  });

  it("gives React nothing to undo for a detached element", () => {
    let ref!: ReturnType<typeof useFocusHandoff>;
    function Probe() {
      ref = useFocusHandoff();
      return null;
    }
    const host = page("");
    const root = createRoot(host);
    roots.push(root);
    return act(async () => root.render(<Probe />)).then(() => expect(ref(null)).toBeUndefined());
  });
});
