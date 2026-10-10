import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useNavigate } from "react-router";
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

  it("uses explicit active covers and exposes provenance labels", async () => {
    const chef = await createUser(
      db,
      faker.internet.email(),
      faker.internet.username() + "_" + faker.string.alphanumeric(8),
      "testPassword123"
    );
    const recipe = await db.recipe.create({
      data: {
        title: "Explicit Cover Beans",
        description: "A simple dinner",
        servings: "4",
        chefId: chef.id,
      },
    });
    const activeCover = await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/active-raw.jpg",
        stylizedImageUrl: "/photos/active-editorial.jpg",
        sourceType: "spoon",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    await db.recipeCover.create({
      data: {
        recipeId: recipe.id,
        imageUrl: "/photos/newer-raw.jpg",
        stylizedImageUrl: "/photos/newer-editorial.jpg",
        sourceType: "chef-upload",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    });
    await db.recipe.update({
      where: { id: recipe.id },
      data: {
        activeCoverId: activeCover.id,
        activeCoverVariant: "stylized",
        coverMode: "manual",
      },
    });

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/recipes"),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.recipes[0]).toMatchObject({
      id: recipe.id,
      coverImageUrl: "/photos/active-editorial.jpg",
      coverProvenanceLabel: "Editorial photo",
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

  it("treats a comma query as a pantry query ranked by matched terms", async () => {
    const chef = await createUser(
      db,
      faker.internet.email(),
      faker.internet.username() + "_" + faker.string.alphanumeric(8),
      "testPassword123"
    );
    await db.recipe.create({ data: { title: "Roasted Tomato Soup", chefId: chef.id } });
    await db.recipe.create({ data: { title: "Lemon Herb Rice", chefId: chef.id } });
    await db.recipe.create({ data: { title: "Tomato Lemon Salad", chefId: chef.id } });
    await db.recipe.create({ data: { title: "Miso Glazed Salmon", chefId: chef.id } });

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/recipes?q=tomato%2C+lemon"),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    const titles = result.recipes.map((recipe: { title: string }) => recipe.title);
    expect(titles[0]).toBe("Tomato Lemon Salad");
    expect(titles.slice(1).sort()).toEqual(["Lemon Herb Rice", "Roasted Tomato Soup"]);
  });

  it("keeps the search box in step with the results across Back and Forward", async () => {
    function RecipesWithHistory() {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => navigate(-1)}>History back</button>
          <button type="button" onClick={() => navigate(1)}>History forward</button>
          <RecipesIndex />
        </>
      );
    }
    const Stub = createTestRoutesStub([
      {
        path: "/recipes",
        Component: RecipesWithHistory,
        loader: ({ request }: { request: Request }) => ({
          query: new URL(request.url).searchParams.get("q") ?? "",
          isAuthenticated: false,
          recipes: [],
        }),
      },
    ]);

    render(<Stub initialEntries={["/recipes?q=lemon"]} />);

    expect(await screen.findByRole("heading", { name: 'Recipes for "lemon"' })).toBeInTheDocument();
    const box = screen.getByLabelText("Search recipes") as HTMLInputElement;
    expect(box.value).toBe("lemon");
    expect(box).toHaveAttribute("autocomplete", "off");

    fireEvent.change(box, { target: { value: "tomato" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("heading", { name: 'Recipes for "tomato"' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "History back" }));
    expect(await screen.findByRole("heading", { name: 'Recipes for "lemon"' })).toBeInTheDocument();
    expect((screen.getByLabelText("Search recipes") as HTMLInputElement).value).toBe("lemon");

    fireEvent.click(screen.getByRole("button", { name: "History forward" }));
    expect(await screen.findByRole("heading", { name: 'Recipes for "tomato"' })).toBeInTheDocument();
    expect((screen.getByLabelText("Search recipes") as HTMLInputElement).value).toBe("tomato");

    fireEvent.click(screen.getByRole("link", { name: "Clear" }));
    expect(await screen.findByRole("heading", { name: "All public recipes" })).toBeInTheDocument();
    expect((screen.getByLabelText("Search recipes") as HTMLInputElement).value).toBe("");
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
    expect(screen.getByText("Every public Spoonjoy recipe, to cook, fork, save or shop from.")).toBeInTheDocument();
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
              coverProvenanceLabel: "Imported photo",
            },
          ],
        }),
      },
    ]);

    const { container } = render(<Stub initialEntries={["/recipes?q=tomato"]} />);

    expect(await screen.findByRole("heading", { name: 'Recipes for "tomato"' })).toBeInTheDocument();
    // Signed-out visitors still see the sign-up invitation in the hero, now in one short line.
    expect(screen.getByRole("heading", { level: 1, name: "Recipes worth opening." })).toBeInTheDocument();
    expect(screen.getByText("Every public Spoonjoy recipe, free to read. Sign up to cook, save and shop from them.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear" })).toHaveAttribute("href", "/recipes");
    expect(screen.queryByRole("link", { name: /create recipe/i })).not.toBeInTheDocument();
    expect(screen.getAllByText("By rowan").length).toBeGreaterThan(0);
    expect(screen.getByText("Imported photo")).toBeInTheDocument();
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

  it("pages through every public recipe 48 at a time after a cursor", async () => {
    const chef = await createUser(db, faker.internet.email(), `pager_${faker.string.alphanumeric(8)}`, "testPassword123");
    const created = [];
    for (let index = 0; index < 50; index += 1) {
      const at = new Date(Date.UTC(2026, 0, 1, 0, index));
      created.push(await db.recipe.create({ data: { title: `Paged recipe ${index}`, chefId: chef.id, createdAt: at, updatedAt: at } }));
    }
    const load = (path: string) =>
      loader({ request: new UndiciRequest(`http://localhost:3000${path}`), context: { cloudflare: { env: null } }, params: {} } as any);

    const first = await load("/recipes");
    expect(first.recipes).toHaveLength(48);
    expect(first.recipes[0]!.title).toBe("Paged recipe 49");
    expect(first.after).toBeNull();
    expect(first.nextCursor).toBe(first.recipes[47]!.id);

    const second = await load(`/recipes?after=${first.nextCursor}`);
    expect(second.recipes.map((recipe) => recipe.title)).toEqual(["Paged recipe 1", "Paged recipe 0"]);
    expect(second.after).toBe(first.nextCursor);
    expect(second.nextCursor).toBeNull();
    // The two pages together hold every recipe once: the 49th and 50th newest are reachable.
    expect(new Set([...first.recipes, ...second.recipes].map((recipe) => recipe.id)).size).toBe(created.length);

    // A malformed cursor is ignored, and a search is one ranked page whatever the cursor.
    expect((await load("/recipes?after=not%20a%20cursor!")).after).toBeNull();
    const searched = await load(`/recipes?q=paged&after=${first.nextCursor}`);
    expect(searched.after).toBeNull();
    expect(searched.nextCursor).toBeNull();
  });

  it("shows more recipes in place, moves focus to the first new one and says how many are shown", async () => {
    const recipe = (id: string, title: string) => ({
      id,
      title,
      description: null,
      servings: null,
      chef: { username: "ari" },
      coverImageUrl: null,
      coverProvenanceLabel: null,
    });
    const Stub = createTestRoutesStub([
      {
        path: "/recipes",
        children: [
          {
            index: true,
            Component: RecipesIndex,
            loader: ({ request }: { request: Request }) => {
              const after = new URL(request.url).searchParams.get("after");
              return after === "r2"
                ? { query: "", isAuthenticated: false, after, recipes: [recipe("r3", "Third Soup")], nextCursor: null }
                : { query: "", isAuthenticated: false, after: null, recipes: [recipe("r1", "First Soup"), recipe("r2", "Second Soup")], nextCursor: "r2" };
            },
          },
        ],
      },
    ]);

    render(<Stub initialEntries={["/recipes"]} />);

    const showMore = await screen.findByRole("link", { name: "Show more recipes" });
    // Without JavaScript it is a plain link to the next page.
    expect(showMore).toHaveAttribute("href", "/recipes?after=r2");
    expect(screen.getByText("2 shown")).toBeInTheDocument();

    fireEvent.click(showMore);

    const third = await screen.findByRole("link", { name: "Third Soup" });
    expect(screen.getByRole("link", { name: "First Soup" })).toBeInTheDocument();
    await waitFor(() => expect(third).toHaveFocus());
    expect(screen.getByTestId("show-more-status")).toHaveTextContent("Showing 3 recipes");
    expect(screen.queryByRole("link", { name: "Show more recipes" })).not.toBeInTheDocument();
    expect(screen.getByText("3 recipes")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("says when a later page has nothing left, with a way back to the newest", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/recipes",
        Component: RecipesIndex,
        loader: () => ({ query: "", isAuthenticated: false, after: "r9", recipes: [], nextCursor: null }),
      },
    ]);

    render(<Stub initialEntries={["/recipes?after=r9"]} />);

    expect(await screen.findByRole("heading", { name: "That's every recipe" })).toBeInTheDocument();
    expect(screen.getByText("Older recipes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the newest" })).toHaveAttribute("href", "/recipes");
  });

  it("returns public recipe metadata", () => {
    expect(meta({} as any)).toEqual([
      { title: "Recipes - Spoonjoy" },
      { name: "description", content: "Browse public Spoonjoy recipes from every kitchen." },
    ]);
  });
});
