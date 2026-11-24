export type QueueRun = {
  id: number;
  name: string;
  head_sha: string;
  head_branch: string;
  event: string;
  status: string;
  run_started_at?: string;
  created_at: string;
};
type FetchLike = (url: string, init: { method?: string; body?: string; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;
export type GitHub = {
  entryHeads(branch: string): Promise<string[]>;
  openPullRequestHeads(): Promise<string[]>;
  unfinishedRuns(event: "merge_group" | "pull_request"): Promise<QueueRun[]>;
  unfinishedQueueRuns(): Promise<QueueRun[]>;
  run(runId: number): Promise<{ status: string }>;
  cancel(runId: number): Promise<unknown>;
  forceCancel(runId: number): Promise<unknown>;
};
export const MIN_AGE_MS: number;
export const STUCK_WAIT_MS: number;
export function staleQueueRuns(runs: QueueRun[], entryHeads: string[], options: { now: number; selfRunId?: string; minAgeMs?: number }): QueueRun[];
export function stalePullRequestRuns(runs: QueueRun[], openHeads: string[], options: { now: number; selfRunId?: string; minAgeMs?: number }): QueueRun[];
export function createGitHub(options: { token: string; repository: string; fetchImpl: FetchLike }): GitHub;
export function cancelStaleQueueRuns(options: { github: GitHub; branch: string; now: number; selfRunId?: string; log: (line: string) => void; wait?: (ms: number) => Promise<void> }): Promise<QueueRun[]>;
export function main(deps?: { env?: Record<string, string | undefined>; fetchImpl?: FetchLike; now?: () => number; log?: (line: string) => void }): Promise<QueueRun[]>;
export function runCliIfEntry(options?: { moduleUrl?: string; argv1?: string; runMain?: () => Promise<unknown>; io?: { error: (line: string) => void } }): Promise<boolean>;
