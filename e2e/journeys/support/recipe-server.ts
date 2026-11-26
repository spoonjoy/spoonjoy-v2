// A stand-in for the other recipe app's server, for the Move in journey that moves a kitchen in from its server. It
// answers the API a move-in reads with one proof kitchen: its recipes exactly as that version's server returned them
// when the proof fixtures were made, and their photos from the same kitchen's backup. The answers are served by the
// run's stand-in Worker (workers/move-in-stand-in), which the Journeys workflow deploys beside the run's QA Worker
// (scripts/qa-run-scope.mjs stand-in) and exports as SPOONJOY_MOVE_IN_STAND_IN_URL and _SECRET. Each journey loads
// its kitchen there under a fresh id and token, so the QA Worker reads it at an https address over the network as it
// would a cook's own server, and only that token opens it, as a real server's API token would.
import { randomBytes } from "node:crypto";
import { bytesSource, type ZipArchive } from "../../../app/domains/move-in/adapters/archive/zip";
import { openMealieBackup } from "../../../app/domains/move-in/adapters/sources/mealie-backup/backup";
import { chooseGroup, recipeDrafts } from "../../../app/domains/move-in/adapters/sources/mealie-backup/database";
import { normalizeGuid } from "../../../app/domains/move-in/model/source-key";

type Json = Record<string, unknown>;

const RECIPE_MAX_BYTES = 1024 * 1024;
const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
// Loading a kitchen is one request to the stand-in; a blip on the runner's network gets a few more tries.
const LOAD_TRIES = 4;
const ASK_MS = 15_000;

export interface RecipeServer {
  /** The https address the QA Worker reaches the stand-in at. */
  address: string;
  token: string;
  /** How many times each path was asked for, so a journey can see the move-in read the server. */
  asked(): Promise<Map<string, number>>;
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

/** The stand-in's address and the secret that opens its loading routes, which the Journeys workflow exports. */
function standIn(): { origin: string; secret: string } {
  const origin = process.env.SPOONJOY_MOVE_IN_STAND_IN_URL ?? "";
  const secret = process.env.SPOONJOY_MOVE_IN_STAND_IN_SECRET ?? "";
  if (!origin || !secret) {
    throw new Error("SPOONJOY_MOVE_IN_STAND_IN_URL and SPOONJOY_MOVE_IN_STAND_IN_SECRET are unset: the Journeys workflow's stand-in step (scripts/qa-run-scope.mjs stand-in) sets them");
  }
  return { origin: origin.replace(/\/+$/, ""), secret };
}

/** One request to the stand-in, tried again after a network failure or a server error. */
async function ask(url: string, init: RequestInit, what: string): Promise<Response> {
  let failure = "";
  for (let attempt = 1; attempt <= LOAD_TRIES; attempt += 1) {
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    const answer = await fetch(url, { ...init, signal: AbortSignal.timeout(ASK_MS) }).catch((error: Error) => error);
    if (answer instanceof Error) failure = answer.message;
    else if (answer.status >= 500) failure = `HTTP ${answer.status}`;
    else if (!answer.ok) throw new Error(`The Move in stand-in refused to ${what}: HTTP ${answer.status}`);
    else return answer;
  }
  throw new Error(`The Move in stand-in didn't ${what} in ${LOAD_TRIES} tries: ${failure}`);
}

/** Loads one version's small kitchen into the run's stand-in, under an id and a token made for this journey. */
export async function startRecipeServer(bundle: ZipArchive, version: string): Promise<RecipeServer> {
  const { origin, secret } = standIn();
  const { json, photos, readPhoto } = await kitchenRoutes(bundle, version);
  const kitchen = randomBytes(16).toString("hex");
  const token = randomBytes(24).toString("hex");
  const routes = [...json].map(([path, value]) => ({ path, type: "application/json", body: Buffer.from(JSON.stringify(value)).toString("base64") }));
  for (const [path, photo] of photos) {
    const bytes = await readPhoto(photo);
    if (bytes) routes.push({ path, type: "image/webp", body: Buffer.from(bytes).toString("base64") });
  }
  const admin = `${origin}/_stand-in/kitchens/${kitchen}`;
  const opened = { authorization: `Bearer ${secret}` };
  await ask(admin, { method: "PUT", headers: { ...opened, "content-type": "application/json" }, body: JSON.stringify({ token, routes }) }, "load the kitchen");
  const address = `${origin}/${kitchen}`;
  // The kitchen answers its token from here, as it will the QA Worker.
  await ask(`${address}/api/users/self`, { headers: { authorization: `Bearer ${token}` } }, "answer the kitchen's token");
  return {
    address,
    token,
    asked: async () => new Map(Object.entries((await (await ask(`${admin}/asked`, { headers: opened }, "say what was asked")).json()) as Record<string, number>)),
    close: async () => {
      // The run's teardown deletes the stand-in with everything in it, so a kitchen left here goes with it.
      await fetch(admin, { method: "DELETE", headers: opened, signal: AbortSignal.timeout(ASK_MS) }).catch(() => undefined);
    },
  };
}
