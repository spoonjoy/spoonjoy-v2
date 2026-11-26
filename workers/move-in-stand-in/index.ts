/**
 * A stand-in for the other recipe app's server, for the Move in journeys (e2e/journeys/support/recipe-server.ts). Each
 * Journeys run that runs them deploys it as a Worker of its own, `<the run's QA Worker>-stand-in`, at its own
 * workers.dev address (scripts/qa-run-scope.mjs `stand-in`), and the run's teardown and the QA Run Sweep delete it. A
 * journey loads one kitchen into it under a fresh id and token, gives the run's QA Worker the kitchen's address and
 * token, and the QA Worker reads the kitchen over the network as it would a cook's own server.
 *
 *   GET    /health                          "ok": the Worker is deployed and answering.
 *   PUT    /_stand-in/kitchens/<id>         with STAND_IN_SECRET as a bearer token: replaces the kitchen with
 *                                           { token, routes: [{ path, type, body }] }, each body in base64.
 *   GET    /_stand-in/kitchens/<id>/asked   with the secret: how many times each path was asked for.
 *   DELETE /_stand-in/kitchens/<id>         with the secret: forgets the kitchen.
 *   GET    /<id><path>                      the kitchen's answer for the path: to its token only, as a real server's API
 *                                           answers, except /api/app/about, which a real server answers to anyone.
 *
 * Each kitchen is one Durable Object (StandInKitchen), so every request for it, from any Cloudflare location, sees the
 * same answers and the same counts.
 */

/** The kitchen id in an address: 32 hex characters, made fresh by each journey. */
export const KITCHEN_ID = /^[0-9a-f]{32}$/;
/** The path a real server answers without a token. */
export const OPEN_PATH = "/api/app/about";
/** How many keys one storage put takes at most. */
export const PUT_BATCH = 100;

export interface KitchenStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  deleteAll(): Promise<void>;
}

export interface KitchenStub {
  fetch(request: Request): Promise<Response>;
}

export interface KitchenNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): KitchenStub;
}

export interface StandInEnv {
  /** Opens the /_stand-in routes; each run makes its own. */
  STAND_IN_SECRET?: string;
  KITCHENS: KitchenNamespace;
}

interface StoredRoute {
  type: string;
  body: Uint8Array<ArrayBuffer>;
}

const INTERNAL = "https://kitchen";

function status(code: number): Response {
  return new Response(null, { status: code });
}

/** Compares in time that doesn't depend on where the two first differ. */
export function sameText(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let differ = a.length ^ b.length;
  for (let index = 0; index < b.length; index++) differ |= (a[index] ?? 0) ^ b[index];
  return differ === 0;
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
}

/** The routes a PUT carries, or null when the body isn't one. */
export function parseKitchen(body: unknown): { token: string; routes: Map<string, StoredRoute> } | null {
  if (!body || typeof body !== "object") return null;
  const { token, routes } = body as { token?: unknown; routes?: unknown };
  if (typeof token !== "string" || !token || !Array.isArray(routes)) return null;
  const parsed = new Map<string, StoredRoute>();
  for (const route of routes as Array<{ path?: unknown; type?: unknown; body?: unknown } | null>) {
    if (!route || typeof route.path !== "string" || !route.path.startsWith("/") || typeof route.type !== "string" || typeof route.body !== "string") return null;
    try {
      parsed.set(route.path, { type: route.type, body: fromBase64(route.body) });
    } catch {
      return null;
    }
  }
  return { token, routes: parsed };
}

/** One kitchen: its token, its answers by path, and how many times each path was asked for. */
export class StandInKitchen {
  constructor(private readonly state: { storage: KitchenStorage }) {}

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const { storage } = this.state;
    if (pathname === "/" && request.method === "PUT") {
      const kitchen = parseKitchen(await request.json().catch(() => null));
      if (!kitchen) return status(400);
      await storage.deleteAll();
      const entries = Object.entries({ token: kitchen.token, ...Object.fromEntries([...kitchen.routes].map(([path, route]) => [`route:${path}`, route])) });
      for (let start = 0; start < entries.length; start += PUT_BATCH) await storage.put(Object.fromEntries(entries.slice(start, start + PUT_BATCH)));
      return status(204);
    }
    if (pathname === "/" && request.method === "DELETE") {
      await storage.deleteAll();
      return status(204);
    }
    if (pathname === "/asked") {
      const counts = await storage.list<number>({ prefix: "asked:" });
      return Response.json(Object.fromEntries([...counts].map(([key, count]) => [key.slice("asked:".length), count])));
    }
    if (!pathname.startsWith("/serve/")) return status(404);
    const path = pathname.slice("/serve".length);
    const token = await storage.get<string>("token");
    if (token === undefined) return status(404);
    await storage.put({ [`asked:${path}`]: ((await storage.get<number>(`asked:${path}`)) ?? 0) + 1 });
    if (path !== OPEN_PATH && !sameText(request.headers.get("authorization") ?? "", `Bearer ${token}`)) return status(401);
    const route = await storage.get<StoredRoute>(`route:${path}`);
    if (!route) return status(404);
    return new Response(route.body, { headers: { "content-type": route.type } });
  }
}

function kitchen(env: StandInEnv, id: string): KitchenStub {
  return env.KITCHENS.get(env.KITCHENS.idFromName(id));
}

export async function handle(request: Request, env: StandInEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") return request.method === "GET" ? new Response("ok") : status(405);

  const admin = /^\/_stand-in\/kitchens\/([^/]+)(\/asked)?$/.exec(url.pathname);
  if (admin) {
    const secret = env.STAND_IN_SECRET ?? "";
    if (!secret || !sameText(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return status(401);
    if (!KITCHEN_ID.test(admin[1])) return status(404);
    const stub = kitchen(env, admin[1]);
    if (admin[2]) return request.method === "GET" ? stub.fetch(new Request(`${INTERNAL}/asked`)) : status(405);
    if (request.method === "PUT") return stub.fetch(new Request(`${INTERNAL}/`, { method: "PUT", body: await request.arrayBuffer() }));
    if (request.method === "DELETE") return stub.fetch(new Request(`${INTERNAL}/`, { method: "DELETE" }));
    return status(405);
  }

  const served = /^\/([0-9a-f]{32})(\/.*)$/.exec(url.pathname);
  if (!served) return status(404);
  if (request.method !== "GET") return status(405);
  const authorization = request.headers.get("authorization");
  return kitchen(env, served[1]).fetch(new Request(`${INTERNAL}/serve${served[2]}`, { headers: authorization === null ? {} : { authorization } }));
}

export default {
  fetch(request: Request, env: StandInEnv): Promise<Response> {
    return handle(request, env);
  },
};
