import { faker } from "@faker-js/faker";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { loader } from "~/routes/sitemap.xml";

const context = { cloudflare: { env: null } } as any;

function uniqueEmail(prefix: string) {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

async function fetchSitemap() {
  const response = await loader({
    request: new Request("https://spoonjoy.app/sitemap.xml"),
    context,
  } as any);
  return { response, xml: await response.text() };
}

describe("sitemap.xml route", () => {
  let userId: string;
  let username: string;

  beforeEach(async () => {
    await cleanupDatabase();
    username = `chef_${faker.string.alphanumeric(8).toLowerCase()}`;
    const user = await createUser(
      db,
      uniqueEmail("sitemap"),
      username,
      "testPassword123",
    );
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("lists static pages, complete recipes, non-empty cookbooks, and chefs", async () => {
    const recipe = await db.recipe.create({
      data: { title: "Sitemap Toast", servings: "2", chefId: userId },
    });
    await db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum: 1, description: "Toast it." },
    });
    const cookbook = await db.cookbook.create({
      data: { title: "Sitemap Book", authorId: userId },
    });
    await db.recipeInCookbook.create({
      data: { cookbookId: cookbook.id, recipeId: recipe.id, addedById: userId },
    });

    const { response, xml } = await fetchSitemap();

    expect(response.headers.get("Content-Type")).toContain("application/xml");
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    );
    expect(xml).toContain("<loc>https://spoonjoy.app/</loc>");
    expect(xml).toContain(`<loc>https://spoonjoy.app/recipes/${recipe.id}</loc>`);
    expect(xml).toContain(
      `<loc>https://spoonjoy.app/cookbooks/${cookbook.id}</loc>`,
    );
    expect(xml).toContain(`<loc>https://spoonjoy.app/users/${username}</loc>`);
  });

  it("uses the configured base URL for <loc> entries behind an edge proxy", async () => {
    // request.url is the internal worker host; SPOONJOY_BASE_URL must win so
    // the sitemap never leaks the *.workers.dev origin to crawlers.
    const recipe = await db.recipe.create({
      data: { title: "Proxy Toast", servings: "2", chefId: userId },
    });
    await db.recipeStep.create({
      data: { recipeId: recipe.id, stepNum: 1, description: "Toast it." },
    });

    const response = await loader({
      request: new Request("https://internal.example.com/sitemap.xml"),
      context: { cloudflare: { env: { SPOONJOY_BASE_URL: "https://spoonjoy.app" } } },
    } as any);
    const xml = await response.text();

    expect(xml).toContain("<loc>https://spoonjoy.app/</loc>");
    expect(xml).toContain(`<loc>https://spoonjoy.app/recipes/${recipe.id}</loc>`);
    expect(xml).not.toContain("internal.example.com");
  });

  it("omits thin recipes (no steps) and empty cookbooks", async () => {
    const thin = await db.recipe.create({
      data: { title: "Thin Recipe", chefId: userId },
    });
    const emptyCookbook = await db.cookbook.create({
      data: { title: "Empty Book", authorId: userId },
    });

    const { xml } = await fetchSitemap();

    expect(xml).not.toContain(`/recipes/${thin.id}`);
    expect(xml).not.toContain(`/cookbooks/${emptyCookbook.id}`);
    // A chef with only thin recipes is not indexable either.
    expect(xml).not.toContain(`/users/${username}`);
  });
});
