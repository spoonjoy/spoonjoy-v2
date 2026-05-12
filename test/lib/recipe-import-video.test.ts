import { describe, expect, it } from "vitest";
import { detectImportSource } from "~/lib/recipe-import-video.server";

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
