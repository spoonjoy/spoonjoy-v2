import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isPushSupported,
  isIosNonStandalone,
  registerServiceWorker,
  subscribeToPush,
  unsubscribeFromPush,
  base64UrlToUint8Array,
} from "~/lib/push-client";

interface NavState {
  navigator?: unknown;
  isSecureContext?: boolean;
}

function setGlobals(state: NavState) {
  const g = globalThis as unknown as {
    navigator?: unknown;
    isSecureContext?: boolean;
    Notification?: unknown;
    fetch?: typeof fetch;
  };
  if ("navigator" in state) {
    if (state.navigator === undefined) {
      delete g.navigator;
    } else {
      g.navigator = state.navigator;
    }
  }
  if ("isSecureContext" in state) {
    g.isSecureContext = state.isSecureContext!;
  }
}

const origNavigator = (globalThis as unknown as { navigator: unknown }).navigator;
const origSecure = (globalThis as unknown as { isSecureContext?: boolean }).isSecureContext;
const origFetch = globalThis.fetch;
const origNotification = (globalThis as unknown as { Notification?: unknown }).Notification;

afterEach(() => {
  (globalThis as unknown as { navigator: unknown }).navigator = origNavigator;
  (globalThis as unknown as { isSecureContext?: boolean }).isSecureContext = origSecure;
  globalThis.fetch = origFetch;
  (globalThis as unknown as { Notification?: unknown }).Notification = origNotification;
  delete (globalThis as unknown as { PushManager?: unknown }).PushManager;
});

describe("base64UrlToUint8Array", () => {
  it("decodes a known base64url string", () => {
    expect(Array.from(base64UrlToUint8Array("TWFu"))).toEqual([77, 97, 110]);
  });

  it("handles - and _ replacements", () => {
    expect(Array.from(base64UrlToUint8Array("__4"))).toEqual([0xff, 0xfe]);
  });
});

describe("isPushSupported", () => {
  it("returns no_service_worker when navigator lacks serviceWorker", () => {
    setGlobals({ navigator: {}, isSecureContext: true });
    const r = isPushSupported();
    expect(r).toEqual({ supported: false, reason: "no_service_worker" });
  });

  it("returns no_push_manager when PushManager missing", () => {
    setGlobals({ navigator: { serviceWorker: {} }, isSecureContext: true });
    const r = isPushSupported();
    expect(r).toEqual({ supported: false, reason: "no_push_manager" });
  });

  it("returns insecure_context when isSecureContext is false", () => {
    setGlobals({
      navigator: { serviceWorker: {} },
      isSecureContext: false,
    });
    // PushManager check is independent; provide one so we reach the secure check.
    (globalThis as unknown as { PushManager?: unknown }).PushManager = function () {};
    const r = isPushSupported();
    expect(r).toEqual({ supported: false, reason: "insecure_context" });
    delete (globalThis as unknown as { PushManager?: unknown }).PushManager;
  });

  it("returns supported when all conditions met", () => {
    setGlobals({
      navigator: { serviceWorker: {} },
      isSecureContext: true,
    });
    (globalThis as unknown as { PushManager?: unknown }).PushManager = function () {};
    const r = isPushSupported();
    expect(r).toEqual({ supported: true });
    delete (globalThis as unknown as { PushManager?: unknown }).PushManager;
  });

  it("returns no_service_worker when navigator is undefined (server-side)", () => {
    setGlobals({ navigator: undefined });
    const r = isPushSupported();
    expect(r).toEqual({ supported: false, reason: "no_service_worker" });
  });
});

describe("isIosNonStandalone", () => {
  it("returns true on iPhone Safari outside PWA", () => {
    setGlobals({
      navigator: {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15",
        standalone: false,
      },
    });
    expect(isIosNonStandalone()).toBe(true);
  });

  it("returns false when navigator.standalone is true (installed PWA)", () => {
    setGlobals({
      navigator: {
        userAgent: "Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X) AppleWebKit/605.1.15",
        standalone: true,
      },
    });
    expect(isIosNonStandalone()).toBe(false);
  });

  it("returns false on non-iOS UA", () => {
    setGlobals({
      navigator: {
        userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/120",
        standalone: false,
      },
    });
    expect(isIosNonStandalone()).toBe(false);
  });

  it("returns false when navigator is undefined (server-side)", () => {
    setGlobals({ navigator: undefined });
    expect(isIosNonStandalone()).toBe(false);
  });

  it("returns false on iOS UA when navigator.userAgent is undefined", () => {
    setGlobals({
      navigator: {
        // no userAgent property
      },
    });
    expect(isIosNonStandalone()).toBe(false);
  });

  it("treats missing standalone property as non-standalone iOS", () => {
    setGlobals({
      navigator: {
        userAgent: "Mozilla/5.0 (iPod touch; CPU iPhone OS 16) AppleWebKit/605.1.15",
      },
    });
    expect(isIosNonStandalone()).toBe(true);
  });
});

describe("registerServiceWorker", () => {
  it("is a no-op when navigator is undefined", async () => {
    setGlobals({ navigator: undefined });
    await expect(registerServiceWorker()).resolves.toBeNull();
  });

  it("is a no-op when navigator has no serviceWorker", async () => {
    setGlobals({ navigator: {} });
    await expect(registerServiceWorker()).resolves.toBeNull();
  });

  it("registers /sw.js with scope '/' when available", async () => {
    const register = vi.fn(async () => ({ scope: "/" }));
    setGlobals({
      navigator: {
        serviceWorker: {
          register,
          getRegistration: vi.fn(async () => null),
        },
      },
    });
    await registerServiceWorker();
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });

  it("registers when getRegistration is not available on the navigator", async () => {
    const register = vi.fn(async () => ({ scope: "/" }));
    setGlobals({
      navigator: {
        serviceWorker: {
          register,
          // no getRegistration
        },
      },
    });
    await registerServiceWorker();
    expect(register).toHaveBeenCalled();
  });

  it("is idempotent — does not re-register when registration already exists", async () => {
    const register = vi.fn(async () => ({ scope: "/" }));
    const existing = { scope: "/" };
    setGlobals({
      navigator: {
        serviceWorker: {
          register,
          getRegistration: vi.fn(async () => existing),
        },
      },
    });
    const result = await registerServiceWorker();
    expect(register).not.toHaveBeenCalled();
    expect(result).toBe(existing);
  });
});

describe("subscribeToPush", () => {
  function setupPushable(
    permission: NotificationPermission,
    overrides?: Partial<{ subscribeResult: unknown; existingSub: unknown }>,
  ) {
    const subscribe = vi.fn(async () => overrides?.subscribeResult ?? {
      endpoint: "https://push.example/x",
      getKey: (name: string) =>
        name === "p256dh"
          ? new Uint8Array([1, 2, 3]).buffer
          : new Uint8Array([4, 5, 6]).buffer,
      toJSON: () => ({
        endpoint: "https://push.example/x",
        keys: { p256dh: "p", auth: "a" },
      }),
    });
    const getSubscription = vi.fn(async () => overrides?.existingSub ?? null);
    const ready = Promise.resolve({
      pushManager: { subscribe, getSubscription },
    });
    setGlobals({
      navigator: {
        serviceWorker: {
          ready,
          register: vi.fn(async () => ({ scope: "/" })),
          getRegistration: vi.fn(async () => ({ scope: "/" })),
        },
      },
      isSecureContext: true,
    });
    (globalThis as unknown as { PushManager?: unknown }).PushManager = function () {};
    (globalThis as unknown as { Notification?: unknown }).Notification = {
      requestPermission: vi.fn(async () => permission),
    };
    return { subscribe, getSubscription };
  }

  it("returns { ok:true } and POSTs to /api/push/subscriptions on granted permission", async () => {
    const { subscribe } = setupPushable("granted");
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/push/public-key") {
        return new Response(JSON.stringify({ key: "BHpzJ01VsKtS08clJYyuN-WasvuNNaWOtg_nkE60YRoy0Ez9X2F-ITgDKWbh8EzAMLpx9rskKADfMbadO3yo5rQ" }), {
          status: 200,
        });
      }
      return new Response(null, { status: 201 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await subscribeToPush();
    expect(result).toEqual({ ok: true });
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true }),
    );
    const postCall = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/push/subscriptions",
    );
    expect(postCall).toBeDefined();
  });

  it("uses pre-fetched publicKey when provided", async () => {
    setupPushable("granted");
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await subscribeToPush("BHpzJ01VsKtS08clJYyuN-WasvuNNaWOtg_nkE60YRoy0Ez9X2F-ITgDKWbh8EzAMLpx9rskKADfMbadO3yo5rQ");
    expect(result).toEqual({ ok: true });
    expect(
      fetchMock.mock.calls.find((c) => c[0] === "/api/push/public-key"),
    ).toBeUndefined();
  });

  it("returns permission_denied on denied", async () => {
    setupPushable("denied");
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await subscribeToPush("BHpzJ01VsKtS08clJYyuN-WasvuNNaWOtg_nkE60YRoy0Ez9X2F-ITgDKWbh8EzAMLpx9rskKADfMbadO3yo5rQ");
    expect(result).toEqual({ ok: false, reason: "permission_denied" });
  });

  it("returns permission_dismissed on default", async () => {
    setupPushable("default");
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await subscribeToPush("BHpzJ01VsKtS08clJYyuN-WasvuNNaWOtg_nkE60YRoy0Ez9X2F-ITgDKWbh8EzAMLpx9rskKADfMbadO3yo5rQ");
    expect(result).toEqual({ ok: false, reason: "permission_dismissed" });
  });

  it("returns unsupported when push is not supported", async () => {
    setGlobals({ navigator: {} });
    const result = await subscribeToPush("BHpzJ01VsKtS08clJYyuN-WasvuNNaWOtg_nkE60YRoy0Ez9X2F-ITgDKWbh8EzAMLpx9rskKADfMbadO3yo5rQ");
    expect(result).toEqual({ ok: false, reason: "unsupported" });
  });

  it("returns public_key_unavailable when the public-key response has no key field", async () => {
    setupPushable("granted");
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;
    const result = await subscribeToPush();
    expect(result).toEqual({ ok: false, reason: "public_key_unavailable" });
  });

  it("returns failed when the public-key fetch is non-200", async () => {
    setupPushable("granted");
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const result = await subscribeToPush();
    expect(result).toEqual({ ok: false, reason: "public_key_unavailable" });
  });

  it("returns failed when the subscribe POST is non-2xx", async () => {
    setupPushable("granted");
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/push/subscriptions"
        ? new Response("err", { status: 500 })
        : new Response(JSON.stringify({ key: "BHpzJ01VsKtS08clJYyuN-WasvuNNaWOtg_nkE60YRoy0Ez9X2F-ITgDKWbh8EzAMLpx9rskKADfMbadO3yo5rQ" }), {
            status: 200,
          }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await subscribeToPush();
    expect(result).toEqual({ ok: false, reason: "server_error" });
  });
});

describe("unsubscribeFromPush", () => {
  it("calls unsubscribe + DELETE when a subscription exists", async () => {
    const unsub = vi.fn(async () => true);
    const sub = { endpoint: "https://push.example/del", unsubscribe: unsub };
    const ready = Promise.resolve({
      pushManager: { getSubscription: vi.fn(async () => sub) },
    });
    setGlobals({
      navigator: {
        serviceWorker: {
          ready,
          register: vi.fn(),
          getRegistration: vi.fn(async () => ({})),
        },
      },
    });
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const result = await unsubscribeFromPush();
    expect(result).toEqual({ ok: true });
    expect(unsub).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/push/subscriptions",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("returns alreadyUnsubscribed when no subscription exists", async () => {
    const ready = Promise.resolve({
      pushManager: { getSubscription: vi.fn(async () => null) },
    });
    setGlobals({
      navigator: {
        serviceWorker: {
          ready,
          register: vi.fn(),
          getRegistration: vi.fn(async () => ({})),
        },
      },
    });
    const result = await unsubscribeFromPush();
    expect(result).toEqual({ ok: true, alreadyUnsubscribed: true });
  });

  it("returns unsupported when navigator has no serviceWorker", async () => {
    setGlobals({ navigator: {} });
    const result = await unsubscribeFromPush();
    expect(result).toEqual({ ok: false, reason: "unsupported" });
  });

  it("skips sub.unsubscribe() when the subscription object lacks an unsubscribe method", async () => {
    const sub = { endpoint: "https://push.example/no-unsub" }; // no unsubscribe()
    const ready = Promise.resolve({
      pushManager: { getSubscription: vi.fn(async () => sub) },
    });
    setGlobals({
      navigator: {
        serviceWorker: {
          ready,
          register: vi.fn(),
          getRegistration: vi.fn(async () => ({})),
        },
      },
    });
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const result = await unsubscribeFromPush();
    expect(result).toEqual({ ok: true });
  });

  it("returns server_error when DELETE response is non-2xx and not 404", async () => {
    const sub = {
      endpoint: "https://push.example/x",
      unsubscribe: vi.fn(async () => true),
    };
    const ready = Promise.resolve({
      pushManager: { getSubscription: vi.fn(async () => sub) },
    });
    setGlobals({
      navigator: {
        serviceWorker: {
          ready,
          register: vi.fn(),
          getRegistration: vi.fn(async () => ({})),
        },
      },
    });
    globalThis.fetch = vi.fn(async () => new Response("err", { status: 500 })) as unknown as typeof fetch;
    const result = await unsubscribeFromPush();
    expect(result).toEqual({ ok: false, reason: "server_error" });
  });

  it("treats 404 DELETE response as success (idempotent unsubscribe)", async () => {
    const sub = {
      endpoint: "https://push.example/x",
      unsubscribe: vi.fn(async () => true),
    };
    const ready = Promise.resolve({
      pushManager: { getSubscription: vi.fn(async () => sub) },
    });
    setGlobals({
      navigator: {
        serviceWorker: {
          ready,
          register: vi.fn(),
          getRegistration: vi.fn(async () => ({})),
        },
      },
    });
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const result = await unsubscribeFromPush();
    expect(result).toEqual({ ok: true });
  });
});

describe("subscriptionToBody fallback (toJSON missing or empty keys)", () => {
  it("falls back to getKey when toJSON is undefined", async () => {
    const subWithoutToJSON = {
      endpoint: "https://push.example/no-tojson",
      getKey: (name: string) => {
        const bytes = name === "p256dh"
          ? new Uint8Array([1, 2, 3, 4])
          : new Uint8Array([5, 6, 7]);
        return bytes.buffer;
      },
    };
    const ready = Promise.resolve({
      pushManager: {
        subscribe: vi.fn(async () => subWithoutToJSON),
        getSubscription: vi.fn(async () => null),
      },
    });
    setGlobals({
      navigator: {
        serviceWorker: {
          ready,
          register: vi.fn(),
          getRegistration: vi.fn(async () => ({})),
        },
      },
      isSecureContext: true,
    });
    (globalThis as unknown as { PushManager?: unknown }).PushManager = function () {};
    (globalThis as unknown as { Notification?: unknown }).Notification = {
      requestPermission: vi.fn(async () => "granted"),
    };

    let postedBody: string | undefined;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof init?.body === "string") postedBody = init.body;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    const result = await subscribeToPush("BHpzJ01VsKtS08clJYyuN-WasvuNNaWOtg_nkE60YRoy0Ez9X2F-ITgDKWbh8EzAMLpx9rskKADfMbadO3yo5rQ");
    expect(result).toEqual({ ok: true });
    expect(postedBody).toBeDefined();
    const parsed = JSON.parse(postedBody!);
    expect(parsed.keys.p256dh).toBeTruthy(); // bytes were base64url-encoded
    expect(parsed.keys.auth).toBeTruthy();
  });

  it("falls back to getKey when toJSON returns incomplete keys", async () => {
    const subBadJSON = {
      endpoint: "https://push.example/bad-json",
      toJSON: () => ({ endpoint: "https://push.example/bad-json", keys: { p256dh: "", auth: "a" } }),
      getKey: (name: string) =>
        name === "p256dh"
          ? new Uint8Array([0xff]).buffer
          : new Uint8Array([0xaa]).buffer,
    };
    const ready = Promise.resolve({
      pushManager: {
        subscribe: vi.fn(async () => subBadJSON),
        getSubscription: vi.fn(async () => null),
      },
    });
    setGlobals({
      navigator: {
        serviceWorker: {
          ready,
          register: vi.fn(),
          getRegistration: vi.fn(async () => ({})),
        },
      },
      isSecureContext: true,
    });
    (globalThis as unknown as { PushManager?: unknown }).PushManager = function () {};
    (globalThis as unknown as { Notification?: unknown }).Notification = {
      requestPermission: vi.fn(async () => "granted"),
    };

    globalThis.fetch = vi.fn(async () => new Response(null, { status: 201 })) as unknown as typeof fetch;
    const result = await subscribeToPush("BHpzJ01VsKtS08clJYyuN-WasvuNNaWOtg_nkE60YRoy0Ez9X2F-ITgDKWbh8EzAMLpx9rskKADfMbadO3yo5rQ");
    expect(result).toEqual({ ok: true });
  });

  it("emits empty key strings when getKey is missing entirely", async () => {
    const subEmpty = {
      endpoint: "https://push.example/empty",
      // no getKey, no toJSON
    };
    const ready = Promise.resolve({
      pushManager: {
        subscribe: vi.fn(async () => subEmpty),
        getSubscription: vi.fn(async () => null),
      },
    });
    setGlobals({
      navigator: {
        serviceWorker: {
          ready,
          register: vi.fn(),
          getRegistration: vi.fn(async () => ({})),
        },
      },
      isSecureContext: true,
    });
    (globalThis as unknown as { PushManager?: unknown }).PushManager = function () {};
    (globalThis as unknown as { Notification?: unknown }).Notification = {
      requestPermission: vi.fn(async () => "granted"),
    };

    let postedBody: string | undefined;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof init?.body === "string") postedBody = init.body;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;

    await subscribeToPush("BHpzJ01VsKtS08clJYyuN-WasvuNNaWOtg_nkE60YRoy0Ez9X2F-ITgDKWbh8EzAMLpx9rskKADfMbadO3yo5rQ");
    expect(postedBody).toBeDefined();
    const parsed = JSON.parse(postedBody!);
    expect(parsed.keys.p256dh).toBe("");
    expect(parsed.keys.auth).toBe("");
  });
});
