// Move-in (supporting, anti-corruption layer): import jobs, with one source adapter per app we import from.
// Its public surface: code outside this context imports only from "~/domains/move-in" (docs/domains.md).
export { bytesSource, type RangeSource } from "./adapters/archive/zip";
export { openMealieBackup, type MealieBackup } from "./adapters/sources/mealie-backup/backup";
export {
  chooseGroup,
  inspectGroup,
  listGroups,
  recipeDrafts,
  type MealieDatabase,
  type MealieGroup,
  type MealieVersion,
} from "./adapters/sources/mealie-backup/database";
export { MOVE_IN_ERROR_MESSAGES, MoveInError, type MoveInErrorCode } from "./model/move-in-error";
export { UNTITLED_RECIPE, type IngredientDraft, type RecipeDraft, type StepDraft } from "./model/recipe-draft";
export { joinKey, normalizeGuid, tableRowKey } from "./model/source-key";
