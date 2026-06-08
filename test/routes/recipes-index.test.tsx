import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { loader, meta } from "~/routes/recipes._index";
import RecipesIndex from "~/routes/recipes._index";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";

describe("Recipes Index Route", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("lists public recipes for unauthenticated visitors", async () => {
    const chef = await createUser(
      db,
      faker.internet.email(),
      faker.internet.username() + "_" + faker.string.alphanumeric(8),
      "testPassword123"
    );
    const recipe = await db.recipe.create({
      data: {
        title: "Public Tomato Beans",
        description: "A simple dinner",
        servings: "4",
        chefId: chef.id,
      },
    });
    const request = new UndiciRequest("http://localhost:3000/recipes");

    const result = await loader({
      request,
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.isAuthenticated).toBe(false);
    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0]).toMatchObject({
      id: recipe.id,
      title: "Public Tomato Beans",
      chef: { username: chef.username },
      coverImageUrl: null,
    });
  });

  it("includes create affordance state for authenticated visitors", async () => {
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

    const request = new UndiciRequest("http://localhost:3000/recipes", { headers });

    const result = await loader({
      request,
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.isAuthenticated).toBe(true);
  });

  it("searches public recipes with the shared search index", async () => {
    const chef = await createUser(
      db,
      faker.internet.email(),
      faker.internet.username() + "_" + faker.string.alphanumeric(8),
      "testPassword123"
    );
    await db.recipe.create({
      data: {
        title: "Lemon Ricotta Pancakes",
        description: "Bright breakfast",
        chefId: chef.id,
      },
    });
    await db.recipe.create({
      data: {
        title: "Ricotta Toast",
        description: "Fast lunch",
        chefId: chef.id,
      },
    });
    await db.recipe.create({
      data: {
        title: "Tomato Toast",
        description: "Not the target",
        chefId: chef.id,
      },
    });

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/recipes?q=ricotta"),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.query).toBe("ricotta");
    expect(result.recipes.map((recipe: { title: string }) => recipe.title)).toEqual([
      "Ricotta Toast",
      "Lemon Ricotta Pancakes",
    ]);
  });

  it("renders a cookbook-style public browse page", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/recipes",
        Component: RecipesIndex,
        loader: () => ({
          query: "",
          isAuthenticated: true,
          recipes: [
            {
              id: "r1",
              title: "Public Tomato Beans",
              description: "A simple dinner",
              servings: "4",
              chef: { username: "ari" },
              coverImageUrl: null,
            },
          ],
        }),
      },
    ]);

    render(<Stub initialEntries={["/recipes"]} />);

    expect(await screen.findByRole("heading", { name: "Recipes worth opening." })).toBeInTheDocument();
    // Signed-in visitors must not be told to "sign in".
    expect(screen.queryByText(/before you sign in/i)).not.toBeInTheDocument();
    expect(screen.getByText(/then cook, fork, save, or add ingredients to your list/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Public Tomato Beans" })).toHaveAttribute("href", "/recipes/r1");
    expect(screen.getByRole("link", { name: /create recipe/i })).toHaveAttribute("href", "/recipes/new");
  });

  it("renders guest search results with clear affordance and photo rows", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/recipes",
        Component: RecipesIndex,
        loader: () => ({
          query: "tomato",
          isAuthenticated: false,
          recipes: [
            {
              id: "r2",
              title: "Tomato Toast",
              description: null,
              servings: null,
              chef: { username: "rowan" },
              coverImageUrl: "https://example.com/tomato.jpg",
            },
          ],
        }),
      },
    ]);

    const { container } = render(<Stub initialEntries={["/recipes?q=tomato"]} />);

    expect(await screen.findByRole("heading", { name: 'Recipes for "tomato"' })).toBeInTheDocument();
    // Signed-out visitors still see the sign-in invitation in the hero.
    expect(screen.getByRole("heading", { name: "Recipes worth opening before you sign in." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear" })).toHaveAttribute("href", "/recipes");
    expect(screen.queryByRole("link", { name: /create recipe/i })).not.toBeInTheDocument();
    expect(screen.getAllByText("By rowan").length).toBeGreaterThan(0);
    expect(container.querySelector('img[src="https://example.com/tomato.jpg"]')).toBeInTheDocument();
  });

  it("renders empty public and empty search states", async () => {
    const EmptyPublicStub = createTestRoutesStub([
      {
        path: "/recipes",
        Component: RecipesIndex,
        loader: () => ({
          query: "",
          isAuthenticated: false,
          recipes: [],
        }),
      },
    ]);

    const { unmount } = render(<EmptyPublicStub initialEntries={["/recipes"]} />);

    expect(await screen.findByText("No public recipes yet")).toBeInTheDocument();
    expect(screen.getByText("The public recipe box will fill as kitchens publish their first recipes.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Clear Search" })).not.toBeInTheDocument();
    unmount();

    const EmptySearchStub = createTestRoutesStub([
      {
        path: "/recipes",
        Component: RecipesIndex,
        loader: () => ({
          query: "kumquat",
          isAuthenticated: false,
          recipes: [],
        }),
      },
    ]);

    render(<EmptySearchStub initialEntries={["/recipes?q=kumquat"]} />);

    expect(await screen.findByText("No matching recipes yet")).toBeInTheDocument();
    expect(screen.getByText("Try a broader ingredient, dish name, or chef.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear Search" })).toHaveAttribute("href", "/recipes");
  });

  it("returns public recipe metadata", () => {
    expect(meta({} as any)).toEqual([
      { title: "Recipes - Spoonjoy" },
      { name: "description", content: "Browse public Spoonjoy recipes from every kitchen." },
    ]);
  });
});
