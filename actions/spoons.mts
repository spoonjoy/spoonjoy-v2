// The spoons' actions (a spoon is one logged cook of a recipe), each declared once with Ouro UI's action model. The MCP
// tools keep the names and inputs agents already call.
import { defineAction, field } from "../tools/ouro-actions/ouro-actions.mts";
import { idempotencyKey, ownerEmail, pageLimit, pageOffset } from "./fields.mts";

const spoonId = field.string({ label: "Cook", description: "The spoon's id." });
const note = field.string({ label: "Note", description: "How the cook went.", optional: true });
const nextTime = field.string({ label: "Next time", description: "What to do differently next time.", optional: true });
const cookedAt = field.string({ label: "Cooked", description: "When it was cooked, as an ISO date-time; now when left out.", optional: true });

export const createSpoon = defineAction({
  id: "create_spoon",
  consent: "write",
  label: "Log a cook",
  description: "Log that you cooked a recipe, with a note and a photo.",
  agent: "Create a RecipeSpoon (cook event) authored by the authenticated principal.",
  input: {
    recipeId: field.string({ label: "Recipe", description: "The recipe that was cooked, by id." }),
    photoUrl: field.string({ label: "Photo", description: "A Spoonjoy image URL from upload_spoon_photo.", optional: true }),
    note,
    nextTime,
    cookedAt,
    idempotencyKey: idempotencyKey("Stable key (8-100 letters, digits, '_' or '-') for replay-safe creation: a repeat with the same key returns the spoon the first call made instead of logging a second cook."),
  },
  output: {},
});

export const updateSpoon = defineAction({
  id: "update_spoon",
  consent: "write",
  label: "Update a cook",
  description: "Change a cook you logged.",
  agent: "Update note, nextTime, photoUrl, or cookedAt on a spoon owned by the authenticated principal.",
  input: {
    spoonId,
    note,
    nextTime,
    photoUrl: field.string({ label: "Photo", description: "A Spoonjoy image URL from upload_spoon_photo, or null to remove the photo.", optional: true, nullable: true }),
    cookedAt,
  },
  output: {},
});

export const deleteSpoon = defineAction({
  id: "delete_spoon",
  consent: "consequential",
  label: "Delete a cook",
  description: "Delete a cook you logged.",
  agent: "Soft-delete a spoon owned by the authenticated principal.",
  input: { spoonId },
  output: {},
  idempotent: true,
});

export const listSpoonsForRecipe = defineAction({
  id: "list_spoons_for_recipe",
  consent: "read",
  label: "List cooks for recipe",
  description: "See who has cooked a recipe.",
  agent: "List the most-recent non-deleted spoons for a recipe.",
  input: {
    recipeId: field.string({ label: "Recipe", description: "The recipe's id." }),
    limit: pageLimit("The most spoons to return."),
    offset: pageOffset,
  },
  output: {},
});

export const listSpoonsByChef = defineAction({
  id: "list_spoons_by_chef",
  consent: "read",
  label: "List cooks by chef",
  description: "See what a chef has cooked.",
  agent: "List the chef's most-recent non-deleted spoons across all recipes.",
  input: {
    chefIdOrUsername: field.string({ label: "Chef", description: "The chef's id or username." }),
    limit: pageLimit("The most spoons to return."),
    offset: pageOffset,
  },
  output: {},
});

export const uploadSpoonPhoto = defineAction({
  id: "upload_spoon_photo",
  consent: "write",
  label: "Upload spoon photo",
  description: "Add a photo of something you cooked.",
  agent: "Upload a spoon/cook photo from base64 bytes and return a Spoonjoy image URL for spoon assignment.",
  input: {
    ownerEmail,
    imageBase64: field.string({ label: "Image", description: "The photo's bytes, base64-encoded." }),
    mimeType: field.enum({ label: "Type", description: "The photo's type.", values: ["image/jpeg", "image/png", "image/webp"] }),
    filename: field.string({ label: "File name", description: "The photo's file name, such as dinner.jpg." }),
  },
  output: {},
});

export const spoons = [createSpoon, updateSpoon, deleteSpoon, listSpoonsForRecipe, listSpoonsByChef, uploadSpoonPhoto];
