import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getPlatformProxy } from "wrangler";

import { getDb } from "../../app/lib/db.server";
import { issueConnectorTokens, rotateConnectorTokens } from "../../app/lib/oauth-server.server";

const ISSUER = "https://spoonjoy.test";
const USER_ID = "oauth-process-restart-user";
const CLIENT_ID = "oauth-process-restart-client";
const REDIRECT_URI = "https://example.com/callback";
const NOW = new Date("2026-08-29T19:00:00.000Z");
const RESULT_PREFIX = "OAUTH_D1_RESTART_RESULT=";

interface LocalD1Statement {
  run(): Promise<unknown>;
}

interface LocalD1Database {
  prepare(sql: string): LocalD1Statement;
}

function splitMigrationStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = "";
  let inTrigger = false;

  for (const sourceLine of sql.split(/\r?\n/)) {
    if (/^\s*--/.test(sourceLine) || !sourceLine.trim()) continue;
    buffer += `${sourceLine}\n`;
    if (/^\s*CREATE\s+TRIGGER\b/i.test(buffer)) inTrigger = true;
    const complete = inTrigger ? /^\s*END;\s*$/i.test(sourceLine) : /;\s*$/.test(sourceLine);
    if (!complete) continue;
    statements.push(buffer.trim());
    buffer = "";
    inTrigger = false;
  }

  if (buffer.trim()) throw new Error("Repository migration ended with incomplete SQL");
  return statements;
}

async function applyRepositoryMigrations(database: LocalD1Database) {
  const migrationDirectory = resolve("migrations");
  const filenames = (await readdir(migrationDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  for (const filename of filenames) {
    const sql = await readFile(resolve(migrationDirectory, filename), "utf8");
    for (const statement of splitMigrationStatements(sql)) {
      await database.prepare(statement).run();
    }
  }
}

async function readInput(): Promise<Record<string, unknown>> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk.toString();
  if (!input.trim()) return {};
  const parsed: unknown = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Restart process input must be an object");
  }
  return parsed as Record<string, unknown>;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value) throw new Error(`Missing ${key}`);
  return value;
}

async function main() {
  const mode = process.argv[2];
  const persistencePath = process.argv[3];
  if (!mode || !persistencePath) throw new Error("Mode and persistence path are required");
  const input = await readInput();
  const platform = await getPlatformProxy<{ DB: D1Database }>({
    configPath: resolve("wrangler.json"),
    envFiles: [],
    persist: { path: persistencePath },
    remoteBindings: false,
  });
  const database = await getDb({ DB: platform.env.DB });

  try {
    let result: Record<string, unknown>;
    if (mode === "issue") {
      await applyRepositoryMigrations(platform.env.DB as unknown as LocalD1Database);
      await database.user.create({
        data: {
          id: USER_ID,
          email: "oauth-process-restart@example.com",
          username: "oauth_process_restart",
        },
      });
      await database.oAuthClient.create({
        data: {
          id: CLIENT_ID,
          clientName: "Process restart connector",
          redirectUris: REDIRECT_URI,
          issuer: ISSUER,
        },
      });
      const tokens = await issueConnectorTokens(database, {
        userId: USER_ID,
        clientId: CLIENT_ID,
        scope: "kitchen:read",
        resource: "https://spoonjoy.test/mcp",
        persistentMcpResource: "https://spoonjoy.test/mcp",
        issuer: ISSUER,
        now: NOW,
      });
      result = tokens;
    } else if (mode === "rotate") {
      const tokens = await rotateConnectorTokens(database, {
        refreshToken: requiredString(input, "refreshToken"),
        clientId: CLIENT_ID,
        issuer: ISSUER,
        now: NOW,
      });
      result = tokens;
    } else if (mode === "observe") {
      result = {
        user: await database.user.findUniqueOrThrow({ where: { id: USER_ID } }),
        client: await database.oAuthClient.findUniqueOrThrow({ where: { id: CLIENT_ID } }),
        refreshRows: await database.oAuthRefreshToken.findMany({
          where: { userId: USER_ID, clientId: CLIENT_ID },
          orderBy: { tokenHash: "asc" },
        }),
        accessRows: await database.apiCredential.findMany({
          where: { userId: USER_ID, oauthClientId: CLIENT_ID },
          orderBy: { tokenHash: "asc" },
        }),
      };
    } else {
      throw new Error("Unknown restart-process mode");
    }
    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(result)}\n`);
  } finally {
    await database.$disconnect();
    await platform.dispose();
  }
}

await main();
