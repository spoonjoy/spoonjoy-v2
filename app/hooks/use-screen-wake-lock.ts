import { useEffect } from "react";

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
}

interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockLike | null {
  // Called from an effect, so `navigator` always exists here.
  const candidate = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return candidate && typeof candidate.request === "function" ? candidate : null;
}

// Keeps the screen on while `active` (cook mode is open), using the Screen Wake Lock API where the
// browser has it. The browser drops the lock whenever the page is hidden, so it is requested again
// when the cook comes back to the tab. Unsupported browsers and refused requests change nothing.
export function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    const api = wakeLockApi();
    if (!active || !api) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;

    const acquire = async () => {
      if (document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      try {
        const next = await api.request("screen");
        if (disposed) {
          await next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
      } catch {
        // Refused (battery saver, permissions policy) or unsupported: the screen may sleep.
      }
    };

    const handleVisibilityChange = () => {
      void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      const held = sentinel;
      sentinel = null;
      if (held && !held.released) void held.release().catch(() => undefined);
    };
  }, [active]);
}
