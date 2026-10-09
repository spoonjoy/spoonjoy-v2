import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { API_EVENT_SLOW_MS, apiEventSampleRate, sampleApiEvent } from "~/lib/api-v1-event-sampling.server";

const env = { SPOONJOY_API_EVENT_SAMPLE_RATE: "0.1" };
const read = { method: "GET", status: 200, latencyMs: 20 };

describe("API v1 request event sampling", () => {
  it("keeps every error, whether by status or by error code", () => {
    expect(sampleApiEvent({ ...read, status: 503 }, env, () => 0.99)).toEqual({ send: true, sampleRate: 1, reason: "error" });
    expect(sampleApiEvent({ ...read, errorCode: "rate_limited" }, env, () => 0.99)).toEqual({ send: true, sampleRate: 1, reason: "error" });
  });

  it("keeps every slow request", () => {
    expect(sampleApiEvent({ ...read, latencyMs: API_EVENT_SLOW_MS }, env, () => 0.99)).toEqual({ send: true, sampleRate: 1, reason: "slow" });
    expect(sampleApiEvent({ ...read, latencyMs: API_EVENT_SLOW_MS - 1 }, env, () => 0.99)).toEqual({ send: false });
  });

  it("keeps every write", () => {
    expect(sampleApiEvent({ ...read, method: "post" }, env, () => 0.99)).toEqual({ send: true, sampleRate: 1, reason: "write" });
  });

  it("samples fast successful reads, including HEAD, at the configured rate", () => {
    expect(sampleApiEvent(read, env, () => 0.09)).toEqual({ send: true, sampleRate: 0.1, reason: "sampled" });
    expect(sampleApiEvent(read, env, () => 0.1)).toEqual({ send: false });
    expect(sampleApiEvent({ ...read, method: "HEAD" }, env, () => 0.5)).toEqual({ send: false });
    expect(sampleApiEvent(read, { SPOONJOY_API_EVENT_SAMPLE_RATE: "0" }, () => 0)).toEqual({ send: false });
  });

  it("sends every read when no valid rate is set", () => {
    expect(apiEventSampleRate(undefined)).toBe(1);
    expect(apiEventSampleRate({ SPOONJOY_API_EVENT_SAMPLE_RATE: " " })).toBe(1);
    expect(apiEventSampleRate({ SPOONJOY_API_EVENT_SAMPLE_RATE: "often" })).toBe(1);
    expect(apiEventSampleRate({ SPOONJOY_API_EVENT_SAMPLE_RATE: "1.5" })).toBe(1);
    expect(apiEventSampleRate({ SPOONJOY_API_EVENT_SAMPLE_RATE: "-0.1" })).toBe(1);
    expect(apiEventSampleRate({ SPOONJOY_API_EVENT_SAMPLE_RATE: "0.25" })).toBe(0.25);
    expect(sampleApiEvent(read, null)).toEqual({ send: true, sampleRate: 1, reason: "sampled" });
  });

  it("samples production at 10% and leaves QA unsampled", () => {
    const wrangler = JSON.parse(readFileSync("wrangler.json", "utf8")) as {
      vars: Record<string, string>;
      env: { qa: { vars: Record<string, string> } };
    };
    expect(wrangler.vars.SPOONJOY_API_EVENT_SAMPLE_RATE).toBe("0.1");
    expect(wrangler.env.qa.vars.SPOONJOY_API_EVENT_SAMPLE_RATE).toBeUndefined();
  });
});
