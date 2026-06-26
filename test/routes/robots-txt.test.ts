import { describe, expect, it } from "vitest";
import { loader } from "~/routes/robots.txt";

describe("robots.txt route", () => {
  it("serves robots with a Sitemap directive and disallow rules", async () => {
    const response = await loader({
      request: new Request("https://spoonjoy.app/robots.txt"),
    } as any);

    expect(response.headers.get("Content-Type")).toContain("text/plain");
    const body = await response.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Allow: /");
    expect(body).toContain("Sitemap: https://spoonjoy.app/sitemap.xml");
    expect(body).toContain("Disallow: /account/");
    expect(body).toContain("Disallow: /api/");
    expect(body).toContain("Disallow: /shopping-list");
  });
});
