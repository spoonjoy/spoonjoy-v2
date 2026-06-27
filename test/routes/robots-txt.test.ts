import { describe, expect, it } from "vitest";
import { loader } from "~/routes/robots.txt";

describe("robots.txt route", () => {
  it("serves robots with a Sitemap directive and disallow rules", async () => {
    const response = await loader({
      request: new Request("https://spoonjoy.app/robots.txt"),
      context: { cloudflare: { env: null } },
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

  it("uses the configured base URL for the Sitemap directive behind an edge proxy", async () => {
    // The public domain fronts the worker, so inside the worker request.url is
    // the internal host. SPOONJOY_BASE_URL must win for the Sitemap URL.
    const response = await loader({
      request: new Request("https://internal.example.com/robots.txt"),
      context: { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } } },
    } as any);

    const body = await response.text();
    expect(body).toContain("Sitemap: https://spoonjoy.app/sitemap.xml");
    expect(body).not.toContain("internal.example.com");
  });
});
