// The other app's own server as a move-in source, read with an API token the cook made there. It asks for the token's
// kitchen and its recipe list once when a kitchen opens, then for each recipe and photo only when the move-in reaches
// it, so a large kitchen never has to fit in one request or one run.
import { SourceUnavailableError, type KitchenEntry, type MoveInKitchen, type MoveInSource } from "../../../application/source";
import { MoveInError } from "../../../model/move-in-error";
import { UNTITLED_RECIPE, type RecipeDraft } from "../../../model/recipe-draft";
import { normalizeGuid } from "../../../model/source-key";
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

function baseOf(address: string): URL {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    throw new MoveInError("server-address", "not a web address");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new MoveInError("server-address", `${url.protocol} isn't a web address`);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function client({ address, token, fetch }: MealieApiConnection) {
  const base = baseOf(address);
  const request = async (path: string): Promise<Response> => {
    let response: Response;
    try {
      response = await fetch(`${base.href.replace(/\/$/, "")}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    } catch (error) {
      throw new SourceUnavailableError(`the recipe server can't be reached: ${messageOf(error)}`);
    }
    if (response.status === 401 || response.status === 403) throw new MoveInError("server-token", `${path} answered ${response.status}`);
    if (response.status === 429 || response.status >= 500) throw new SourceUnavailableError(`the recipe server answered ${response.status} for ${path}`);
    if (!response.ok) throw new Error(`the recipe server answered ${response.status} for ${path}`);
    return response;
  };
  return {
    request,
    json: async (path: string): Promise<unknown> => (await request(path)).json(),
    bytes: async (path: string): Promise<Uint8Array> => new Uint8Array(await (await request(path)).arrayBuffer()),
  };
}

/** Asks which version of the app answers at the address; anything else at that address isn't the recipe app. */
async function versionAt(api: ReturnType<typeof client>): Promise<string> {
  const about = await api.json("/api/app/about").catch((error: unknown) => {
    if (error instanceof SourceUnavailableError || error instanceof MoveInError) throw error;
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
  // The server names the kitchen by its group's name.
  const name = text(self.group) ?? "Kitchen";

  async function openKitchen(key: string): Promise<MoveInKitchen | null> {
    if (!kitchenKey || key !== kitchenKey) return null;
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
      draft: async (index) => apiRecipeDraft((await api.json(`/api/recipes/${encodeURIComponent(listed[index].slug)}`)) as Json),
      hasPhoto: (draft: RecipeDraft) => draft.photoPath !== "",
      async readPhoto(draft) {
        return api.bytes(draft.photoPath).catch((error: unknown) => {
          if (error instanceof SourceUnavailableError || error instanceof MoveInError) throw error;
          throw new Error("the server has no photo for this recipe");
        });
      },
    };
  }

  return {
    version,
    chooseKitchen: async () => kitchenKey,
    openKitchen,
  };
}
