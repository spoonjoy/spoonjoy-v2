// The composition root for spoonjoy.app: every platform port, served by today's code.
// Build one per request (or scheduled run) from the Worker's env, and hand its ports to application code.
import { getDb } from "~/lib/db.server";
import { getVapidConfig } from "~/lib/env.server";
import { DEFAULT_GEMINI_TEXT_MODEL, DEFAULT_GEMINI_TEXT_TIMEOUT_MS, geminiGenerateJson } from "~/lib/gemini-text.server";
import { sendTransactionalEmail, type TransactionalEmailEnv } from "~/lib/transactional-email.server";
import { createOpenAIClient } from "~/lib/openai-client.server";
import { sendPush } from "~/lib/web-push.server";
import type { JobMessage } from "../ports/jobs";
import { PlatformUnavailableError, type GenerateJsonInput, type Platform } from "../ports/ports";
import { d1JobKeys, queueJobs, type JobKeysDatabase } from "./cloudflare-jobs";

export type CloudflarePlatformEnv = TransactionalEmailEnv & {
  DB?: D1Database;
  JOBS?: Queue<JobMessage>;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  OPENAI_API_KEY?: string;
  /** An OpenAI-compatible address to use instead of OpenAI's own. */
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
};

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

async function openAiJson(env: CloudflarePlatformEnv, apiKey: string, input: GenerateJsonInput): Promise<string> {
  const client = createOpenAIClient({ apiKey, ...(env.OPENAI_BASE_URL?.trim() ? { baseURL: env.OPENAI_BASE_URL.trim() } : {}) });
  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL,
    messages: [
      { role: "system", content: input.systemPrompt },
      { role: "user", content: input.userText },
    ],
    ...(input.maxOutputTokens ? { max_completion_tokens: input.maxOutputTokens } : {}),
    response_format: { type: "json_schema", json_schema: { name: input.schemaName, strict: true, schema: input.responseSchema } },
  });
  const message = response.choices[0]?.message;
  if (!message?.content || message.refusal) throw new Error("The model gave no JSON answer.");
  return message.content;
}

export function cloudflarePlatform(env: CloudflarePlatformEnv): Platform {
  return {
    push: {
      async web(subscription, payload) {
        let vapid;
        try {
          vapid = getVapidConfig(env);
        } catch {
          throw new PlatformUnavailableError("push", "VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT");
        }
        return sendPush(subscription, payload, vapid);
      },
    },
    ai: {
      async generateJson(input) {
        const openAiKey = env.OPENAI_API_KEY?.trim();
        if (openAiKey) return openAiJson(env, openAiKey, input);
        const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
        if (!apiKey) throw new PlatformUnavailableError("ai", "OPENAI_API_KEY or GEMINI_API_KEY");
        const config = { apiKey, model: DEFAULT_GEMINI_TEXT_MODEL, timeoutMs: DEFAULT_GEMINI_TEXT_TIMEOUT_MS };
        const { systemPrompt, userText, responseSchema, maxOutputTokens } = input;
        return geminiGenerateJson({ systemPrompt, userText, responseSchema, maxOutputTokens, config });
      },
    },
    email: {
      async send(email) {
        if (!env.DB) throw new PlatformUnavailableError("email", "the DB binding");
        await sendTransactionalEmail(await getDb({ DB: env.DB }), env, email);
      },
    },
    jobs: {
      async enqueue(kind, payload, options) {
        if (!env.DB) throw new PlatformUnavailableError("jobs", "the DB binding");
        return queueJobs(env.JOBS, d1JobKeys(env.DB as unknown as JobKeysDatabase)).enqueue(kind, payload, options);
      },
    },
  };
}
