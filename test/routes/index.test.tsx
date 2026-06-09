import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { absoluteKitchenUrl, loader, meta } from "~/routes/_index";
import Index from "~/routes/_index";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { faker } from "@faker-js/faker";
import { shareContent } from "~/components/navigation";

vi.mock("~/components/navigation", () => ({
  shareContent: vi.fn(async () => ({ success: true, method: "native" })),
}));

describe("Kitchen Index Route", () => {
  beforeEach(async () => {
    vi.mocked(shareContent).mockClear();
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => {
    it("returns guest payload when no session and no requested kitchen", async () => {
      const request = new UndiciRequest("http://localhost:3000/");

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.tab).toBe("recipes");
      expect(result.kitchenUser).toBeNull();
      expect(result.viewer).toBeNull();
      expect(result.isOwner).toBe(false);
      expect(result.recipes).toEqual([]);
      expect(result.cookbooks).toEqual([]);
    });

    it("falls back to recipes tab for unknown tab query", async () => {
      const email = faker.internet.email();
      const username = faker.internet.username() + "_" + faker.string.alphanumeric(8);
      const user = await createUser(db, email, username, "testPassword123");

      const session = await sessionStorage.getSession();
      session.set("userId", user.id);
      const cookieValue = (await sessionStorage.commitSession(session)).split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/?tab=invalid", { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.tab).toBe("recipes");
      expect(result.isOwner).toBe(true);
      expect(result.kitchenUser?.id).toBe(user.id);
    });

    it("returns owner kitchen with recipes and cookbooks", async () => {
      const owner = await createUser(
        db,
        faker.internet.email(),
        faker.internet.username() + "_" + faker.string.alphanumeric(8),
        "testPassword123"
      );
      await db.user.update({
        where: { id: owner.id },
        data: { photoUrl: "https://example.com/owner.jpg" },
      });

      const recipe = await db.recipe.create({
        data: {
          title: "Alpine Tart",
          description: "Buttery crust",
          servings: "6",
          chefId: owner.id,
        },
      });

      const cookbook = await db.cookbook.create({
        data: {
          title: "Mountain Suppers",
          authorId: owner.id,
        },
      });

      await db.recipeInCookbook.create({
        data: {
          cookbookId: cookbook.id,
          recipeId: recipe.id,
          addedById: owner.id,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", owner.id);
      const cookieValue = (await sessionStorage.commitSession(session)).split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/?tab=cookbooks", { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.tab).toBe("cookbooks");
      expect(result.isOwner).toBe(true);
      expect(result.kitchenUser?.username).toBe(owner.username);
      expect(result.viewer?.id).toBe(owner.id);
      expect(result.recipes).toHaveLength(1);
      expect(result.recipes[0].coverImageUrl).toBeNull();
      expect(result.cookbooks).toHaveLength(1);
      expect(result.cookbooks[0]._count.recipes).toBe(1);
      expect(result.cookbooks[0].recipes[0].recipe.coverImageUrl).toBeNull();
    });

    it("uses explicit active cover display data for kitchen recipes and cookbook previews", async () => {
      const owner = await createUser(
        db,
        faker.internet.email(),
        faker.internet.username() + "_" + faker.string.alphanumeric(8),
        "testPassword123"
      );
      const recipe = await db.recipe.create({
        data: {
          title: "Kitchen Active Cover",
          description: "Active cover fixture",
          servings: "2",
          chefId: owner.id,
        },
      });
      const activeCover = await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/kitchen-raw.jpg",
          stylizedImageUrl: "/photos/kitchen-editorial.jpg",
          sourceType: "spoon",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
      await db.recipeCover.create({
        data: {
          recipeId: recipe.id,
          imageUrl: "/photos/kitchen-newer.jpg",
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
      const cookbook = await db.cookbook.create({
        data: {
          title: "Active Cover Book",
          authorId: owner.id,
        },
      });
      await db.recipeInCookbook.create({
        data: {
          cookbookId: cookbook.id,
          recipeId: recipe.id,
          addedById: owner.id,
        },
      });
      const headers = new Headers({ Cookie: await (async () => {
        const session = await sessionStorage.getSession();
        session.set("userId", owner.id);
        return (await sessionStorage.commitSession(session)).split(";")[0];
      })() });

      const result = await loader({
        request: new UndiciRequest("http://localhost:3000/", { headers }),
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.recipes[0]).toMatchObject({
        id: recipe.id,
        coverImageUrl: "/photos/kitchen-editorial.jpg",
        coverProvenanceLabel: "Editorialized chef photo",
      });
      expect(result.cookbooks[0].recipes[0].recipe).toMatchObject({
        title: recipe.title,
        coverImageUrl: "/photos/kitchen-editorial.jpg",
        coverProvenanceLabel: "Editorialized chef photo",
      });
    });

    it("returns visitor kitchen by username in read-only framing", async () => {
      const viewer = await createUser(
        db,
        faker.internet.email(),
        faker.internet.username() + "_" + faker.string.alphanumeric(8),
        "testPassword123"
      );
      const chef = await createUser(
        db,
        faker.internet.email(),
        faker.internet.username() + "_" + faker.string.alphanumeric(8),
        "testPassword123"
      );

      await db.recipe.create({
        data: {
          title: "Guest View Dish",
          chefId: chef.id,
        },
      });

      const session = await sessionStorage.getSession();
      session.set("userId", viewer.id);
      const cookieValue = (await sessionStorage.commitSession(session)).split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest(`http://localhost:3000/?chef=${chef.username}`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.isOwner).toBe(false);
      expect(result.viewer?.id).toBe(viewer.id);
      expect(result.kitchenUser?.id).toBe(chef.id);
      expect(result.recipes).toHaveLength(1);
    });

    it("supports unauthenticated visitor kitchen by chefId", async () => {
      const chef = await createUser(
        db,
        faker.internet.email(),
        faker.internet.username() + "_" + faker.string.alphanumeric(8),
        "testPassword123"
      );

      const request = new UndiciRequest(`http://localhost:3000/?chefId=${chef.id}`);

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result.viewer).toBeNull();
      expect(result.kitchenUser?.id).toBe(chef.id);
      expect(result.isOwner).toBe(false);
    });

    it("throws 404 when explicit chef target is not found", async () => {
      const request = new UndiciRequest("http://localhost:3000/?chef=missing-chef");

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: {},
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("returns empty kitchen payload when session user no longer exists", async () => {
      const session = await sessionStorage.getSession();
      session.set("userId", "missing-user-id");
      const cookieValue = (await sessionStorage.commitSession(session)).split(";")[0];

      const headers = new Headers();
      headers.set("Cookie", cookieValue);

      const request = new UndiciRequest("http://localhost:3000/?tab=cookbooks", { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(result).toEqual({
        tab: "cookbooks",
        isOwner: false,
        viewer: null,
        kitchenUser: null,
        recipes: [],
        cookbooks: [],
      });
    });
  });

  describe("meta", () => {
    it("returns kitchen metadata", () => {
      const result = meta({} as any);

      expect(result).toEqual([
        { title: "Spoonjoy - Recipe Kitchens & Cookbooks" },
        { name: "description", content: "Collect family recipes, shape them into cookbooks, and share a personal kitchen." },
      ]);
    });
  });

  describe("absoluteKitchenUrl", () => {
    it("returns the relative path when no browser origin exists", () => {
      const originalWindow = window;
      vi.stubGlobal("window", undefined);

      try {
        expect(absoluteKitchenUrl("/recipes/recipe-1")).toBe("/recipes/recipe-1");
      } finally {
        vi.stubGlobal("window", originalWindow);
      }
    });
  });

  describe("component", () => {
    it("renders guest landing page with product framing and auth actions", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/",
          Component: Index,
          loader: () => ({
            tab: "recipes",
            isOwner: false,
            viewer: null,
            kitchenUser: null,
            recipes: [],
            cookbooks: [
              {
                id: "cookbook-owner",
                title: "Cheese Night",
                _count: { recipes: 1 },
                recipes: [],
              },
            ],
          }),
        },
      ]);

      render(<Stub initialEntries={["/"]} />);

      expect(await screen.findByRole("heading", { name: /your food should look as good as it tastes/i })).toBeInTheDocument();
      expect(screen.getByText("Family recipe OS")).toBeInTheDocument();
      expect(screen.getByText(/photo-first kitchen/i)).toBeInTheDocument();
      expect(screen.getByText("Collect")).toBeInTheDocument();
      expect(screen.getByText("Cook")).toBeInTheDocument();
      expect(screen.getByText("Share")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Start Your Kitchen" })).toHaveAttribute("href", "/signup");
      expect(screen.getByRole("link", { name: "Log In" })).toHaveAttribute("href", "/login");
      expect(screen.getByRole("link", { name: "Search Recipes" })).toHaveAttribute("href", "/search");
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    });

    it("renders owner kitchen as a cookbook spread with settings and admin controls", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/",
          Component: Index,
          loader: () => ({
            tab: "recipes",
            isOwner: true,
            viewer: { id: "viewer-1", username: "chef", email: "chef@example.com", photoUrl: null },
            kitchenUser: { id: "viewer-1", username: "chef", photoUrl: null },
            recipes: [
              {
                id: "recipe-1",
                title: "Fondue",
                description: "Cheese and wine",
                servings: "4",
                coverImageUrl: "https://example.com/fondue.jpg",
                coverProvenanceLabel: "Chef photo",
              },
              {
                id: "recipe-2",
                title: "Rosti",
                description: "Crisp potatoes",
                servings: "2",
                coverImageUrl: "https://example.com/rosti.jpg",
              },
              {
                id: "recipe-3",
                title: "Broth",
                description: null,
                servings: null,
                coverImageUrl: null,
              },
            ],
            cookbooks: [
              {
                id: "cookbook-owner",
                title: "Cheese Night",
                _count: { recipes: 1 },
                recipes: [],
              },
            ],
          }),
        },
      ]);

      const { container } = render(<Stub initialEntries={["/"]} />);

      expect(await screen.findByText("My Kitchen")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Create Recipe" })).toHaveAttribute("href", "/recipes/new");
      expect(screen.getByRole("link", { name: "Kitchen settings" })).toHaveAttribute("href", "/account/settings");
      expect(screen.queryByRole("button", { name: "Logout" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "New Recipe" })).not.toBeInTheDocument();
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Latest from the kitchen" })).toBeInTheDocument();
      expect(screen.getByRole("complementary", { name: "Recipe index" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Cookbook shelf" })).toBeInTheDocument();
      expect(screen.getByText("3 recipes and 1 cookbook")).toBeInTheDocument();
      expect(screen.getAllByText("Cheese Night").length).toBeGreaterThan(0);
      expect(screen.getByText("Chef photo")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open Recipe" })).toHaveAttribute("href", "/recipes/recipe-1");
      expect(screen.getByText("Fondue")).toBeInTheDocument();
      expect(screen.getAllByRole("link", { name: "Fondue" }).some((link) => link.classList.contains("min-h-11"))).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Share" }));
      await waitFor(() => {
        expect(vi.mocked(shareContent)).toHaveBeenCalledWith(expect.objectContaining({
          title: "Fondue",
          url: expect.stringContaining("/recipes/recipe-1"),
        }));
      });
      expect(screen.getByRole("link", { name: /Rosti/ })).toHaveAttribute("href", "/recipes/recipe-2");
      expect(container.querySelector('img[src="https://example.com/rosti.jpg"]')).not.toBeNull();
      expect(screen.getByRole("button", { name: "Share Rosti" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Share Rosti" }));
      await waitFor(() => {
        expect(vi.mocked(shareContent)).toHaveBeenCalledWith(expect.objectContaining({
          title: "Rosti",
          url: expect.stringContaining("/recipes/recipe-2"),
        }));
      });
      expect(screen.getByText("Crisp potatoes")).toBeInTheDocument();
      expect(screen.getByText("Serves 2")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /Broth/ })).toHaveAttribute("href", "/recipes/recipe-3");
      fireEvent.click(screen.getByRole("button", { name: "Share Broth" }));
      await waitFor(() => {
        expect(vi.mocked(shareContent)).toHaveBeenCalledWith(expect.objectContaining({
          text: "Open this Spoonjoy recipe: Broth",
          title: "Broth",
          url: expect.stringContaining("/recipes/recipe-3"),
        }));
      });

      const styles = container.querySelectorAll("[style]");
      expect(styles.length).toBe(0);
    });

    it("renders owner empty states and recipe image fallback branches", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/",
          Component: Index,
          loader: () => ({
            tab: "recipes",
            isOwner: true,
            viewer: { id: "viewer-1", username: "chef", email: "chef@example.com", photoUrl: null },
            kitchenUser: { id: "viewer-1", username: "chef", photoUrl: null },
            recipes: [],
            cookbooks: [],
          }),
        },
      ]);

      render(<Stub initialEntries={["/"]} />);

      expect(await screen.findByText("0 recipes and 0 cookbooks")).toBeInTheDocument();
      expect(screen.getByText("Start your recipe box")).toBeInTheDocument();
      expect(screen.getByText(/the family classic everyone asks about/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Create First Recipe" })).toHaveAttribute("href", "/recipes/new");
      expect(screen.getByText("Build your first cookbook")).toBeInTheDocument();
      expect(screen.getByText(/a family collection that grows/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Create First Cookbook", hidden: true })).toHaveAttribute("href", "/cookbooks/new");
    });

    it("renders recipe images when recipes have displayable image URLs", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/",
          Component: Index,
          loader: () => ({
            tab: "recipes",
            isOwner: false,
            viewer: null,
            kitchenUser: { id: "chef-1", username: "chef", photoUrl: "https://example.com/avatar.jpg" },
            recipes: [
              {
                id: "recipe-with-image",
                title: "Image Dish",
                description: null,
                servings: null,
                coverImageUrl: "https://example.com/dish.jpg",
              },
            ],
            cookbooks: [],
          }),
        },
      ]);

      render(<Stub initialEntries={["/?chef=chef"]} />);

      const image = await screen.findByRole("img", { name: "Image Dish" });
      expect(image).toHaveAttribute("src", "https://example.com/dish.jpg");
      expect(screen.queryByText(/Serves/)).not.toBeInTheDocument();
    });

    it("renders visitor kitchen with read-only controls hidden", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/",
          Component: Index,
          loader: () => ({
            tab: "recipes",
            isOwner: false,
            viewer: { id: "viewer-1", username: "viewer", email: "viewer@example.com", photoUrl: null },
            kitchenUser: { id: "chef-2", username: "alpinechef", photoUrl: null },
            recipes: [],
            cookbooks: [],
          }),
        },
      ]);

      render(<Stub initialEntries={["/?chef=alpinechef"]} />);

      expect(await screen.findByText("alpinechef's Kitchen")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Search Recipes" })).toHaveAttribute("href", "/search");
      expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Logout" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "New Recipe" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Create First Recipe" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Create First Cookbook", hidden: true })).not.toBeInTheDocument();
      expect(screen.getAllByText("No public recipes yet.").length).toBeGreaterThan(0);
      expect(screen.getByText("No public cookbooks yet.")).toBeInTheDocument();
    });

    it("renders recipes and cookbooks together instead of hiding content behind tabs", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/",
          Component: Index,
          loader: () => ({
            tab: "cookbooks",
            isOwner: true,
            viewer: { id: "viewer-1", username: "chef", email: "chef@example.com", photoUrl: null },
            kitchenUser: { id: "viewer-1", username: "chef", photoUrl: null },
            recipes: [{ id: "recipe-1", title: "Visible Recipe", description: null, servings: null, coverImageUrl: null }],
            cookbooks: [
              {
                id: "cookbook-1",
                title: "Swiss Weeknight",
                _count: { recipes: 1 },
                recipes: [
                  {
                    recipe: {
                      coverImageUrl: "https://example.com/cookbook-recipe.jpg",
                      title: "Rosti",
                    },
                  },
                ],
              },
              {
                id: "cookbook-2",
                title: "No Photo Book",
                _count: { recipes: 2 },
                recipes: [
                  {
                    recipe: {
                      coverImageUrl: null,
                      title: "Plain Soup",
                    },
                  },
                ],
              },
            ],
          }),
        },
      ]);

      render(<Stub initialEntries={["/?tab=cookbooks"]} />);

      expect(await screen.findByText("Visible Recipe")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "New Cookbook" })).toHaveAttribute("href", "/cookbooks/new");
      expect(screen.getAllByText("Swiss Weeknight").length).toBeGreaterThan(0);
      expect(screen.getAllByText("No Photo Book").length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("button", { name: "Share Swiss Weeknight" }));
      await waitFor(() => {
        expect(vi.mocked(shareContent)).toHaveBeenCalledWith(expect.objectContaining({
          title: "Swiss Weeknight",
          url: expect.stringContaining("/cookbooks/cookbook-1"),
        }));
      });
      fireEvent.click(screen.getByRole("button", { name: "Share No Photo Book" }));
      await waitFor(() => {
        expect(vi.mocked(shareContent)).toHaveBeenCalledWith(expect.objectContaining({
          text: "Open this Spoonjoy cookbook with 2 recipes.",
          title: "No Photo Book",
          url: expect.stringContaining("/cookbooks/cookbook-2"),
        }));
      });
      expect(screen.getAllByText("2 recipes").length).toBeGreaterThan(0);
      expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    });

    it("does not render tab navigation for visitor kitchens", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/",
          Component: Index,
          loader: () => ({
            tab: "recipes",
            isOwner: false,
            viewer: { id: "viewer-1", username: "viewer", email: "viewer@example.com", photoUrl: null },
            kitchenUser: { id: "chef-2", username: "alpinechef", photoUrl: null },
            recipes: [],
            cookbooks: [],
          }),
        },
      ]);

      render(<Stub initialEntries={["/?chef=alpinechef&tab=recipes"]} />);

      expect(await screen.findByText("alpinechef's Kitchen")).toBeInTheDocument();
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Cookbook shelf" })).toBeInTheDocument();
    });
  });
});
