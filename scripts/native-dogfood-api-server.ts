import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { handleApiV1Request } from "../app/lib/api-v1.server";
import { createUser } from "../app/lib/auth.server";
import { getLocalDb } from "../app/lib/db.server";

type ServerOptions = {
  host: string;
  port: number;
  baseUrl: string;
};

function parseOptions(argv: string[]): ServerOptions {
  let host = process.env.SPOONJOY_NATIVE_DOGFOOD_API_HOST || "127.0.0.1";
  let port = Number(process.env.SPOONJOY_NATIVE_DOGFOOD_API_PORT || 5179);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--") {
      continue;
    }
    if (argument === "--host" && value) {
      host = value;
      index += 1;
    } else if (argument === "--port" && value) {
      port = Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port: ${String(port)}`);
  }

  return { host, port, baseUrl: `http://${host}:${port}` };
}

async function nodeRequestBody(request: IncomingMessage): Promise<BodyInit | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      headers.set(name, value.join(", "));
    } else if (typeof value === "string") {
      headers.set(name, value);
    }
  }
  if (!headers.has("X-Request-Id")) {
    headers.set("X-Request-Id", `req_native_dogfood_${randomUUID()}`);
  }
  return headers;
}

async function toWebRequest(request: IncomingMessage, baseUrl: string): Promise<Request> {
  const url = new URL(request.url || "/", baseUrl);
  return new Request(url, {
    method: request.method,
    headers: requestHeaders(request),
    body: await nodeRequestBody(request),
  });
}

async function writeWebResponse(response: Response, target: ServerResponse) {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : undefined;
  target.end(body);
}

function apiSplat(pathname: string): string | null {
  if (pathname === "/api/v1") return "";
  if (pathname.startsWith("/api/v1/")) return pathname.slice("/api/v1/".length);
  return null;
}

async function handleNodeRequest(options: ServerOptions, request: IncomingMessage, response: ServerResponse) {
  try {
    const webRequest = await toWebRequest(request, options.baseUrl);
    const splat = apiSplat(new URL(webRequest.url).pathname);
    if (splat === null) {
      response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }

    const webResponse = await handleApiV1Request({
      request: webRequest,
      params: { "*": splat },
      context: {
        cloudflare: {
          env: {
            NODE_ENV: "development",
            SPOONJOY_BASE_URL: options.baseUrl,
            SPOONJOY_NATIVE_ENVIRONMENT: "local",
          },
        },
      },
    } as never);
    await writeWebResponse(webResponse, response);
  } catch (error) {
    console.error("[native-dogfood-api] request failed", error);
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    }
    response.end(JSON.stringify({ ok: false, error: "internal_error" }));
  }
}

async function seedDogfoodPasswordUser() {
  const identifier = process.env.SPOONJOY_NATIVE_DOGFOOD_IDENTIFIER?.trim();
  const passwordFile = process.env.SPOONJOY_NATIVE_DOGFOOD_PASSWORD_FILE?.trim();
  const password = passwordFile
    ? readFileSync(passwordFile, "utf8").replace(/[\r\n]+$/u, "")
    : process.env.SPOONJOY_NATIVE_DOGFOOD_PASSWORD;
  if (!identifier || !password) return;

  const database = await getLocalDb();
  const normalizedEmail = identifier.toLowerCase();
  const existing = await database.user.findFirst({
    where: {
      OR: [
        { email: normalizedEmail },
        { username: identifier },
      ],
    },
    select: { id: true },
  });
  if (existing) return;

  const username = process.env.SPOONJOY_NATIVE_DOGFOOD_USERNAME?.trim()
    || `native_dogfood_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await createUser(database, normalizedEmail, username, password);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("Set DATABASE_URL to the local SQLite database used for native dogfood.");
  }
  process.env.SPOONJOY_FORCE_SQLITE_LOCAL_DB ||= "1";
  process.env.SPOONJOY_NATIVE_DOGFOOD_API ||= "1";
  await seedDogfoodPasswordUser();

  const options = parseOptions(process.argv.slice(2));
  const server = createServer((request, response) => {
    void handleNodeRequest(options, request, response);
  });

  await new Promise<void>((resolve) => server.listen(options.port, options.host, resolve));
  console.log(JSON.stringify({
    event: "spoonjoy_native_dogfood_api_ready",
    baseUrl: options.baseUrl,
    database: "configured",
  }));
}

main().catch((error) => {
  console.error("[native-dogfood-api] failed to start", error);
  process.exit(1);
});
