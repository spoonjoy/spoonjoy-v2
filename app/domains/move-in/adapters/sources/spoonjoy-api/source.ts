// Another Spoonjoy as a move-in source: spoonjoy.app, or a cook's own server running the same app (docs/self-hosting.md),
// read through its REST API with an API token the cook made there. So one source moves a kitchen both ways: from
// spoonjoy.app into a self-hosted Spoonjoy, and from a self-hosted one back. It asks for the token's account export
// (GET /api/v1/me/export) once when a kitchen opens, which holds every recipe with its steps, ingredients, tags,
// categories and tools, then for each recipe's photo only when the move-in reaches it.
import { SourceUnavailableError, type KitchenEntry, type MoveInKitchen, type MoveInSource } from "../../../application/source";
import { MoveInError } from "../../../model/move-in-error";
import { UNTITLED_RECIPE, type RecipeDraft } from "../../../model/recipe-draft";
import { AnswerError, messageOf, serverApiClient, type ServerApiClient, type ServerApiConnection } from "../server-api/client";
import { list, names, photoPathOf, SPOONJOY_KIND, spoonjoyRecipeDraft, text } from "./recipe";

/** The app a Spoonjoy kitchen lives in, as its Source row records it. */
export const SPOONJOY_SOURCE_KIND = SPOONJOY_KIND;

/** The account export's format, which this source reads. */
const EXPORT_FORMAT = "spoonjoy.account-export.v1";

type Json = Record<string, unknown>;

interface Listed extends KitchenEntry {
  recipe: Json;
  createdAt: number;
}

/** What the API answered inside its envelope ({ ok, data }), or null when it isn't one. */
function dataOf(answer: unknown): Json | null {
  const envelope = answer as { ok?: unknown; data?: unknown } | null;
  return envelope?.ok === true && envelope.data && typeof envelope.data === "object" ? (envelope.data as Json) : null;
}

/**
 * Asks the server whether it is a Spoonjoy and which build it runs. Its health check answers without a sign-in, so
 * anything else at the address, a sign-in page in front of it included, isn't a Spoonjoy.
 */
async function versionAt(api: ServerApiClient): Promise<string> {
  const health = dataOf(
    await api.json("/api/v1/health").catch((error: unknown) => {
      if (error instanceof SourceUnavailableError || error instanceof MoveInError) throw error;
      throw new MoveInError("server-address", messageOf(error));
    }),
  );
  if (health?.version !== "v1") throw new MoveInError("server-address", "the server didn't answer like a Spoonjoy");
  const build = text(health.sourceSha);
  return build ? `v1 (${build.slice(0, 12)})` : "v1";
}

/** The token's account export, which holds the kitchen. */
async function exportAt(api: ServerApiClient): Promise<Json> {
  const exported = dataOf(await api.json("/api/v1/me/export"));
  if (exported?.format !== EXPORT_FORMAT) throw new MoveInError("server-address", "the server's export isn't one this Spoonjoy reads");
  return exported;
}

/**
 * `home` is this Spoonjoy's own address (SPOONJOY_BASE_URL), so a recipe that moved out of it and is moving back is
 * found again; without it, every recipe moves in as the other Spoonjoy's.
 */
export async function spoonjoyApiSource(connection: ServerApiConnection, home: string | null = null): Promise<MoveInSource> {
  // Asking for the token's own account needs the server's database, as the export does.
  const api = serverApiClient(connection, { probePath: "/api/v1/me" });
  const version = await versionAt(api);
  const exported = await exportAt(api);
  // The export read to start is used by the first kitchen opened; each later one reads it again, since the kitchen
  // can change while it moves in.
  let unread: Json | null = exported;
  const account = (exported.account ?? {}) as Json;
  const kitchenKey = text(account.id);
  if (!kitchenKey) throw new MoveInError("server-token", "the server has no account for this token");
  const name = text(account.username) ?? "Kitchen";

  async function openKitchen(key: string): Promise<MoveInKitchen | null> {
    if (key !== kitchenKey) return null;
    const current = unread ?? (await exportAt(api));
    unread = null;
    // A recipe the cook deleted there stays behind. Oldest first, then by key, so every run goes through the same
    // order, and a recipe added meanwhile goes last.
    const listed: Listed[] = list(current.recipes)
      .filter((recipe) => !recipe.deletedAt)
      .map((recipe) => ({
        sourceKey: String(recipe.id),
        title: text(recipe.title) ?? UNTITLED_RECIPE,
        recipe,
        createdAt: Date.parse(String(recipe.createdAt)) || 0,
      }))
      .sort((a, b) => a.createdAt - b.createdAt || a.sourceKey.localeCompare(b.sourceKey));
    const counted = (field: string) => new Set(listed.flatMap(({ recipe }) => names(recipe[field]))).size;
    return {
      key,
      name,
      size: listed.length,
      count: async () => ({
        photos: listed.filter(({ recipe }) => photoPathOf(recipe) !== "").length,
        tags: counted("tags"),
        categories: counted("categories"),
        tools: counted("tools"),
      }),
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
      draft: async (index) => spoonjoyRecipeDraft(listed[index].recipe, kitchenKey as string, home),
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
    kind: SPOONJOY_SOURCE_KIND,
    serverUrl: api.base,
    words: { there: "on your other Spoonjoy", again: "Moving in from your other Spoonjoy again" },
    version,
    chooseKitchen: async () => kitchenKey,
    openKitchen,
  };
}
