import type { Prisma, PrismaClient } from "@prisma/client";
import type { D1ReadDatabase } from "~/lib/d1-read.server";
import { d1WriteBatch } from "~/lib/d1-write.server";
import { isSelfHosted, type ServerAccessEnv } from "~/lib/server-access.server";

// Which AI a self-hosted server uses: OpenAI, Gemini or none, picked by its admin on Server
// settings with their own key. The Worker reads the pick on each request (applyServerAi in
// workers/app.ts) and hands every AI feature an env holding only that provider's key, so the
// features themselves don't change. With no pick saved, the keys the server was started with
// apply, as they do on spoonjoy.app, which never reads or writes any of this.

export type AiProvider = "openai" | "gemini" | "off";

export const AI_PROVIDERS: readonly AiProvider[] = ["off", "openai", "gemini"];

const AI_KEY = "ai";
const AI_SECRET_KEY = "ai-key";

export interface ServerAiEnv extends ServerAccessEnv {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  SPOONJOY_AI_IMAGE_GENERATION?: string;
}

/** What the page shows: the provider in use, whether a saved key goes with it, and who chose it. */
export type ServerAi = { provider: AiProvider; setBy: "admin" | "env" | "default" };

type Saved = { provider: AiProvider; key: string | null };

function parseSaved(provider: string | undefined, key: string | undefined): Saved | null {
  if (provider !== "openai" && provider !== "gemini" && provider !== "off") return null;
  return { provider, key: key || null };
}

function providerFromEnv(env: ServerAiEnv | null | undefined): AiProvider | null {
  if (env?.OPENAI_API_KEY?.trim()) return "openai";
  if (env?.GEMINI_API_KEY?.trim() || env?.GOOGLE_API_KEY?.trim()) return "gemini";
  return null;
}

/**
 * The env the AI features see under a saved pick: only the picked provider's key, the admin's.
 * Off also turns off generated covers. No pick (or no key for the picked provider) leaves the env
 * as the server was started.
 */
export function withServerAi<E extends ServerAiEnv>(env: E, saved: Saved | null): E {
  if (!saved || (saved.provider !== "off" && !saved.key)) return env;
  const { OPENAI_API_KEY: _openai, OPENAI_BASE_URL: _base, GEMINI_API_KEY: _gemini, GOOGLE_API_KEY: _google, ...rest } = env;
  if (saved.provider === "openai") return { ...rest, OPENAI_API_KEY: saved.key } as E;
  if (saved.provider === "gemini") return { ...rest, GEMINI_API_KEY: saved.key, GOOGLE_API_KEY: saved.key } as E;
  return { ...rest, SPOONJOY_AI_IMAGE_GENERATION: "off" } as E;
}

type SettingRow = { key: string; value: string };
// The little of D1 this reads with, so it takes the Worker's DB binding whatever its declared type.
type SettingsD1 = { prepare(query: string): { bind(...values: string[]): { all(): Promise<{ results: SettingRow[] }> } } };

/**
 * The Worker's env for one request or scheduled run on a self-hosted server, with the admin's AI
 * pick applied. Reads the two settings straight from D1, before anything else touches the env.
 */
export async function applyServerAi<E extends ServerAiEnv & { DB?: unknown }>(env: E): Promise<E> {
  if (!isSelfHosted(env) || !env.DB) return env;
  const d1 = env.DB as SettingsD1;
  const { results: rows } = await d1.prepare(`SELECT "key", "value" FROM "ServerSetting" WHERE "key" IN (?, ?)`).bind(AI_KEY, AI_SECRET_KEY).all();
  const value = (key: string) => rows.find((row) => row.key === key)?.value;
  return withServerAi(env, parseSaved(value(AI_KEY), value(AI_SECRET_KEY)));
}

async function readSaved(db: PrismaClient): Promise<Saved | null> {
  const rows = await db.serverSetting.findMany({ where: { key: { in: [AI_KEY, AI_SECRET_KEY] } } });
  const value = (key: string) => rows.find((row) => row.key === key)?.value;
  return parseSaved(value(AI_KEY), value(AI_SECRET_KEY));
}

export async function serverAi(db: PrismaClient, env: ServerAiEnv | null | undefined): Promise<ServerAi> {
  const saved = await readSaved(db);
  if (saved) return { provider: saved.provider, setBy: "admin" };
  const fromEnv = providerFromEnv(env);
  return fromEnv ? { provider: fromEnv, setBy: "env" } : { provider: "off", setBy: "default" };
}

/**
 * Saves the admin's pick, or says why it can't. A provider needs a key, except when it is already
 * the saved one, whose key a blank keeps. Off forgets the saved key. With the request's D1
 * binding the pick and its key are written as one batch, since Prisma's D1 adapter doesn't
 * make `$transaction` atomic.
 */
export async function setServerAi(
  db: PrismaClient,
  env: ServerAiEnv | null | undefined,
  { provider, key }: { provider: AiProvider; key: string },
  d1?: D1ReadDatabase | null,
): Promise<string | null> {
  if (!isSelfHosted(env)) return "AI can only be chosen on a self-hosted server.";
  const typed = key.trim();
  if (provider !== "off" && !typed) {
    const saved = await readSaved(db);
    if (saved?.provider !== provider || !saved.key) {
      return `Paste the server's ${provider === "openai" ? "OpenAI" : "Gemini"} API key.`;
    }
  }
  if (d1) {
    const upsert = `INSERT INTO "ServerSetting" ("key", "value") VALUES (?, ?) ON CONFLICT ("key") DO UPDATE SET "value" = excluded."value"`;
    await d1WriteBatch(d1, [
      [upsert, AI_KEY, provider],
      ...(provider === "off" ? [[`DELETE FROM "ServerSetting" WHERE "key" = ?`, AI_SECRET_KEY] as const] : typed ? [[upsert, AI_SECRET_KEY, typed] as const] : []),
    ]);
    return null;
  }
  const writes: Prisma.PrismaPromise<unknown>[] = [
    db.serverSetting.upsert({ where: { key: AI_KEY }, create: { key: AI_KEY, value: provider }, update: { value: provider } }),
  ];
  if (provider === "off") writes.push(db.serverSetting.deleteMany({ where: { key: AI_SECRET_KEY } }));
  else if (typed) writes.push(db.serverSetting.upsert({ where: { key: AI_SECRET_KEY }, create: { key: AI_SECRET_KEY, value: typed }, update: { value: typed } }));
  await db.$transaction(writes);
  return null;
}
