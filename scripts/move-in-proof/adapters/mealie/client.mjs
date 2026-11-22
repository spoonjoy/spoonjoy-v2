// A small HTTP client for the source app's REST API. It signs in with a password, sends JSON,
// forms and multipart uploads, and retries only reads, so a retried write can never double a
// count (a write that is safe to repeat, like asking for an export token, says so with
// `idempotent`). Exercised against real servers by the Move-in Proof workflow.
import { createHash } from "node:crypto";
import { Agent, FormData, fetch } from "undici";

// The source app's server drops a kept-alive connection after 5 idle seconds; reusing one it has
// just dropped fails the request. Idle connections here close after 1 second instead.
const dispatcher = new Agent({ keepAliveTimeout: 1000, keepAliveMaxTimeout: 1000 });

export class SourceApiError extends Error {
  constructor(method, path, status, body) {
    super(`${method} ${path} answered ${status}: ${body.slice(0, 500)}`);
    this.status = status;
  }
}

// A version 4 UUID derived from a key, so ids the kitchen chooses (ingredient references, step
// ids) are the same on every run.
export function stableUuid(key) {
  const hex = createHash("sha256").update(key).digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class SourceClient {
  constructor(baseUrl, token = null) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  withToken(token) {
    return new SourceClient(this.baseUrl, token);
  }

  async signIn(email, password) {
    const body = new URLSearchParams({ username: email, password });
    const response = await this.request("POST", "/api/auth/token", { body });
    return this.withToken(response.access_token);
  }

  async request(method, path, { json, body, query, raw = false, idempotent = method === "GET" } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
    const headers = { accept: "application/json" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let payload = body;
    if (json !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(json);
    }
    const attempts = idempotent ? 4 : 1;
    for (let attempt = 1; ; attempt += 1) {
      let response;
      let content;
      try {
        response = await fetch(url, { method, headers, body: payload, dispatcher });
        content = Buffer.from(await response.arrayBuffer());
      } catch (error) {
        // A dropped connection, before or during the answer.
        if (attempt >= attempts) throw error;
        await sleep(500 * attempt);
        continue;
      }
      if (response.status >= 500 && attempt < attempts) {
        await sleep(500 * attempt);
        continue;
      }
      if (!response.ok) throw new SourceApiError(method, path, response.status, content.toString("utf8"));
      if (raw) return content;
      const text = content.toString("utf8");
      return text ? JSON.parse(text) : null;
    }
  }

  get(path, query) {
    return this.request("GET", path, { query });
  }

  post(path, json) {
    return this.request("POST", path, { json });
  }

  put(path, json) {
    return this.request("PUT", path, { json });
  }

  // Every item of a paginated list in one page.
  async all(path, query = {}) {
    const page = await this.get(path, { page: 1, perPage: -1, ...query });
    return Array.isArray(page) ? page : page.items;
  }

  async uploadImage(path, png) {
    const form = new FormData();
    form.set("image", new Blob([png], { type: "image/png" }), "photo.png");
    form.set("extension", "png");
    return this.request("PUT", path, { body: form });
  }

  download(path, query) {
    return this.request("GET", path, { query, raw: true });
  }
}

export async function waitForServer(baseUrl, { timeoutMs = 240_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no answer yet";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/app/about`, { dispatcher });
      if (response.ok) return response.json();
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(2000);
  }
  throw new Error(`The source app at ${baseUrl} did not come up within ${timeoutMs / 1000}s (${lastError}).`);
}

// Runs `work` over `items`, at most `limit` at a time, in item order per worker.
export async function eachLimited(items, limit, work) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await work(items[index], index);
    }
  });
  await Promise.all(workers);
}
