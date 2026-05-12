import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen, waitFor } from "@testing-library/react";
import { faker } from "@faker-js/faker";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { loader, meta } from "~/routes/users.$identifier.kitchen-visitors";
import KitchenVisitorsPage from "~/routes/users.$identifier.kitchen-visitors";

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

describe("/users/:identifier/kitchen-visitors route", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });
  afterEach(async () => {
    await cleanupDatabase();
  });

  describe("loader", () => {
    it("returns rows/total/viewerIsOwner/profileUsername for a valid username", async () => {
      const owner = await createTestProfileUser("owner");
      const visitor = await createTestProfileUser("visitor");
      const recipe = await db.recipe.create({
        data: { title: `R ${faker.string.alphanumeric(6)}`, chefId: owner.id },
      });
      await db.recipeSpoon.create({
        data: {
          chefId: visitor.id,
          recipeId: recipe.id,
          cookedAt: new Date("2026-04-01T00:00:00Z"),
        },
      });
      const request = new UndiciRequest(
        `http://localhost/users/${owner.username}/kitchen-visitors`,
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
      expect(data.rows[0].username).toBe(visitor.username);
    });

    it("marks viewerIsOwner true when the session user matches the profile", async () => {
      const owner = await createTestProfileUser("owner");
      const cookie = await makeSession(owner.id);
      const request = new UndiciRequest(
        `http://localhost/users/${owner.username}/kitchen-visitors`,
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
        `http://localhost/users/${owner.id}/kitchen-visitors`,
      ) as unknown as Request;
      const result = await loader({
        request,
        params: { identifier: owner.id },
        context: { cloudflare: { env: null } } as any,
      });
      expect(result).toBeInstanceOf(Response);
      expect((result as Response).status).toBe(302);
      expect((result as Response).headers.get("Location")).toBe(
        `/users/${owner.username}/kitchen-visitors`,
      );
    });

    it("404s on missing user", async () => {
      const request = new UndiciRequest(
        "http://localhost/users/ghost-chef/kitchen-visitors",
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
        "http://localhost/users//kitchen-visitors",
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

    it("parses ?page=2 correctly", async () => {
      const owner = await createTestProfileUser("owner");
      const request = new UndiciRequest(
        `http://localhost/users/${owner.username}/kitchen-visitors?page=2`,
      ) as unknown as Request;
      const result = await loader({
        request,
        params: { identifier: owner.username },
        context: { cloudflare: { env: null } } as any,
      });
      const { data } = extractResponseData(result);
      expect(data.page).toBe(2);
    });

    it("falls back to page 1 on invalid ?page", async () => {
      const owner = await createTestProfileUser("owner");
      for (const value of ["abc", "-1", "0", "NaN"]) {
        const request = new UndiciRequest(
          `http://localhost/users/${owner.username}/kitchen-visitors?page=${value}`,
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
      expect(meta({ data: { profileUsername: "rowan" } } as any)).toEqual([
        { title: "Kitchen visitors · rowan - Spoonjoy" },
        {
          name: "description",
          content: "Chefs who have cooked, forked, or saved rowan's recipes.",
        },
      ]);
    });

    it("falls back when loader data is missing", () => {
      expect(meta({ data: undefined } as any)).toEqual([
        { title: "Kitchen visitors - Spoonjoy" },
        { name: "description", content: "Kitchen visitors on Spoonjoy." },
      ]);
    });
  });

  describe("component", () => {
    it("renders empty state for owner view", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier/kitchen-visitors",
          Component: KitchenVisitorsPage,
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
      render(<Stub initialEntries={["/users/me/kitchen-visitors"]} />);
      await waitFor(() => {
        expect(
          screen.getByText(/no one has cooked, forked, or saved your recipes yet/i),
        ).toBeInTheDocument();
      });
    });

    it("renders empty state for non-owner view", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier/kitchen-visitors",
          Component: KitchenVisitorsPage,
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
      render(<Stub initialEntries={["/users/chefx/kitchen-visitors"]} />);
      await waitFor(() => {
        expect(
          screen.getByText(
            /no one has cooked, forked, or saved @chefx's recipes yet/i,
          ),
        ).toBeInTheDocument();
      });
    });

    it("renders populated list", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier/kitchen-visitors",
          Component: KitchenVisitorsPage,
          loader: () => ({
            profileUsername: "chefx",
            viewerIsOwner: false,
            rows: [
              {
                chefId: "u-a",
                username: "alpha",
                photoUrl: null,
                interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
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
      render(<Stub initialEntries={["/users/chefx/kitchen-visitors"]} />);
      await waitFor(() => {
        expect(screen.getByRole("link", { name: /alpha/i })).toHaveAttribute(
          "href",
          "/users/alpha",
        );
      });
    });

    it("renders Next link when total exceeds one page", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier/kitchen-visitors",
          Component: KitchenVisitorsPage,
          loader: () => ({
            profileUsername: "chefx",
            viewerIsOwner: false,
            rows: [],
            total: 75,
            page: 1,
            pageSize: 50,
          }),
        },
      ]);
      render(<Stub initialEntries={["/users/chefx/kitchen-visitors"]} />);
      await waitFor(() => {
        expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
          "href",
          "/users/chefx/kitchen-visitors?page=2",
        );
      });
    });

    it("renders Previous link on page 2+", async () => {
      const Stub = createTestRoutesStub([
        {
          path: "/users/:identifier/kitchen-visitors",
          Component: KitchenVisitorsPage,
          loader: () => ({
            profileUsername: "chefx",
            viewerIsOwner: false,
            rows: [],
            total: 75,
            page: 2,
            pageSize: 50,
          }),
        },
      ]);
      render(<Stub initialEntries={["/users/chefx/kitchen-visitors?page=2"]} />);
      await waitFor(() => {
        expect(
          screen.getByRole("link", { name: /previous/i }),
        ).toHaveAttribute("href", "/users/chefx/kitchen-visitors?page=1");
      });
    });
  });
});
