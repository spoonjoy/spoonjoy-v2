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
export { timeLeft } from "./model/time-left";
export { createMoveInJob, readMoveInProgress, type MoveInProgress } from "./adapters/storage/job-store.server";
export { readMoveInOrganizerCounts, type MoveInOrganizerCounts } from "./adapters/storage/organizer-writer.server";
export { MOVE_IN_ARCHIVE_PREFIX, moveInEnv, moveInPorts, type MoveInEnv } from "./adapters/worker/move-in-ports.server";
export { readsAServer } from "./adapters/worker/apps";
export { MOVE_IN_APPS, MOVE_IN_UPLOAD_MAX_BYTES, startMoveIn, startServerMoveIn, type StartMoveInResult } from "./adapters/worker/start-move-in.server";
export {
  FINISHED,
  runForAWhile,
  runNextChunk,
  WAITING_ON_SOURCE,
  type MoveInCounts,
  type MoveInEvent,
  type MoveInJob,
  type MoveInPorts,
  type MoveInStatus,
} from "./application/run-move-in";
export { runScheduledMoveInSweep } from "./adapters/worker/sweep-move-in-archives.server";
export {
  MOVE_IN_BACKUP_MAX_BYTES,
  MOVE_IN_PART_BYTES,
  UPLOAD_REFUSAL_MESSAGES,
  isFileHead,
  type UploadRefusal,
} from "./model/backup-upload";
export {
  abortBackupUpload,
  beginBackupUpload,
  finishBackupUpload,
  putBackupPart,
  type UploadPlan,
  type UploadResult,
} from "./adapters/worker/backup-upload.server";
export {
  MOVE_IN_JOB,
  MOVE_IN_WATCH,
  moveInJobHandler,
  moveInWatchHandler,
  nudgeMoveIn,
  startMoveInJob,
  type MoveInJobPayload,
  type MoveInWatchPayload,
} from "./adapters/worker/move-in-job.server";
