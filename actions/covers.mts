// Recipe Photo Studio's actions (a recipe's cover candidates), each declared once with Ouro UI's action model. The MCP
// tools keep the names and inputs agents already call.
import { defineAction, field } from "../tools/ouro-actions/ouro-actions.mts";
import { idempotencyKey } from "./fields.mts";

const recipeId = (description: string) => field.string({ label: "Recipe", description });
const coverId = (description: string) => field.string({ label: "Cover", description });
const variant = (description: string, optional?: true) => field.enum({ label: "Variant", description, values: ["image", "stylized"], ...(optional ? { optional } : {}) });
const promptAddition = (description: string) => field.string({ label: "Prompt", description, optional: true, maxLength: 240 });
const activateWhenReady = (description: string) => field.boolean({ label: "Use when ready", description, optional: true });
const limit = (description: string) => field.number({ label: "Limit", description, optional: true, min: 1, max: 25 });
const offset = field.number({ label: "Offset", description: "Zero-based pagination offset.", optional: true, min: 0 });
// An existing MCP input named dryRun, whose own flag web's kit takes (--dry-run), so its CLI flag is --plan-only.
const dryRun = field.boolean({ label: "Plan only", description: "Validate inputs and return planned next actions without writing a cover.", optional: true, protocolOnly: true, flag: "plan-only" });
const requiredKey = (description: string) => field.string({ label: "Idempotency key", description, protocolOnly: true });

export const listRecipeCovers = defineAction({
  id: "list_recipe_covers",
  consent: "read",
  label: "List recipe covers",
  description: "See a recipe's cover photos.",
  agent: "List Recipe Photo Studio cover candidates. Owners with kitchen write access receive full cover history; other readers receive active public cover metadata only. May record that an abandoned generation failed: a cover still processing ten minutes after its generation started is reported, and stored, as failed.",
  input: {
    recipeId: recipeId("Recipe whose cover candidates should be listed."),
    includeArchived: field.boolean({ label: "Include archived", description: "Include archived cover candidates in the owner-only history.", optional: true }),
    limit: limit("Maximum number of cover candidates to return."),
    offset,
  },
  output: {},
});

export const listRecipeSpoonImages = defineAction({
  id: "list_recipe_spoon_images",
  consent: "read",
  label: "List recipe spoon images",
  description: "See the photos from your cooks of a recipe that could be its cover.",
  agent: "List owner-only Spoon photos that can be used as Recipe Photo Studio cover sources.",
  input: {
    recipeId: recipeId("Recipe whose Spoon photos should be listed."),
    limit: limit("Maximum number of Spoon photos to return."),
    offset,
  },
  output: {},
});

export const createRecipeCoverFromUpload = defineAction({
  id: "create_recipe_cover_from_upload",
  consent: "write",
  label: "Create recipe cover from upload",
  description: "Make a cover for a recipe from a photo you uploaded.",
  agent: "Create a Recipe Photo Studio cover candidate from an uploaded recipe or spoon photo URL.",
  input: {
    recipeId: recipeId("Recipe that will receive the cover candidate."),
    imageUrl: field.string({ label: "Photo", description: "Spoonjoy uploaded recipe or spoon photo URL to use as the original cover source." }),
    activateWhenReady: activateWhenReady("Make the cover active when the editorial image is ready."),
    generateEditorial: field.boolean({ label: "Editorial", description: "Generate an editorialized cover from the uploaded original photo.", optional: true }),
    promptAddition: promptAddition("Optional bounded instruction to guide editorial cover generation."),
    postAsSpoon: field.boolean({ label: "Also log a cook", description: "Also create a Spoon entry to preserve the original photo with optional cook notes.", optional: true }),
    note: field.string({ label: "Note", description: "Spoon note used when postAsSpoon preserves the original photo.", optional: true }),
    nextTime: field.string({ label: "Next time", description: "Spoon next-time note used when postAsSpoon preserves the original photo.", optional: true }),
    cookedAt: field.string({ label: "Cooked", description: "ISO date-time for the Spoon cook when postAsSpoon preserves the original photo.", optional: true, format: "date-time" }),
    idempotencyKey: idempotencyKey("Stable key for replay-safe cover creation."),
    dryRun,
  },
  output: {},
  idempotent: true,
});

export const generateRecipeCoverPlaceholder = defineAction({
  id: "generate_recipe_cover_placeholder",
  consent: "write",
  label: "Generate recipe cover placeholder",
  description: "Make an AI placeholder cover for a recipe.",
  agent: "Generate an AI placeholder cover candidate for a recipe with an optional prompt addition.",
  input: {
    recipeId: recipeId("Recipe that will receive the generated AI placeholder cover."),
    promptAddition: promptAddition("Optional bounded instruction to guide AI placeholder generation."),
    activateWhenReady: activateWhenReady("Make the generated cover active when the generated cover is ready."),
    idempotencyKey: requiredKey("Stable key for replay-safe placeholder generation."),
    dryRun,
  },
  output: {},
  idempotent: true,
});

export const regenerateRecipeCover = defineAction({
  id: "regenerate_recipe_cover",
  consent: "write",
  label: "Regenerate recipe cover",
  description: "Make a recipe's cover again.",
  agent: "Regenerate the editorial image for a recipe cover candidate with an optional prompt addition.",
  input: {
    recipeId: recipeId("Recipe that owns the cover candidate."),
    coverId: coverId("Existing cover candidate to regenerate."),
    promptAddition: promptAddition("Optional bounded instruction to guide regenerated editorial output."),
    activateWhenReady: activateWhenReady("Make the regenerated cover active when the regenerated cover is ready."),
    idempotencyKey: requiredKey("Stable key for replay-safe regeneration."),
    dryRun,
  },
  output: {},
  idempotent: true,
});

export const getCoverGenerationStatus = defineAction({
  id: "get_cover_generation_status",
  consent: "read",
  label: "Get cover generation status",
  description: "See whether a recipe's new cover is ready.",
  agent: "Fetch Recipe Photo Studio generation status and active-cover context. May record that an abandoned generation failed: a cover still processing ten minutes after its generation started is reported, and stored, as failed, so polling can stop.",
  input: {
    recipeId: recipeId("Recipe that owns the cover candidate."),
    coverId: coverId("Recipe cover candidate whose generation status should be fetched."),
  },
  output: {},
});

export const setActiveRecipeCover = defineAction({
  id: "set_active_recipe_cover",
  consent: "write",
  label: "Set active recipe cover",
  description: "Choose a recipe's cover.",
  agent: "Set one existing Recipe Photo Studio cover variant as the active recipe cover.",
  input: {
    recipeId: recipeId("Recipe that owns the cover candidate."),
    coverId: coverId("Cover candidate to activate."),
    variant: variant("Cover variant to activate: image or stylized."),
    idempotencyKey: idempotencyKey("Stable key for replay-safe activation."),
  },
  output: {},
  idempotent: true,
});

export const setRecipeNoCover = defineAction({
  id: "set_recipe_no_cover",
  consent: "write",
  label: "Set recipe no cover",
  description: "Show a recipe with no cover.",
  agent: "Set an explicit no-cover state for a recipe after destructive no-cover confirmation.",
  input: {
    recipeId: recipeId("Recipe that should intentionally display no cover."),
    // The person's own door is the confirmation, so only programs send it.
    confirmNoCover: field.boolean({ label: "Confirm", description: "Required explicit confirmation before entering no-cover mode.", const: true, protocolOnly: true }),
    idempotencyKey: requiredKey("Stable key for replay-safe no-cover changes."),
  },
  output: {},
  destructive: true,
  idempotent: true,
});

export const archiveRecipeCover = defineAction({
  id: "archive_recipe_cover",
  consent: "write",
  label: "Archive recipe cover",
  description: "Put away one of a recipe's covers.",
  agent: "Archive a Recipe Photo Studio cover. Archiving the active cover requires a replacement or explicit no-cover confirmation.",
  input: {
    recipeId: recipeId("Recipe that owns the cover candidate."),
    coverId: coverId("Cover candidate to archive."),
    replacementCoverId: field.string({ label: "Replacement", description: "Replacement cover candidate to activate when archiving the active cover.", optional: true }),
    replacementVariant: variant("Replacement variant to activate: image or stylized.", true),
    confirmNoCover: field.boolean({ label: "No cover", description: "Use explicit no-cover mode when archiving the active cover without a replacement.", optional: true }),
    deleteSafeObjects: field.boolean({ label: "Delete images", description: "Request deletion of safe owned image objects after archive when supported.", optional: true }),
    idempotencyKey: idempotencyKey("Stable key for replay-safe archiving."),
  },
  output: {},
  destructive: true,
  idempotent: true,
});

export const covers = [
  listRecipeCovers,
  listRecipeSpoonImages,
  createRecipeCoverFromUpload,
  generateRecipeCoverPlaceholder,
  regenerateRecipeCover,
  getCoverGenerationStatus,
  setActiveRecipeCover,
  setRecipeNoCover,
  archiveRecipeCover,
];
