import { describe, expect, it } from "vitest";
import { buildSitemapXml } from "./sitemap.server";

describe("buildSitemapXml", () => {
  it("renders a urlset with loc and optional lastmod", () => {
    const xml = buildSitemapXml([
      { loc: "https://spoonjoy.app/" },
      {
        loc: "https://spoonjoy.app/recipes/abc",
        lastmod: "2026-01-02T00:00:00.000Z",
      },
    ]);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).toContain("<loc>https://spoonjoy.app/</loc>");
    expect(xml).toContain("<loc>https://spoonjoy.app/recipes/abc</loc>");
    expect(xml).toContain("<lastmod>2026-01-02T00:00:00.000Z</lastmod>");
  });

  it("escapes special characters in URLs", () => {
    const xml = buildSitemapXml([
      { loc: "https://spoonjoy.app/users/a&b" },
    ]);
    expect(xml).toContain("https://spoonjoy.app/users/a&amp;b");
    expect(xml).not.toContain("a&b</loc>");
  });
});
