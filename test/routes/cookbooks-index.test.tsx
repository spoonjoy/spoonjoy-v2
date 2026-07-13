import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { loader } from "~/routes/cookbooks._index";
import CookbooksIndexRedirect from "~/routes/cookbooks._index";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";

describe("Cookbooks drawer route", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("redirects unauthenticated requests to login", async () => {
    const request = new UndiciRequest("http://localhost:3000/cookbooks");

    await expect(
      loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any)
    ).rejects.toSatisfy((error: any) => {
      expect(error).toBeInstanceOf(Response);
      expect(error.status).toBe(302);
      expect(error.headers.get("Location")).toContain("/login");
      return true;
    });
  });

  it("shows owned cookbooks instead of redirecting authenticated cooks to a kitchen tab", async () => {
    const user = await createUser(
      db,
      faker.internet.email(),
      faker.internet.username() + "_" + faker.string.alphanumeric(8),
      "testPassword123"
    );

    const session = await sessionStorage.getSession();
    session.set("userId", user.id);
    const cookieValue = (await sessionStorage.commitSession(session)).split(";")[0];

    const headers = new Headers();
    headers.set("Cookie", cookieValue);

    const ownedCookbook = await db.cookbook.create({
      data: {
        title: "Grandma Weeknight Book",
        authorId: user.id,
        updatedAt: new Date("2026-02-01T00:00:00Z"),
      },
    });
    const otherUser = await createUser(
      db,
      faker.internet.email(),
      faker.internet.username() + "_" + faker.string.alphanumeric(8),
      "testPassword123"
    );
    await db.cookbook.create({
      data: {
        title: "Other Chef Book",
        authorId: otherUser.id,
      },
    });

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/cookbooks?q=grandma", { headers }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.query).toBe("grandma");
    expect(result.cookbooks.map((cookbook: { id: string }) => cookbook.id)).toEqual([ownedCookbook.id]);
    expect(result.cookbooks[0]).toMatchObject({
      title: "Grandma Weeknight Book",
      authorId: user.id,
    });

    const unfilteredResult = await loader({
      request: new UndiciRequest("http://localhost:3000/cookbooks", { headers }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);
    expect(unfilteredResult.cookbooks.map((cookbook: { id: string }) => cookbook.id)).toEqual([ownedCookbook.id]);
  });

  it("matches a cookbook by any non-deleted recipe title while previewing only the newest covers", async () => {
    const user = await createUser(
      db,
      faker.internet.email(),
      faker.internet.username() + "_" + faker.string.alphanumeric(8),
      "testPassword123"
    );
    const session = await sessionStorage.getSession();
    session.set("userId", user.id);
    const cookieValue = (await sessionStorage.commitSession(session)).split(";")[0];
    const cookbook = await db.cookbook.create({
      data: {
        title: "Family Dinners",
        authorId: user.id,
      },
    });

    const matchingOlderRecipe = await db.recipe.create({
      data: {
        title: "Hidden Barley Soup",
        chefId: user.id,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
    const newestCoveredRecipe = await db.recipe.create({
      data: {
        title: "Newest Covered Stew",
        chefId: user.id,
        createdAt: new Date("2026-01-06T00:00:00Z"),
      },
    });
    const activeCover = await db.recipeCover.create({
      data: {
        recipeId: newestCoveredRecipe.id,
        imageUrl: "/photos/newest-covered-stew.jpg",
        sourceType: "chef-upload",
      },
    });
    await db.recipe.update({
      where: { id: newestCoveredRecipe.id },
      data: {
        activeCoverId: activeCover.id,
        activeCoverVariant: "image",
        coverMode: "manual",
      },
    });

    const otherRecipes = await Promise.all(
      [2, 3, 4, 5].map((day) =>
        db.recipe.create({
          data: {
            title: `Preview Slot ${day}`,
            chefId: user.id,
            createdAt: new Date(`2026-01-0${day}T00:00:00Z`),
          },
        }),
      ),
    );

    for (const recipe of [matchingOlderRecipe, ...otherRecipes, newestCoveredRecipe]) {
      await db.recipeInCookbook.create({
        data: {
          cookbookId: cookbook.id,
          recipeId: recipe.id,
          addedById: user.id,
          createdAt: recipe.createdAt,
          updatedAt: recipe.createdAt,
        },
      });
    }

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/cookbooks?q=barley", {
        headers: new Headers({ Cookie: cookieValue }),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.cookbooks.map((item: { id: string }) => item.id)).toEqual([cookbook.id]);
    expect(result.cookbooks[0].recipes).toHaveLength(4);
    expect(result.cookbooks[0].recipes[0].recipe).toMatchObject({
      id: newestCoveredRecipe.id,
      coverImageUrl: "/photos/newest-covered-stew.jpg",
      coverProvenanceLabel: "Chef photo",
    });
  });

  it("renders the owned cookbooks drawer", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/cookbooks",
        Component: CookbooksIndexRedirect,
        loader: () => ({
          query: "",
          cookbooks: [
            {
              id: "cookbook-1",
              title: "Grandma Weeknight Book",
              _count: { recipes: 1 },
              searchableRecipeTitles: [],
              recipes: [
                {
                  recipe: {
                    coverImageUrl: "/photos/grandma-book.jpg",
                    coverProvenanceLabel: "Chef photo",
                  },
                },
              ],
            },
            {
              id: "cookbook-2",
              title: "No Photo Book",
              _count: { recipes: 2 },
              searchableRecipeTitles: [],
              recipes: [],
            },
          ],
        }),
      },
    ]);

    render(<Stub initialEntries={["/cookbooks"]} />);
    expect(await screen.findByRole("heading", { name: /cookbooks/i })).toBeInTheDocument();
    expect(screen.getByText("Grandma Weeknight Book")).toBeInTheDocument();
    expect(screen.getByText("No Photo Book")).toBeInTheDocument();
    expect(screen.getByText("1 recipe")).toBeInTheDocument();
    expect(screen.getByText("2 recipes")).toBeInTheDocument();
    expect(document.querySelector('img[src="/photos/grandma-book.jpg"]')).toBeInTheDocument();
  });

  it("renders cookbook empty states for new and filtered shelves", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/cookbooks-empty",
        Component: CookbooksIndexRedirect,
        loader: () => ({
          query: "",
          cookbooks: [],
        }),
      },
      {
        path: "/cookbooks-filtered",
        Component: CookbooksIndexRedirect,
        loader: () => ({
          query: "barley",
          cookbooks: [],
        }),
      },
    ]);

    const { unmount } = render(<Stub initialEntries={["/cookbooks-empty"]} />);

    expect(await screen.findByRole("heading", { name: "No cookbooks yet" })).toBeInTheDocument();
    expect(screen.getByText("Group recipes into a shelf you can find again.")).toBeInTheDocument();

    unmount();
    render(<Stub initialEntries={["/cookbooks-filtered?q=barley"]} />);

    expect(await screen.findByRole("heading", { name: "No matching cookbooks" })).toBeInTheDocument();
    expect(screen.getByText("Try another cookbook title or recipe title.")).toBeInTheDocument();
  });

  it("returns an empty owned-cookbooks drawer when the signed-in chef has no cookbooks", async () => {
    const user = await createUser(
      db,
      faker.internet.email(),
      faker.internet.username() + "_" + faker.string.alphanumeric(8),
      "testPassword123"
    );
    const session = await sessionStorage.getSession();
    session.set("userId", user.id);
    const cookieValue = (await sessionStorage.commitSession(session)).split(";")[0];

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/cookbooks", {
        headers: new Headers({ Cookie: cookieValue }),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.query).toBe("");
    expect(result.cookbooks).toEqual([]);
  });
});
