import { SPOONJOY_APP_STORE_URL } from "~/lib/app-store";

/**
 * Spoonjoy's public roadmap, shown at /roadmap. Each pull request that ships a roadmap item moves it
 * here in the same change: set `status: "shipped"`, add `shipped` (the day it went live) and a
 * `link` to where a cook can try it. Write each line for a cook, not an engineer, and name no other
 * recipe app.
 */

/** Where an item is: live, being built, up next, or later. */
export type RoadmapStatus = "shipped" | "building" | "next" | "later";

/** The part of the kitchen an item belongs to. */
export type RoadmapArea =
  | "Recipes"
  | "Cooking"
  | "Planning"
  | "Shopping"
  | "Households"
  | "Moving in"
  | "Food know-how"
  | "Connections"
  | "Languages"
  | "Your own server"
  | "Community"
  | "Apps"
  | "Agents";

export interface RoadmapItem {
  /** Stable, kebab-case: a shipping pull request finds its item by this. */
  id: string;
  /** What it is, in a few words. */
  title: string;
  /** One sentence on what it does for a cook. */
  benefit: string;
  status: RoadmapStatus;
  area: RoadmapArea;
  /** The day it went live, as YYYY-MM-DD. Shipped items only. */
  shipped?: string;
  /** Where to try it: a Spoonjoy page, or the App Store. */
  link?: { href: string; label: string };
}

export const ROADMAP_STATUSES: ReadonlyArray<{ id: RoadmapStatus; title: string; summary: string }> = [
  { id: "shipped", title: "Shipped", summary: "Live on spoonjoy.app and in the iPhone and iPad app today." },
  { id: "building", title: "Building now", summary: "On the stove: being built and tested this week." },
  { id: "next", title: "Next", summary: "Prepped and up next, in roughly this order." },
  { id: "later", title: "Later", summary: "Planned, and coming after the next batch." },
];

export const ROADMAP: readonly RoadmapItem[] = [
  // Shipped.
  {
    id: "save-from-anywhere",
    title: "Save a recipe from any link",
    benefit: "Paste a link or a video and get the recipe without the life story above it.",
    status: "shipped",
    area: "Recipes",
  },
  {
    id: "step-by-step-cooking",
    title: "Cook one step at a time",
    benefit: "Each step shows just the ingredients it needs, with timers and scaling that follow along.",
    status: "shipped",
    area: "Cooking",
    link: { href: "/test-kitchen", label: "Try it in the Test Kitchen" },
  },
  {
    id: "cook-on-any-device",
    title: "Pick up on another device",
    benefit: "Start on your phone and finish on your laptop, with your place and your ticks kept.",
    status: "shipped",
    area: "Cooking",
  },
  {
    id: "forks-with-credit",
    title: "Change a friend's recipe",
    benefit: "Make any recipe your own while the original chef's name stays on it.",
    status: "shipped",
    area: "Community",
    link: { href: "/recipes", label: "Browse recipes" },
  },
  {
    id: "cook-notes",
    title: "Notes and photos from every cook",
    benefit: "After you cook, note what you'd change and add a photo, so the next cook knows.",
    status: "shipped",
    area: "Cooking",
  },
  {
    id: "cookbooks",
    title: "Cookbooks",
    benefit: "Gather recipes into cookbooks, each with its own page to share.",
    status: "shipped",
    area: "Recipes",
  },
  {
    id: "shopping-list",
    title: "A shopping list in aisle order",
    benefit: "Add a recipe's ingredients in one tap and shop them grouped by aisle.",
    status: "shipped",
    area: "Shopping",
  },
  {
    id: "find-recipes-and-chefs",
    title: "Find recipes and chefs",
    benefit: "Search everything cooks have shared, and visit the kitchens of chefs whose food you like.",
    status: "shipped",
    area: "Community",
    link: { href: "/search", label: "Search recipes" },
  },
  {
    id: "iphone-and-ipad",
    title: "Spoonjoy for iPhone and iPad",
    benefit: "The whole kitchen in a native app, with your recipes and list kept in step with the web.",
    status: "shipped",
    area: "Apps",
    link: { href: SPOONJOY_APP_STORE_URL, label: "Get it on the App Store" },
  },
  {
    id: "agents",
    title: "Cook with your AI assistant",
    benefit: "Let an assistant you trust save recipes, fill your list and find what to cook in your kitchen.",
    status: "shipped",
    area: "Agents",
    link: { href: "/developers", label: "Connect an assistant" },
  },
  {
    id: "take-your-kitchen",
    title: "Take your kitchen with you",
    benefit: "Download everything you've made here in one file, whenever you like.",
    status: "shipped",
    area: "Moving in",
    link: { href: "/support", label: "How to export" },
  },

  // Building now.
  {
    id: "move-in",
    title: "Move in from other recipe apps in one step",
    benefit: "Bring your recipes, photos, cookbooks, plans and lists over intact, and nothing doubles if you run it again.",
    status: "building",
    area: "Moving in",
  },
  {
    id: "self-hosting",
    title: "Run Spoonjoy on your own server",
    benefit: "One container on your own box, with the same web app and the same iPhone and iPad app.",
    status: "building",
    area: "Your own server",
  },
  {
    id: "public-roadmap",
    title: "This roadmap",
    benefit: "See what's live, what's cooking and what's next, kept current by every change we ship.",
    status: "building",
    area: "Community",
  },

  // Next.
  {
    id: "meal-planner",
    title: "Meal planner",
    benefit: "Plan the week with recipes or quick notes, set servings per meal and send it all to your list.",
    status: "next",
    area: "Planning",
  },
  {
    id: "households",
    title: "Households",
    benefit: "Share one kitchen with the people you cook for: recipes, plans and lists, by invite.",
    status: "next",
    area: "Households",
  },
  {
    id: "organizers",
    title: "Tags, categories and tools",
    benefit: "Sort recipes your way, and filter out what you can't eat or don't own the gear for.",
    status: "building",
    area: "Recipes",
  },
  {
    id: "smart-cookbooks",
    title: "Smart cookbooks",
    benefit: "Cookbooks that fill themselves from a rule, like every vegetarian dinner under 30 minutes.",
    status: "building",
    area: "Recipes",
  },
  {
    id: "unit-conversion",
    title: "Unit conversion",
    benefit: "Switch any recipe between metric, US and imperial measures in one tap.",
    status: "next",
    area: "Food know-how",
  },
  {
    id: "nutrition",
    title: "Nutrition",
    benefit: "See calories and macros for a recipe, and find recipes that fit your goals.",
    status: "next",
    area: "Food know-how",
  },
  {
    id: "swaps",
    title: "Ingredient swaps",
    benefit: "Out of buttermilk? See what works instead, right in the step you're cooking.",
    status: "next",
    area: "Food know-how",
  },
  {
    id: "pantry",
    title: "Pantry",
    benefit: "Keep track of what you have, so the list skips it and you can cook from what's on hand.",
    status: "next",
    area: "Shopping",
  },
  {
    id: "calendar-feed",
    title: "Your meal plan in your calendar",
    benefit: "Subscribe to your plan from any calendar app and see dinner next to everything else.",
    status: "next",
    area: "Planning",
  },
  {
    id: "webhooks",
    title: "Webhooks and notifications",
    benefit: "Tell your other tools when a recipe is saved, a plan changes or the list fills up.",
    status: "next",
    area: "Connections",
  },
  {
    id: "home-assistant",
    title: "Home Assistant",
    benefit: "Put tonight's dinner and the shopping list on your smart-home dashboard.",
    status: "next",
    area: "Connections",
  },
  {
    id: "languages",
    title: "Spoonjoy in your language",
    benefit: "Use Spoonjoy in many languages, with recipes and ingredient names in yours.",
    status: "next",
    area: "Languages",
  },
  {
    id: "apple-app-everything",
    title: "Everything in the iPhone and iPad app",
    benefit: "The planner, households, pantry and conversion in the native app, and a pick of server at sign-in.",
    status: "next",
    area: "Apps",
  },

  // Later.
  {
    id: "import-anything",
    title: "Import from a PDF, text or a photo",
    benefit: "Snap a recipe card, drop in a PDF or paste plain text, and get a recipe you can cook.",
    status: "later",
    area: "Moving in",
  },
  {
    id: "more-recipe-apps",
    title: "Move in from even more recipe apps",
    benefit: "Bring your kitchen over from the other recipe apps people use most.",
    status: "later",
    area: "Moving in",
  },
  {
    id: "recipes-travel",
    title: "Recipes that travel between servers",
    benefit: "Copy a recipe from any Spoonjoy server to yours, with a link back to where it came from.",
    status: "later",
    area: "Community",
  },
  {
    id: "server-linking",
    title: "Link your server to the community",
    benefit: "Keep your data at home and still follow chefs and share cooks with everyone on spoonjoy.app.",
    status: "later",
    area: "Your own server",
  },
  {
    id: "federation",
    title: "Follow chefs from the fediverse",
    benefit: "Follow Spoonjoy chefs from Mastodon and other fediverse apps, and see their recipes there.",
    status: "later",
    area: "Community",
  },
];

/** The items in one group, in the order this file lists them. */
export function roadmapByStatus(status: RoadmapStatus): RoadmapItem[] {
  return ROADMAP.filter((item) => item.status === status);
}
