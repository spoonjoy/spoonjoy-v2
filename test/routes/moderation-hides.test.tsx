// What a chef blocked or reported disappears from every web page they load (App Store guideline 1.2).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import { getLocalDb } from "~/lib/db.server";
import { OBJECTIONABLE_CONTENT_MESSAGE } from "~/lib/objectionable-terms";
import { createUserSessionCookie } from "~/lib/session.server";
import { RecipeNotFound } from "~/components/recipe/RecipeNotFound";
import { loader as kitchenLoader } from "~/routes/_index";
import { loader as settingsLoader } from "~/routes/account.settings";
import { action as cookbookAction, loader as cookbookLoader } from "~/routes/cookbooks.$id";
import { action as newCookbookAction } from "~/routes/cookbooks.new";
import { loader as recipeLoader } from "~/routes/recipes.$id";
import { loader as recipesLoader } from "~/routes/recipes._index";
import { loader as savedLoader } from "~/routes/saved-recipes";
import UserProfile, { loader as profileLoader } from "~/routes/users.$identifier";
import { loader as fellowChefsLoader } from "~/routes/users.$identifier.fellow-chefs";
import { loader as visitorsLoader } from "~/routes/users.$identifier.kitchen-visitors";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe, createTestRoutesStub, createTestUser } from "../utils";

type Db = Awaited<ReturnType<typeof getLocalDb>>;

async function settle<T>(run: () => Promise<T>): Promise<T | Response> {
  try {
    return await run();
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

describe("hidden content on web pages", () => {
  let db: Db;
  let cookie: string;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  function get(loader: (args: never) => unknown, path: string, params: Record<string, string> = {}) {
    const request = new UndiciRequest(`http://localhost:3000${path}`, { headers: { Cookie: cookie } });
    return settle(async () => (await loader({ request, context: { cloudflare: { env: null } }, params } as never)) as any);
  }

  function post(action: (args: never) => unknown, path: string, fields: Record<string, string>, params: Record<string, string> = {}) {
    const request = new UndiciRequest(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
    return settle(async () => (await action({ request, context: { cloudflare: { env: null } }, params } as never)) as any);
  }

  async function kitchen() {
    const viewer = await db.user.create({ data: createTestUser() });
    cookie = (await createUserSessionCookie(viewer.id)).split(";")[0]!;
    const blocked = await db.user.create({ data: createTestUser() });
    const reported = await db.user.create({ data: createTestUser() });
    const blockedRecipe = await db.recipe.create({ data: { ...createTestRecipe(blocked.id), title: "Blocked Stew" } });
    const badRecipe = await db.recipe.create({ data: { ...createTestRecipe(reported.id), title: "Reported Pie" } });
    const goodRecipe = await db.recipe.create({ data: { ...createTestRecipe(reported.id), title: "Fine Bread" } });
    const viewerRecipe = await db.recipe.create({ data: { ...createTestRecipe(viewer.id), title: "Viewer Soup" } });
    const blockedBook = await db.cookbook.create({ data: { title: "Blocked Book", authorId: blocked.id } });
    const badBook = await db.cookbook.create({ data: { title: "Reported Book", authorId: reported.id } });
    await db.cookbook.create({ data: { title: "Fine Book", authorId: reported.id } });
    const viewerBook = await db.cookbook.create({ data: { title: "My Saves", authorId: viewer.id } });
    for (const recipe of [blockedRecipe, goodRecipe, badRecipe]) {
      await db.recipeInCookbook.create({ data: { cookbookId: viewerBook.id, recipeId: recipe.id, addedById: viewer.id } });
    }
    const now = new Date();
    await db.recipeSpoon.create({ data: { recipeId: viewerRecipe.id, chefId: blocked.id, cookedAt: now, photoUrl: "https://example.com/b.jpg" } });
    const badSpoon = await db.recipeSpoon.create({ data: { recipeId: goodRecipe.id, chefId: reported.id, cookedAt: now, note: "Bad note" } });
    await db.recipeSpoon.create({ data: { recipeId: goodRecipe.id, chefId: reported.id, cookedAt: now, note: "Fine note" } });

    await db.chefBlock.create({ data: { blockerId: viewer.id, blockedId: blocked.id } });
    for (const [targetType, targetId] of [["recipe", badRecipe.id], ["cookbook", badBook.id], ["spoon", badSpoon.id]]) {
      await db.contentReport.create({ data: { reporterId: viewer.id, targetType: targetType!, targetId: targetId!, targetChefId: reported.id, reason: "offensive" } });
    }
    return { viewer, blocked, reported, blockedRecipe, badRecipe, goodRecipe, viewerRecipe, blockedBook, viewerBook };
  }

  const titles = (rows: Array<{ title: string }>) => rows.map((row) => row.title);

  it("hides a blocked chef's profile, kitchen and graph pages, and reported content on the rest", async () => {
    const { blocked, reported, viewer } = await kitchen();

    for (const [loader, path] of [
      [profileLoader, `/users/${blocked.username}`],
      [fellowChefsLoader, `/users/${blocked.username}/fellow-chefs`],
      [visitorsLoader, `/users/${blocked.username}/kitchen-visitors`],
      [kitchenLoader, `/?chef=${blocked.username}`],
    ] as const) {
      const result = (await get(loader, path, { identifier: blocked.username })) as Response;
      expect(result.status, path).toBe(404);
    }

    const profile = await get(profileLoader, `/users/${reported.username}`, { identifier: reported.username });
    expect(titles(profile.recipes)).toEqual(["Fine Bread"]);
    expect(titles(profile.cookbooks)).toEqual(["Fine Book"]);
    expect(profile.recentSpoons.map((spoon: any) => spoon.note)).toEqual(["Fine note"]);
    expect(profile.isAuthenticated).toBe(true);

    const reportedKitchen = await get(kitchenLoader, `/?chef=${reported.username}`);
    expect(titles(reportedKitchen.recipes)).toEqual(["Fine Bread"]);
    expect(titles(reportedKitchen.cookbooks)).toEqual(["Fine Book"]);

    const recipes = await get(recipesLoader, "/recipes");
    expect(titles(recipes.recipes)).not.toContain("Blocked Stew");
    expect(titles(recipes.recipes)).not.toContain("Reported Pie");

    const saved = await get(savedLoader, "/saved-recipes");
    expect(titles(saved.recipes)).toEqual(["Fine Bread"]);

    const settings = await get(settingsLoader, "/account/settings");
    expect(settings.blockedChefs).toEqual([{ id: blocked.id, username: blocked.username }]);
    expect(viewer.id).not.toBe(blocked.id);
  });

  it("hides reported cookbooks and recipes, and the recipes and cooks of blocked chefs inside them", async () => {
    const { blockedBook, viewerBook, blockedRecipe, badRecipe, goodRecipe, viewerRecipe } = await kitchen();

    expect(((await get(cookbookLoader, `/cookbooks/${blockedBook.id}`, { id: blockedBook.id })) as Response).status).toBe(404);
    const mine = await get(cookbookLoader, `/cookbooks/${viewerBook.id}`, { id: viewerBook.id });
    expect(mine.cookbook.recipes.map((item: any) => item.recipe.title)).toEqual(["Fine Bread"]);

    for (const recipe of [blockedRecipe, badRecipe]) {
      const hidden = (await get(recipeLoader, `/recipes/${recipe.id}`, { id: recipe.id })) as Response;
      expect(hidden.status).toBe(404);
      expect(await hidden.json()).toMatchObject({ hidden: true, deleted: false });
    }
    const fine = await get(recipeLoader, `/recipes/${goodRecipe.id}`, { id: goodRecipe.id });
    expect(fine.spoons.map((spoon: any) => spoon.note)).toEqual(["Fine note"]);
    const own = await get(recipeLoader, `/recipes/${viewerRecipe.id}`, { id: viewerRecipe.id });
    expect(own.spoons).toEqual([]);
    expect(own.spoonImages).toEqual([]);
  });

  it("refuses objectionable cookbook titles", async () => {
    const { viewerBook } = await kitchen();
    const created = await post(newCookbookAction, "/cookbooks/new", { title: "porn" });
    expect(created.data?.errors?.title ?? created.errors?.title).toBe(OBJECTIONABLE_CONTENT_MESSAGE);

    const renamed = await post(cookbookAction, `/cookbooks/${viewerBook.id}`, { intent: "updateTitle", title: "porn" }, { id: viewerBook.id });
    expect(renamed.data).toEqual({ error: OBJECTIONABLE_CONTENT_MESSAGE, intent: "updateTitle" });
    expect(renamed.init.status).toBe(400);
  });

  it("offers signed-in visitors a Report control on a chef's profile", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/users/:identifier",
        Component: UserProfile,
        loader: () => ({
          profile: { id: "u1", username: "loud_chef", photoUrl: null, joinedAt: "2026-05-15T12:00:00.000Z" },
          isOwner: false,
          isAuthenticated: true,
          recipes: [],
          cookbooks: [],
          recentSpoons: [],
          recipeCount: 0,
          fellowChefsCount: 0,
          kitchenVisitorsCount: 0,
          canonicalUrl: "https://spoonjoy.app/users/loud_chef",
          ogImageUrl: "https://spoonjoy.app/og.png",
        }),
      },
    ]);
    render(<Stub initialEntries={["/users/loud_chef"]} />);
    expect(await screen.findByTestId("profile-report-action")).toHaveTextContent("Report");
  });

  it("explains a recipe the chef hid", async () => {
    const Stub = createTestRoutesStub([{ path: "/", Component: () => <RecipeNotFound deleted={false} hidden /> }]);
    render(<Stub initialEntries={["/"]} />);
    expect(await screen.findByRole("heading", { name: "You've hidden this recipe." })).toBeInTheDocument();
  });
});
