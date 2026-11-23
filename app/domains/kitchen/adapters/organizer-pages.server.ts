// Loaders and the action behind the organizer pages: a cook's list of one kind, one organizer's recipes, and a recipe's
// Organize page, which sets its tags, categories and tools in one save. Every one is the cook's own and behind the
// organizers flag (organizersRequest).
import type { AppLoadContext } from "react-router";
import { data } from "react-router";
import { OBJECTIONABLE_CONTENT_MESSAGE, containsObjectionableContent } from "~/lib/objectionable-terms";
import { listOrganizers, organizerPage, organizersOnRecipe, setRecipeOrganizers } from "../application/organizers";
import { ORGANIZER_KINDS, ORGANIZER_NAME_MAX_LENGTH, normalizeOrganizerName, type Organizer, type OrganizerKind } from "../model/organizer";
import { organizerNamesFromInput, organizersRequest } from "./organizers-route.server";

type Args = { request: Request; context: AppLoadContext };

function notFound(): never {
  throw new Response("Not Found", { status: 404 });
}

const named = (organizers: Organizer[]) => organizers.map(({ name, slug }) => ({ name, slug }));

/** The form field and loader key each kind uses on a recipe's Organize page. */
export const ORGANIZE_FIELDS = { tag: "tags", category: "categories", tool: "tools" } as const satisfies Record<OrganizerKind, string>;

/** What the kind is called in a refusal ("Keep each category to 60 characters or fewer."). */
const KIND_WORD: Record<OrganizerKind, string> = { tag: "tag", category: "category", tool: "tool" };

export async function organizerListLoader(kind: OrganizerKind, { request, context }: Args) {
  const { userId, store } = await organizersRequest(request, context);
  const organizers = await listOrganizers(store, userId, kind);
  return { organizers: organizers.map(({ organizer, recipeCount }) => ({ name: organizer.name, slug: organizer.slug, recipeCount })) };
}

export async function organizerPageLoader(kind: OrganizerKind, { request, context, slug }: Args & { slug: string }) {
  const { userId, store, db } = await organizersRequest(request, context);
  const page = await organizerPage(store, userId, kind, slug);
  if (!page) notFound();
  const rows = await db.recipe.findMany({ where: { id: { in: page.recipeIds } }, select: { id: true, title: true, description: true } });
  // Keep the page's order: most recently changed first.
  const order = new Map(page.recipeIds.map((id, index) => [id, index]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { organizer: { name: page.organizer.name, slug: page.organizer.slug }, recipes: rows };
}

export async function recipeOrganizeLoader({ request, context, recipeId }: Args & { recipeId: string }) {
  const { userId, store, db } = await organizersRequest(request, context);
  const recipe = await db.recipe.findFirst({ where: { id: recipeId, chefId: userId, deletedAt: null }, select: { id: true, title: true } });
  if (!recipe) notFound();
  const [tags, categories, tools] = await Promise.all(ORGANIZER_KINDS.map((kind) => organizersOnRecipe(store, recipe.id, kind)));
  return { recipe, tags: named(tags), categories: named(categories), tools: named(tools) };
}

export async function recipeOrganizeAction({ request, context, recipeId }: Args & { recipeId: string }) {
  const { userId, store } = await organizersRequest(request, context);
  if ((await store.liveRecipeChefId(recipeId)) !== userId) notFound();
  const form = await request.formData();
  // A kind the form leaves out stays as it is; an empty field clears it.
  const names = ORGANIZER_KINDS.filter((kind) => form.has(ORGANIZE_FIELDS[kind])).map(
    (kind) => [kind, organizerNamesFromInput(form.get(ORGANIZE_FIELDS[kind]))] as const,
  );
  if (names.some(([, typed]) => typed.some((name) => containsObjectionableContent(name)))) {
    return data({ error: OBJECTIONABLE_CONTENT_MESSAGE }, { status: 400 });
  }
  // A name the model refuses though it has text is too long; empty entries between commas are skipped.
  const tooLong = names.find(([, typed]) => typed.some((name) => name.trim() !== "" && normalizeOrganizerName(name) === null));
  if (tooLong) {
    return data({ error: `Keep each ${KIND_WORD[tooLong[0]]} to ${ORGANIZER_NAME_MAX_LENGTH} characters or fewer.` }, { status: 400 });
  }
  for (const [kind, typed] of names) {
    // Ownership is checked above; a recipe deleted since then is left alone.
    await setRecipeOrganizers(store, userId, recipeId, kind, typed);
  }
  return { saved: true as const };
}
