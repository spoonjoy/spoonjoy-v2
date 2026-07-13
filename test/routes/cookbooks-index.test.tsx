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
              _count: { recipes: 0 },
              recipes: [],
            },
          ],
        }),
      },
    ]);

    render(<Stub initialEntries={["/cookbooks"]} />);
    expect(await screen.findByRole("heading", { name: /cookbooks/i })).toBeInTheDocument();
    expect(screen.getByText("Grandma Weeknight Book")).toBeInTheDocument();
  });
});
