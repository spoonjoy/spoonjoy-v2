import type { Page, Request, Response } from "@playwright/test";

interface CookSyncPhase {
  request: number;
  phase: "request" | "response" | "finished" | "failed";
  at: number;
  method: string;
  path: string;
  status?: number;
}

/** Failure evidence only: never captures headers, queries, bodies or changes requests. */
export function recordCookSyncRequests(page: Pick<Page, "on" | "off">, now = Date.now) {
  const events: CookSyncPhase[] = [];
  const ids = new WeakMap<Request, number>();
  let nextId = 0;
  let dropped = 0;

  function record(phase: CookSyncPhase["phase"], request: Request, status?: number) {
    const path = new URL(request.url()).pathname;
    if (!/^\/api\/cook-sessions\/[^/]+(?:\/start)?$/.test(path)) return;
    if (events.length === 64) {
      dropped += 1;
      return;
    }
    let id = ids.get(request);
    if (id === undefined) {
      id = ++nextId;
      ids.set(request, id);
    }
    events.push({
      request: id,
      phase,
      at: now(),
      method: request.method(),
      path,
      ...(status === undefined ? {} : { status }),
    });
  }

  const requested = (request: Request) => record("request", request);
  const responded = (response: Response) => record("response", response.request(), response.status());
  const finished = (request: Request) => record("finished", request);
  const failed = (request: Request) => record("failed", request);
  page.on("request", requested);
  page.on("response", responded);
  page.on("requestfinished", finished);
  page.on("requestfailed", failed);

  return {
    snapshot: () => ({ events: [...events], dropped }),
    stop() {
      page.off("request", requested);
      page.off("response", responded);
      page.off("requestfinished", finished);
      page.off("requestfailed", failed);
    },
  };
}
