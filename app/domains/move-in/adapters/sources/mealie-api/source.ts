// The other app's own server as a move-in source, read with an API token the cook made there. It asks for the token's
// kitchen and its recipe list once when a kitchen opens, then for each recipe and photo only when the move-in reaches
// it, so a large kitchen never has to fit in one request or one run.
import { SourceUnavailableError, type KitchenEntry, type MoveInKitchen, type MoveInSource } from "../../../application/source";
import { MoveInError } from "../../../model/move-in-error";
import { UNTITLED_RECIPE, type RecipeDraft } from "../../../model/recipe-draft";
import { normalizeGuid } from "../../../model/source-key";
import { MEALIE_SOURCE_KIND } from "../mealie-backup/source";
import { AnswerError, messageOf, serverApiClient, type ServerApiClient, type ServerApiConnection } from "../server-api/client";
import { apiRecipeDraft, recipeKey, text } from "./recipe";

export { BUSY_DEFAULT_MS, BUSY_MAX_MS, BUSY_MIN_MS, retryAfterMs } from "../server-api/client";

/** Where the cook's Mealie is, and their token for it. */
export type MealieApiConnection = ServerApiConnection;

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

/**
 * Asks which version of the app answers at the address. Anything else there isn't the recipe app; that includes a
 * sign-in page in front of it, since the app answers this without one.
 */
async function versionAt(api: ServerApiClient): Promise<string> {
  const about = await api.json("/api/app/about").catch((error: unknown) => {
    if (error instanceof SourceUnavailableError) throw error;
    throw new MoveInError("server-address", messageOf(error));
  });
  const version = text((about as Json | null)?.version);
  if (!version) throw new MoveInError("server-address", "the server didn't say which version it runs");
  return /^\d/.test(version) ? `v${version}` : version;
}

export async function mealieApiSource(connection: MealieApiConnection): Promise<MoveInSource> {
  const api = serverApiClient(connection, { probePath: "/api/users/self" });
  const version = await versionAt(api);
  const self = (await api.json("/api/users/self")) as Json;
  const kitchenKey = normalizeGuid(self.groupId);
  if (!kitchenKey) throw new MoveInError("server-token", "the server has no kitchen for this token");
  // The server names the kitchen by its group's name.
  const name = text(self.group) ?? "Kitchen";

  async function openKitchen(key: string): Promise<MoveInKitchen | null> {
    if (key !== kitchenKey) return null;
    // Oldest first, then by key, so every run goes through the same order. A recipe added meanwhile is newer, so it goes
    // last; one the server dates earlier than the place the move-in has reached would wait for the next move-in.
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
      // The cook can delete or add recipes while the move-in runs, so the job keeps the last recipe's place in the order
      // rather than a count, which a recipe deleted before it would push one recipe past.
      mark: (index) => `${listed[index].createdAt}:${listed[index].sourceKey}`,
      indexAfter(mark) {
        const split = mark.indexOf(":");
        const createdAt = Number(mark.slice(0, split));
        const sourceKey = mark.slice(split + 1);
        const next = listed.findIndex((recipe) => recipe.createdAt > createdAt || (recipe.createdAt === createdAt && recipe.sourceKey.localeCompare(sourceKey) > 0));
        return next === -1 ? listed.length : next;
      },
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
