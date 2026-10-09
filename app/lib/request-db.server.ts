import { AsyncLocalStorage } from "node:async_hooks";

// One Prisma client per Worker request, freed when the request is completely finished.
//
// Prisma's client engine allocates its query compiler in wasm memory that only `$disconnect()`
// reliably frees on Workers (FinalizationRegistry does not run dependably there), so a client per
// call that is never disconnected leaks until the isolate fails with "Invalid array buffer length"
// or "memory access out of bounds" (prisma/orm#28012, #27662, #29660). Sharing one client across
// requests instead makes requests wait on each other's I/O and hang (prisma/orm#28193).
//
// So each request gets its own client, created on first use and shared by everything the request
// runs, and the request's lifetime is held open with `waitUntil` from its first moment: a browser
// that aborts the request no longer tears down a query that is already running. Once the response
// body has finished (or was canceled) and every background task the request registered has
// settled, the client is disconnected.

export type DisconnectableClient = { $disconnect(): Promise<void> };

type RequestDbScope = { client?: Promise<DisconnectableClient> };

const requestDbScope = new AsyncLocalStorage<RequestDbScope>();

/**
 * The current request's client, created by `create` on first use. Outside a request scope (Node
 * scripts and tests), `create` runs on every call, as before.
 */
export function requestScopedClient<T extends DisconnectableClient>(create: () => Promise<T>): Promise<T> {
  const scope = requestDbScope.getStore();
  if (!scope) return create();
  if (!scope.client) {
    const created = create();
    scope.client = created;
    // A failed creation is not cached, so a later call in the same request can try again.
    created.catch(() => {
      if (scope.client === created) scope.client = undefined;
    });
  }
  return scope.client as Promise<T>;
}

type RequestContext = Pick<ExecutionContext, "waitUntil" | "passThroughOnException"> & { props?: unknown };

async function settleThenDisconnect(scope: RequestDbScope, tasks: Promise<unknown>[]): Promise<void> {
  // A task may register more tasks while it runs, so wait until no new ones appear.
  for (let settled = 0; settled < tasks.length; ) {
    const batch = tasks.slice(settled);
    settled = tasks.length;
    await Promise.allSettled(batch);
  }
  const client = await scope.client?.catch(() => undefined);
  scope.client = undefined;
  await client?.$disconnect().catch(() => undefined);
}

/**
 * Runs `handle` with a per-request database scope, and disconnects the request's client after the
 * response body and every `waitUntil` task registered through the context passed to `handle`
 * have finished.
 */
export async function withRequestDb<C extends RequestContext>(
  ctx: C,
  handle: (ctx: C) => Promise<Response>,
): Promise<Response> {
  const scope: RequestDbScope = {};
  const tasks: Promise<unknown>[] = [];
  let markDone!: () => void;
  const done = new Promise<void>((resolve) => {
    markDone = resolve;
  });
  // Registered before any work starts, so the runtime keeps the request alive (up to its
  // waitUntil limit) even if the client disconnects mid-query.
  ctx.waitUntil(done.then(() => settleThenDisconnect(scope, tasks)));

  const scopedCtx = {
    waitUntil(promise: Promise<unknown>) {
      tasks.push(Promise.resolve(promise));
      ctx.waitUntil(promise);
    },
    passThroughOnException() {
      ctx.passThroughOnException();
    },
    get props() {
      return ctx.props;
    },
  } as unknown as C;

  let response: Response;
  try {
    response = await requestDbScope.run(scope, () => handle(scopedCtx));
  } catch (error) {
    markDone();
    throw error;
  }

  if (!response.body || (response as Response & { webSocket?: unknown }).webSocket) {
    markDone();
    return response;
  }
  // Pass the body through unchanged and learn when it has been fully sent or canceled.
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  response.body.pipeTo(writable).catch(() => undefined).finally(markDone);
  return new Response(readable, response);
}
