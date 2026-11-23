// The words and icons each kind of organizer uses on its pages. Client-safe: it takes only the kind's type from
// Kitchen, so the pages' components can share it without pulling the store into the browser bundle.
import { CookingPot, Shapes, Tag, type LucideIcon } from "lucide-react";
import type { OrganizerKind } from "~/domains/kitchen";

export type OrganizerKindCopy = {
  /** Where the cook's list of this kind lives, and the form field's name on a recipe's Organize page. */
  segment: "tags" | "categories" | "tools";
  /** One of this kind, in a page's eyebrow and title. */
  one: string;
  /** This kind's name as a field label and a heading. */
  label: string;
  listTitle: string;
  listDescription: string;
  emptyList: string;
  emptyPage: string;
  emptyPageDescription: string;
  emptyOnRecipe: string;
  allLabel: string;
  placeholder: string;
  recipesLabel: (name: string) => string;
  Icon: LucideIcon;
};

export const ORGANIZER_KIND_COPY: Record<OrganizerKind, OrganizerKindCopy> = {
  tag: {
    segment: "tags",
    one: "Tag",
    label: "Tags",
    listTitle: "Your tags",
    listDescription: "The tags you sort your recipes by.",
    emptyList: "No tags yet",
    emptyPage: "No recipes with this tag",
    emptyPageDescription: "Recipes you tag with it show up here.",
    emptyOnRecipe: "No tags on this recipe yet.",
    allLabel: "All tags",
    placeholder: "weeknight, vegetarian, spicy",
    recipesLabel: (name) => `Recipes tagged ${name}`,
    Icon: Tag,
  },
  category: {
    segment: "categories",
    one: "Category",
    label: "Categories",
    listTitle: "Your categories",
    listDescription: "The categories your recipes sit in.",
    emptyList: "No categories yet",
    emptyPage: "No recipes in this category",
    emptyPageDescription: "Recipes you put in it show up here.",
    emptyOnRecipe: "No categories on this recipe yet.",
    allLabel: "All categories",
    placeholder: "dinner, soup, dessert",
    recipesLabel: (name) => `Recipes in ${name}`,
    Icon: Shapes,
  },
  tool: {
    segment: "tools",
    one: "Tool",
    label: "Tools",
    listTitle: "Your tools",
    listDescription: "The kitchen tools your recipes call for.",
    emptyList: "No tools yet",
    emptyPage: "No recipes use this tool",
    emptyPageDescription: "Recipes that call for it show up here.",
    emptyOnRecipe: "No tools on this recipe yet.",
    allLabel: "All tools",
    placeholder: "Dutch oven, stand mixer",
    recipesLabel: (name) => `Recipes using ${name}`,
    Icon: CookingPot,
  },
};

/** The kinds in the order a recipe's Organize page shows them. */
export const ORGANIZER_KIND_ORDER = ["tag", "category", "tool"] as const satisfies readonly OrganizerKind[];

export function organizerHref(kind: OrganizerKind, slug: string): string {
  return `/${ORGANIZER_KIND_COPY[kind].segment}/${encodeURIComponent(slug)}`;
}

export function recipeCountLabel(count: number): string {
  return count === 1 ? "1 recipe" : `${count} recipes`;
}

/** A page title for an organizer list, an organizer's page or a recipe's Organize page. */
export function organizerMeta(title: string) {
  return [{ title: `${title} - Spoonjoy` }, { name: "robots", content: "noindex" }];
}
