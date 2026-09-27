import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen, waitFor } from "@testing-library/react";
import { faker } from "@faker-js/faker";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { sessionStorage } from "~/lib/session.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { loader } from "~/routes/users.$identifier";
import UserProfile from "~/routes/users.$identifier";

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

describe("Users $identifier route — recent spoons section", () => {
  let chefId: string;
  let viewerId: string;
  let viewerSessionCookie: string;
  let chefUsername: string;
  let recipeId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const chef = await createUser(
      db,
      uniqueEmail("chef"),
      `chef_${faker.string.alphanumeric(8).toLowerCase()}`,
      "testPassword123",
    );
    chefId = chef.id;
    chefUsername = chef.username;
    const viewer = await createUser(
      db,
      uniqueEmail("viewer"),
      `view_${faker.string.alphanumeric(8).toLowerCase()}`,
      "testPassword123",
    );
    viewerId = viewer.id;
    viewerSessionCookie = await makeSession(viewerId);
    const recipe = await db.recipe.create({
      data: {
        title: `Recipe ${faker.string.alphanumeric(6)}`,
        chefId,
      },
    });
    recipeId = recipe.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("loader returns recentSpoons with recipe + coverImageUrl preloaded for the profile owner", async () => {
    await db.recipeSpoon.create({
      data: {
        chefId,
        recipeId,
        photoUrl: "/photos/spoons/x.png",
        cookedAt: new Date("2025-05-01T10:00:00Z"),
      },
    });
    const request = new UndiciRequest(
      `http://localhost/users/${chefUsername}`,
      { headers: { cookie: viewerSessionCookie } },
    ) as unknown as Request;
    const response = await loader({
      request,
      params: { identifier: chefUsername },
      context: { cloudflare: { env: null } } as any,
    });
    const { data } = extractResponseData(response);
    expect(Array.isArray(data.recentSpoons)).toBe(true);
    expect(data.recentSpoons).toHaveLength(1);
    expect(data.recentSpoons[0].recipe.id).toBe(recipeId);
    // The cooks' relative times are measured from this, on the server and in the browser alike.
    expect(data.renderedAt).toBeGreaterThanOrEqual(Date.parse(data.recentSpoons[0].cookedAt));
    expect(data.renderedAt).toBeLessThanOrEqual(Date.now());
    expect(data.recentSpoons[0].coverImageUrl).toBeNull();
  });

  it("loader returns at most 10 recent spoons", async () => {
    for (let i = 0; i < 12; i++) {
      const r = await db.recipe.create({
        data: { title: `r${i}-${faker.string.alphanumeric(4)}`, chefId },
      });
      await db.recipeSpoon.create({
        data: {
          chefId,
          recipeId: r.id,
          photoUrl: `/photos/${i}.png`,
          cookedAt: new Date(2025, 0, i + 1),
        },
      });
    }
    const request = new UndiciRequest(
      `http://localhost/users/${chefUsername}`,
      { headers: { cookie: viewerSessionCookie } },
    ) as unknown as Request;
    const response = await loader({
      request,
      params: { identifier: chefUsername },
      context: { cloudflare: { env: null } } as any,
    });
    const { data } = extractResponseData(response);
    expect(data.recentSpoons).toHaveLength(10);
  });

  it("renders a 'Recent cooks' section with recipe title and link", async () => {
    const mockData = {
      profile: {
        id: "u1",
        username: "chefuser",
        photoUrl: null,
        joinedLabel: "Joined 2025",
      },
      isOwner: false,
      recipes: [],
      cookbooks: [],
      recentSpoons: [
        {
          id: "s1",
          cookedAt: new Date().toISOString(),
          photoUrl: "/photos/a.png",
          note: null,
          nextTime: null,
          chef: { id: "u1", username: "chefuser", photoUrl: null },
          recipe: { id: "r1", title: "Lentil Soup", chefId: "u1" },
          coverImageUrl: "/photos/cover.png",
        },
      ],
    };
    const Stub = createTestRoutesStub([
      {
        path: "/users/:identifier",
        Component: UserProfile,
        loader: () => mockData,
      },
    ]);
    render(<Stub initialEntries={["/users/chefuser"]} />);
    await waitFor(() => {
      expect(screen.getByText(/recent cooks/i)).toBeInTheDocument();
    });
    const recipeLink = screen.getByRole("link", { name: /lentil soup/i });
    expect(recipeLink).toHaveAttribute("href", "/recipes/r1");
  });

  it("measures each recent cook's time from the loader's render time, not the browser's clock", async () => {
    const mockData = {
      profile: { id: "u1", username: "chefuser", photoUrl: null, joinedLabel: "Joined 2025" },
      isOwner: false,
      recipes: [],
      cookbooks: [],
      recentSpoons: [
        {
          id: "s1",
          cookedAt: "2025-05-01T12:00:00.000Z",
          photoUrl: null,
          note: null,
          nextTime: null,
          chef: { id: "u1", username: "chefuser", photoUrl: null },
          recipe: { id: "r1", title: "Lentil Soup", chefId: "u1" },
          coverImageUrl: null,
        },
      ],
      renderedAt: Date.parse("2025-05-01T15:00:30Z"),
    };
    const Stub = createTestRoutesStub([
      { path: "/users/:identifier", Component: UserProfile, loader: () => mockData },
    ]);
    render(<Stub initialEntries={["/users/chefuser"]} />);
    await waitFor(() => {
      expect(screen.getByText(/recent cooks/i)).toBeInTheDocument();
    });
    const times = screen.getAllByText("3 hr ago");
    expect(times.length).toBeGreaterThan(0);
    for (const time of times) {
      expect(time).toHaveAttribute("datetime", "2025-05-01T12:00:00.000Z");
    }
  });
});
