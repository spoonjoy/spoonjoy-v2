"use client";

import { createContext, createElement, useCallback, useContext, useLayoutEffect, useMemo, useSyncExternalStore, type JSX, type ReactNode } from "react";
import {
  COLOR_SCHEME_DEFAULTS,
  type ColorScheme,
  type ColorSchemeOptions,
  type ResolvedColorScheme,
} from "~/lib/ouro/color-scheme-script";

export type { ColorScheme, ColorSchemeOptions, ResolvedColorScheme } from "~/lib/ouro/color-scheme-script";

/** What `useColorScheme` returns. */
export interface ColorSchemeValue {
  /** The person's choice: `light`, `dark` or `system`. */
  scheme: ColorScheme;
  /** The scheme the page shows: `system` resolved through the system's setting. */
  resolved: ResolvedColorScheme;
  /** Keeps a new choice and applies it to the page at once. */
  setScheme: (scheme: ColorScheme) => void;
}

/** Props for {@link ColorSchemeProvider}. */
export interface ColorSchemeProviderProps extends ColorSchemeOptions {
  /** Your app, or the part of it that shows the scheme. */
  children: ReactNode;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";
const schemes: readonly string[] = ["light", "dark", "system"];

/** The provider's options, for `useColorScheme`. */
const ColorSchemeContext = createContext<{ storageKey: string; defaultScheme: ColorScheme }>(COLOR_SCHEME_DEFAULTS);

/** Choices kept in memory, for a browser that refuses localStorage (a private window), so it still switches. */
const memory = new Map<string, ColorScheme>();
const listeners = new Set<() => void>();

function stored(key: string, fallback: ColorScheme): ColorScheme {
  let value: string | null;
  try {
    value = localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? fallback;
  }
  return value !== null && schemes.includes(value) ? (value as ColorScheme) : fallback;
}

/** Keeps a choice in localStorage, or in memory where the browser refuses it. */
function keep(key: string, scheme: ColorScheme): void {
  try {
    localStorage.setItem(key, scheme);
  } catch {
    memory.set(key, scheme);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab's choice arrives as a storage event.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function subscribeSystem(listener: () => void): () => void {
  const query = matchMedia(DARK_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

const systemDark = () => matchMedia(DARK_QUERY).matches;
const serverFalse = () => false;

/** Sets the `.dark` class and the `color-scheme` property on `<html>`. */
function apply(resolved: ResolvedColorScheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

const resolve = (scheme: ColorScheme, dark: boolean): ResolvedColorScheme => (scheme === "system" ? (dark ? "dark" : "light") : scheme);

/**
 * Keeps the page's color scheme: it applies the person's choice (`light`, `dark` or
 * `system`) as the `.dark` class on `<html>`, which is how shadcn themes switch, keeps it in
 * `localStorage`, and follows the system's setting live while the choice is `system`. Every
 * `ColorSchemeToggle` and `useColorScheme` under it share its options.
 *
 * Wrap the app once, in the root layout, and put `colorSchemeScript()` in `<head>` so the
 * first paint already has the scheme. Ouro UI components need neither: without them, dark
 * mode is whatever `.dark` class the app sets.
 *
 * @group App setup
 * @see https://ourostack.github.io/ouro-ui/docs/color-scheme-toggle
 * @example
 * // app/root.tsx (React Router):
 * <html lang="en" suppressHydrationWarning>
 *   <head>
 *     <script dangerouslySetInnerHTML={{ __html: colorSchemeScript() }} />
 *   </head>
 *   <body>
 *     <ColorSchemeProvider>
 *       <Outlet />
 *     </ColorSchemeProvider>
 *   </body>
 * </html>
 * @claim "Every `ColorSchemeToggle` and `useColorScheme` under it" registry/ouro/lib/ouro/color-scheme.test.tsx verify:testExists(registry/ouro/lib/ouro/color-scheme.test.tsx::ColorSchemeProvider > takes the app's key and default)
 * @claim "Every `ColorSchemeToggle` and `useColorScheme` under it" registry/ouro/lib/ouro/color-scheme.test.tsx verify:testExists(registry/ouro/lib/ouro/color-scheme.test.tsx::useColorScheme > switches the page without a provider, and every reader agrees)
 */
export function ColorSchemeProvider({ children, storageKey = COLOR_SCHEME_DEFAULTS.storageKey, defaultScheme = COLOR_SCHEME_DEFAULTS.defaultScheme }: ColorSchemeProviderProps): JSX.Element {
  const value = useMemo(() => ({ storageKey, defaultScheme }), [storageKey, defaultScheme]);
  const scheme = useSyncExternalStore(
    subscribe,
    () => stored(storageKey, defaultScheme),
    () => defaultScheme,
  );
  const dark = useSyncExternalStore(subscribeSystem, systemDark, serverFalse);
  const resolved = resolve(scheme, dark);
  // Before paint, so a change of choice or of the system's setting never shows a frame of the old
  // scheme. It reads the live choice and system setting, not the render's: while React hydrates,
  // the render holds the server's default, and applying that would undo colorSchemeScript().
  useLayoutEffect(() => apply(resolve(stored(storageKey, defaultScheme), systemDark())), [resolved, storageKey, defaultScheme]);
  return createElement(ColorSchemeContext.Provider, { value }, children);
}

/**
 * The person's color scheme, the scheme the page shows, and the setter that changes both,
 * for a control of your own. `ColorSchemeToggle` is that control, ready made.
 *
 * It works with or without `ColorSchemeProvider`, with the provider's options when there is
 * one. Before hydration it reports the default scheme, as the server did.
 *
 * @group Actions
 * @see https://ourostack.github.io/ouro-ui/docs/color-scheme-toggle
 * @example
 * const { resolved, setScheme } = useColorScheme();
 * <Switch label="Dark mode" checked={resolved === "dark"} onCheckedChange={(on) => setScheme(on ? "dark" : "light")} />
 * @claim "It works with or without `ColorSchemeProvider`" registry/ouro/lib/ouro/color-scheme.test.tsx verify:testExists(registry/ouro/lib/ouro/color-scheme.test.tsx::useColorScheme > switches the page without a provider, and every reader agrees)
 * @claim "It works with or without `ColorSchemeProvider`" registry/ouro/lib/ouro/color-scheme.test.tsx verify:testExists(registry/ouro/lib/ouro/color-scheme.test.tsx::ColorSchemeProvider > takes the app's key and default)
 */
export function useColorScheme(): ColorSchemeValue {
  const { storageKey, defaultScheme } = useContext(ColorSchemeContext);
  const scheme = useSyncExternalStore(
    subscribe,
    () => stored(storageKey, defaultScheme),
    () => defaultScheme,
  );
  const dark = useSyncExternalStore(subscribeSystem, systemDark, serverFalse);
  const setScheme = useCallback(
    (next: ColorScheme) => {
      keep(storageKey, next);
      // Applied here too, so a toggle without a provider still switches the page.
      apply(resolve(next, systemDark()));
      for (const listener of listeners) listener();
    },
    [storageKey],
  );
  return { scheme, resolved: resolve(scheme, dark), setScheme };
}
