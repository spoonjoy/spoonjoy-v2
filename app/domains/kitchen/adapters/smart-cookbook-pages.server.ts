// Loaders and the action behind the smart cookbook pages: the form that makes one, the page of recipes it fills with,
// and the cook's list of them on Cookbooks. Every one is the cook's own and behind the smart-cookbooks flag.
import type { AppLoadContext } from "react-router";
import { data, redirect } from "react-router";
import type { PrismaClient } from "@prisma/client";
import { isFlagOn } from "~/domains/platform";
import { requestD1 } from "~/lib/d1-read.server";
import { normalizeMyRecipesPage } from "~/lib/my-recipes-search.server";
import { OBJECTIONABLE_CONTENT_MESSAGE, containsObjectionableContent } from "~/lib/objectionable-terms";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import type { OrganizerStore } from "../application/organizers";
import {
  changeSmartCookbookRules,
  createSmartCookbook,
  deleteSmartCookbook,
  listSmartCookbooks,
  renameSmartCookbook,
  smartCookbookFill,
  type CreateSmartCookbookResult,
  type SmartCookbookStore,
} from "../application/smart-cookbooks";
import { ORGANIZER_KINDS, type Organizer, type OrganizerKind } from "../model/organizer";
import { SMART_COOKBOOK_SIDES, SMART_COOKBOOK_TITLE_MAX_LENGTH, type SmartCookbook, type SmartCookbookSide } from "../model/smart-cookbook";
import { ORGANIZER_FILTER_MAX } from "../model/organizer-filter";
import { prismaOrganizerStore } from "./prisma-organizer-store";
import { prismaSmartCookbookStore } from "./prisma-smart-cookbook-store";
import { readSmartCookbookRecipes } from "./smart-cookbook-recipes.server";

type Args = { request: Request; context: AppLoadContext };

function notFound(): never {
  throw new Response("Not Found", { status: 404 });
}

/** The signed-in cook and the stores, or a 404 while smart cookbooks are off for them. */
async function smartCookbooksRequest(
  request: Request,
  context: AppLoadContext,
): Promise<{ userId: string; store: SmartCookbookStore; organizers: OrganizerStore; db: PrismaClient }> {
  const env = context.cloudflare?.env;
  const userId = await requireUserId(request, "/login", env);
  if (!isFlagOn("smart-cookbooks", env, userId)) notFound();
  const db = await getRequestDb(context);
  return { userId, store: prismaSmartCookbookStore(db), organizers: prismaOrganizerStore(db), db };
}

/** What each kind is called on a rule's row and chip. */
const KIND_NAME: Record<OrganizerKind, string> = { tag: "Tag", category: "Category", tool: "Tool" };
const SEGMENT: Record<OrganizerKind, string> = { tag: "tags", category: "categories", tool: "tools" };

/** One organizer a rule can name: its id submits, its name shows, and its kind is the second line. */
export type SmartCookbookChoice = { value: string; label: string; description: string };

async function ownedOrganizers(organizers: OrganizerStore, userId: string): Promise<Organizer[]> {
  const byKind = await Promise.all(ORGANIZER_KINDS.map((kind) => organizers.organizersOf(userId, kind)));
  return byKind.flatMap((list) => list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
}

/** One of a cookbook's rules as its page shows it: the organizer's name and page, or that it is gone. */
export type SmartCookbookRuleView = { side: SmartCookbookSide; name: string; kind: string; href: string } | { side: SmartCookbookSide; gone: true };

function ruleViews(cookbook: SmartCookbook, organizers: Organizer[]): SmartCookbookRuleView[] {
  const byId = new Map(organizers.map((organizer) => [organizer.id, organizer]));
  return cookbook.rules.map(({ side, organizerId }) => {
    const organizer = byId.get(organizerId);
    if (!organizer) return { side, gone: true as const };
    return { side, name: organizer.name, kind: KIND_NAME[organizer.kind], href: `/${SEGMENT[organizer.kind]}/${organizer.slug}` };
  });
}

/** The cook's smart cookbooks for the Cookbooks page, each with its rules, or null while the flag is off for them. */
export async function smartCookbookListFor(request: Request, context: AppLoadContext, userId: string) {
  if (!isFlagOn("smart-cookbooks", context.cloudflare?.env, userId)) return null;
  const db = await getRequestDb(context);
  const organizers = await ownedOrganizers(prismaOrganizerStore(db), userId);
  const cookbooks = await listSmartCookbooks(prismaSmartCookbookStore(db), userId);
  return cookbooks.map((cookbook) => ({ id: cookbook.id, title: cookbook.title, rules: ruleViews(cookbook, organizers) }));
}

function choicesFrom(owned: Organizer[]): SmartCookbookChoice[] {
  return owned.map((organizer) => ({ value: organizer.id, label: organizer.name, description: KIND_NAME[organizer.kind] }));
}

/** The organizer ids a rules form sends on each side, as rules in the order sent. */
function rulesFrom(form: FormData) {
  return SMART_COOKBOOK_SIDES.flatMap((side) => form.getAll(side).map((organizerId) => ({ side, organizerId: String(organizerId) })));
}

/** The new smart cookbook form: every organizer the cook has, to pick rules from. */
export async function newSmartCookbookLoader({ request, context }: Args) {
  const { userId, organizers } = await smartCookbooksRequest(request, context);
  return { choices: choicesFrom(await ownedOrganizers(organizers, userId)), titleMaxLength: SMART_COOKBOOK_TITLE_MAX_LENGTH };
}

const REFUSALS: Record<Exclude<CreateSmartCookbookResult, { ok: true }>["reason"], string> = {
  "invalid-title": `Give the cookbook a title of ${SMART_COOKBOOK_TITLE_MAX_LENGTH} characters or fewer.`,
  taken: "You already have a smart cookbook with this title.",
  "no-rules": "Pick at least one tag, category or tool for the cookbook to fill with or leave out.",
  // Deleted in another tab since the form loaded.
  "unknown-organizer": "One of those tags, categories or tools is gone. Pick again.",
  "both-sides": "A tag, category or tool can't be both in and out. Remove it from one side.",
  "too-many": `Pick up to ${ORGANIZER_FILTER_MAX} on each side.`,
};

/** Makes the smart cookbook and opens it, or refuses with why and keeps what the cook typed. */
export async function newSmartCookbookAction({ request, context }: Args) {
  const { userId, store, organizers } = await smartCookbooksRequest(request, context);
  const form = await request.formData();
  const title = form.get("title");
  const values = { title: typeof title === "string" ? title : "", with: form.getAll("with").map(String), without: form.getAll("without").map(String) };
  if (containsObjectionableContent(values.title)) return data({ error: OBJECTIONABLE_CONTENT_MESSAGE, values }, { status: 400 });
  const result = await createSmartCookbook(store, organizers, userId, { title, rules: rulesFrom(form) });
  if (!result.ok) return data({ error: REFUSALS[result.reason], values }, { status: 400 });
  return redirect(`/cookbooks/smart/${result.cookbook.id}`);
}

/** A smart cookbook page's own forms: change its rules, rename it, or delete it (its recipes stay). */
export async function smartCookbookPageAction({ request, context, cookbookId }: Args & { cookbookId: string }) {
  const { userId, store, organizers } = await smartCookbooksRequest(request, context);
  const form = await request.formData();
  const refuse = (error: string) => data({ error }, { status: 400 });
  switch (form.get("intent")) {
    case "rules": {
      const result = await changeSmartCookbookRules(store, organizers, userId, cookbookId, rulesFrom(form));
      if (result.ok) return { rulesSaved: true };
      if (result.reason === "not-found") notFound();
      return refuse(REFUSALS[result.reason]);
    }
    case "rename": {
      const title = form.get("title");
      if (typeof title === "string" && containsObjectionableContent(title)) return refuse(OBJECTIONABLE_CONTENT_MESSAGE);
      const result = await renameSmartCookbook(store, userId, cookbookId, title);
      if (result.ok) return { renamed: result.title };
      if (result.reason === "not-found") notFound();
      return refuse(REFUSALS[result.reason]);
    }
    case "delete":
      // Gone already (another tab) ends in the same place.
      await deleteSmartCookbook(store, userId, cookbookId);
      return redirect("/cookbooks");
    default:
      return refuse("Choose Save rules, Rename or Delete.");
  }
}

/** A smart cookbook's page: its rules, and a page of the cook's recipes that match them (newest first, with covers) and how many match. */
export async function smartCookbookPageLoader({ request, context, cookbookId }: Args & { cookbookId: string }) {
  const { userId, store, organizers, db } = await smartCookbooksRequest(request, context);
  const fill = await smartCookbookFill(store, organizers, userId, cookbookId);
  if (!fill) notFound();
  const owned = await ownedOrganizers(organizers, userId);
  const rules = ruleViews(fill.cookbook, owned);
  // What the rules form offers and starts from: a rule on an organizer that is gone has nothing to pick, so it drops.
  const ownedIds = new Set(owned.map((organizer) => organizer.id));
  const chosen = Object.fromEntries(SMART_COOKBOOK_SIDES.map((side) => [
    side,
    fill.cookbook.rules.filter((rule) => rule.side === side && ownedIds.has(rule.organizerId)).map((rule) => rule.organizerId),
  ])) as Record<SmartCookbookSide, string[]>;
  const ruleForm = { choices: choicesFrom(owned), chosen };
  const cookbook = { id: fill.cookbook.id, title: fill.cookbook.title };
  const page = normalizeMyRecipesPage(new URL(request.url).searchParams.get("page"));
  if (!fill.filters) return { cookbook, rules, ruleForm, missing: true, total: 0, page: 1, hasPreviousPage: false, hasNextPage: false, recipes: [] };
  const result = await readSmartCookbookRecipes({ d1: requestD1(context), db }, { ownerId: userId, filters: fill.filters, page });
  return { cookbook, rules, ruleForm, missing: false, ...result };
}
