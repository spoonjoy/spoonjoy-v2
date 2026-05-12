import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SafeFetchError,
  isBlockedHost,
  fetchRecipeHtml,
  type SafeFetchDeps,
} from "~/lib/recipe-import-fetch.server";

/**
 * Build a Response-like object with a body stream that emits the provided chunks
 * one at a time. The `bytes` parameter is a list of Uint8Array chunks to emit.
 */
function streamingResponse(
  body: Uint8Array[],
  init: { status?: number; contentType?: string | null; url?: string } = {},
): Response {
  const status = init.status ?? 200;
  const contentType =
    init.contentType === undefined ? "text/html; charset=utf-8" : init.contentType;
  const url = init.url ?? "https://example.com/r";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of body) controller.enqueue(chunk);
      controller.close();
    },
  });

  const headers = new Headers();
  if (contentType !== null) headers.set("content-type", contentType);

  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers,
    body: stream,
  } as unknown as Response;
}

function htmlBody(html: string): Uint8Array[] {
  return [new TextEncoder().encode(html)];
}

function mockFetch(response: Response | Error): typeof fetch {
  return vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
}

describe("isBlockedHost", () => {
  it.each([
    ["localhost"],
    ["LOCALHOST"],
    ["127.0.0.1"],
    ["127.255.255.254"],
    ["10.0.0.1"],
    ["10.255.255.255"],
    ["172.16.0.1"],
    ["172.31.255.255"],
    ["192.168.1.1"],
    ["169.254.1.1"],
    ["::1"],
    ["fc00::1"],
    ["fdff::1"],
    ["fe80::1"],
    ["febf::1"],
  ])("returns true for blocked host %s", (host) => {
    expect(isBlockedHost(host)).toBe(true);
  });

  it.each([
    ["172.15.0.1"],
    ["172.32.0.1"],
    ["8.8.8.8"],
    ["2606:4700::1"],
    ["example.com"],
    ["a.b.c.d"], // IPv4-shaped but non-numeric → falls through
    ["999.0.0.0"], // numeric > 255 → falls through
    ["g::1"], // invalid IPv6 chars → falls through
    ["2001:db8::1234"], // public IPv6 with `::`
    ["2606:4700:4700:0:0:0:0:1111"], // public IPv6 with no `::` (full 8 hextets)
    ["1:2:3:4:5:6:7:8:9:10"], // too many hextets
    ["12345::1"], // hextet too long
    ["1:2:3:4:5:6:7"], // no `::` and fewer than 8 hextets
  ])("returns false for public host %s", (host) => {
    expect(isBlockedHost(host)).toBe(false);
  });

  it("returns true for empty hostname", () => {
    expect(isBlockedHost("")).toBe(true);
  });

  it("returns true for bracketed IPv6 [fe80::1]", () => {
    expect(isBlockedHost("[fe80::1]")).toBe(true);
  });
});

describe("fetchRecipeHtml — scheme & URL validation", () => {
  it("rejects non-http(s) scheme file://", async () => {
    await expect(fetchRecipeHtml("file:///etc/passwd")).rejects.toMatchObject({
      code: "bad-scheme",
    });
  });

  it("rejects ftp:// with code=bad-scheme", async () => {
    await expect(fetchRecipeHtml("ftp://example.com")).rejects.toMatchObject({
      code: "bad-scheme",
    });
  });

  it("rejects javascript: with code=bad-scheme", async () => {
    await expect(fetchRecipeHtml("javascript:alert(1)")).rejects.toMatchObject({
      code: "bad-scheme",
    });
  });

  it("rejects malformed URL with code=bad-scheme", async () => {
    await expect(fetchRecipeHtml("not a url")).rejects.toMatchObject({
      code: "bad-scheme",
    });
  });
});

describe("fetchRecipeHtml — blocked-host", () => {
  it("rejects https://127.0.0.1/r with code=blocked-host", async () => {
    await expect(
      fetchRecipeHtml("https://127.0.0.1/r", {
        fetchImpl: mockFetch(streamingResponse(htmlBody("<html/>"))),
      }),
    ).rejects.toMatchObject({ code: "blocked-host" });
  });

  it("rejects https://[::1]/r with code=blocked-host", async () => {
    await expect(
      fetchRecipeHtml("https://[::1]/r", {
        fetchImpl: mockFetch(streamingResponse(htmlBody("<html/>"))),
      }),
    ).rejects.toMatchObject({ code: "blocked-host" });
  });

  it("rejects https://localhost:8080/r with code=blocked-host", async () => {
    await expect(
      fetchRecipeHtml("https://localhost:8080/r", {
        fetchImpl: mockFetch(streamingResponse(htmlBody("<html/>"))),
      }),
    ).rejects.toMatchObject({ code: "blocked-host" });
  });
});

describe("fetchRecipeHtml — happy paths", () => {
  it("accepts https://example.com/r and returns html", async () => {
    const result = await fetchRecipeHtml("https://example.com/r", {
      fetchImpl: mockFetch(streamingResponse(htmlBody("<html>hi</html>"))),
    });
    expect(result.html).toContain("hi");
    expect(result.url).toBe("https://example.com/r");
  });

  it("accepts http://example.com/r", async () => {
    const result = await fetchRecipeHtml("http://example.com/r", {
      fetchImpl: mockFetch(streamingResponse(htmlBody("<html/>"))),
    });
    expect(result.html).toBe("<html/>");
  });

  it("accepts content-type application/xhtml+xml", async () => {
    const result = await fetchRecipeHtml("https://example.com/r", {
      fetchImpl: mockFetch(
        streamingResponse(htmlBody("<html/>"), { contentType: "application/xhtml+xml" }),
      ),
    });
    expect(result.html).toBe("<html/>");
  });

  it("accepts content-type text/html; charset=utf-8", async () => {
    const result = await fetchRecipeHtml("https://example.com/r", {
      fetchImpl: mockFetch(
        streamingResponse(htmlBody("<html/>"), { contentType: "text/html; charset=utf-8" }),
      ),
    });
    expect(result.html).toBe("<html/>");
  });
});

describe("fetchRecipeHtml — error responses", () => {
  it("rejects 404 with code=non-2xx", async () => {
    await expect(
      fetchRecipeHtml("https://example.com/r", {
        fetchImpl: mockFetch(streamingResponse(htmlBody(""), { status: 404 })),
      }),
    ).rejects.toMatchObject({ code: "non-2xx" });
  });

  it("rejects content-type application/pdf with code=not-html", async () => {
    await expect(
      fetchRecipeHtml("https://example.com/r", {
        fetchImpl: mockFetch(
          streamingResponse(htmlBody(""), { contentType: "application/pdf" }),
        ),
      }),
    ).rejects.toMatchObject({ code: "not-html" });
  });

  it("rejects missing content-type with code=not-html", async () => {
    await expect(
      fetchRecipeHtml("https://example.com/r", {
        fetchImpl: mockFetch(streamingResponse(htmlBody(""), { contentType: null })),
      }),
    ).rejects.toMatchObject({ code: "not-html" });
  });

  it("rejects body >5MB with code=too-large", async () => {
    // Emit chunks of 512KB until we exceed 5MB.
    const chunk = new Uint8Array(512 * 1024).fill(65);
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < 12; i++) chunks.push(chunk); // 6MB total
    await expect(
      fetchRecipeHtml("https://example.com/r", {
        fetchImpl: mockFetch(streamingResponse(chunks)),
      }),
    ).rejects.toMatchObject({ code: "too-large" });
  });
});

describe("fetchRecipeHtml — timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts after 15s and throws code=timeout", async () => {
    const fetchImpl = vi.fn(async (_input: unknown, init?: { signal?: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
        // Never resolves on its own
      });
    }) as unknown as typeof fetch;

    const promise = fetchRecipeHtml("https://example.com/r", { fetchImpl });
    // Attach rejection handler before advancing timers to avoid unhandled rejection.
    const assertion = expect(promise).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(16_000);
    await assertion;
  });
});

describe("fetchRecipeHtml — og:image extraction", () => {
  it("parses og:image meta with double quotes", async () => {
    const html =
      '<html><head><meta property="og:image" content="https://cdn.example.com/a.jpg"></head></html>';
    const result = await fetchRecipeHtml("https://example.com/r", {
      fetchImpl: mockFetch(streamingResponse(htmlBody(html))),
    });
    expect(result.ogImageUrl).toBe("https://cdn.example.com/a.jpg");
  });

  it("returns ogImageUrl=null when no og:image", async () => {
    const result = await fetchRecipeHtml("https://example.com/r", {
      fetchImpl: mockFetch(streamingResponse(htmlBody("<html><head></head></html>"))),
    });
    expect(result.ogImageUrl).toBeNull();
  });

  it("resolves relative og:image against finalUrl", async () => {
    const html = '<html><head><meta property="og:image" content="/img/a.jpg"></head></html>';
    const result = await fetchRecipeHtml("https://example.com/r", {
      fetchImpl: mockFetch(
        streamingResponse(htmlBody(html), { url: "https://example.com/recipes/123" }),
      ),
    });
    expect(result.ogImageUrl).toBe("https://example.com/img/a.jpg");
  });

  it("supports single-quote og:image content attribute", async () => {
    const html =
      "<html><head><meta property='og:image' content='https://cdn.example.com/a.jpg'></head></html>";
    const result = await fetchRecipeHtml("https://example.com/r", {
      fetchImpl: mockFetch(streamingResponse(htmlBody(html))),
    });
    expect(result.ogImageUrl).toBe("https://cdn.example.com/a.jpg");
  });

  it("supports name=og:image (in addition to property=og:image)", async () => {
    const html =
      '<html><head><meta name="og:image" content="https://cdn.example.com/b.jpg"></head></html>';
    const result = await fetchRecipeHtml("https://example.com/r", {
      fetchImpl: mockFetch(streamingResponse(htmlBody(html))),
    });
    expect(result.ogImageUrl).toBe("https://cdn.example.com/b.jpg");
  });

  it("returns finalUrl distinct from input when fetch follows a redirect", async () => {
    const result = await fetchRecipeHtml("https://example.com/r", {
      fetchImpl: mockFetch(
        streamingResponse(htmlBody("<html/>"), { url: "https://example.com/final" }),
      ),
    });
    expect(result.url).toBe("https://example.com/r");
    expect(result.finalUrl).toBe("https://example.com/final");
  });
});

describe("fetchRecipeHtml — default fetchImpl", () => {
  it("falls back to global fetch when deps.fetchImpl is undefined", async () => {
    const stub = vi.fn(async () => streamingResponse(htmlBody("<html>ok</html>")));
    const originalFetch = globalThis.fetch;
    (globalThis as { fetch: typeof fetch }).fetch = stub as unknown as typeof fetch;
    try {
      const result = await fetchRecipeHtml("https://example.com/r");
      expect(result.html).toBe("<html>ok</html>");
      expect(stub).toHaveBeenCalled();
    } finally {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    }
  });
});

describe("fetchRecipeHtml — non-og meta tags", () => {
  it("skips meta tags that are not og:image", async () => {
    const html =
      '<html><head>' +
      '<meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width">' +
      '<meta property="og:image" content="https://cdn.example.com/a.jpg">' +
      "</head></html>";
    const result = await fetchRecipeHtml("https://example.com/r", {
      fetchImpl: mockFetch(streamingResponse(htmlBody(html))),
    });
    expect(result.ogImageUrl).toBe("https://cdn.example.com/a.jpg");
  });
});

describe("fetchRecipeHtml — non-abort fetch error", () => {
  it("re-throws non-AbortError from fetch", async () => {
    const err = new TypeError("network down");
    await expect(
      fetchRecipeHtml("https://example.com/r", { fetchImpl: mockFetch(err) }),
    ).rejects.toBe(err);
  });
});

describe("fetchRecipeHtml — malformed og:image", () => {
  it("returns ogImageUrl=null when og:image content is empty string", async () => {
    const html =
      '<html><head><meta property="og:image" content=""></head></html>';
    const result = await fetchRecipeHtml("https://example.com/r", {
      fetchImpl: mockFetch(streamingResponse(htmlBody(html))),
    });
    expect(result.ogImageUrl).toBeNull();
  });

  it("falls back to null when og:image content cannot be parsed against finalUrl", async () => {
    // Spy on URL constructor: relative parse against http: URL is generally valid
    // unless we feed an utterly invalid scheme-relative target like a malformed
    // protocol. The implementation catches URL parse errors. We craft a payload
    // that asserts the catch path executes.
    const html =
      '<html><head><meta property="og:image" content="http://[::g]/"></head></html>';
    const result = await fetchRecipeHtml("https://example.com/r", {
      fetchImpl: mockFetch(streamingResponse(htmlBody(html))),
    });
    expect(result.ogImageUrl).toBeNull();
  });
});

describe("fetchRecipeHtml — finalUrl fallback", () => {
  it("uses input URL when response.url is empty", async () => {
    const headers = new Headers();
    headers.set("content-type", "text/html");
    const response = {
      ok: true,
      status: 200,
      url: "",
      headers,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<html/>"));
          controller.close();
        },
      }),
    } as unknown as Response;
    const result = await fetchRecipeHtml("https://example.com/r", {
      fetchImpl: mockFetch(response),
    });
    expect(result.finalUrl).toBe("https://example.com/r");
  });
});

describe("SafeFetchError", () => {
  it("is an Error with a code field", () => {
    const err = new SafeFetchError("blocked-host", "msg");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("blocked-host");
    expect(err.message).toBe("msg");
  });
});
