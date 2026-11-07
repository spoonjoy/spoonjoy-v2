import { type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commands } from "vitest/browser";
import { colorSchemeScript } from "~/lib/ouro/color-scheme-script";
import { ColorSchemeProvider, useColorScheme, type ColorSchemeValue } from "~/lib/ouro/color-scheme";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];
const html = document.documentElement;

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return root;
}

/** Reads the hook into `seen`, the latest value last. */
function Probe({ seen }: { seen: ColorSchemeValue[] }) {
  seen.push(useColorScheme());
  return null;
}

const dark = () => html.classList.contains("dark");

afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
  for (const key of ["ouro-color-scheme", "app-theme", "private"]) localStorage.removeItem(key);
  html.classList.remove("dark");
  html.style.colorScheme = "";
  await commands.emulateMedia({ colorScheme: "light" });
});

describe("ColorSchemeProvider", () => {
  it("applies the system's scheme by default and follows it live", async () => {
    await commands.emulateMedia({ colorScheme: "dark" });
    const seen: ColorSchemeValue[] = [];
    await render(
      <ColorSchemeProvider>
        <Probe seen={seen} />
      </ColorSchemeProvider>,
    );
    expect(dark()).toBe(true);
    expect(html.style.colorScheme).toBe("dark");
    expect(seen.at(-1)).toMatchObject({ scheme: "system", resolved: "dark" });
    await commands.emulateMedia({ colorScheme: "light" });
    await expect.poll(dark).toBe(false);
    expect(seen.at(-1)).toMatchObject({ scheme: "system", resolved: "light" });
  });

  it("applies a kept choice, and keeps a new one", async () => {
    localStorage.setItem("ouro-color-scheme", "dark");
    const seen: ColorSchemeValue[] = [];
    await render(
      <ColorSchemeProvider>
        <Probe seen={seen} />
      </ColorSchemeProvider>,
    );
    expect(dark()).toBe(true);
    await act(async () => seen.at(-1)!.setScheme("light"));
    expect(dark()).toBe(false);
    expect(localStorage.getItem("ouro-color-scheme")).toBe("light");
    expect(seen.at(-1)).toMatchObject({ scheme: "light", resolved: "light" });
  });

  it("takes the app's key and default", async () => {
    localStorage.setItem("ouro-color-scheme", "dark");
    const seen: ColorSchemeValue[] = [];
    await render(
      <ColorSchemeProvider storageKey="app-theme" defaultScheme="light">
        <Probe seen={seen} />
      </ColorSchemeProvider>,
    );
    expect(seen.at(-1)).toMatchObject({ scheme: "light", resolved: "light" });
    expect(dark()).toBe(false);
    await act(async () => seen.at(-1)!.setScheme("dark"));
    expect(localStorage.getItem("app-theme")).toBe("dark");
    expect(localStorage.getItem("ouro-color-scheme")).toBe("dark");
  });

  it("ignores a kept value that is no scheme", async () => {
    localStorage.setItem("ouro-color-scheme", "sepia");
    const seen: ColorSchemeValue[] = [];
    await render(
      <ColorSchemeProvider defaultScheme="dark">
        <Probe seen={seen} />
      </ColorSchemeProvider>,
    );
    expect(seen.at(-1)!.scheme).toBe("dark");
  });

  it("follows a choice made in another tab", async () => {
    const seen: ColorSchemeValue[] = [];
    await render(
      <ColorSchemeProvider>
        <Probe seen={seen} />
      </ColorSchemeProvider>,
    );
    localStorage.setItem("ouro-color-scheme", "dark");
    await act(async () => window.dispatchEvent(new StorageEvent("storage", { key: "ouro-color-scheme", newValue: "dark" })));
    expect(dark()).toBe(true);
    expect(seen.at(-1)!.scheme).toBe("dark");
  });

  it("keeps the head script's dark class through hydration", async () => {
    localStorage.setItem("ouro-color-scheme", "dark");
    const page = (
      <ColorSchemeProvider>
        <p>Page</p>
      </ColorSchemeProvider>
    );
    const host = document.createElement("div");
    host.innerHTML = renderToString(page);
    document.body.append(host);
    mounted.push(host);
    new Function(colorSchemeScript())();
    expect(dark()).toBe(true);
    const classes: (string | null)[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) classes.push(record.oldValue);
    });
    observer.observe(html, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
    await act(async () => {
      roots.push(hydrateRoot(host, page));
    });
    classes.push(...observer.takeRecords().map((record) => record.oldValue));
    observer.disconnect();
    classes.push(html.getAttribute("class"));
    // Every class value <html> held during hydration, the first one the script's.
    expect(classes.filter((value) => !value?.split(" ").includes("dark"))).toEqual([]);
    expect(html.style.colorScheme).toBe("dark");
  });

  it("renders the default on the server", () => {
    const seen: ColorSchemeValue[] = [];
    const markup = renderToString(
      <ColorSchemeProvider defaultScheme="dark">
        <Probe seen={seen} />
        <p>Page</p>
      </ColorSchemeProvider>,
    );
    expect(markup).toBe("<p>Page</p>");
    expect(seen.at(-1)).toMatchObject({ scheme: "dark", resolved: "dark" });
  });
});

describe("useColorScheme", () => {
  it("switches the page without a provider, and every reader agrees", async () => {
    const first: ColorSchemeValue[] = [];
    const second: ColorSchemeValue[] = [];
    await render(
      <>
        <Probe seen={first} />
        <Probe seen={second} />
      </>,
    );
    expect(first.at(-1)).toMatchObject({ scheme: "system", resolved: "light" });
    await act(async () => first.at(-1)!.setScheme("dark"));
    expect(dark()).toBe(true);
    expect(second.at(-1)).toMatchObject({ scheme: "dark", resolved: "dark" });
    await commands.emulateMedia({ colorScheme: "dark" });
    await act(async () => first.at(-1)!.setScheme("system"));
    expect(dark()).toBe(true);
    expect(second.at(-1)).toMatchObject({ scheme: "system", resolved: "dark" });
  });

  it("keeps the choice in memory where the browser refuses localStorage", async () => {
    const denied = () => {
      throw new DOMException("denied", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);
    const seen: ColorSchemeValue[] = [];
    await render(
      <ColorSchemeProvider storageKey="private">
        <Probe seen={seen} />
      </ColorSchemeProvider>,
    );
    expect(seen.at(-1)!.scheme).toBe("system");
    await act(async () => seen.at(-1)!.setScheme("dark"));
    expect(seen.at(-1)!.scheme).toBe("dark");
    expect(dark()).toBe(true);
  });
});
