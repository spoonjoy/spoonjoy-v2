import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { action, loader } from "~/routes/mcp";

const MAX_BODY_BYTES = 1024 * 1024;
const READY_KIND = "spoonjoy-mcp-python-bridge-ready";

export function requestHeaders(request: IncomingMessage) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

export async function requestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.byteLength;
    if (length > MAX_BODY_BYTES) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export async function writeResponse(target: ServerResponse, response: Response) {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  target.end(Buffer.from(await response.arrayBuffer()));
}

export async function runBridge() {
  const db = await getLocalDb();
  const user = await db.user.create({
    data: {
      email: `python-mcp-conformance-${crypto.randomUUID()}@example.invalid`,
      username: `python-mcp-${crypto.randomUUID()}`,
    },
  });
  const { token } = await createApiCredential(db, user.id, "Official Python MCP SDK conformance");
  let origin = "";

  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url ?? "/", origin);
      if (url.pathname !== "/mcp") {
        outgoing.writeHead(404).end();
        return;
      }
      const body = incoming.method === "GET" || incoming.method === "HEAD"
        ? undefined
        : await requestBody(incoming);
      if (body === null) {
        outgoing.writeHead(413).end();
        return;
      }
      const request = new Request(url, {
        method: incoming.method,
        headers: requestHeaders(incoming),
        body,
      });
      const routeArgs = {
        request,
        params: {},
        context: { cloudflare: { env: { SPOONJOY_BASE_URL: origin } } },
      } as never;
      const result = incoming.method === "GET" ? await loader(routeArgs) : await action(routeArgs);
      if (!(result instanceof Response)) {
        outgoing.writeHead(406).end();
        return;
      }
      await writeResponse(outgoing, result);
    } catch (error) {
      console.error("Local MCP conformance bridge request failed", error);
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Bridge did not receive a TCP address.");
  origin = `http://127.0.0.1:${address.port}`;
  process.stdout.write(`${JSON.stringify({
    kind: READY_KIND,
    url: `${origin}/mcp`,
    token,
  })}\n`);

  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await db.$disconnect();
  }

  process.once("SIGTERM", async () => {
    await close();
    process.exit(0);
  });
  process.once("SIGINT", async () => {
    await close();
    process.exit(130);
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await runBridge();
}
