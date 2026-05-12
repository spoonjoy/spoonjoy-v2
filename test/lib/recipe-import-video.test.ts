import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  detectImportSource,
  fetchOEmbedMetadata,
  OEmbedError,
} from "~/lib/recipe-import-video.server";

const FIXTURES_DIR = path.resolve(
  process.cwd(),
  "test/fixtures/recipe-import/video",
);

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), "utf-8"));
}

function streamingJsonResponse(
  body: Uint8Array[],
  init: { status?: number; contentType?: string | null } = {},
): Response {
  const status = init.status ?? 200;
  const contentType =
    init.contentType === undefined ? "application/json" : init.contentType;
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
    headers,
    body: stream,
  } as unknown as Response;
}

function jsonBody(value: unknown): Uint8Array[] {
  return [new TextEncoder().encode(JSON.stringify(value))];
}

function rawBody(text: string): Uint8Array[] {
  return [new TextEncoder().encode(text)];
}

function mockFetch(response: Response | Error): typeof fetch {
  return vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
}

function captureFetchUrl(response: Response): {
  fetchImpl: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: unknown) => {
    calls.push(typeof input === "string" ? input : (input as URL).toString());
    return response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("detectImportSource", () => {
  it("classifies https://youtube.com/watch?v=abc as youtube", () => {
    expect(detectImportSource(new URL("https://youtube.com/watch?v=abc"))).toBe(
      "youtube",
    );
  });

  it("classifies https://www.youtube.com/watch?v=abc as youtube", () => {
    expect(
      detectImportSource(new URL("https://www.youtube.com/watch?v=abc")),
    ).toBe("youtube");
  });

  it("classifies https://m.youtube.com/watch?v=abc as youtube", () => {
    expect(
      detectImportSource(new URL("https://m.youtube.com/watch?v=abc")),
    ).toBe("youtube");
  });

  it("classifies https://music.youtube.com/watch?v=abc as youtube", () => {
    expect(
      detectImportSource(new URL("https://music.youtube.com/watch?v=abc")),
    ).toBe("youtube");
  });

  it("classifies https://youtu.be/abc as youtube", () => {
    expect(detectImportSource(new URL("https://youtu.be/abc"))).toBe("youtube");
  });

  it("classifies https://tiktok.com/@user/video/123 as tiktok", () => {
    expect(
      detectImportSource(new URL("https://tiktok.com/@user/video/123")),
    ).toBe("tiktok");
  });

  it("classifies https://www.tiktok.com/@user/video/123 as tiktok", () => {
    expect(
      detectImportSource(new URL("https://www.tiktok.com/@user/video/123")),
    ).toBe("tiktok");
  });

  it("classifies https://m.tiktok.com/@user/video/123 as tiktok", () => {
    expect(
      detectImportSource(new URL("https://m.tiktok.com/@user/video/123")),
    ).toBe("tiktok");
  });

  it("classifies https://vm.tiktok.com/abc as tiktok", () => {
    expect(detectImportSource(new URL("https://vm.tiktok.com/abc"))).toBe(
      "tiktok",
    );
  });

  it("is case-insensitive: WWW.YOUTUBE.COM routes to youtube", () => {
    expect(
      detectImportSource(new URL("https://WWW.YOUTUBE.COM/watch?v=abc")),
    ).toBe("youtube");
  });

  it("is case-insensitive: TIKTOK.COM routes to tiktok", () => {
    expect(detectImportSource(new URL("https://TIKTOK.COM/@u/video/1"))).toBe(
      "tiktok",
    );
  });

  it("rejects suffix-spoof: youtube.com.evil.example routes to web", () => {
    expect(
      detectImportSource(new URL("https://youtube.com.evil.example/path")),
    ).toBe("web");
  });

  it("rejects suffix-spoof: eviltiktok.com routes to web", () => {
    expect(detectImportSource(new URL("https://eviltiktok.com/path"))).toBe(
      "web",
    );
  });

  it("routes example.com to web", () => {
    expect(detectImportSource(new URL("https://example.com/"))).toBe("web");
  });

  it("routes nytimes.com to web", () => {
    expect(
      detectImportSource(new URL("https://nytimes.com/recipes/foo")),
    ).toBe("web");
  });

  it("routes 8.8.8.8 to web", () => {
    expect(detectImportSource(new URL("https://8.8.8.8/"))).toBe("web");
  });

  it("accepts a URL instance (TypeScript signature)", () => {
    // Compile-time check: detectImportSource takes URL, not string.
    const url: URL = new URL("https://example.com/");
    const result: "youtube" | "tiktok" | "web" = detectImportSource(url);
    expect(result).toBe("web");
  });
});

describe("fetchOEmbedMetadata — endpoint construction", () => {
  it("calls https://www.youtube.com/oembed?url=<encoded>&format=json for source=youtube", async () => {
    const youtubeFixture = loadFixture("youtube-pasta.json");
    const { fetchImpl, calls } = captureFetchUrl(
      streamingJsonResponse(jsonBody(youtubeFixture)),
    );
    await fetchOEmbedMetadata(
      "https://www.youtube.com/watch?v=abc123&feature=youtu.be",
      "youtube",
      { fetchImpl },
    );
    expect(calls).toHaveLength(1);
    const endpoint = new URL(calls[0]);
    expect(endpoint.origin + endpoint.pathname).toBe(
      "https://www.youtube.com/oembed",
    );
    expect(endpoint.searchParams.get("url")).toBe(
      "https://www.youtube.com/watch?v=abc123&feature=youtu.be",
    );
    expect(endpoint.searchParams.get("format")).toBe("json");
  });

  it("calls https://www.tiktok.com/oembed?url=<encoded> for source=tiktok", async () => {
    const tiktokFixture = loadFixture("tiktok-dumpling.json");
    const { fetchImpl, calls } = captureFetchUrl(
      streamingJsonResponse(jsonBody(tiktokFixture)),
    );
    await fetchOEmbedMetadata(
      "https://www.tiktok.com/@dumpling_chef/video/123",
      "tiktok",
      { fetchImpl },
    );
    expect(calls).toHaveLength(1);
    const endpoint = new URL(calls[0]);
    expect(endpoint.origin + endpoint.pathname).toBe(
      "https://www.tiktok.com/oembed",
    );
    expect(endpoint.searchParams.get("url")).toBe(
      "https://www.tiktok.com/@dumpling_chef/video/123",
    );
  });

  it("URL-encodes the source URL in the ?url= query param", async () => {
    const youtubeFixture = loadFixture("youtube-pasta.json");
    const { fetchImpl, calls } = captureFetchUrl(
      streamingJsonResponse(jsonBody(youtubeFixture)),
    );
    const messy = "https://www.youtube.com/watch?v=abc&q=spaces%20and%20%2B";
    await fetchOEmbedMetadata(messy, "youtube", { fetchImpl });
    expect(calls[0]).toContain(
      `url=${encodeURIComponent(messy)}`,
    );
  });
});

describe("fetchOEmbedMetadata — happy paths", () => {
  it("youtube-pasta fixture → returns title, authorName, thumbnailUrl, source, sourceUrl", async () => {
    const fixture = loadFixture("youtube-pasta.json");
    const result = await fetchOEmbedMetadata(
      "https://www.youtube.com/watch?v=abc123",
      "youtube",
      { fetchImpl: mockFetch(streamingJsonResponse(jsonBody(fixture))) },
    );
    expect(result).toEqual({
      title: "One-Pot Pasta Recipe",
      authorName: "Joe's Kitchen",
      description: null,
      thumbnailUrl: "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
      source: "youtube",
      sourceUrl: "https://www.youtube.com/watch?v=abc123",
    });
  });

  it("returns description=null when oEmbed omits description (youtube)", async () => {
    const fixture = loadFixture("youtube-pasta.json");
    const result = await fetchOEmbedMetadata(
      "https://www.youtube.com/watch?v=abc",
      "youtube",
      { fetchImpl: mockFetch(streamingJsonResponse(jsonBody(fixture))) },
    );
    expect(result.description).toBeNull();
  });

  it("returns description when present (tiktok variant)", async () => {
    const tiktokFixture = loadFixture("tiktok-dumpling.json") as Record<
      string,
      unknown
    >;
    const withDescription = {
      ...tiktokFixture,
      description: "Quick dumpling tutorial.",
    };
    const result = await fetchOEmbedMetadata(
      "https://www.tiktok.com/@dumpling_chef/video/123",
      "tiktok",
      {
        fetchImpl: mockFetch(streamingJsonResponse(jsonBody(withDescription))),
      },
    );
    expect(result.description).toBe("Quick dumpling tutorial.");
  });

  it("tiktok-minimal fixture → authorName=null, thumbnailUrl=null, description=null", async () => {
    const fixture = loadFixture("tiktok-minimal.json");
    const result = await fetchOEmbedMetadata(
      "https://www.tiktok.com/@x/video/1",
      "tiktok",
      { fetchImpl: mockFetch(streamingJsonResponse(jsonBody(fixture))) },
    );
    expect(result.authorName).toBeNull();
    expect(result.thumbnailUrl).toBeNull();
    expect(result.description).toBeNull();
    expect(result.title).toBe("Easy dumpling fold #cooking #recipe");
  });

  it("youtube-no-thumbnail fixture → thumbnailUrl=null", async () => {
    const fixture = loadFixture("youtube-no-thumbnail.json");
    const result = await fetchOEmbedMetadata(
      "https://www.youtube.com/watch?v=abc",
      "youtube",
      { fetchImpl: mockFetch(streamingJsonResponse(jsonBody(fixture))) },
    );
    expect(result.thumbnailUrl).toBeNull();
  });

  it("accepts content-type application/json; charset=utf-8", async () => {
    const fixture = loadFixture("youtube-pasta.json");
    const result = await fetchOEmbedMetadata(
      "https://www.youtube.com/watch?v=abc",
      "youtube",
      {
        fetchImpl: mockFetch(
          streamingJsonResponse(jsonBody(fixture), {
            contentType: "application/json; charset=utf-8",
          }),
        ),
      },
    );
    expect(result.title).toBe("One-Pot Pasta Recipe");
  });

  it("silently accepts and discards extra oEmbed fields", async () => {
    // youtube-pasta has html, width, height, type, version, provider_name —
    // none of which appear on the returned OEmbedMetadata shape.
    const fixture = loadFixture("youtube-pasta.json");
    const result = await fetchOEmbedMetadata(
      "https://www.youtube.com/watch?v=abc",
      "youtube",
      { fetchImpl: mockFetch(streamingJsonResponse(jsonBody(fixture))) },
    );
    expect(Object.keys(result).sort()).toEqual(
      [
        "authorName",
        "description",
        "source",
        "sourceUrl",
        "thumbnailUrl",
        "title",
      ].sort(),
    );
  });
});

describe("fetchOEmbedMetadata — error paths", () => {
  it("rejects with code=oembed-failed when fetch throws network error", async () => {
    const fetchImpl = mockFetch(new TypeError("network down"));
    await expect(
      fetchOEmbedMetadata("https://www.youtube.com/watch?v=abc", "youtube", {
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: "OEmbedError",
      code: "oembed-failed",
      status: 502,
    });
  });

  it("rejects with code=oembed-failed status=502 when response is 500", async () => {
    const fetchImpl = mockFetch(
      streamingJsonResponse(rawBody("server error"), {
        status: 500,
        contentType: "text/plain",
      }),
    );
    await expect(
      fetchOEmbedMetadata("https://www.youtube.com/watch?v=abc", "youtube", {
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "oembed-failed", status: 502 });
  });

  it("rejects with code=video-unavailable status=502 when response is 404", async () => {
    const fetchImpl = mockFetch(
      streamingJsonResponse(rawBody("not found"), {
        status: 404,
        contentType: "text/plain",
      }),
    );
    await expect(
      fetchOEmbedMetadata("https://www.youtube.com/watch?v=missing", "youtube", {
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      code: "video-unavailable",
      status: 502,
      message: "video metadata unavailable; try a different URL",
    });
  });

  it("rejects with code=video-unavailable status=502 when response is 403", async () => {
    const fetchImpl = mockFetch(
      streamingJsonResponse(rawBody("forbidden"), {
        status: 403,
        contentType: "text/plain",
      }),
    );
    await expect(
      fetchOEmbedMetadata("https://www.tiktok.com/@x/video/1", "tiktok", {
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "video-unavailable", status: 502 });
  });

  it("rejects with code=oembed-failed when content-type is text/html", async () => {
    const fixture = loadFixture("youtube-pasta.json");
    const fetchImpl = mockFetch(
      streamingJsonResponse(jsonBody(fixture), { contentType: "text/html" }),
    );
    await expect(
      fetchOEmbedMetadata("https://www.youtube.com/watch?v=abc", "youtube", {
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "oembed-failed", status: 502 });
  });

  it("rejects with code=oembed-failed when content-type is missing", async () => {
    const fixture = loadFixture("youtube-pasta.json");
    const fetchImpl = mockFetch(
      streamingJsonResponse(jsonBody(fixture), { contentType: null }),
    );
    await expect(
      fetchOEmbedMetadata("https://www.youtube.com/watch?v=abc", "youtube", {
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "oembed-failed", status: 502 });
  });

  it("rejects with code=oembed-failed when body exceeds 1MB cap", async () => {
    // 1.2MB of 'a' wrapped in a JSON string field.
    const big = "a".repeat(1_200_000);
    const oversized = `{"title":"${big}"}`;
    const chunk = new Uint8Array(64 * 1024).fill(65);
    const chunks: Uint8Array[] = [];
    // 20 * 64KB = 1.28MB body of garbage. Title isn't valid JSON shape, but
    // we should fail on the body-cap guard BEFORE the JSON parse.
    for (let i = 0; i < 20; i++) chunks.push(chunk);
    void oversized;
    const fetchImpl = mockFetch(streamingJsonResponse(chunks));
    await expect(
      fetchOEmbedMetadata("https://www.youtube.com/watch?v=abc", "youtube", {
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "oembed-failed", status: 502 });
  });

  it("rejects with code=oembed-failed when JSON is malformed", async () => {
    const fetchImpl = mockFetch(
      streamingJsonResponse(rawBody("not json {"), {
        contentType: "application/json",
      }),
    );
    await expect(
      fetchOEmbedMetadata("https://www.youtube.com/watch?v=abc", "youtube", {
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "oembed-failed", status: 502 });
  });

  it("rejects with code=oembed-failed when Zod parse fails (title missing)", async () => {
    const bad = { author_name: "Joe", thumbnail_url: "https://x/y.jpg" };
    const fetchImpl = mockFetch(streamingJsonResponse(jsonBody(bad)));
    await expect(
      fetchOEmbedMetadata("https://www.youtube.com/watch?v=abc", "youtube", {
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "oembed-failed", status: 502 });
  });

  it("rejects with code=oembed-failed when Zod parse fails (title empty string)", async () => {
    const bad = { title: "" };
    const fetchImpl = mockFetch(streamingJsonResponse(jsonBody(bad)));
    await expect(
      fetchOEmbedMetadata("https://www.youtube.com/watch?v=abc", "youtube", {
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "oembed-failed", status: 502 });
  });

  it("rejects with code=oembed-failed when Zod parse fails (thumbnail_url is not a URL)", async () => {
    const bad = { title: "x", thumbnail_url: "definitely not a url" };
    const fetchImpl = mockFetch(streamingJsonResponse(jsonBody(bad)));
    await expect(
      fetchOEmbedMetadata("https://www.youtube.com/watch?v=abc", "youtube", {
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "oembed-failed", status: 502 });
  });
});

describe("fetchOEmbedMetadata — timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts after 15s and throws code=oembed-failed status=502", async () => {
    const fetchImpl = vi.fn(
      async (_input: unknown, init?: { signal?: AbortSignal }) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        });
      },
    ) as unknown as typeof fetch;

    const promise = fetchOEmbedMetadata(
      "https://www.youtube.com/watch?v=abc",
      "youtube",
      { fetchImpl },
    );
    const assertion = expect(promise).rejects.toMatchObject({
      name: "OEmbedError",
      code: "oembed-failed",
      status: 502,
    });
    await vi.advanceTimersByTimeAsync(16_000);
    await assertion;
  });
});

describe("fetchOEmbedMetadata — edge cases", () => {
  it("rejects with code=oembed-failed when response has no body", async () => {
    // Construct a Response-like with body: null. Body-stream readers can't
    // read this, so we surface it as oembed-failed.
    const noBody = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      body: null,
    } as unknown as Response;
    await expect(
      fetchOEmbedMetadata("https://www.youtube.com/watch?v=abc", "youtube", {
        fetchImpl: mockFetch(noBody),
      }),
    ).rejects.toMatchObject({ code: "oembed-failed", status: 502 });
  });

  it("falls back to global fetch when no fetchImpl is provided", async () => {
    // Tests both the default-arg `deps = {}` and the `?? fetch` fallback.
    const fixture = loadFixture("youtube-pasta.json");
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(streamingJsonResponse(jsonBody(fixture)));
    try {
      const result = await fetchOEmbedMetadata(
        "https://www.youtube.com/watch?v=abc",
        "youtube",
      );
      expect(result.title).toBe("One-Pot Pasta Recipe");
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("OEmbedError", () => {
  it("exposes name=OEmbedError and the supplied code/status/message", () => {
    const err = new OEmbedError("video-unavailable", 502, "private");
    expect(err.name).toBe("OEmbedError");
    expect(err.code).toBe("video-unavailable");
    expect(err.status).toBe(502);
    expect(err.message).toBe("private");
    expect(err).toBeInstanceOf(Error);
  });
});
