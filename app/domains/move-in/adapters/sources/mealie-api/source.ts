// The other app's own server as a move-in source, read with an API token the cook made there. It asks for the token's
// kitchen and its recipe list once when a kitchen opens, then for each recipe and photo only when the move-in reaches
// it, so a large kitchen never has to fit in one request or one run.
import { SourceUnavailableError, type KitchenEntry, type MoveInKitchen, type MoveInSource } from "../../../application/source";
import { MoveInError } from "../../../model/move-in-error";
import { UNTITLED_RECIPE, type RecipeDraft } from "../../../model/recipe-draft";
import { normalizeGuid } from "../../../model/source-key";
import { MEALIE_SOURCE_KIND } from "../mealie-backup/source";
import { apiRecipeDraft, recipeKey, text } from "./recipe";

export interface MealieApiConnection {
  /** Where the cook opens the app, such as https://recipes.example.com. */
  address: string;
  token: string;
  fetch: typeof globalThis.fetch;
}

type Json = Record<string, unknown>;

interface Listed extends KitchenEntry {
  slug: string;
  hasPhoto: boolean;
  createdAt: number;
}

function itemsOf(page: unknown): Json[] {
  const items = Array.isArray(page) ? page : (page as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items.filter((item): item is Json => Boolean(item) && typeof item === "object") : [];
}

// The cook's token goes only to the address they gave, over https, and the move-in waits only so long for each answer
// and reads only so much of it, so a slow or strange server can't hold a run past its time or its memory.
// The answer has to start within HEADERS_MS; its body then has BODY_MS more, so a large photo on a slow home upload
// still arrives. One recipe's worst case is two tries of an answer and a check that the server is up, plus its photo,
// about 150 s: it has to stay under the move-in's claim lease (leaseSeconds in move-in-job.server.ts, 300 s).
const HEADERS_MS = 10_000;
const BODY_MS = 15_000;
const JSON_MAX_BYTES = 16 * 1024 * 1024;
const PHOTO_MAX_BYTES = 20 * 1024 * 1024;

function baseOf(address: string): URL {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    throw new MoveInError("server-address", "not a web address");
  }
  // Plain http would carry the token across the internet in the clear.
  if (url.protocol !== "https:") throw new MoveInError("server-address", `${url.protocol} isn't https`);
  // A name and password in the address would be kept with it and sent beside the token: the token is all it needs.
  if (url.username || url.password) throw new MoveInError("server-address", "the address has a name or password in it");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The server answered, but not with what was asked for: a status it shouldn't give, or more than the move-in reads. */
class AnswerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AnswerError";
  }
}

/** The server, or a proxy in front of it, asked the move-in to slow down: an outage however well the server answers. */
class RateLimitedError extends SourceUnavailableError {}

/** The body, up to `maxBytes`; a body cut off partway is an outage, like a server that can't be reached. */
async function readBody(response: Response, path: string, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AnswerError(response.status, `the recipe server's answer for ${path} is larger than ${maxBytes / 1024 / 1024} MB`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AnswerError) throw error;
    throw new SourceUnavailableError(`the recipe server stopped answering partway: ${messageOf(error)}`);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

function client({ address, token, fetch }: MealieApiConnection) {
  const base = baseOf(address).href.replace(/\/$/, "");
  const request = async (path: string, maxBytes: number): Promise<Uint8Array> => {
    let response: Response;
    const timer = new AbortController();
    const headers = setTimeout(() => timer.abort(new Error("the server took too long to answer")), HEADERS_MS);
    try {
      response = await fetch(`${base}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        // A redirect could carry the token to another server, so the move-in never follows one.
        redirect: "manual",
        signal: timer.signal,
      });
    } catch (error) {
      throw new SourceUnavailableError(`the recipe server can't be reached: ${messageOf(error)}`);
    } finally {
      clearTimeout(headers);
    }
    if (response.status === 401 || response.status === 403) throw new MoveInError("server-token", `${path} answered ${response.status}`);
    if (response.status === 429) throw new RateLimitedError(`the recipe server asked the move-in to slow down at ${path}`);
    if (response.status >= 500) throw new SourceUnavailableError(`the recipe server answered ${response.status} for ${path}`);
    if (response.status !== 200) throw new AnswerError(response.status, `the recipe server answered ${response.status} for ${path}`);
    const body = setTimeout(() => timer.abort(new Error("the answer took too long to arrive")), BODY_MS);
    try {
      return await readBody(response, path, maxBytes);
    } finally {
      clearTimeout(body);
    }
  };
  return {
    /** The address with no trailing slash, as the move-in keeps it. */
    base,
    json: async (path: string): Promise<unknown> => JSON.parse(new TextDecoder().decode(await request(path, JSON_MAX_BYTES))),
    bytes: (path: string): Promise<Uint8Array> => request(path, PHOTO_MAX_BYTES),
    /**
     * An outage while asking for one recipe or photo is the server's only if the server is down as a whole: when it
     * still answers, the trouble is that one item's, which counts against it like any failure, so it's passed over.
     * The check asks for the token's own account, which needs the server's database as recipes do: the app's about
     * page answers even while its database is down.
     */
    async itemOutage(error: unknown): Promise<never> {
      if (!(error instanceof SourceUnavailableError) || error instanceof RateLimitedError) throw error;
      const answers = await request("/api/users/self", JSON_MAX_BYTES).then(
        () => true,
        (probe: unknown) => {
          if (probe instanceof MoveInError) throw probe;
          return false;
        },
      );
      if (answers) throw new Error(`the recipe server couldn't give this one: ${error.message}`);
      throw error;
    },
  };
}

/**
 * Asks which version of the app answers at the address. Anything else there isn't the recipe app; that includes a
 * sign-in page in front of it, since the app answers this without one.
 */
async function versionAt(api: ReturnType<typeof client>): Promise<string> {
  const about = await api.json("/api/app/about").catch((error: unknown) => {
    if (error instanceof SourceUnavailableError) throw error;
    throw new MoveInError("server-address", messageOf(error));
  });
  const version = text((about as Json | null)?.version);
  if (!version) throw new MoveInError("server-address", "the server didn't say which version it runs");
  return /^\d/.test(version) ? `v${version}` : version;
}

export async function mealieApiSource(connection: MealieApiConnection): Promise<MoveInSource> {
  const api = client(connection);
  const version = await versionAt(api);
  const self = (await api.json("/api/users/self")) as Json;
  const kitchenKey = normalizeGuid(self.groupId);
  if (!kitchenKey) throw new MoveInError("server-token", "the server has no kitchen for this token");
  // The server names the kitchen by its group's name.
  const name = text(self.group) ?? "Kitchen";

  async function openKitchen(key: string): Promise<MoveInKitchen | null> {
    if (key !== kitchenKey) return null;
    // Oldest first, then by key, so every run counts through the same order and a recipe added meanwhile goes last.
    const listed: Listed[] = itemsOf(await api.json("/api/recipes?page=1&perPage=-1"))
      .map((item) => ({
        sourceKey: recipeKey(item.id),
        title: text(item.name) ?? UNTITLED_RECIPE,
        slug: String(item.slug),
        hasPhoto: Boolean(text(item.image)),
        createdAt: Date.parse(String(item.createdAt)) || 0,
      }))
      .sort((a, b) => a.createdAt - b.createdAt || a.sourceKey.localeCompare(b.sourceKey));
    const counted = async (organizer: string) => itemsOf(await api.json(`/api/organizers/${organizer}?page=1&perPage=-1`)).length;
    return {
      key,
      name,
      size: listed.length,
      async count() {
        const [tags, categories, tools] = await Promise.all([counted("tags"), counted("categories"), counted("tools")]);
        return { photos: listed.filter((recipe) => recipe.hasPhoto).length, tags, categories, tools };
      },
      entry: (index) => ({ sourceKey: listed[index].sourceKey, title: listed[index].title }),
      draft: async (index) =>
        apiRecipeDraft((await api.json(`/api/recipes/${encodeURIComponent(listed[index].slug)}`).catch(api.itemOutage)) as Json),
      hasPhoto: (draft: RecipeDraft) => draft.photoPath !== "",
      async readPhoto(draft) {
        return api.bytes(draft.photoPath).catch(api.itemOutage).catch((error: unknown) => {
          if (error instanceof AnswerError && error.status !== 200) throw new Error("the server has no photo for this recipe");
          throw error;
        });
      },
    };
  }

  return {
    // The same app as its backups, so a kitchen moved in from either brings each recipe once.
    kind: MEALIE_SOURCE_KIND,
    serverUrl: api.base,
    words: { there: "on your recipe server", again: "Moving in from your server again" },
    version,
    chooseKitchen: async () => kitchenKey,
    openKitchen,
  };
}
