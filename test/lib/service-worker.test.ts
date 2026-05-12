/**
 * Service worker tests.
 *
 * We can't run the SW in a real ServiceWorker scope from Vitest, so we
 * evaluate `public/sw.js` against a hand-rolled stub scope, then synthesize
 * the events it listens for.
 *
 * The SW file is plain JS (no bundler); it's served as-is.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SW_PATH = resolve(__dirname, "..", "..", "public", "sw.js");

interface SwScope {
  registration: {
    showNotification: ReturnType<typeof vi.fn>;
  };
  clients: {
    matchAll: ReturnType<typeof vi.fn>;
    openWindow: ReturnType<typeof vi.fn>;
  };
  addEventListener: (
    name: string,
    handler: (event: unknown) => unknown,
  ) => void;
  __handlers: Map<string, Array<(event: unknown) => unknown>>;
}

function makeScope(): SwScope {
  const handlers = new Map<string, Array<(event: unknown) => unknown>>();
  const scope = {
    registration: { showNotification: vi.fn() },
    clients: {
      matchAll: vi.fn(),
      openWindow: vi.fn(),
    },
    addEventListener(name: string, handler: (event: unknown) => unknown) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
    __handlers: handlers,
  } as SwScope;
  return scope;
}

function evaluateSw(scope: SwScope) {
  const source = readFileSync(SW_PATH, "utf8");
  // Bind `self` and `clients` inside the SW source to our stub scope.
  // We wrap the file in a function so its references resolve to scope properties.
  const fn = new Function("self", "clients", source);
  fn(scope, scope.clients);
}

describe("public/sw.js", () => {
  describe("push event", () => {
    let scope: SwScope;
    beforeAll(() => {
      scope = makeScope();
      evaluateSw(scope);
    });

    it("calls showNotification with title/body/data when valid JSON arrives", () => {
      const waitUntil = vi.fn();
      const handlers = scope.__handlers.get("push") ?? [];
      expect(handlers.length).toBeGreaterThan(0);
      handlers[0]({
        data: { json: () => ({ title: "T", body: "B", url: "/recipes/r1", icon: "/i.png" }) },
        waitUntil,
      });
      expect(scope.registration.showNotification).toHaveBeenCalledWith(
        "T",
        expect.objectContaining({
          body: "B",
          data: expect.objectContaining({ url: "/recipes/r1" }),
          icon: "/i.png",
        }),
      );
      expect(waitUntil).toHaveBeenCalledTimes(1);
    });

    it("is a no-op when event.data is null", () => {
      const fresh = makeScope();
      evaluateSw(fresh);
      const waitUntil = vi.fn();
      (fresh.__handlers.get("push") ?? [])[0]({ data: null, waitUntil });
      expect(fresh.registration.showNotification).not.toHaveBeenCalled();
      expect(waitUntil).not.toHaveBeenCalled();
    });

    it("does not throw if JSON parsing fails", () => {
      const fresh = makeScope();
      evaluateSw(fresh);
      const waitUntil = vi.fn();
      expect(() =>
        (fresh.__handlers.get("push") ?? [])[0]({
          data: {
            json: () => {
              throw new Error("invalid");
            },
          },
          waitUntil,
        }),
      ).not.toThrow();
      expect(fresh.registration.showNotification).not.toHaveBeenCalled();
    });
  });

  describe("notificationclick event", () => {
    let scope: SwScope;
    beforeAll(() => {
      scope = makeScope();
      evaluateSw(scope);
    });

    it("closes the notification + focuses an existing window matching data.url", async () => {
      const close = vi.fn();
      const focus = vi.fn();
      scope.clients.matchAll.mockResolvedValueOnce([
        { url: "https://app.example/other", focus: vi.fn() },
        { url: "https://app.example/recipes/r1", focus },
      ]);

      let storedTask: Promise<unknown> | undefined;
      const waitUntil = (p: Promise<unknown>) => {
        storedTask = p;
      };
      const handler = (scope.__handlers.get("notificationclick") ?? [])[0];
      handler({
        notification: { close, data: { url: "/recipes/r1" } },
        waitUntil,
      });
      await storedTask;
      expect(close).toHaveBeenCalled();
      expect(focus).toHaveBeenCalled();
      expect(scope.clients.openWindow).not.toHaveBeenCalled();
    });

    it("opens a new window when no existing window matches", async () => {
      const fresh = makeScope();
      evaluateSw(fresh);
      fresh.clients.matchAll.mockResolvedValueOnce([
        { url: "https://app.example/different", focus: vi.fn() },
      ]);
      const close = vi.fn();
      let storedTask: Promise<unknown> | undefined;
      const waitUntil = (p: Promise<unknown>) => {
        storedTask = p;
      };
      (fresh.__handlers.get("notificationclick") ?? [])[0]({
        notification: { close, data: { url: "/recipes/r1" } },
        waitUntil,
      });
      await storedTask;
      expect(fresh.clients.openWindow).toHaveBeenCalledWith("/recipes/r1");
    });

    it("falls back to '/' when there is no data.url", async () => {
      const fresh = makeScope();
      evaluateSw(fresh);
      fresh.clients.matchAll.mockResolvedValueOnce([]);
      let storedTask: Promise<unknown> | undefined;
      (fresh.__handlers.get("notificationclick") ?? [])[0]({
        notification: { close: vi.fn(), data: null },
        waitUntil: (p: Promise<unknown>) => {
          storedTask = p;
        },
      });
      await storedTask;
      expect(fresh.clients.openWindow).toHaveBeenCalledWith("/");
    });
  });
});
