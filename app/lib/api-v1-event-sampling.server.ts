/**
 * Sampling for the per-request `spoonjoy.api_v1.request` analytics event.
 *
 * Every API request used to send one PostHog event, including the uptime monitor's
 * health probe every minute and every cached public read. Errors, slow requests and
 * writes still send every time, because they are rare and they drive alerting and
 * product counts. Successful fast reads send at `SPOONJOY_API_EVENT_SAMPLE_RATE`
 * (0 to 1; unset means 1, every event). Each event carries `sample_rate`, so a count
 * of events weighted by 1 / sample_rate estimates the true request count.
 */

/** A request at least this slow always sends its event. */
export const API_EVENT_SLOW_MS = 1000;

export type ApiEventSampleReason = "error" | "slow" | "write" | "sampled";

export interface ApiEventSamplingEnv {
  SPOONJOY_API_EVENT_SAMPLE_RATE?: string;
}

export interface ApiEventSampleInput {
  method: string;
  status: number;
  errorCode?: string;
  latencyMs: number;
}

export type ApiEventSampleDecision =
  | { send: true; sampleRate: number; reason: ApiEventSampleReason }
  | { send: false };

/** The configured success sample rate: a number in [0, 1], else 1 (send every event). */
export function apiEventSampleRate(env: ApiEventSamplingEnv | null | undefined): number {
  const raw = env?.SPOONJOY_API_EVENT_SAMPLE_RATE?.trim();
  if (!raw) return 1;
  const rate = Number(raw);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 1;
}

/** Whether to send this request's event, and the rate to record on it. */
export function sampleApiEvent(
  input: ApiEventSampleInput,
  env: ApiEventSamplingEnv | null | undefined,
  random: () => number = Math.random,
): ApiEventSampleDecision {
  if (input.status >= 400 || input.errorCode) return { send: true, sampleRate: 1, reason: "error" };
  if (input.latencyMs >= API_EVENT_SLOW_MS) return { send: true, sampleRate: 1, reason: "slow" };
  const method = input.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return { send: true, sampleRate: 1, reason: "write" };
  const sampleRate = apiEventSampleRate(env);
  if (sampleRate >= 1 || random() < sampleRate) return { send: true, sampleRate, reason: "sampled" };
  return { send: false };
}
