// Platform's server-only surface: the composition root that builds every port from the Worker's env and ctx,
// and the adapters behind its ports. Import it from "~/domains/platform/index.server".
export { cloudflarePlatform, type CloudflarePlatformEnv } from "./adapters/cloudflare.server";
export {
  consumeJobBatch,
  d1JobKeys,
  expireDoneJobKeys,
  JOB_KEY_KEPT_DAYS,
  jobKeysDatabase,
  queueJobs,
  type ConsumeOptions,
  type JobKeysDatabase,
} from "./adapters/cloudflare-jobs.server";
export { memoryJobs, type MemoryJobs } from "./adapters/memory-jobs";
