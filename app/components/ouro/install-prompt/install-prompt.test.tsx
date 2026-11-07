import { type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { InstallPrompt, type InstallPromptProps } from "~/components/ouro/install-prompt/install-prompt";
import { act } from "~/lib/ouro/testing/act";

// The browser's offer is kept for the whole page, so each test uses up the offer it makes.

const roots: Root[] = [];
let mounted: Element[] = [];

/** Fires the browser's install event, with a dialog that answers `outcome`. */
function offer(outcome: "accepted" | "dismissed" = "dismissed") {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome }),
  });
  window.dispatchEvent(event);
  return event;
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
    get prompt() {
      return host.querySelector<HTMLElement>('[data-ouro="install-prompt"]');
    },
    part: (name: "install" | "dismiss") => host.querySelector<HTMLButtonElement>(`[data-ouro-control="install-prompt"][data-ouro-part="${name}"]`)!,
  };
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.removeItem("ouro-install-dismissed");
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

describe("InstallPrompt", () => {
  it("renders nothing until the browser offers to install", async () => {
    const { host } = await render(<InstallPrompt />);
    expect(host.innerHTML).toBe("");
  });

  it("shows a card with the offer, Not now and Install once the browser offers", async () => {
    const { prompt, part } = await render(<InstallPrompt />);
    expect(prompt).toBeNull();
    await act(async () => void offer());
    await expect.element(page.getByRole("heading", { level: 2, name: "Install the app" })).toBeVisible();
    await expect.element(page.getByText("Add it to your home screen or dock and open it like any other app.")).toBeVisible();
    expect(part("install").textContent).toBe("Install");
    expect(part("dismiss").textContent).toBe("Not now");
    expect(part("install").compareDocumentPosition(part("dismiss")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    await userEvent.click(part("install"));
  });

  it("opens the browser's install dialog on Install, calls onInstall, and goes away", async () => {
    const onInstall = vi.fn();
    const event = offer("dismissed");
    const { host, part } = await render(<InstallPrompt onInstall={onInstall} />);
    await userEvent.click(part("install"));
    await expect.poll(() => onInstall.mock.calls).toEqual([["dismissed"]]);
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(host.innerHTML).toBe("");
  });

  it("opens the dialog once when Install is pressed twice before it goes away", async () => {
    const onInstall = vi.fn();
    const event = offer("dismissed");
    const { part } = await render(<InstallPrompt onInstall={onInstall} />);
    const install = part("install");
    await act(async () => {
      install.click();
      install.click();
    });
    await expect.poll(() => onInstall.mock.calls.length).toBe(1);
    expect(event.prompt).toHaveBeenCalledOnce();
  });

  it("goes away on Not now and stays away on the next visit", async () => {
    offer();
    const { host, part } = await render(<InstallPrompt />);
    await userEvent.click(part("dismiss"));
    expect(host.innerHTML).toBe("");
    const again = await render(<InstallPrompt />);
    expect(again.prompt).toBeNull();
    const sooner = await render(<InstallPrompt remindAfterDays={0} />);
    await userEvent.click(sooner.part("install"));
  });

  it("takes its own words, a picture, a heading level and a storage key", async () => {
    localStorage.setItem("ouro-install-dismissed", String(Date.now()));
    offer();
    const { host, part } = await render(
      <InstallPrompt
        title="Take Field Notes offline"
        description="Install it to read your notes without a connection."
        media={<img alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-testid="shot" />}
        installLabel="Add to home screen"
        dismissLabel="Maybe later"
        headingLevel={3}
        storageKey="notes-install"
      />,
    );
    await expect.element(page.getByRole("heading", { level: 3, name: "Take Field Notes offline" })).toBeVisible();
    expect(host.querySelector('[data-testid="shot"]')).not.toBeNull();
    expect(part("dismiss").textContent).toBe("Maybe later");
    await userEvent.click(part("install"));
    expect(host.textContent).not.toContain("Add to home screen");
  });

  it("lets app layout classes win", async () => {
    offer();
    const { prompt, part } = await render(<InstallPrompt className="mt-6 max-w-sm" />);
    expect(getComputedStyle(prompt!).marginTop).toBe("24px");
    expect(getComputedStyle(prompt!).maxWidth).toBe("384px");
    await userEvent.click(part("install"));
  });

  it("calls onInstall with accepted when the person installs, and stays away", async () => {
    const onInstall = vi.fn();
    offer("accepted");
    const { host, part } = await render(<InstallPrompt onInstall={onInstall} />);
    await userEvent.click(part("install"));
    await expect.poll(() => onInstall.mock.calls).toEqual([["accepted"]]);
    await act(async () => void offer());
    expect(host.innerHTML).toBe("");
  });
});

describe("InstallPrompt development messages", () => {
  it.each([
    ["open", { open: true }, "open is not a prop; the offer shows itself when the app can be installed", "<InstallPrompt />"],
    ["onAccept", { onAccept: () => {} }, "onAccept is not a prop", "<InstallPrompt onInstall={(outcome) => {}} />"],
  ])("explains %s with the fix", async (_name, props, problem, fix) => {
    await render(<InstallPrompt {...(props as unknown as InstallPromptProps)} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] InstallPrompt: ${problem}. Fix: ${fix}.`);
  });

  it.each([
    ["bg-card", 'remove "bg-card"; InstallPrompt sets its own look from the theme'],
    ["mt-6", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<InstallPrompt className={className} />);
    if (fix) expect(warn).toHaveBeenCalledWith(`[ouro-ui] InstallPrompt: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    else expect(warn).not.toHaveBeenCalled();
  });

  it("renders nothing on the server, where no offer can have come", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(renderToString(<InstallPrompt />)).toBe("");
    expect(error).not.toHaveBeenCalled();
  });
});
