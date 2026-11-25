// Loaders and the action behind the organizer pages: a cook's list of one kind, one organizer's recipes, and a recipe's
// Organize page, which sets its tags, categories and tools in one save. Every one is the cook's own (organizersRequest).
import type { AppLoadContext } from "react-router";
import { data, redirect } from "react-router";
import { OBJECTIONABLE_CONTENT_MESSAGE, containsObjectionableContent } from "~/lib/objectionable-terms";
import {
  deleteOrganizer,
  listOrganizers,
  mergeOrganizers,
  organizerNames,
  organizerPage,
  organizersOnRecipe,
  renameOrganizerById,
  setRecipeOrganizers,
} from "../application/organizers";
import { ORGANIZER_KINDS, ORGANIZER_NAME_MAX_LENGTH, normalizeOrganizerName, type Organizer, type OrganizerKind } from "../model/organizer";
import { organizerNamesFromForm, organizersRequest } from "./organizers-route.server";
import { repointSmartCookbooks } from "../application/smart-cookbooks";
import { prismaSmartCookbookStore } from "./prisma-smart-cookbook-store";

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
  // The cook's other organizers of this kind, which this one can merge into.
  const others = (await listOrganizers(store, userId, kind))
    .filter(({ organizer }) => organizer.id !== page.organizer.id)
    .map(({ organizer }) => ({ name: organizer.name, slug: organizer.slug }));
  return { organizer: { name: page.organizer.name, slug: page.organizer.slug }, recipes: rows, others };
}

const SEGMENT: Record<OrganizerKind, string> = { tag: "tags", category: "categories", tool: "tools" };

/** An organizer page's own form: rename it, merge it into another of its kind, or delete it. */
export async function organizerPageAction(kind: OrganizerKind, { request, context, slug }: Args & { slug: string }) {
  const { userId, store, db } = await organizersRequest(request, context);
  const page = await organizerPage(store, userId, kind, slug);
  if (!page) notFound();
  const { organizer } = page;
  const form = await request.formData();
  const word = KIND_WORD[kind];
  const refuse = (error: string) => data({ error }, { status: 400 });

  switch (form.get("intent")) {
    case "rename": {
      const name = form.get("name");
      if (typeof name === "string" && containsObjectionableContent(name)) return refuse(OBJECTIONABLE_CONTENT_MESSAGE);
      const result = await renameOrganizerById(store, userId, organizer.id, name);
      if (result.ok) return redirect(`/${SEGMENT[kind]}/${result.organizer.slug}`);
      const refusal: Record<typeof result.reason, string> = {
        taken: `You already have a ${word} called that. Merge them instead.`,
        "invalid-name": `Give the ${word} a name of ${ORGANIZER_NAME_MAX_LENGTH} characters or fewer.`,
        // Deleted in another tab since the page loaded.
        "not-found": `This ${word} is gone.`,
      };
      return refuse(refusal[result.reason]);
    }
    case "merge": {
      const into = (await store.organizersOf(userId, kind)).find(
        (candidate) => candidate.slug === form.get("into") && candidate.id !== organizer.id,
      );
      // Either one may also have gone in another tab since the page loaded.
      if (!into || !(await mergeOrganizers(store, userId, into.id, [organizer.id])).ok) {
        return refuse(`Choose another ${word} to merge into.`);
      }
      // Smart cookbooks that used the merged one now use the one it merged into, whether or not their flag is on.
      await repointSmartCookbooks(prismaSmartCookbookStore(db), userId, [organizer.id], into.id);
      return redirect(`/${SEGMENT[kind]}/${into.slug}`);
    }
    case "delete":
      // Gone already (another tab) ends in the same place.
      await deleteOrganizer(store, userId, organizer.id);
      return redirect(`/${SEGMENT[kind]}`);
    default:
      return refuse("Choose Rename, Merge or Delete.");
  }
}

export async function recipeOrganizeLoader({ request, context, recipeId }: Args & { recipeId: string }) {
  const { userId, store, db } = await organizersRequest(request, context);
  const recipe = await db.recipe.findFirst({ where: { id: recipeId, chefId: userId, deletedAt: null }, select: { id: true, title: true } });
  if (!recipe) notFound();
  const [tags, categories, tools] = await Promise.all(ORGANIZER_KINDS.map((kind) => organizersOnRecipe(store, recipe.id, kind)));
  // Every one the cook has of each kind, so typing "weeknight" offers their "Weeknight" instead of starting another.
  const [tagChoices, categoryChoices, toolChoices] = await Promise.all(
    ORGANIZER_KINDS.map((kind) => organizerNames(store, userId, kind)),
  );
  return {
    recipe,
    tags: named(tags),
    categories: named(categories),
    tools: named(tools),
    choices: { tags: tagChoices, categories: categoryChoices, tools: toolChoices },
  };
}

export async function recipeOrganizeAction({ request, context, recipeId }: Args & { recipeId: string }) {
  const { userId, store } = await organizersRequest(request, context);
  if ((await store.liveRecipeChefId(recipeId)) !== userId) notFound();
  const form = await request.formData();
  // A kind the form leaves out stays as it is; a shown one with no chips (or an empty field) clears it.
  const names = ORGANIZER_KINDS.flatMap((kind) => {
    const typed = organizerNamesFromForm(form, ORGANIZE_FIELDS[kind]);
    return typed ? [[kind, typed] as const] : [];
  });
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
