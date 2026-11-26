// How a move-in asks another app's own server for a kitchen, with the API token the cook made there. Every server
// source (Mealie's, another Spoonjoy's) asks through this client, so each keeps the same promises: the token goes only
// to the address the cook gave, over https, never along a redirect, and the move-in waits only so long for each answer
// and reads only so much of it, so a slow or strange server can't hold a run past its time or its memory.
import { SourceBusyError, SourceUnavailableError } from "../../../application/source";
import { MoveInError } from "../../../model/move-in-error";

export interface ServerApiConnection {
  /** Where the cook opens the app, such as https://recipes.example.com. */
  address: string;
  token: string;
  fetch: typeof globalThis.fetch;
}

// The answer has to start within HEADERS_MS; its body then has BODY_MS more, so a large photo on a slow home upload
// still arrives. One recipe's worst case is two tries of an answer and a check that the server is up, plus its photo,
// about 150 s: it has to stay under the move-in's claim lease (leaseSeconds in move-in-job.server.ts, 300 s).
const HEADERS_MS = 10_000;
const BODY_MS = 15_000;
export const JSON_MAX_BYTES = 16 * 1024 * 1024;
const PHOTO_MAX_BYTES = 20 * 1024 * 1024;

function baseOf(address: string): URL {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    throw new MoveInError("server-address", "not a web address");
  }
  // Plain http would carry the token across the internet in the clear.
  if (url.protocol !== "https:") throw new MoveInError("server-address", `${url.protocol} isn't https`);
  // A name and password in the address would be kept with it and sent beside the token: the token is all it needs.
  if (url.username || url.password) throw new MoveInError("server-address", "the address has a name or password in it");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The server answered, but not with what was asked for: a status it shouldn't give, or more than the move-in reads. */
export class AnswerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "AnswerError";
  }
}

// How long the move-in waits when the server asks it to slow down: what its Retry-After says, kept between these, or
// BUSY_DEFAULT_MS when it doesn't say.
export const BUSY_MIN_MS = 1_000;
export const BUSY_MAX_MS = 5 * 60_000;
export const BUSY_DEFAULT_MS = 30_000;

/**
 * A 429: the server, or a proxy in front of it, is limiting how fast the move-in asks. Unlike a 503 that says when to
 * come back, it is never one recipe's trouble, so the move-in waits rather than asking whether the server is up.
 */
class RateLimitedError extends SourceBusyError {}

/** A Retry-After header, in seconds or as a date, as milliseconds from `now`, kept between BUSY_MIN_MS and BUSY_MAX_MS. */
export function retryAfterMs(header: string | null, now: number): number {
  const value = header?.trim() ?? "";
  let ms = BUSY_DEFAULT_MS;
  if (/^\d+$/.test(value)) ms = Number(value) * 1000;
  else if (value && !Number.isNaN(Date.parse(value))) ms = Date.parse(value) - now;
  return Math.min(BUSY_MAX_MS, Math.max(BUSY_MIN_MS, ms));
}

/** The body, up to `maxBytes`; a body cut off partway is an outage, like a server that can't be reached. */
async function readBody(response: Response, path: string, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AnswerError(response.status, `the recipe server's answer for ${path} is larger than ${maxBytes / 1024 / 1024} MB`);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AnswerError) throw error;
    throw new SourceUnavailableError(`the recipe server stopped answering partway: ${messageOf(error)}`);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

/**
 * A client for the server at the connection's address. `probePath` is a path that needs the server's database, as
 * recipes do, and answers the token: the client asks it to tell one recipe's trouble from the whole server's.
 */
export function serverApiClient({ address, token, fetch }: ServerApiConnection, { probePath }: { probePath: string }) {
  const base = baseOf(address).href.replace(/\/$/, "");
  const request = async (path: string, maxBytes: number): Promise<Uint8Array> => {
    let response: Response;
    const timer = new AbortController();
    const headers = setTimeout(() => timer.abort(new Error("the server took too long to answer")), HEADERS_MS);
    try {
      response = await fetch(`${base}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        // A redirect could carry the token to another server, so the move-in never follows one.
        redirect: "manual",
        signal: timer.signal,
      });
    } catch (error) {
      throw new SourceUnavailableError(`the recipe server can't be reached: ${messageOf(error)}`);
    } finally {
      clearTimeout(headers);
    }
    if (response.status === 401 || response.status === 403) throw new MoveInError("server-token", `${path} answered ${response.status}`);
    // The server, or a proxy in front of it, asked the move-in to slow down: a 429, or a 503 that says when to come back.
    if (response.status === 429 || (response.status === 503 && response.headers.has("retry-after"))) {
      const wait = retryAfterMs(response.headers.get("retry-after"), Date.now());
      const Busy = response.status === 429 ? RateLimitedError : SourceBusyError;
      throw new Busy(`the recipe server asked the move-in to wait ${Math.round(wait / 1000)} s at ${path}`, wait);
    }
    if (response.status >= 500) throw new SourceUnavailableError(`the recipe server answered ${response.status} for ${path}`);
    if (response.status !== 200) throw new AnswerError(response.status, `the recipe server answered ${response.status} for ${path}`);
    const body = setTimeout(() => timer.abort(new Error("the answer took too long to arrive")), BODY_MS);
    try {
      return await readBody(response, path, maxBytes);
    } finally {
      clearTimeout(body);
    }
  };
  return {
    /** The address with no trailing slash, as the move-in keeps it. */
    base,
    json: async (path: string): Promise<unknown> => JSON.parse(new TextDecoder().decode(await request(path, JSON_MAX_BYTES))),
    bytes: (path: string): Promise<Uint8Array> => request(path, PHOTO_MAX_BYTES),
    /**
     * An outage while asking for one recipe or photo is the server's only if the server is down as a whole: when it
     * still answers, the trouble is that one item's, which counts against it like any failure, so it's passed over.
     * The check asks for `probePath`, which needs the server's database as recipes do: an about page answers even
     * while its database is down.
     *
     * It isn't async: an async handler that rethrows makes a second rejected promise, which the chain only takes up a
     * turn later, and the Workers runtime reports that one as unhandled.
     */
    itemOutage(error: unknown): Promise<never> {
      if (!(error instanceof SourceUnavailableError) || error instanceof RateLimitedError) throw error;
      return request(probePath, JSON_MAX_BYTES).then(
        () => {
          throw new Error(`the recipe server couldn't give this one: ${error.message}`);
        },
        (probe: unknown) => {
          throw probe instanceof MoveInError ? probe : error;
        },
      );
    },
  };
}

export type ServerApiClient = ReturnType<typeof serverApiClient>;
