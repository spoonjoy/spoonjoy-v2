// Platform: the seams the rest of the app runs on. Import it from "~/domains/platform", never from its folders.
export * from "./flags";
export * from "./ports/jobs";
export { consumeJobBatch, d1JobKeys, queueJobs, type ConsumeOptions, type JobKeysDatabase } from "./adapters/cloudflare-jobs";
export { memoryJobs, type MemoryJobs } from "./adapters/memory-jobs";
