// A stand-in for the other recipe app's server, for the Move in journey that moves a kitchen in from its server. It
// answers the API a move-in reads with one proof kitchen: its recipes exactly as that version's server returned them
// when the proof fixtures were made, and their photos from the same kitchen's backup. It runs on the journey's runner,
// and a Cloudflare quick tunnel gives it the https address the QA Worker reaches it at. Only the per-run token opens
// it, as a real server's API token would.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { bytesSource, type ZipArchive } from "../../../app/domains/move-in/adapters/archive/zip";
import { openMealieBackup } from "../../../app/domains/move-in/adapters/sources/mealie-backup/backup";
import { chooseGroup, recipeDrafts } from "../../../app/domains/move-in/adapters/sources/mealie-backup/database";
import { normalizeGuid } from "../../../app/domains/move-in/model/source-key";

type Json = Record<string, unknown>;

const RECIPE_MAX_BYTES = 1024 * 1024;
const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
// A quick tunnel's address can take a little while to answer once cloudflared prints it. A quick tunnel promises
// nothing, so a bad one is replaced with a fresh one, on a new address, a few times before the journey gives up.
const TUNNEL_MS = 45_000;
const TUNNEL_TRIES = 3;
const READY_ASK_MS = 10_000;

export interface RecipeServer {
  /** The https address the QA Worker reaches the stand-in at. */
  address: string;
  token: string;
  /** How many times each path was asked for, so a journey can see the move-in read the server. */
  asked: Map<string, number>;
  close(): Promise<void>;
}

/** The routes a move-in reads, from one version's small kitchen in the proof fixtures. */
async function kitchenRoutes(bundle: ZipArchive, version: string) {
  const folder = `${version}/small/`;
  const recipes: Json[] = [];
  for (const entry of bundle.entries) {
    if (!entry.name.startsWith(`${folder}recipes/`) || !entry.name.endsWith(".json")) continue;
    recipes.push(JSON.parse(new TextDecoder().decode(await bundle.read(entry, { maxBytes: RECIPE_MAX_BYTES }))) as Json);
  }
  if (!recipes.length) throw new Error(`The proof fixtures have no recipes for ${folder}`);
  const backupEntry = bundle.get(`${folder}backup.zip`);
  if (!backupEntry) throw new Error(`The proof fixtures have no ${folder}backup.zip`);
  const backup = await openMealieBackup(bytesSource(await bundle.read(backupEntry, { maxBytes: BACKUP_MAX_BYTES })));
  const photoPaths = new Map(recipeDrafts(backup.database, chooseGroup(backup.database, null) as string).map((draft) => [draft.sourceKey, draft.photoPath]));

  const json = new Map<string, unknown>([
    ["/api/app/about", { version: version.replace(/^v/, "") }],
    ["/api/users/self", { id: recipes[0].userId, group: "Home", groupId: recipes[0].groupId }],
    ["/api/recipes", { items: recipes.map(({ id, slug, name, image, createdAt, updatedAt, updateAt }) => ({ id, slug, name, image, createdAt, updatedAt, updateAt })) }],
  ]);
  for (const [kind, field] of [["tags", "tags"], ["categories", "recipeCategory"], ["tools", "tools"]] as const) {
    const names = new Set(recipes.flatMap((recipe) => (Array.isArray(recipe[field]) ? (recipe[field] as Json[]).map((item) => String(item.name)) : [])));
    json.set(`/api/organizers/${kind}`, { items: [...names].map((name) => ({ name })) });
  }
  const photos = new Map<string, string>();
  for (const recipe of recipes) {
    json.set(`/api/recipes/${encodeURIComponent(String(recipe.slug))}`, recipe);
    const path = photoPaths.get(normalizeGuid(recipe.id) ?? "");
    if (recipe.image && path && backup.hasFile(path)) photos.set(`/api/media/recipes/${encodeURIComponent(String(recipe.id))}/images/original.webp`, path);
  }
  return { json, photos, readPhoto: (path: string) => backup.readFile(path) };
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
  });
}

/** Stops cloudflared and waits until it has exited, killing it outright if it is still running after 5 s. */
function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const hard = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(hard);
      resolve();
    });
    child.kill();
  });
}

/** One quick tunnel to the port, once its address answers; cloudflared is stopped on every way this fails. */
async function openTunnel(port: number, token: string): Promise<{ address: string; process: ChildProcess }> {
  const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  let exited: Error | null = null;
  child.once("exit", (code, signal) => {
    exited = new Error(`cloudflared exited (${signal ?? code})`);
  });
  try {
    const address = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("cloudflared printed no tunnel address")), TUNNEL_MS);
      const read = (chunk: Buffer) => {
        const found = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(chunk.toString());
        if (found) {
          clearTimeout(timer);
          resolve(found[0]);
        }
      };
      child.stdout?.on("data", read);
      child.stderr?.on("data", read);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`cloudflared didn't start: ${error.message}`));
      });
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        reject(new Error(`cloudflared exited (${signal ?? code}) before printing a tunnel address`));
      });
    });
    const until = Date.now() + TUNNEL_MS;
    for (;;) {
      if (exited) throw exited;
      const answer = await fetch(`${address}/api/users/self`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(READY_ASK_MS) }).catch(() => null);
      if (answer?.ok) return { address, process: child };
      if (Date.now() > until) throw new Error(`The tunnel at ${address} didn't answer within ${TUNNEL_MS / 1000} s`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (error) {
    await stop(child);
    throw error;
  }
}

/** A quick tunnel to the port, trying a fresh one when one fails. */
async function tunnel(port: number, token: string): Promise<{ address: string; process: ChildProcess }> {
  const failures: string[] = [];
  for (let attempt = 1; attempt <= TUNNEL_TRIES; attempt += 1) {
    try {
      return await openTunnel(port, token);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`No quick tunnel answered in ${TUNNEL_TRIES} tries: ${failures.join("; ")}`);
}

/** Starts the stand-in for one version's small kitchen, behind a quick tunnel and a token made for this run. */
export async function startRecipeServer(bundle: ZipArchive, version: string): Promise<RecipeServer> {
  const { json, photos, readPhoto } = await kitchenRoutes(bundle, version);
  const token = randomBytes(24).toString("hex");
  const asked = new Map<string, number>();
  const server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? "/", "http://stand-in").pathname;
      asked.set(path, (asked.get(path) ?? 0) + 1);
      if (path !== "/api/app/about" && request.headers.authorization !== `Bearer ${token}`) return response.writeHead(401).end();
      const photo = photos.get(path);
      const bytes = photo ? await readPhoto(photo) : null;
      if (bytes) return response.writeHead(200, { "content-type": "image/webp" }).end(bytes);
      if (!json.has(path)) return response.writeHead(404).end();
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(json.get(path)));
    })().catch(() => response.writeHead(500).end());
  });
  const port = await listen(server);
  const shut = () => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  };
  const opened = await tunnel(port, token).catch(async (error: unknown) => {
    await shut();
    throw error;
  });
  return {
    address: opened.address,
    token,
    asked,
    close: async () => {
      await stop(opened.process);
      await shut();
    },
  };
}
