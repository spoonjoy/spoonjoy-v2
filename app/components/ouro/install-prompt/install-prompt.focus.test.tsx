import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { InstallPrompt, type InstallPromptProps } from "~/components/ouro/install-prompt/install-prompt";
import { act } from "~/lib/ouro/testing/act";
import { pressTab } from "~/lib/ouro/testing/tab";

// Where focus goes when the card goes away. Its own file, because the browser's offer is kept
// for the whole page, and the main file's last tests install the app, which ends every offer.

const roots: Root[] = [];
let mounted: Element[] = [];

/** Fires the browser's install event, with a dialog that answers "dismissed". */
function offer() {
  window.dispatchEvent(
    Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({ outcome: "dismissed" }),
    }),
  );
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
    root,
    part: (name: "install" | "dismiss") => host.querySelector<HTMLButtonElement>(`[data-ouro-control="install-prompt"][data-ouro-part="${name}"]`)!,
  };
}

afterEach(async () => {
  localStorage.removeItem("ouro-install-dismissed");
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

describe("InstallPrompt focus", () => {
  /** The card between two controls of the page's own, as it sits in a layout. */
  const layout = (props: InstallPromptProps = {}, { before = true, after = true } = {}) => (
    <>
      {before ? (
        <button type="button" data-test-harness="before">
          Before
        </button>
      ) : null}
      <InstallPrompt {...props} />
      {after ? (
        <button type="button" data-test-harness="after">
          After
        </button>
      ) : null}
    </>
  );
  const harness = (host: HTMLElement, name: "before" | "after") => host.querySelector<HTMLButtonElement>(`[data-test-harness="${name}"]`)!;

  it.each(["dismiss", "install"] as const)("returns focus to where it came from when %s, pressed from the keyboard, takes the card away", async (name) => {
    offer();
    const { host, part } = await render(layout());
    harness(host, "before").focus();
    await pressTab();
    expect(document.activeElement).toBe(part("dismiss"));
    if (name === "install") await pressTab();
    expect(document.activeElement).toBe(part(name));
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => host.querySelector('[data-ouro="install-prompt"]')).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(harness(host, "before"));
  });

  it("moves focus to the next control when focus came from nowhere", async () => {
    offer();
    const { host, part } = await render(layout());
    document.body.focus();
    part("dismiss").focus();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(harness(host, "after"));
  });

  it("moves focus to the next control when the one it came from is gone", async () => {
    offer();
    const { host, root, part } = await render(layout());
    harness(host, "before").focus();
    part("dismiss").focus();
    await act(async () => root.render(layout({}, { before: false })));
    expect(document.activeElement).toBe(part("dismiss"));
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(harness(host, "after"));
  });

  it("moves focus to the control before the card when none it can reach follows it", async () => {
    offer();
    const { host, part } = await render(
      <>
        {layout({}, { after: false })}
        <button type="button" hidden data-test-harness="hidden">
          Hidden
        </button>
      </>,
    );
    document.body.focus();
    part("dismiss").focus();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(harness(host, "before"));
  });

  it("leaves focus to the page when the page has no other control", async () => {
    offer();
    const { host, part } = await render(<InstallPrompt />);
    part("dismiss").focus();
    await userEvent.keyboard("{Enter}");
    expect(host.innerHTML).toBe("");
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves focus where it is when the card goes away without it", async () => {
    offer();
    const { host, part } = await render(layout());
    harness(host, "after").focus();
    await act(async () => part("dismiss").click());
    expect(document.activeElement).toBe(harness(host, "after"));
  });

  it("does not move focus when it unmounts with focus on the card", async () => {
    offer();
    const { host, root, part } = await render(layout());
    harness(host, "before").focus();
    part("install").focus();
    await act(async () => root.render(null));
    expect(document.activeElement).toBe(document.body);
    expect(host.innerHTML).toBe("");
  });
});
