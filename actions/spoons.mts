// The spoons' actions (a spoon is one logged cook of a recipe), each declared once with Ouro UI's action model. The MCP
// tools keep the names and inputs agents already call.
import { defineAction, field } from "../tools/ouro-actions/ouro-actions.mts";
import { idempotencyKey, ownerEmail, pageLimit, pageOffset, PHOTO_UPLOAD_STEPS, photoFilename, photoImageBase64, photoMimeType, photoUploadId } from "./fields.mts";

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

export const startPhotoUpload = defineAction({
  id: "start_photo_upload",
  consent: "write",
  label: "Start photo upload",
  description: "Get a link to upload a photo to.",
  agent: `Start a photo upload and get a single-use upload link for one JPEG, PNG or WebP photo. Returns uploadId, putUrl, expiresAt, maxBytes and mimeTypes. PUT the photo's raw bytes to putUrl with no Authorization header (the link is signed), for example \`curl -fsS -T /mnt/user-data/uploads/<name> "<putUrl>"\` from a code sandbox, before expiresAt (about 15 minutes). Then pass uploadId to upload_spoon_photo, upload_recipe_image or create_recipe_cover_from_upload, once. Use this instead of imageBase64 whenever the photo is a file you can reach from a shell, such as a chat attachment: never read the photo into the conversation or write it out as base64.`,
  input: { ownerEmail },
  output: {},
});

export const uploadSpoonPhoto = defineAction({
  id: "upload_spoon_photo",
  consent: "write",
  label: "Upload spoon photo",
  description: "Add a photo of something you cooked.",
  agent: `Store a spoon/cook photo and return a Spoonjoy image URL for create_spoon or update_spoon's photoUrl. Pass exactly one of uploadId (from start_photo_upload) or imageBase64. ${PHOTO_UPLOAD_STEPS}`,
  input: {
    ownerEmail,
    uploadId: photoUploadId,
    imageBase64: photoImageBase64,
    mimeType: photoMimeType,
    filename: photoFilename("dinner.jpg"),
  },
  output: {},
});

export const spoons = [createSpoon, updateSpoon, deleteSpoon, listSpoonsForRecipe, listSpoonsByChef, startPhotoUpload, uploadSpoonPhoto];
