// The cookbooks' actions, each declared once with Ouro UI's action model. The MCP tools keep the names and inputs
// agents already call.
import { defineAction, field } from "../tools/ouro-actions/ouro-actions.mts";
import { idempotencyKey, ownerEmail, searchLimit } from "./fields.mts";

// A cookbook is named by its id or by its exact title; cookbookTitle is the older name for title.
const cookbookId = field.string({ label: "Cookbook", description: "The cookbook's id. Give this or its title.", optional: true });
const title = field.string({ label: "Title", description: "The cookbook's exact title, when you don't have its id.", optional: true });
const cookbookTitle = field.string({ label: "Cookbook title", description: "The same as title; title wins when both are given.", optional: true, protocolOnly: true });
const recipeId = field.string({ label: "Recipe", description: "The recipe's id." });

export const listCookbooks = defineAction({
  id: "list_cookbooks",
  consent: "read",
  label: "List cookbooks",
  description: "See your cookbooks.",
  agent: "List cookbooks owned by the configured owner, with active recipe counts and covers.",
  input: {
    ownerEmail,
    query: field.string({ label: "Search", description: "Only cookbooks whose title has these words.", optional: true }),
    limit: searchLimit,
  },
  output: {},
});

export const getCookbook = defineAction({
  id: "get_cookbook",
  consent: "read",
  label: "Get cookbook",
  description: "Open one of your cookbooks.",
  agent: "Fetch one cookbook owned by the configured owner by cookbookId or exact title.",
  input: { ownerEmail, cookbookId, title, cookbookTitle },
  output: {},
});

export const createCookbook = defineAction({
  id: "create_cookbook",
  consent: "write",
  label: "Create cookbook",
  description: "Start a new cookbook.",
  agent: "Create or return an existing cookbook for the configured owner by exact title.",
  input: {
    ownerEmail,
    title: field.string({ label: "Title", description: "The cookbook's title; an existing cookbook with this exact title is returned instead." }),
    idempotencyKey: idempotencyKey("Stable key (8-100 letters, digits, '_' or '-') for replay-safe creation: a repeat with the same key returns the cookbook the first call made, with created: true and mutation.replayed: true."),
  },
  output: {},
  idempotent: true,
});

export const addRecipeToCookbook = defineAction({
  id: "add_recipe_to_cookbook",
  consent: "write",
  label: "Add recipe to cookbook",
  description: "Save a recipe in one of your cookbooks.",
  agent: "Idempotently add an active recipe to a cookbook owned by the configured owner.",
  input: { ownerEmail, cookbookId, title, cookbookTitle, recipeId },
  output: {},
  idempotent: true,
});

export const removeRecipeFromCookbook = defineAction({
  id: "remove_recipe_from_cookbook",
  consent: "write",
  label: "Remove recipe from cookbook",
  description: "Take a recipe out of one of your cookbooks.",
  agent: "Idempotently remove a recipe from a cookbook owned by the configured owner.",
  input: { ownerEmail, cookbookId, title, cookbookTitle, recipeId },
  output: {},
  destructive: true,
  idempotent: true,
});

export const cookbooks = [listCookbooks, getCookbook, createCookbook, addRecipeToCookbook, removeRecipeFromCookbook];
