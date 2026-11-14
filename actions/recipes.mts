// The recipes' actions and Spoonjoy's search, each declared once with Ouro UI's action model. The MCP tools keep the
// names and inputs agents already call.
import { defineAction, field } from "../tools/ouro-actions/ouro-actions.mts";
import { idempotencyKey, ownerEmail, searchLimit } from "./fields.mts";

const query = field.string({ label: "Search", description: "The words to search for. Every word must match; commas separate alternatives, any of which may match.", optional: true });
const recipeId = field.string({ label: "Recipe", description: "The recipe's id." });

const ingredient = field.group({
  label: "Ingredient",
  description: "One ingredient of a step.",
  fields: {
    name: field.string({ label: "Name", description: "What it is, such as flour." }),
    quantity: field.number({ label: "Quantity", description: "How much, as a number." }),
    unit: field.string({ label: "Unit", description: "The unit for the quantity, such as grams or cups." }),
  },
});
const stepFields = {
  title: field.string({ label: "Title", description: "The step's short title.", optional: true }),
  description: field.string({ label: "Description", description: "What to do in this step." }),
  duration: field.number({ label: "Duration", description: "How long the step takes, in minutes.", optional: true }),
  ingredients: field.list({ label: "Ingredients", description: "The ingredients this step uses.", optional: true, of: ingredient }),
};
const newSteps = field.list({
  label: "Steps",
  description: "The recipe's steps, in order, each with its ingredients.",
  optional: true,
  protocolOnly: true,
  of: field.group({ label: "Step", description: "One step.", fields: stepFields }),
});
const updatedSteps = field.list({
  label: "Steps",
  description: "The recipe's steps, in order; steps left out are removed.",
  optional: true,
  protocolOnly: true,
  of: field.group({
    label: "Step",
    description: "One step.",
    fields: {
      id: field.string({ label: "Step", description: "The id of the step this one updates.", optional: true }),
      ...stepFields,
      outputStepNums: field.list({
        label: "Uses output of",
        description: "Earlier step numbers, in this list's order, whose output this step uses.",
        optional: true,
        of: field.integer({ label: "Step number", description: "An earlier step's number, from 1.", min: 1 }),
      }),
    },
  }),
});
const clearable = (label: string, description: string) => field.string({ label, description: `${description}, or null to clear it.`, optional: true, nullable: true });

export const searchSpoonjoy = defineAction({
  id: "search_spoonjoy",
  consent: "read",
  label: "Search Spoonjoy",
  description: "Search recipes, cookbooks, chefs and your shopping list.",
  agent: "Full-text search Spoonjoy recipes, cookbooks, chefs, and the configured owner's private shopping list. Without commas every query word must match; commas separate alternatives, so a result matching any of them is returned, ordered by how many alternatives it matches, and at most 12 alternatives are used.",
  input: {
    query,
    scope: field.enum({ label: "Where", description: "What to search: all, or one kind of result.", optional: true, values: ["all", "recipes", "cookbooks", "chefs", "shopping-list", "shopping"] }),
    ownerEmail,
    limit: searchLimit,
  },
  output: {},
});

export const searchRecipes = defineAction({
  id: "search_recipes",
  consent: "read",
  label: "Search recipes",
  description: "Find recipes.",
  agent: "Full-text search Spoonjoy recipes by title, description, source URL, steps and ingredients, optionally limited to one chef by username, or to your own recipes by your own chefEmail. Without commas every query word must match; commas separate alternatives, so a result matching any of them is returned, ordered by how many alternatives it matches, and at most 12 alternatives are used.",
  input: {
    query,
    chefUsername: field.string({ label: "Chef", description: "Only recipes by the chef with this username.", optional: true }),
    chefEmail: field.string({ label: "Your email", description: "Only your own recipes: must be your own email. Any other address returns no recipes.", optional: true, protocolOnly: true }),
    limit: searchLimit,
  },
  output: {},
});

export const getRecipe = defineAction({
  id: "get_recipe",
  consent: "read",
  label: "Get recipe",
  description: "Open a recipe.",
  agent: "Fetch a Spoonjoy recipe by id or exact title with ordered steps and ingredients.",
  input: {
    id: field.string({ label: "Recipe", description: "The recipe's id. Give this or its title.", optional: true }),
    title: field.string({ label: "Title", description: "The recipe's exact title, when you don't have its id.", optional: true }),
  },
  output: {},
});

export const createRecipe = defineAction({
  id: "create_recipe",
  consent: "write",
  label: "Create recipe",
  description: "Add a new recipe to your kitchen.",
  agent: "Create a Spoonjoy recipe for the configured owner, including steps and ingredients.",
  input: {
    ownerEmail,
    title: field.string({ label: "Title", description: "The recipe's title." }),
    description: field.string({ label: "Description", description: "A short description of the recipe.", optional: true }),
    servings: field.string({ label: "Servings", description: "How many it serves, such as 4 or 4-6.", optional: true }),
    sourceUrl: field.string({ label: "Source", description: "Where the recipe came from, as a URL.", optional: true }),
    imageUrl: field.string({ label: "Photo", description: "A Spoonjoy image URL from upload_recipe_image.", optional: true }),
    steps: newSteps,
  },
  output: {},
});

export const updateRecipe = defineAction({
  id: "update_recipe",
  consent: "write",
  label: "Update recipe",
  description: "Change one of your recipes.",
  agent: "Update a recipe owned by the configured owner. With steps, the recipe's steps become the given list, in order: a step with an id updates that step, a step without one updates the step at its position or is added, and steps left out are removed. Updated steps keep their ids, their ingredients keep theirs, and a step keeps the steps whose output it uses unless outputStepNums says otherwise. Each ingredient appears in one step only.",
  input: {
    ownerEmail,
    id: recipeId,
    title: field.string({ label: "Title", description: "The recipe's new title.", optional: true }),
    description: clearable("Description", "A short description of the recipe"),
    servings: clearable("Servings", "How many it serves"),
    sourceUrl: clearable("Source", "Where the recipe came from, as a URL"),
    imageUrl: clearable("Photo", "A Spoonjoy image URL from upload_recipe_image"),
    steps: updatedSteps,
  },
  output: {},
  // With steps, the steps left out are removed.
  destructive: true,
});

export const deleteRecipe = defineAction({
  id: "delete_recipe",
  consent: "consequential",
  label: "Delete recipe",
  description: "Delete one of your recipes.",
  agent: "Soft-delete a recipe owned by the configured owner.",
  input: { ownerEmail, id: recipeId },
  output: {},
  idempotent: true,
});

export const uploadRecipeImage = defineAction({
  id: "upload_recipe_image",
  consent: "write",
  label: "Upload recipe image",
  description: "Add a photo for a recipe.",
  agent: "Upload a recipe photo from base64 bytes and return a Spoonjoy image URL for recipe cover assignment.",
  input: {
    ownerEmail,
    imageBase64: field.string({ label: "Image", description: "The photo's bytes, base64-encoded." }),
    mimeType: field.enum({ label: "Type", description: "The photo's type.", values: ["image/jpeg", "image/png", "image/webp"] }),
    filename: field.string({ label: "File name", description: "The photo's file name, such as lasagna.jpg." }),
  },
  output: {},
});

export const forkRecipe = defineAction({
  id: "fork_recipe",
  consent: "write",
  label: "Fork recipe",
  description: "Make your own copy of a recipe.",
  agent: "Fork an existing Spoonjoy recipe into the authenticated principal's kitchen. Clones title, description, servings, steps, ingredients, and step-output uses; snapshots the source's latest cover; sets sourceRecipeId on the new recipe. Retrying the same fork (the same idempotencyKey, or the same source and title without a key) within 24 hours returns the first fork instead of creating another, unless that fork was deleted.",
  input: {
    sourceRecipeId: field.string({ label: "Recipe", description: "The recipe to fork, by id." }),
    title: field.string({ label: "Title", description: "Optional title override. Subject to the same `(chefId, title)` collision suffixing as the default title.", optional: true }),
    idempotencyKey: idempotencyKey("Stable key for a replay-safe fork; reuse it when retrying."),
  },
  output: {},
});

export const recipes = [searchSpoonjoy, searchRecipes, getRecipe, createRecipe, updateRecipe, deleteRecipe, uploadRecipeImage, forkRecipe];
