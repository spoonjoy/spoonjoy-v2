import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSafeImageBytes } from "~/lib/safe-image-fetch.server";

function validJpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xda]);
}

function validPngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

function validWebpBytes(): Uint8Array {
  return new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
}

function imageResponse(
  bytes: Uint8Array,
  contentType: string | null,
  init: { ok?: boolean; status?: number; location?: string } = {},
): Response {
  const headers = new Headers();
  if (contentType !== null) headers.set("content-type", contentType);
  if (init.location) headers.set("location", init.location);
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers,
    arrayBuffer: async () => bytes.buffer as ArrayBuffer,
  } as unknown as Response;
}

function chunkedImageResponse(
  chunks: Uint8Array[],
  contentType: string,
): Response & { reader: { read: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } } {
  let index = 0;
  const reader = {
    read: vi.fn(async () => {
      const chunk = chunks[index];
      index += 1;
      return chunk ? { done: false, value: chunk } : { done: true, value: undefined };
    }),
    cancel: vi.fn(async () => undefined),
    releaseLock: vi.fn(),
  };
  const response = {
    ok: true,
    status: 200,
    headers: new Headers([["content-type", contentType]]),
    body: { getReader: () => reader },
    arrayBuffer: vi.fn(async () => {
      const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes.buffer as ArrayBuffer;
    }),
  } as unknown as Response & { reader: typeof reader };
  response.reader = reader;
  return response;
}

describe("fetchSafeImageBytes", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("accepts JPEG, PNG, and WebP responses with matching magic bytes", async () => {
    const cases = [
      ["https://cdn.example.com/cover.jpg", "image/jpeg; charset=binary", validJpegBytes(), "jpg"],
      ["https://cdn.example.com/cover.png", "image/png", validPngBytes(), "png"],
      ["https://cdn.example.com/cover.webp", "image/webp", validWebpBytes(), "webp"],
    ] as const;

    for (const [url, contentType, bytes, extension] of cases) {
      const fetchImpl = vi.fn(async () => imageResponse(bytes, contentType)) as unknown as typeof fetch;

      await expect(fetchSafeImageBytes(url, { fetchImpl })).resolves.toMatchObject({
        contentType: contentType.split(";")[0],
        extension,
      });
      expect(fetchImpl).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "manual" }));
    }
  });

  it("uses global fetch and default max size when deps are omitted", async () => {
    const originalFetch = globalThis.fetch;
    const stub = vi.fn(async () => imageResponse(validJpegBytes(), "image/jpeg")) as unknown as typeof fetch;
    globalThis.fetch = stub;
    try {
      await expect(fetchSafeImageBytes("https://cdn.example.com")).resolves.toMatchObject({
        contentType: "image/jpeg",
        extension: "jpg",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects malformed, non-http, blocked-host, and GIF-extension URLs before fetch", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(fetchSafeImageBytes("not a url", { fetchImpl })).rejects.toThrow(/cannot parse/i);
    await expect(fetchSafeImageBytes("file:///tmp/x.jpg", { fetchImpl })).rejects.toThrow(/scheme/i);
    await expect(fetchSafeImageBytes("http://localhost/x.jpg", { fetchImpl })).rejects.toThrow(/blocked/i);
    await expect(fetchSafeImageBytes("https://cdn.example.com/x.gif", { fetchImpl })).rejects.toThrow(/gif/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-2xx, missing content-type, unsupported content-type, oversized, and byte-mismatch responses", async () => {
    await expect(fetchSafeImageBytes("https://cdn.example.com/a.jpg", {
      fetchImpl: vi.fn(async () => imageResponse(validJpegBytes(), "image/jpeg", { ok: false, status: 500 })) as unknown as typeof fetch,
    })).rejects.toThrow(/500/);
    await expect(fetchSafeImageBytes("https://cdn.example.com/a.jpg", {
      fetchImpl: vi.fn(async () => imageResponse(validJpegBytes(), null)) as unknown as typeof fetch,
    })).rejects.toThrow(/content-type/i);
    await expect(fetchSafeImageBytes("https://cdn.example.com/a.jpg", {
      fetchImpl: vi.fn(async () => imageResponse(validJpegBytes(), "application/pdf")) as unknown as typeof fetch,
    })).rejects.toThrow(/content-type/i);
    await expect(fetchSafeImageBytes("https://cdn.example.com/a.jpg", {
      fetchImpl: vi.fn(async () => imageResponse(validJpegBytes(), "image/jpeg")) as unknown as typeof fetch,
      maxBytes: 2,
    })).rejects.toThrow(/5MB/);
    await expect(fetchSafeImageBytes("https://cdn.example.com/a.jpg", {
      fetchImpl: vi.fn(async () => imageResponse(validPngBytes(), "image/jpeg")) as unknown as typeof fetch,
    })).rejects.toThrow(/JPG, PNG, or WebP/);
  });

  it("streams image bytes and cancels the response body as soon as the size cap is exceeded", async () => {
    const streamResponse = chunkedImageResponse([
      validPngBytes().slice(0, 4),
      validPngBytes().slice(4),
      new Uint8Array([1, 2, 3]),
    ], "image/png");
    const fetchImpl = vi.fn(async () => streamResponse) as unknown as typeof fetch;

    await expect(fetchSafeImageBytes("https://cdn.example.com/a.png", {
      fetchImpl,
      maxBytes: 8,
    })).rejects.toThrow(/5MB/);
    expect(streamResponse.reader.cancel).toHaveBeenCalledWith("Image exceeds 5MB cap");
    expect(streamResponse.reader.read).toHaveBeenCalledTimes(2);
    expect(streamResponse.arrayBuffer).not.toHaveBeenCalled();
  });

  it("accepts streamed image responses by joining chunks before validation", async () => {
    const streamResponse = chunkedImageResponse([
      validPngBytes().slice(0, 4),
      validPngBytes().slice(4),
    ], "image/png");
    const fetchImpl = vi.fn(async () => streamResponse) as unknown as typeof fetch;

    await expect(fetchSafeImageBytes("https://cdn.example.com/a.png", { fetchImpl }))
      .resolves.toMatchObject({ bytes: validPngBytes(), contentType: "image/png", extension: "png" });
    expect(streamResponse.reader.cancel).not.toHaveBeenCalled();
    expect(streamResponse.reader.read).toHaveBeenCalledTimes(3);
    expect(streamResponse.arrayBuffer).not.toHaveBeenCalled();
  });

  it("maps AbortError to timeout and rethrows other fetch failures", async () => {
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    await expect(fetchSafeImageBytes("https://cdn.example.com/a.jpg", {
      fetchImpl: vi.fn(async () => { throw abortError; }) as unknown as typeof fetch,
    })).rejects.toThrow(/timed out/);
    await expect(fetchSafeImageBytes("https://cdn.example.com/a.jpg", {
      fetchImpl: vi.fn(async () => { throw new TypeError("network down"); }) as unknown as typeof fetch,
    })).rejects.toBeInstanceOf(TypeError);
  });

  it("aborts an in-flight fetch when the image fetch timeout fires", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const abortError = new Error("aborted by timeout");
        abortError.name = "AbortError";
        reject(abortError);
      });
    })) as unknown as typeof fetch;

    const pending = fetchSafeImageBytes("https://cdn.example.com/a.jpg", { fetchImpl });
    const assertion = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });

  it("follows public redirects, rejects missing Location and private redirect targets, and caps redirect count", async () => {
    const publicRedirect = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === "https://cdn.example.com/start.jpg") {
        return imageResponse(new Uint8Array(), null, { ok: false, status: 302, location: "/next.png" });
      }
      return imageResponse(validPngBytes(), "image/png");
    }) as unknown as typeof fetch;
    await expect(fetchSafeImageBytes("https://cdn.example.com/start.jpg", { fetchImpl: publicRedirect }))
      .resolves.toMatchObject({ extension: "png" });

    await expect(fetchSafeImageBytes("https://cdn.example.com/start.jpg", {
      fetchImpl: vi.fn(async () => imageResponse(new Uint8Array(), null, { ok: false, status: 302 })) as unknown as typeof fetch,
    })).rejects.toThrow(/Location/);

    const privateRedirect = vi.fn(async () => imageResponse(
      new Uint8Array(),
      null,
      { ok: false, status: 302, location: "http://127.0.0.1/private.jpg" },
    )) as unknown as typeof fetch;
    await expect(fetchSafeImageBytes("https://cdn.example.com/start.jpg", { fetchImpl: privateRedirect }))
      .rejects.toThrow(/blocked/);
    expect(privateRedirect).toHaveBeenCalledTimes(1);

    const loopingRedirect = vi.fn(async () => imageResponse(
      new Uint8Array(),
      null,
      { ok: false, status: 302, location: "/again.jpg" },
    )) as unknown as typeof fetch;
    await expect(fetchSafeImageBytes("https://cdn.example.com/start.jpg", { fetchImpl: loopingRedirect }))
      .rejects.toThrow(/limit/);
  });
});
