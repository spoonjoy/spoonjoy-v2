// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendPush = vi.fn();
const geminiGenerateJson = vi.fn();
const sendTransactionalEmail = vi.fn();
const createOpenAIClient = vi.fn();
const completionsCreate = vi.fn();
vi.mock("~/lib/openai-client.server", () => ({ createOpenAIClient: (...args: unknown[]) => createOpenAIClient(...args) }));
vi.mock("~/lib/web-push.server", () => ({ sendPush: (...args: unknown[]) => sendPush(...args) }));
vi.mock("~/lib/gemini-text.server", async (original) => ({
  ...(await original<typeof import("~/lib/gemini-text.server")>()),
  geminiGenerateJson: (...args: unknown[]) => geminiGenerateJson(...args),
}));
vi.mock("~/lib/transactional-email.server", () => ({ sendTransactionalEmail: (...args: unknown[]) => sendTransactionalEmail(...args) }));

const { cloudflarePlatform } = await import("~/domains/platform/index.server");
const { defineJob } = await import("~/domains/platform");

const unavailable = (port: string) => expect.objectContaining({ name: "PlatformUnavailableError", port });

describe("platform ports on spoonjoy.app", () => {
  beforeEach(() => {
    sendPush.mockReset();
    geminiGenerateJson.mockReset();
    sendTransactionalEmail.mockReset();
    completionsCreate.mockReset();
    createOpenAIClient.mockReset().mockReturnValue({ chat: { completions: { create: completionsCreate } } });
  });

  it("sends web push with the Worker's VAPID keys", async () => {
    sendPush.mockResolvedValue({ status: "delivered", httpStatus: 201, providerEndpoint: "push.example" });
    const env = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:chef@example.com" };
    const subscription = { endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } };
    const payload = { title: "Done", body: "Your kitchen moved in", url: "/" };
    expect(await cloudflarePlatform(env as never).push.web(subscription, payload)).toMatchObject({ status: "delivered" });
    expect(sendPush).toHaveBeenCalledWith(subscription, payload, { publicKey: "pub", privateKey: "priv", subject: "mailto:chef@example.com" });
    await expect(cloudflarePlatform({} as never).push.web(subscription, payload)).rejects.toEqual(unavailable("push"));
  });

  const aiInput = { systemPrompt: "Parse", userText: "2 lemons", schemaName: "items", responseSchema: { type: "object" } };

  it("asks OpenAI, or an OpenAI-compatible address, for JSON first", async () => {
    completionsCreate.mockResolvedValue({ choices: [{ message: { content: '{"ok":true}', refusal: null } }] });
    expect(await cloudflarePlatform({ OPENAI_API_KEY: " sk " } as never).ai.generateJson(aiInput)).toBe('{"ok":true}');
    expect(createOpenAIClient).toHaveBeenLastCalledWith({ apiKey: "sk" });
    expect(completionsCreate).toHaveBeenLastCalledWith({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Parse" },
        { role: "user", content: "2 lemons" },
      ],
      response_format: { type: "json_schema", json_schema: { name: "items", strict: true, schema: { type: "object" } } },
    });

    const env = { OPENAI_API_KEY: "sk", OPENAI_BASE_URL: " http://ollama.local/v1 ", OPENAI_MODEL: "llama3", GEMINI_API_KEY: "g" };
    await cloudflarePlatform(env as never).ai.generateJson({ ...aiInput, maxOutputTokens: 300 });
    expect(createOpenAIClient).toHaveBeenLastCalledWith({ apiKey: "sk", baseURL: "http://ollama.local/v1" });
    expect(completionsCreate).toHaveBeenLastCalledWith(expect.objectContaining({ model: "llama3", max_completion_tokens: 300 }));
    expect(geminiGenerateJson).not.toHaveBeenCalled();
  });

  it("refuses an OpenAI answer with no JSON in it", async () => {
    const platform = cloudflarePlatform({ OPENAI_API_KEY: "sk" } as never);
    for (const choices of [[], [{ message: { content: null } }], [{ message: { content: "{}", refusal: "no" } }]]) {
      completionsCreate.mockResolvedValueOnce({ choices });
      await expect(platform.ai.generateJson(aiInput)).rejects.toThrow("The model gave no JSON answer.");
    }
  });

  it("falls back to Gemini when there is no OpenAI key", async () => {
    geminiGenerateJson.mockResolvedValue('{"ok":true}');
    const { schemaName: _schemaName, ...geminiInput } = aiInput;
    expect(await cloudflarePlatform({ GEMINI_API_KEY: " key " } as never).ai.generateJson(aiInput)).toBe('{"ok":true}');
    expect(geminiGenerateJson).toHaveBeenCalledWith({ ...geminiInput, maxOutputTokens: undefined, config: expect.objectContaining({ apiKey: "key" }) });
    await cloudflarePlatform({ OPENAI_API_KEY: " ", GOOGLE_API_KEY: "google" } as never).ai.generateJson(aiInput);
    expect(geminiGenerateJson).toHaveBeenLastCalledWith(expect.objectContaining({ config: expect.objectContaining({ apiKey: "google" }) }));
    await expect(cloudflarePlatform({ GEMINI_API_KEY: " " } as never).ai.generateJson(aiInput)).rejects.toEqual(unavailable("ai"));
  });

  it("sends account email through the email outbox code", async () => {
    sendTransactionalEmail.mockResolvedValue(undefined);
    const env = { DB: {}, SPOONJOY_EMAIL_MODE: "capture" };
    const email = { to: "chef@example.com", purpose: "verify_email" as const, subject: "Hi", text: "Hello" };
    await cloudflarePlatform(env as never).email.send(email);
    const [client, sentEnv, sent] = sendTransactionalEmail.mock.calls[0];
    expect(typeof client.$disconnect).toBe("function");
    expect([sentEnv, sent]).toEqual([env, email]);
    await expect(cloudflarePlatform({} as never).email.send(email)).rejects.toEqual(unavailable("email"));
  });

  it("sends jobs on the JOBS queue, keyed in D1", async () => {
    const send = vi.fn(async () => {});
    const run = vi.fn(async () => ({ meta: { changes: 1 } }));
    const DB = { prepare: () => ({ bind: () => ({ run, all: async () => ({ results: [] }) }) }) };
    const kind = defineJob<{ jobId: string }>("move-in.run");
    const platform = cloudflarePlatform({ DB, JOBS: { send } } as never);
    expect(await platform.jobs.enqueue(kind, { jobId: "job-1" }, { key: "move-in:job-1" })).toEqual({ enqueued: true });
    expect(send).toHaveBeenCalledWith({ type: "move-in.run", key: "move-in:job-1", payload: { jobId: "job-1" } }, {});
    await expect(cloudflarePlatform({ DB } as never).jobs.enqueue(kind, { jobId: "job-1" }, { key: "k" })).rejects.toEqual(unavailable("jobs"));
    await expect(cloudflarePlatform({ JOBS: { send } } as never).jobs.enqueue(kind, { jobId: "job-1" }, { key: "k" })).rejects.toEqual(unavailable("jobs"));
  });
});
