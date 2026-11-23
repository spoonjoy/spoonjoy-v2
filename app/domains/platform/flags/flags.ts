// Feature flags: how an unfinished feature lands on main without reaching people.
//
// Declare a flag in FLAGS below, read it with isFlagOn on the server or useFlag in a component, and delete it as the
// last step of its feature. Every flag is off unless the environment turns it on:
// - SPOONJOY_FLAGS turns flags on for everyone: "all" (QA, set in wrangler.json's env.qa) or names separated by commas
//   or spaces. Production leaves it unset, so production has every flag off.
// - SPOONJOY_FLAG_USERS turns flags on for chosen users, for dogfooding: JSON from user id to a list of names or "all",
//   for example {"<user id>": ["meal-planner"]}.
// Names nobody declared are ignored, and a value that cannot be read turns nothing on.
//
// This file does no I/O: callers pass the Worker env and the signed-in user's id, so it runs on server and client alike.

/** Every flag, by name, with what it hides. Keep the names sorted. */
export const FLAGS = {
  households: { description: "Households at /households: members, roles and invites, and the lists, plan and recipes they share." },
  "meal-planner": { description: "The meal planner at /plan: a week of recipes and notes, and its API and MCP tools." },
  move_in: { description: "The Move in page at /move-in: bring a kitchen over from another recipe app's backup." },
  recipe_visibility: { description: "Cooks choose who reads each recipe (private or public) and their default for new ones" },
  organizers: {
    description: "Tags, categories and tools on recipes, their pages and filters, smart cookbooks and bulk actions on many recipes.",
  },
  nutrition: { description: "Calories and macros per serving on a recipe's page, from USDA FoodData Central." },
} as const satisfies Record<string, { description: string }>;

export type FlagName = keyof typeof FLAGS & string;

export const FLAG_NAMES = Object.keys(FLAGS).sort() as FlagName[];

export type FlagEnv = { SPOONJOY_FLAGS?: string; SPOONJOY_FLAG_USERS?: string } | null | undefined;

function namesIn(value: unknown): string[] | "all" {
  if (value === "all") return "all";
  if (!Array.isArray(value)) return [];
  return value.filter((name): name is string => typeof name === "string");
}

function userNames(raw: string | undefined, userId: string | null | undefined): string[] | "all" {
  if (!raw || !userId) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return namesIn((parsed as Record<string, unknown>)[userId]);
}

function everyoneNames(raw: string | undefined): string[] | "all" {
  const names = (raw ?? "").split(/[\s,]+/).filter(Boolean);
  return names.some((name) => name.toLowerCase() === "all") ? "all" : names;
}

/** The flags that are on for this user in this environment, out of `known`, sorted. */
export function resolveFlags<Name extends string>(
  known: readonly Name[],
  env: FlagEnv,
  userId: string | null | undefined,
): Name[] {
  const everyone = everyoneNames(env?.SPOONJOY_FLAGS);
  const user = userNames(env?.SPOONJOY_FLAG_USERS, userId);
  if (everyone === "all" || user === "all") return [...known].sort();
  const on = new Set([...everyone, ...user]);
  return known.filter((name) => on.has(name)).sort();
}

/** The app's flags that are on for this user; the root loader hands these to the client. */
export function flagsFor(env: FlagEnv, userId: string | null | undefined): FlagName[] {
  return resolveFlags(FLAG_NAMES, env, userId);
}

/** Whether one flag is on for this user, on the server. */
export function isFlagOn(name: FlagName, env: FlagEnv, userId: string | null | undefined): boolean {
  return flagsFor(env, userId).includes(name);
}
