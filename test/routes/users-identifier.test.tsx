import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import { faker } from "@faker-js/faker";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { loader, meta } from "~/routes/users.$identifier";
import UserProfile from "~/routes/users.$identifier";

async function createSessionCookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

async function createProfileUser() {
  return createUser(
    db,
    faker.internet.email(),
    `${faker.internet.username()}_${faker.string.alphanumeric(8)}`,
    "testPassword123"
  );
}

describe("Users $identifier Route", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => {
    it("returns profile data by username for an unauthenticated visitor", async () => {
      const user = await createProfileUser();
      await db.user.update({
        where: { id: user.id },
        data: { photoUrl: "https://example.com/profile.jpg" },
      });
      const recipe = await db.recipe.create({
        data: {
          title: `Profile Recipe ${faker.string.alphanumeric(8)}`,
          description: "A profile route fixture",
          servings: "4",
          chefId: user.id,
        },
      });
      const cookbook = await db.cookbook.create({
        data: {
          title: `Profile Book ${faker.string.alphanumeric(8)}`,
          authorId: user.id,
        },
      });
      await db.recipeInCookbook.create({
        data: {
          cookbookId: cookbook.id,
          recipeId: recipe.id,
          addedById: user.id,
        },
      });

      const request = new UndiciRequest(`http://localhost:3000/users/${user.username}`);

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { identifier: user.username },
      } as any);

      expect(result.profile).toMatchObject({
        id: user.id,
        username: user.username,
        photoUrl: "https://example.com/profile.jpg",
      });
      expect(result.profile.joinedLabel).toMatch(/^Joined \w{3} \d{4}$/);
      expect(result.isOwner).toBe(false);
      expect(result.recipes).toHaveLength(1);
      expect(result.recipes[0]).toMatchObject({ title: recipe.title, servings: "4" });
      expect(result.cookbooks).toHaveLength(1);
      expect(result.cookbooks[0]._count.recipes).toBe(1);
      expect(result.cookbooks[0].recipes[0].recipe.title).toBe(recipe.title);
    });

    it("marks the profile as owned when the session user matches", async () => {
      const user = await createProfileUser();
      const headers = new Headers({ Cookie: await createSessionCookie(user.id) });
      const request = new UndiciRequest(`http://localhost:3000/users/${user.username}`, { headers });

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { identifier: user.username },
      } as any);

      expect(result.isOwner).toBe(true);
      expect(result.profile.id).toBe(user.id);
    });

    it("redirects id aliases to the canonical username route", async () => {
      const user = await createProfileUser();
      const request = new UndiciRequest(`http://localhost:3000/users/${user.id}`);

      const result = await loader({
        request,
        context: { cloudflare: { env: null } },
        params: { identifier: user.id },
      } as any);

      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(302);
      expect(result.headers.get("Location")).toBe(`/users/${user.username}`);
    });

    it("throws 404 when the identifier is missing", async () => {
      const request = new UndiciRequest("http://localhost:3000/users/");

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

    it("throws 404 when no username or id matches", async () => {
      const request = new UndiciRequest("http://localhost:3000/users/missing-chef");

      await expect(
        loader({
          request,
          context: { cloudflare: { env: null } },
          params: { identifier: "missing-chef" },
        } as any)
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });
  });

  describe("meta", () => {
    it("uses the loaded profile username", () => {
      expect(meta({ data: { profile: { username: "chef-rowan" } } } as any)).toEqual([
        { title: "chef-rowan - Spoonjoy" },
        { name: "description", content: "Open chef-rowan's Spoonjoy kitchen." },
      ]);
    });

    it("falls back when loader data is unavailable", () => {
      expect(meta({ data: undefined } as any)).toEqual([
        { title: "Chef - Spoonjoy" },
        { name: "description", content: "Open Chef's Spoonjoy kitchen." },
      ]);
    });
  });

  describe("component", () => {
    it("renders a visitor profile with recipes, cookbooks, and canonical links", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier",
          Component: UserProfile,
          loader: () => ({
            profile: {
              id: "user-1",
              username: "chef-rowan",
              photoUrl: "https://example.com/profile.jpg",
              joinedLabel: "Joined May 2026",
            },
            isOwner: false,
            recipes: [
              {
                id: "recipe-1",
                title: "Miso Soup",
                description: "Comfort in a bowl",
                imageUrl: "https://example.com/miso.jpg",
                servings: "4",
              },
              {
                id: "recipe-2",
                title: "Plain Rice",
                description: null,
                imageUrl: "",
                servings: null,
              },
            ],
            cookbooks: [
              {
                id: "cookbook-1",
                title: "Weeknight Pantry",
                _count: { recipes: 1 },
                recipes: [
                  {
                    recipe: {
                      imageUrl: "https://example.com/miso.jpg",
                      title: "Miso Soup",
                    },
                  },
                ],
              },
            ],
          }),
        },
      ]);

      render(<Stub initialEntries={["/users/chef-rowan"]} />);

      expect(await screen.findByRole("heading", { name: "chef-rowan" })).toBeInTheDocument();
      expect(screen.getByText("Joined May 2026 • 2 recipes • 1 cookbook")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open kitchen view" })).toHaveAttribute("href", "/?chef=chef-rowan");
      expect(screen.getByRole("link", { name: "Canonical profile: /users/chef-rowan" })).toHaveAttribute(
        "href",
        "/users/chef-rowan"
      );
      expect(screen.getAllByRole("link", { name: "Miso Soup" })[0]).toHaveAttribute("href", "/recipes/recipe-1");
      expect(screen.getByRole("link", { name: "Plain Rice" })).toHaveAttribute("href", "/recipes/recipe-2");
      expect(screen.getByText("Weeknight Pantry")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Open settings" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Logout" })).not.toBeInTheDocument();
    });

    it("renders owner actions, default avatar fallback, and empty states", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier",
          Component: UserProfile,
          loader: () => ({
            profile: {
              id: "user-1",
              username: "chef-empty",
              photoUrl: null,
              joinedLabel: "Joined May 2026",
            },
            isOwner: true,
            recipes: [],
            cookbooks: [],
          }),
        },
      ]);

      render(<Stub initialEntries={["/users/chef-empty"]} />);

      expect(await screen.findByRole("heading", { name: "chef-empty" })).toBeInTheDocument();
      expect(screen.getByTitle("chef-empty")).toBeInTheDocument();
      expect(screen.getByText("Joined May 2026 • 0 recipes • 0 cookbooks")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open settings" })).toHaveAttribute("href", "/account/settings");
      expect(screen.getByRole("button", { name: "Logout" })).toBeInTheDocument();
      expect(screen.getByText("No recipes yet")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Create Recipe" })).toHaveAttribute("href", "/recipes/new");
      expect(screen.getByText("No cookbooks yet.")).toBeInTheDocument();
    });

    it("renders the singular recipe count when a profile has exactly one recipe", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier",
          Component: UserProfile,
          loader: () => ({
            profile: {
              id: "user-3",
              username: "chef-one",
              photoUrl: null,
              joinedLabel: "Joined May 2026",
            },
            isOwner: false,
            recipes: [
              {
                id: "recipe-3",
                title: "Solo Stew",
                description: null,
                imageUrl: "",
                servings: null,
              },
            ],
            cookbooks: [],
          }),
        },
      ]);

      render(<Stub initialEntries={["/users/chef-one"]} />);

      expect(await screen.findByText("Joined May 2026 • 1 recipe • 0 cookbooks")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Solo Stew" })).toHaveAttribute("href", "/recipes/recipe-3");
    });

    it("renders visitor empty states without owner calls to action", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier",
          Component: UserProfile,
          loader: () => ({
            profile: {
              id: "user-2",
              username: "chef-quiet",
              photoUrl: null,
              joinedLabel: "Joined May 2026",
            },
            isOwner: false,
            recipes: [],
            cookbooks: [],
          }),
        },
      ]);

      render(<Stub initialEntries={["/users/chef-quiet"]} />);

      expect(await screen.findByRole("heading", { name: "chef-quiet" })).toBeInTheDocument();
      expect(screen.getByText("No public recipes yet")).toBeInTheDocument();
      expect(screen.getByText("chef-quiet has not shared any recipes yet.")).toBeInTheDocument();
      expect(screen.getByText("chef-quiet has not shared any cookbooks yet.")).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Create Recipe" })).not.toBeInTheDocument();
    });
  });
});
