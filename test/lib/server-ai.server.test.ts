import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { applyServerAi, serverAi, setServerAi, withServerAi } from "~/lib/server-ai.server";
import { cleanupDatabase } from "../helpers/cleanup";

const selfHosted = { SPOONJOY_SELF_HOSTED: "true" };
const started = { ...selfHosted, OPENAI_API_KEY: "sk-started", OPENAI_BASE_URL: "http://models.local/v1", GEMINI_API_KEY: "g-started", GOOGLE_API_KEY: "g-started", POSTHOG_KEY: "ph" };

// The Worker's DB binding as applyServerAi reads it, answered from the test database's settings.
function d1(asked: string[] = []) {
  return {
    prepare: (query: string) => ({
      bind: (...keys: string[]) => ({
        all: async () => {
          asked.push(query);
          return { results: await db.serverSetting.findMany({ where: { key: { in: keys } } }) };
        },
      }),
    }),
  };
}

beforeEach(async () => {
  await cleanupDatabase();
  await db.serverSetting.deleteMany();
});
afterEach(async () => {
  await db.serverSetting.deleteMany();
});

describe("serverAi", () => {
  it("is the key the server was started with until the admin picks, then the admin's pick", async () => {
    expect(await serverAi(db, selfHosted)).toEqual({ provider: "off", setBy: "default" });
    expect(await serverAi(db, { ...selfHosted, OPENAI_API_KEY: " sk " })).toEqual({ provider: "openai", setBy: "env" });
    expect(await serverAi(db, { ...selfHosted, GOOGLE_API_KEY: "g" })).toEqual({ provider: "gemini", setBy: "env" });
    expect(await serverAi(db, { ...selfHosted, GEMINI_API_KEY: "g" })).toEqual({ provider: "gemini", setBy: "env" });
    await setServerAi(db, selfHosted, { provider: "off", key: "" });
    expect(await serverAi(db, started)).toEqual({ provider: "off", setBy: "admin" });
    await setServerAi(db, selfHosted, { provider: "gemini", key: " g-admin " });
    expect(await serverAi(db, started)).toEqual({ provider: "gemini", setBy: "admin" });
  });

  it("ignores a setting it doesn't know", async () => {
    await db.serverSetting.create({ data: { key: "ai", value: "claude-on-a-toaster" } });
    expect(await serverAi(db, selfHosted)).toEqual({ provider: "off", setBy: "default" });
  });
});

describe("setServerAi", () => {
  it("needs a key for a new provider, keeps the saved one when left empty, and forgets it when AI is turned off", async () => {
    expect(await setServerAi(db, selfHosted, { provider: "openai", key: " " })).toBe("Paste the server's OpenAI API key.");
    await setServerAi(db, selfHosted, { provider: "openai", key: "sk-admin" });
    expect(await setServerAi(db, selfHosted, { provider: "gemini", key: "" })).toBe("Paste the server's Gemini API key.");
    await setServerAi(db, selfHosted, { provider: "openai", key: "" });
    expect(await db.serverSetting.findUnique({ where: { key: "ai-key" } })).toMatchObject({ value: "sk-admin" });
    await setServerAi(db, selfHosted, { provider: "off", key: "ignored" });
    expect(await db.serverSetting.findMany({ orderBy: { key: "asc" } })).toEqual([{ key: "ai", value: "off" }]);
    expect(await setServerAi(db, selfHosted, { provider: "openai", key: "" })).toBe("Paste the server's OpenAI API key.");
  });

  it("refuses anywhere but a self-hosted server", async () => {
    expect(await setServerAi(db, {}, { provider: "off", key: "" })).toBe("AI can only be chosen on a self-hosted server.");
  });
});

describe("withServerAi", () => {
  it("hands the AI features only the picked provider's key, or none and no drawn covers", () => {
    expect(withServerAi(started, null)).toBe(started);
    expect(withServerAi(started, { provider: "openai", key: null })).toBe(started);
    expect(withServerAi(started, { provider: "openai", key: "sk-admin" })).toEqual({ ...selfHosted, POSTHOG_KEY: "ph", OPENAI_API_KEY: "sk-admin" });
    expect(withServerAi(started, { provider: "gemini", key: "g-admin" })).toEqual({ ...selfHosted, POSTHOG_KEY: "ph", GEMINI_API_KEY: "g-admin", GOOGLE_API_KEY: "g-admin" });
    expect(withServerAi(started, { provider: "off", key: null })).toEqual({ ...selfHosted, POSTHOG_KEY: "ph", SPOONJOY_AI_IMAGE_GENERATION: "off" });
  });
});

describe("applyServerAi", () => {
  it("applies the saved pick on a self-hosted server, and leaves every other env alone without asking D1", async () => {
    const asked: string[] = [];
    const env = { ...started, DB: d1(asked) };
    expect(await applyServerAi(env)).toBe(env);
    await setServerAi(db, selfHosted, { provider: "openai", key: "sk-admin" });
    const applied = await applyServerAi(env);
    expect(applied).toMatchObject({ OPENAI_API_KEY: "sk-admin", POSTHOG_KEY: "ph" });
    expect(applied).not.toHaveProperty("GEMINI_API_KEY");
    expect(asked).toHaveLength(2);

    const hosted = { OPENAI_API_KEY: "sk", DB: d1(asked) };
    expect(await applyServerAi(hosted)).toBe(hosted);
    const noDb = { ...started };
    expect(await applyServerAi(noDb)).toBe(noDb);
    expect(asked).toHaveLength(2);
  });
});
