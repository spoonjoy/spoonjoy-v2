"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * The browser's install event, which not every TypeScript DOM library declares.
 *
 * @claim "The browser's install event, which not" registry/ouro/lib/ouro/use-install-prompt.test.tsx verify:testExists(registry/ouro/lib/ouro/use-install-prompt.test.tsx::useInstallPrompt > is not available, and install() says so, until the browser offers to install)
 * @claim "The browser's install event, which not" https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent verify:urlOk(https://developer.mozilla.org/en-US/docs/Web/API/BeforeInstallPromptEvent)
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Options for {@link useInstallPrompt}. */
export interface InstallPromptOptions {
  /** Days to wait before offering again after the person says not now. @default 14 */
  remindAfterDays?: number | undefined;
  /** The `localStorage` key that keeps when the person last said not now. @default "ouro-install-dismissed" */
  storageKey?: string | undefined;
}

/** What {@link useInstallPrompt} returns. */
export interface InstallPromptState {
  /** Whether to offer installing now: the browser can install the app, it is not installed, and the person has not said not now lately. */
  available: boolean;
  /** Whether the app runs installed (standalone) or was installed from this page. */
  installed: boolean;
  /** Opens the browser's install dialog and resolves how the person answered. */
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
  /** Hides the offer and remembers it for `remindAfterDays`. */
  dismiss: () => void;
}

// The browser fires its install event once, often before the app's components mount, so the
// module catches it as soon as it loads in a browser and keeps it for every hook.
let deferred: BeforeInstallPromptEvent | null = null;
let installedHere = false;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of [...listeners]) listener();
};

/* istanbul ignore else @preserve -- the module also loads on the server, where there is no window */
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    installedHere = true;
    deferred = null;
    notify();
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const standalone = matchMedia("(display-mode: standalone)");
  standalone.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    standalone.removeEventListener("change", listener);
  };
}

const canPrompt = () => deferred !== null;
const isInstalled = () => installedHere || matchMedia("(display-mode: standalone)").matches;
const never = () => false;

function readDismissed(key: string): number | null {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether the browser offers to install this web app, and the means to offer it at a good
 * moment rather than when the browser chooses: `install()` opens the browser's own install
 * dialog, `dismiss()` puts the offer away for two weeks. It is `available` only where the
 * browser fires `beforeinstallprompt` (Chromium on Android and desktops; not Safari or
 * Firefox), and never while the app already runs installed.
 *
 * Use `InstallPrompt` instead for the whole offer, a card with Install and Not now.
 *
 * @group Feedback
 * @see https://ourostack.github.io/ouro-ui/docs/install-prompt
 *
 * @example
 * const { available, install } = useInstallPrompt();
 * if (available) return <Button onClick={install}>Install the app</Button>;
 * @claim "Whether the browser offers to install" registry/ouro/lib/ouro/use-install-prompt.test.tsx verify:testExists(registry/ouro/lib/ouro/use-install-prompt.test.tsx::useInstallPrompt > catches the browser's offer, keeps the browser from showing its own, and opens it on install())
 * @claim "Whether the browser offers to install" registry/ouro/lib/ouro/use-install-prompt.test.tsx verify:testExists(registry/ouro/lib/ouro/use-install-prompt.test.tsx::useInstallPrompt > is installed once the browser says the app was installed from this page)
 * @claim "It is `available` only where the" registry/ouro/lib/ouro/use-install-prompt.test.tsx verify:testExists(registry/ouro/lib/ouro/use-install-prompt.test.tsx::useInstallPrompt > is installed, and offers nothing, while the app runs standalone)
 * @claim "It is `available` only where the" registry/ouro/lib/ouro/use-install-prompt.test.tsx verify:testExists(registry/ouro/lib/ouro/use-install-prompt.test.tsx::useInstallPrompt > is installed once the browser says the app was installed from this page)
 */
export function useInstallPrompt({ remindAfterDays = 14, storageKey = "ouro-install-dismissed" }: InstallPromptOptions = {}): InstallPromptState {
  const prompt = useSyncExternalStore(subscribe, canPrompt, never);
  const installed = useSyncExternalStore(subscribe, isInstalled, never);
  const dismissedAt = useSyncExternalStore(subscribe, () => readDismissed(storageKey), () => null);
  const [hidden, setHidden] = useState(false);
  // The time is read when the offer could show, not on every render.
  const [now] = useState(() => Date.now());
  const recent = dismissedAt !== null && now - dismissedAt < remindAfterDays * DAY_MS;

  const install = useCallback(async () => {
    const event = deferred;
    if (!event) return "unavailable" as const;
    // The browser's event can be used once, whatever the answer.
    deferred = null;
    notify();
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      if (outcome === "accepted") installedHere = true;
      notify();
      return outcome;
    } catch {
      return "dismissed" as const;
    }
  }, []);
  const dismiss = useCallback(() => {
    setHidden(true);
    try {
      localStorage.setItem(storageKey, String(Date.now()));
    } catch {
      // Storage may be blocked; the offer stays hidden on this page.
    }
  }, [storageKey]);

  return { available: prompt && !installed && !recent && !hidden, installed, install, dismiss };
}
