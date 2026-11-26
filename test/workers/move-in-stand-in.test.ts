// @vitest-environment node
import { describe, expect, it } from "vitest";
import standIn, {
  OPEN_PATH,
  PUT_BATCH,
  StandInKitchen,
  handle,
  parseKitchen,
  sameText,
  type KitchenNamespace,
  type KitchenStorage,
  type StandInEnv,
} from "../../workers/move-in-stand-in/index";

const SECRET = "run-secret";
const KITCHEN = "0123456789abcdef0123456789abcdef";
const TOKEN = "kitchen-token";
const ORIGIN = "https://spoonjoy-v2-qa-run-1-1-stand-in.example.workers.dev";

function memoryStorage(): KitchenStorage & { data: Map<string, unknown>; puts: number[] } {
  const data = new Map<string, unknown>();
  const puts: number[] = [];
  return {
    data,
    puts,
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async put(entries: Record<string, unknown>) {
      puts.push(Object.keys(entries).length);
      for (const [key, value] of Object.entries(entries)) data.set(key, value);
    },
    async list<T>({ prefix }: { prefix: string }) {
      return new Map([...data].filter(([key]) => key.startsWith(prefix)) as Array<[string, T]>);
    },
    async deleteAll() {
      data.clear();
    },
  };
}

/** One Durable Object per name, as Cloudflare gives them. */
function standInEnv(secret = SECRET): StandInEnv & { kitchens: Map<string, ReturnType<typeof memoryStorage>> } {
  const kitchens = new Map<string, ReturnType<typeof memoryStorage>>();
  const objects = new Map<string, StandInKitchen>();
  const namespace: KitchenNamespace = {
    idFromName: (name) => `id:${name}`,
    get: (id) => {
      const name = String(id);
      if (!objects.has(name)) {
        const storage = memoryStorage();
        kitchens.set(name.slice(3), storage);
        objects.set(name, new StandInKitchen({ storage }));
      }
      return objects.get(name)!;
    },
  };
  return { STAND_IN_SECRET: secret, KITCHENS: namespace, kitchens };
}

const base64 = (text: string) => Buffer.from(text).toString("base64");
const admin = (path: string, init: RequestInit = {}, secret = SECRET) =>
  new Request(`${ORIGIN}/_stand-in/kitchens/${path}`, { ...init, headers: { authorization: `Bearer ${secret}`, ...init.headers } });
const served = (path: string, token: string | null = TOKEN) =>
  new Request(`${ORIGIN}/${KITCHEN}${path}`, { headers: token === null ? {} : { authorization: `Bearer ${token}` } });

async function load(env: StandInEnv, routes: Array<{ path: string; type: string; body: string }>) {
  return handle(admin(KITCHEN, { method: "PUT", body: JSON.stringify({ token: TOKEN, routes }) }), env);
}

const KITCHEN_ROUTES = [
  { path: OPEN_PATH, type: "application/json", body: base64('{"version":"3.31.0"}') },
  { path: "/api/users/self", type: "application/json", body: base64('{"groupId":"g"}') },
  { path: "/api/recipes/lemon%20rice", type: "application/json", body: base64('{"slug":"lemon rice"}') },
  { path: "/api/media/recipes/r1/images/original.webp", type: "image/webp", body: Buffer.from([1, 2, 3]).toString("base64") },
];

describe("the Move in stand-in server", () => {
  it("answers its health check, and only to GET", async () => {
    const env = standInEnv();
    const health = await standIn.fetch(new Request(`${ORIGIN}/health`), env);
    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");
    expect((await handle(new Request(`${ORIGIN}/health`, { method: "POST" }), env)).status).toBe(405);
  });

  it("serves a loaded kitchen's answers to its token, byte for byte and with their types", async () => {
    const env = standInEnv();
    expect((await load(env, KITCHEN_ROUTES)).status).toBe(204);

    const self = await handle(served("/api/users/self"), env);
    expect(self.status).toBe(200);
    expect(self.headers.get("content-type")).toBe("application/json");
    expect(await self.json()).toEqual({ groupId: "g" });
    // The path keeps its encoding, as the move-in asks for it.
    expect(await (await handle(served("/api/recipes/lemon%20rice"), env)).json()).toEqual({ slug: "lemon rice" });
    const photo = await handle(served("/api/media/recipes/r1/images/original.webp"), env);
    expect(photo.headers.get("content-type")).toBe("image/webp");
    expect([...new Uint8Array(await photo.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await handle(served("/api/recipes/missing"), env)).status).toBe(404);
  });

  it("refuses a missing or wrong token, except for the about page a real server answers to anyone", async () => {
    const env = standInEnv();
    await load(env, KITCHEN_ROUTES);
    expect((await handle(served("/api/users/self", null), env)).status).toBe(401);
    expect((await handle(served("/api/users/self", "other-token"), env)).status).toBe(401);
    expect((await handle(served("/api/recipes/missing", "other-token"), env)).status).toBe(401);
    const about = await handle(served(OPEN_PATH, null), env);
    expect(about.status).toBe(200);
    expect(await about.json()).toEqual({ version: "3.31.0" });
  });

  it("counts every path asked for, refused or not, for the journey to read", async () => {
    const env = standInEnv();
    await load(env, KITCHEN_ROUTES);
    await handle(served("/api/users/self"), env);
    await handle(served("/api/users/self", null), env);
    await handle(served("/api/recipes/lemon%20rice"), env);
    const asked = await handle(admin(`${KITCHEN}/asked`), env);
    expect(await asked.json()).toEqual({ "/api/users/self": 2, "/api/recipes/lemon%20rice": 1 });
    expect((await handle(admin(`${KITCHEN}/asked`, { method: "POST" }), env)).status).toBe(405);
  });

  it("answers 404 for a kitchen nobody loaded, or once it is deleted", async () => {
    const env = standInEnv();
    expect((await handle(served(OPEN_PATH, null), env)).status).toBe(404);
    await load(env, KITCHEN_ROUTES);
    expect((await handle(admin(KITCHEN, { method: "DELETE" }), env)).status).toBe(204);
    expect((await handle(served(OPEN_PATH, null), env)).status).toBe(404);
    expect(env.kitchens.get(KITCHEN)!.data.size).toBe(0);
  });

  it("replaces a kitchen loaded again, and keeps each kitchen to its own id", async () => {
    const env = standInEnv();
    await load(env, KITCHEN_ROUTES);
    await handle(served("/api/users/self"), env);
    await load(env, KITCHEN_ROUTES.slice(0, 1));
    expect((await handle(served("/api/users/self"), env)).status).toBe(404);
    expect(await (await handle(admin(`${KITCHEN}/asked`), env)).json()).toEqual({ "/api/users/self": 1 });
    expect((await handle(new Request(`${ORIGIN}/${"f".repeat(32)}${OPEN_PATH}`), env)).status).toBe(404);
  });

  it("stores a large kitchen in batches the storage takes", async () => {
    const env = standInEnv();
    const routes = Array.from({ length: PUT_BATCH * 2 }, (_, index) => ({ path: `/api/recipes/r${index}`, type: "application/json", body: base64("{}") }));
    await load(env, routes);
    expect(env.kitchens.get(KITCHEN)!.puts).toEqual([PUT_BATCH, PUT_BATCH, 1]);
    expect((await handle(served(`/api/recipes/r${PUT_BATCH * 2 - 1}`), env)).status).toBe(200);
  });

  it("opens the loading routes only to the run's secret, and never when the Worker has none", async () => {
    expect((await handle(admin(KITCHEN, { method: "PUT", body: "{}" }, "wrong"), standInEnv())).status).toBe(401);
    expect((await handle(new Request(`${ORIGIN}/_stand-in/kitchens/${KITCHEN}`, { method: "DELETE" }), standInEnv())).status).toBe(401);
    expect((await handle(admin(KITCHEN, { method: "DELETE" }, ""), standInEnv(""))).status).toBe(401);
    const unset = standInEnv();
    delete unset.STAND_IN_SECRET;
    expect((await handle(admin(KITCHEN, { method: "DELETE" }), unset)).status).toBe(401);
  });

  it("refuses a kitchen id that isn't 32 hex characters, and methods it doesn't take", async () => {
    const env = standInEnv();
    expect((await handle(admin("not-a-kitchen", { method: "DELETE" }), env)).status).toBe(404);
    expect((await handle(admin(KITCHEN, { method: "POST" }), env)).status).toBe(405);
    expect((await handle(new Request(`${ORIGIN}/${KITCHEN}/api/users/self`, { method: "POST" }), env)).status).toBe(405);
    expect((await handle(new Request(`${ORIGIN}/nothing`), env)).status).toBe(404);
  });

  it("refuses a load that isn't a kitchen", async () => {
    const env = standInEnv();
    const put = (body: string) => handle(admin(KITCHEN, { method: "PUT", body }), env);
    expect((await put("not json")).status).toBe(400);
    expect((await put(JSON.stringify({ token: TOKEN, routes: [{ path: "/a", type: "text/plain", body: "%%%" }] }))).status).toBe(400);
    expect(env.kitchens.get(KITCHEN)!.data.size).toBe(0);
  });

  it("asks nothing of a kitchen's object for a path it doesn't answer", async () => {
    const env = standInEnv();
    const object = env.KITCHENS.get(env.KITCHENS.idFromName(KITCHEN));
    expect((await object.fetch(new Request("https://kitchen/elsewhere"))).status).toBe(404);
  });
});

describe("parseKitchen", () => {
  it("takes a token and routes with a path, a type and a base64 body", () => {
    const kitchen = parseKitchen({ token: TOKEN, routes: [{ path: "/a", type: "text/plain", body: base64("hi") }] });
    expect(kitchen?.token).toBe(TOKEN);
    expect(new TextDecoder().decode(kitchen?.routes.get("/a")?.body)).toBe("hi");
  });

  it.each([
    ["nothing", null],
    ["a string", "kitchen"],
    ["no token", { routes: [] }],
    ["an empty token", { token: "", routes: [] }],
    ["no routes", { token: TOKEN }],
    ["a missing route", { token: TOKEN, routes: [null] }],
    ["a path without its slash", { token: TOKEN, routes: [{ path: "a", type: "t", body: "" }] }],
    ["no type", { token: TOKEN, routes: [{ path: "/a", body: "" }] }],
    ["a body that isn't text", { token: TOKEN, routes: [{ path: "/a", type: "t", body: 1 }] }],
  ])("refuses %s", (_, body) => {
    expect(parseKitchen(body)).toBeNull();
  });
});

describe("sameText", () => {
  it("is true only for the same text", () => {
    expect(sameText("Bearer a", "Bearer a")).toBe(true);
    expect(sameText("Bearer b", "Bearer a")).toBe(false);
    expect(sameText("Bearer", "Bearer a")).toBe(false);
    expect(sameText("Bearer aa", "Bearer a")).toBe(false);
  });
});
