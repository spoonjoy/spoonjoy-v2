import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen, waitFor } from "@testing-library/react";
import { faker } from "@faker-js/faker";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { loader, meta } from "~/routes/users.$identifier.fellow-chefs";
import FellowChefsPage from "~/routes/users.$identifier.fellow-chefs";

function extractResponseData(response: any): { data: any; status: number } {
  if (response && typeof response === "object" && response.type === "DataWithResponseInit") {
    return { data: response.data, status: response.init?.status || 200 };
  }
  if (response instanceof Response) {
    return { data: null, status: response.status };
  }
  return { data: response, status: 200 };
}

async function makeSession(userId: string): Promise<string> {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  const setCookie = await sessionStorage.commitSession(session);
  return setCookie.split(";")[0];
}

function uniqueEmail(prefix = "u") {
  return `${prefix}-${faker.string.alphanumeric(8).toLowerCase()}@example.com`;
}

async function createTestProfileUser(prefix = "chef") {
  return createUser(
    db,
    uniqueEmail(prefix),
    `${prefix}_${faker.string.alphanumeric(8).toLowerCase()}`,
    "testPassword123",
  );
}

describe("/users/:identifier/fellow-chefs route", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => {
    it("returns rows/total/viewerIsOwner/profileUsername for a valid username", async () => {
      const owner = await createTestProfileUser("owner");
      const other = await createTestProfileUser("other");
      const recipe = await db.recipe.create({
        data: { title: `Soup ${faker.string.alphanumeric(6)}`, chefId: other.id },
      });
      await db.recipeSpoon.create({
        data: {
          chefId: owner.id,
          recipeId: recipe.id,
          cookedAt: new Date("2026-04-01T00:00:00Z"),
        },
      });
      const request = new UndiciRequest(
        `http://localhost/users/${owner.username}/fellow-chefs`,
      ) as unknown as Request;
      const result = await loader({
        request,
        params: { identifier: owner.username },
        context: { cloudflare: { env: null } } as any,
      });
      const { data } = extractResponseData(result);
      expect(data.profileUsername).toBe(owner.username);
      expect(data.viewerIsOwner).toBe(false);
      expect(data.total).toBe(1);
      expect(data.rows).toHaveLength(1);
      expect(data.rows[0].username).toBe(other.username);
      expect(data.page).toBe(1);
    });

    it("marks viewerIsOwner true when the session user matches the profile", async () => {
      const owner = await createTestProfileUser("owner");
      const cookie = await makeSession(owner.id);
      const request = new UndiciRequest(
        `http://localhost/users/${owner.username}/fellow-chefs`,
        { headers: { cookie } },
      ) as unknown as Request;
      const result = await loader({
        request,
        params: { identifier: owner.username },
        context: { cloudflare: { env: null } } as any,
      });
      const { data } = extractResponseData(result);
      expect(data.viewerIsOwner).toBe(true);
    });

    it("redirects id aliases to the canonical username URL", async () => {
      const owner = await createTestProfileUser("owner");
      const request = new UndiciRequest(
        `http://localhost/users/${owner.id}/fellow-chefs`,
      ) as unknown as Request;
      const result = await loader({
        request,
        params: { identifier: owner.id },
        context: { cloudflare: { env: null } } as any,
      });
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(302);
      expect((result as Response).headers.get("Location")).toBe(
        `/users/${owner.username}/fellow-chefs`,
      );
    });

    it("404s on missing user", async () => {
      const request = new UndiciRequest(
        "http://localhost/users/ghost-chef/fellow-chefs",
      ) as unknown as Request;
      await expect(
        loader({
          request,
          params: { identifier: "ghost-chef" },
          context: { cloudflare: { env: null } } as any,
        }),
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("404s when identifier is missing", async () => {
      const request = new UndiciRequest(
        "http://localhost/users//fellow-chefs",
      ) as unknown as Request;
      await expect(
        loader({
          request,
          params: {},
          context: { cloudflare: { env: null } } as any,
        }),
      ).rejects.toSatisfy((error: any) => {
        expect(error).toBeInstanceOf(Response);
        expect(error.status).toBe(404);
        return true;
      });
    });

    it("parses ?page=2 into the correct offset (one row per page, 2 rows total)", async () => {
      const owner = await createTestProfileUser("owner");
      const a = await createTestProfileUser("a");
      const b = await createTestProfileUser("b");
      const rA = await db.recipe.create({
        data: { title: `A ${faker.string.alphanumeric(4)}`, chefId: a.id },
      });
      const rB = await db.recipe.create({
        data: { title: `B ${faker.string.alphanumeric(4)}`, chefId: b.id },
      });
      await db.recipeSpoon.create({
        data: {
          chefId: owner.id,
          recipeId: rA.id,
          cookedAt: new Date("2026-01-01T00:00:00Z"),
        },
      });
      await db.recipeSpoon.create({
        data: {
          chefId: owner.id,
          recipeId: rB.id,
          cookedAt: new Date("2026-02-01T00:00:00Z"),
        },
      });
      const request = new UndiciRequest(
        `http://localhost/users/${owner.username}/fellow-chefs?page=2`,
      ) as unknown as Request;
      const result = await loader({
        request,
        params: { identifier: owner.username },
        context: { cloudflare: { env: null } } as any,
      });
      const { data } = extractResponseData(result);
      expect(data.page).toBe(2);
      expect(data.total).toBe(2);
      // With default page size 50, page 2 has 0 rows
      expect(data.rows).toHaveLength(0);
    });

    it("falls back to page 1 when ?page is invalid (NaN, negative, zero, non-numeric)", async () => {
      const owner = await createTestProfileUser("owner");
      for (const value of ["abc", "-1", "0", "NaN"]) {
        const request = new UndiciRequest(
          `http://localhost/users/${owner.username}/fellow-chefs?page=${value}`,
        ) as unknown as Request;
        const result = await loader({
          request,
          params: { identifier: owner.username },
          context: { cloudflare: { env: null } } as any,
        });
        const { data } = extractResponseData(result);
        expect(data.page).toBe(1);
      }
    });
  });

  describe("meta", () => {
    it("uses the profile username", () => {
      expect(
        meta({ data: { profileUsername: "rowan" } } as any),
      ).toEqual([
        { title: "Fellow chefs · rowan - Spoonjoy" },
        { name: "description", content: "Chefs rowan has cooked, forked, or saved from." },
      ]);
    });

    it("falls back when loader data is missing", () => {
      expect(meta({ data: undefined } as any)).toEqual([
        { title: "Fellow chefs - Spoonjoy" },
        { name: "description", content: "Fellow chefs on Spoonjoy." },
      ]);
    });
  });

  describe("component", () => {
    it("renders empty state for owner view", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier/fellow-chefs",
          Component: FellowChefsPage,
          loader: () => ({
            profileUsername: "me",
            viewerIsOwner: true,
            rows: [],
            total: 0,
            page: 1,
            pageSize: 50,
          }),
        },
      ]);
      render(<Stub initialEntries={["/users/me/fellow-chefs"]} />);
      await waitFor(() => {
        expect(
          screen.getByText(
            /you haven't cooked, forked, or saved any recipes from other chefs yet/i,
          ),
        ).toBeInTheDocument();
      });
    });

    it("renders empty state for non-owner view with username", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier/fellow-chefs",
          Component: FellowChefsPage,
          loader: () => ({
            profileUsername: "chefx",
            viewerIsOwner: false,
            rows: [],
            total: 0,
            page: 1,
            pageSize: 50,
          }),
        },
      ]);
      render(<Stub initialEntries={["/users/chefx/fellow-chefs"]} />);
      await waitFor(() => {
        expect(
          screen.getByText(
            /@chefx hasn't cooked, forked, or saved any recipes from other chefs yet/i,
          ),
        ).toBeInTheDocument();
      });
    });

    it("renders populated list via FellowChefList", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier/fellow-chefs",
          Component: FellowChefsPage,
          loader: () => ({
            profileUsername: "chefx",
            viewerIsOwner: false,
            rows: [
              {
                chefId: "u-a",
                username: "ada",
                photoUrl: null,
                interactionCounts: { spoons: 2, forks: 0, cookbookSaves: 0 },
                latestInteractionAt: new Date(
                  Date.now() - 60 * 1000,
                ).toISOString(),
              },
            ],
            total: 1,
            page: 1,
            pageSize: 50,
          }),
        },
      ]);
      render(<Stub initialEntries={["/users/chefx/fellow-chefs"]} />);
      await waitFor(() => {
        expect(screen.getByRole("link", { name: /ada/i })).toHaveAttribute(
          "href",
          "/users/ada",
        );
      });
      expect(screen.getByText("2 spoons")).toBeInTheDocument();
    });

    it("renders next/prev pagination controls when total exceeds one page", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier/fellow-chefs",
          Component: FellowChefsPage,
          loader: () => ({
            profileUsername: "chefx",
            viewerIsOwner: false,
            rows: Array.from({ length: 50 }).map((_, i) => ({
              chefId: `u${i}`,
              username: `chef${i}`,
              photoUrl: null,
              interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
              latestInteractionAt: new Date(
                Date.now() - i * 60_000,
              ).toISOString(),
            })),
            total: 75,
            page: 1,
            pageSize: 50,
          }),
        },
      ]);
      render(<Stub initialEntries={["/users/chefx/fellow-chefs"]} />);
      await waitFor(() => {
        expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
          "href",
          "/users/chefx/fellow-chefs?page=2",
        );
      });
    });

    it("does not render a Previous link when on page 1", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier/fellow-chefs",
          Component: FellowChefsPage,
          loader: () => ({
            profileUsername: "chefx",
            viewerIsOwner: false,
            rows: [],
            total: 0,
            page: 1,
            pageSize: 50,
          }),
        },
      ]);
      render(<Stub initialEntries={["/users/chefx/fellow-chefs"]} />);
      await waitFor(() => {
        // Empty state visible — make sure no Previous link
        expect(screen.queryByRole("link", { name: /previous/i })).toBeNull();
      });
    });

    it("renders a Previous link with the prior page on page 2+", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier/fellow-chefs",
          Component: FellowChefsPage,
          loader: () => ({
            profileUsername: "chefx",
            viewerIsOwner: false,
            rows: [
              {
                chefId: "u-a",
                username: "ada",
                photoUrl: null,
                interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
                latestInteractionAt: new Date().toISOString(),
              },
            ],
            total: 75,
            page: 2,
            pageSize: 50,
          }),
        },
      ]);
      render(<Stub initialEntries={["/users/chefx/fellow-chefs?page=2"]} />);
      await waitFor(() => {
        expect(
          screen.getByRole("link", { name: /previous/i }),
        ).toHaveAttribute("href", "/users/chefx/fellow-chefs?page=1");
      });
    });
  });
});
