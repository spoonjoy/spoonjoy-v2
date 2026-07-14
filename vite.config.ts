import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { defineConfig, type Plugin } from "vite";
import { shouldLogRollupBuildMessage } from "./scripts/build-output-hygiene";

const appDirectory = new URL("./app", import.meta.url).pathname;
const componentsDirectory = new URL("./app/components", import.meta.url).pathname;
const prismaWasmClient = new URL("./node_modules/.prisma/client/wasm.js", import.meta.url).pathname;

type RequestInitWithDuplex = RequestInit & { duplex: "half" };

const TURBO_STREAM_NULL = -5;
const TURBO_STREAM_UNDEFINED = -7;
const TURBO_STREAM_HOLE = -1;
const devWranglerVars = wranglerVars();

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function wranglerVars(): Record<string, string> {
  try {
    const config = JSON.parse(readFileSync(new URL("./wrangler.json", import.meta.url), "utf8")) as { vars?: unknown };
    return stringRecord(config.vars);
  } catch {
    return {};
  }
}

function firstHeader(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function decodeTurboStreamJson(text: string): unknown {
  const firstLine = text.split("\n").find((line) => line.trim().length > 0);
  if (!firstLine) throw new SyntaxError("Missing single-fetch body.");
  const values = JSON.parse(firstLine) as unknown[];
  if (!Array.isArray(values)) throw new SyntaxError("Invalid single-fetch body.");
  const hydrated = new Map<number, unknown>();

  function hydrate(index: number): unknown {
    if (index === TURBO_STREAM_NULL) return null;
    if (index === TURBO_STREAM_UNDEFINED) return undefined;
    if (hydrated.has(index)) return hydrated.get(index);

    const value = values[index];
    if (!value || typeof value !== "object") {
      hydrated.set(index, value);
      return value;
    }

    if (Array.isArray(value)) {
      if (typeof value[0] === "string") {
        throw new SyntaxError("Unsupported single-fetch value type.");
      }
      const array: unknown[] = [];
      hydrated.set(index, array);
      value.forEach((item, itemIndex) => {
        if (typeof item === "number" && item !== TURBO_STREAM_HOLE) {
          array[itemIndex] = hydrate(item);
        }
      });
      return array;
    }

    const object: Record<string, unknown> = {};
    hydrated.set(index, object);
    for (const [keyIndex, valueIndex] of Object.entries(value)) {
      const key = String(hydrate(Number(keyIndex.slice(1))));
      object[key] = hydrate(valueIndex as number);
    }
    return object;
  }

  return hydrate(0);
}

function mcpResourceMetadataUrl(url: URL): string {
  const origin = new URL(process.env.SPOONJOY_BASE_URL ?? devWranglerVars.SPOONJOY_BASE_URL ?? url.origin).origin;
  return `${origin}/.well-known/oauth-protected-resource/mcp`;
}

function webRequestFromNode(req: IncomingMessage, url: URL): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const init: RequestInitWithDuplex = {
    method: req.method ?? "GET",
    headers,
    body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
    duplex: "half",
  };
  return new Request(url, init);
}

async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  res.statusMessage = response.statusText;
  response.headers.forEach((value, key) => res.setHeader(key, value));

  if (!response.body) {
    res.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (error) {
    res.destroy(error instanceof Error ? error : new Error(String(error)));
  }
}

async function normalizeMcpDataResponse(response: Response, url: URL): Promise<Response> {
  if (!response.headers.get("Content-Type")?.includes("text/x-script")) {
    return response;
  }

  const decoded = decodeTurboStreamJson(await response.text());
  const payload = isRecord(decoded) && "data" in decoded ? decoded.data : decoded;
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("Content-Length");
  headers.delete("X-Remix-Response");
  if (response.status === 401 && !headers.has("WWW-Authenticate")) {
    headers.set("WWW-Authenticate", `Bearer resource_metadata="${mcpResourceMetadataUrl(url)}"`);
  }

  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function mcpPostDevMiddleware(): Plugin {
  return {
    name: "spoonjoy-mcp-post-dev-middleware",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const method = req.method?.toUpperCase();
        if (method !== "POST" || !req.url) {
          next();
          return;
        }

        const host = firstHeader(req.headers.host, "localhost:5173");
        const proto = firstHeader(req.headers["x-forwarded-proto"], "http");
        const url = new URL(req.url, `${proto}://${host}`);
        if (url.pathname !== "/mcp") {
          next();
          return;
        }

        try {
          const dataUrl = new URL("/mcp.data", url);
          const response = await normalizeMcpDataResponse(
            await fetch(webRequestFromNode(req, dataUrl)),
            dataUrl,
          );
          await writeWebResponse(res, response);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    mcpPostDevMiddleware(),
    reactRouter(),
  ],
  optimizeDeps: command === "build" ? { noDiscovery: true, include: [] } : undefined,
  build: {
    rollupOptions: {
      onLog(level, log, defaultHandler) {
        if (shouldLogRollupBuildMessage(level, log)) {
          defaultHandler(level, log);
        }
      },
    },
  },
  resolve: {
    alias: {
      "@": componentsDirectory,
      "~": appDirectory,
      // Prisma edge runtime alias for Cloudflare Workers
      ".prisma/client/default": prismaWasmClient,
    },
  },
}));
