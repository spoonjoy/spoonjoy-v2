import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Request as UndiciRequest } from "undici";
import { render, screen } from "@testing-library/react";
import { db } from "~/lib/db.server";
import { createTestRoutesStub } from "../utils";
import { cleanupDatabase } from "../helpers/cleanup";
import Chefs, { loader } from "~/routes/chefs";
import {
  createDrawerRecipe,
  createDrawerUser,
  sessionHeaders,
} from "./kitchen-drawer-test-utils";

describe("Chefs drawer route", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("redirects unauthenticated cooks to login", async () => {
    await expect(
      loader({
        request: new UndiciRequest("http://localhost:3000/chefs"),
        context: { cloudflare: { env: null } },
        params: {},
      } as any),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(302);
      return true;
    });
  });

  it("returns fellow chefs, chefs using my recipes, and private chronological activity without shopping-list events", async () => {
    const viewer = await createDrawerUser("chefs-viewer");
    const outboundChef = await createDrawerUser("chefs-outbound");
    const inboundChef = await createDrawerUser("chefs-inbound");
    const savedChef = await createDrawerUser("chefs-saved");
    const viewerRecipe = await createDrawerRecipe({
      chefId: viewer.id,
      title: "Viewer Tomato Soup",
    });
    const outboundRecipe = await createDrawerRecipe({
      chefId: outboundChef.id,
      title: "Outbound Rice",
    });
    const savedRecipe = await createDrawerRecipe({
      chefId: savedChef.id,
      title: "Saved Chickpeas",
    });
    const cookbook = await db.cookbook.create({
      data: { title: "Activity Shelf", authorId: viewer.id },
    });

    await db.recipeSpoon.create({
      data: {
        chefId: viewer.id,
        recipeId: outboundRecipe.id,
        cookedAt: new Date("2026-05-01T10:00:00Z"),
      },
    });
    await db.recipe.create({
      data: {
        title: "Inbound Fork",
        chefId: inboundChef.id,
        sourceRecipeId: viewerRecipe.id,
        createdAt: new Date("2026-05-03T10:00:00Z"),
      },
    });
    await db.recipeInCookbook.create({
      data: {
        cookbookId: cookbook.id,
        recipeId: savedRecipe.id,
        addedById: viewer.id,
        createdAt: new Date("2026-05-02T10:00:00Z"),
      },
    });
    const shoppingList = await db.shoppingList.create({
      data: { authorId: viewer.id, updatedAt: new Date("2026-05-04T10:00:00Z") },
    });
    const ingredientRef = await db.ingredientRef.create({ data: { name: "not chef activity" } });
    await db.shoppingListItem.create({
      data: {
        shoppingListId: shoppingList.id,
        ingredientRefId: ingredientRef.id,
        updatedAt: new Date("2026-05-04T10:00:00Z"),
      },
    });

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/chefs", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.fellowChefs.rows.map((chef: { chefId: string }) => chef.chefId)).toEqual([
      savedChef.id,
      outboundChef.id,
    ]);
    expect(result.chefsUsingMyRecipes.rows.map((chef: { chefId: string }) => chef.chefId)).toEqual([
      inboundChef.id,
    ]);
    expect(result.activity.map((row: { kind: string; direction: string; otherChef: { id: string } }) => ({
      kind: row.kind,
      direction: row.direction,
      otherChefId: row.otherChef.id,
    }))).toEqual([
      { kind: "forked", direction: "inbound", otherChefId: inboundChef.id },
      { kind: "saved", direction: "outbound", otherChefId: savedChef.id },
      { kind: "spooned", direction: "outbound", otherChefId: outboundChef.id },
    ]);
    expect(result.activity.map((row: { kind: string }) => row.kind)).not.toContain("shopping-list");
  });

  it("returns inbound spoons, outbound forks, and inbound saves in deterministic tie order", async () => {
    const viewer = await createDrawerUser("chefs-tie-viewer");
    const spoonChef = await createDrawerUser("chefs-tie-spoon");
    const forkedChef = await createDrawerUser("chefs-tie-forked");
    const savingChefA = await createDrawerUser("chefs-tie-saving-a");
    const savingChefZ = await createDrawerUser("chefs-tie-saving-z");
    const viewerRecipe = await createDrawerRecipe({
      chefId: viewer.id,
      title: "Viewer Lentil Stew",
    });
    const forkedRecipe = await createDrawerRecipe({
      chefId: forkedChef.id,
      title: "Forked Herb Rice",
    });
    const tiedAt = new Date("2026-07-01T10:00:00Z");

    await db.recipeSpoon.create({
      data: {
        id: "tie-spoon",
        chefId: spoonChef.id,
        recipeId: viewerRecipe.id,
        cookedAt: tiedAt,
      },
    });
    await db.recipe.create({
      data: {
        id: "tie-fork",
        title: "Viewer Fork Of Herb Rice",
        chefId: viewer.id,
        sourceRecipeId: forkedRecipe.id,
        createdAt: tiedAt,
      },
    });
    const cookbookA = await db.cookbook.create({
      data: { id: "tie-cookbook-a", title: "Saving Shelf A", authorId: savingChefA.id },
    });
    const cookbookZ = await db.cookbook.create({
      data: { id: "tie-cookbook-z", title: "Saving Shelf Z", authorId: savingChefZ.id },
    });
    await db.recipeInCookbook.create({
      data: {
        id: "tie-save-a",
        cookbookId: cookbookA.id,
        recipeId: viewerRecipe.id,
        addedById: savingChefA.id,
        createdAt: tiedAt,
      },
    });
    await db.recipeInCookbook.create({
      data: {
        id: "tie-save-z",
        cookbookId: cookbookZ.id,
        recipeId: viewerRecipe.id,
        addedById: savingChefZ.id,
        createdAt: tiedAt,
      },
    });

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/chefs", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.activity.map((row: { id: string; label: string }) => ({ id: row.id, label: row.label }))).toEqual([
      { id: "outbound:fork:tie-fork", label: `You forked Forked Herb Rice from ${forkedChef.username}.` },
      { id: "inbound:save:tie-save-z", label: `${savingChefZ.username} saved your Viewer Lentil Stew.` },
      { id: "inbound:save:tie-save-a", label: `${savingChefA.username} saved your Viewer Lentil Stew.` },
      { id: "inbound:spoon:tie-spoon", label: `${spoonChef.username} cooked your Viewer Lentil Stew.` },
    ]);
  });

  it("returns empty chef sections and excludes self activity", async () => {
    const viewer = await createDrawerUser("chefs-empty");
    const viewerRecipe = await createDrawerRecipe({
      chefId: viewer.id,
      title: "Own Toast",
    });
    const cookbook = await db.cookbook.create({
      data: { title: "Own Shelf", authorId: viewer.id },
    });

    await db.recipeSpoon.create({
      data: {
        chefId: viewer.id,
        recipeId: viewerRecipe.id,
        cookedAt: new Date("2026-06-01T10:00:00Z"),
      },
    });
    await db.recipe.create({
      data: {
        title: "Own Fork",
        chefId: viewer.id,
        sourceRecipeId: viewerRecipe.id,
        createdAt: new Date("2026-06-02T10:00:00Z"),
      },
    });
    await db.recipeInCookbook.create({
      data: {
        cookbookId: cookbook.id,
        recipeId: viewerRecipe.id,
        addedById: viewer.id,
        createdAt: new Date("2026-06-03T10:00:00Z"),
      },
    });

    const result = await loader({
      request: new UndiciRequest("http://localhost:3000/chefs", {
        headers: await sessionHeaders(viewer.id),
      }),
      context: { cloudflare: { env: null } },
      params: {},
    } as any);

    expect(result.fellowChefs).toEqual({ rows: [], total: 0 });
    expect(result.chefsUsingMyRecipes).toEqual({ rows: [], total: 0 });
    expect(result.activity).toEqual([]);
  });

  it("renders chef sections and activity rows", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/chefs",
        Component: Chefs,
        loader: () => ({
          viewer: { id: "viewer", username: "viewer", photoUrl: null },
          fellowChefs: {
            total: 1,
            rows: [{ chefId: "chef-1", username: "chef-rosa", latestInteractionAt: new Date("2026-06-01T00:00:00Z") }],
          },
          chefsUsingMyRecipes: {
            total: 1,
            rows: [{ chefId: "chef-2", username: "chef-mina", latestInteractionAt: new Date("2026-06-02T00:00:00Z") }],
          },
          activity: [
            {
              id: "inbound:spoon:spoon-1",
              kind: "spooned",
              direction: "inbound",
              label: "chef-mina cooked your soup.",
              eventAt: new Date("2026-06-02T00:00:00Z"),
              actor: { id: "chef-2", username: "chef-mina", photoUrl: null },
              otherChef: { id: "chef-2", username: "chef-mina", photoUrl: null },
              recipe: { id: "recipe-1", title: "Soup" },
              cookbook: null,
            },
            {
              id: "outbound:save:save-1",
              kind: "saved",
              direction: "outbound",
              label: "You saved rice from chef-rosa.",
              eventAt: new Date("2026-06-01T00:00:00Z"),
              actor: { id: "viewer", username: "viewer", photoUrl: null },
              otherChef: { id: "chef-1", username: "chef-rosa", photoUrl: null },
              recipe: { id: "recipe-2", title: "Rice" },
              cookbook: { id: "cookbook-1", title: "Shelf" },
            },
          ],
        }),
      },
    ]);

    render(<Stub initialEntries={["/chefs"]} />);

    expect(await screen.findByRole("heading", { name: "Chefs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /chef-rosa/i })).toHaveAttribute("href", "/?chef=chef-rosa");
    expect(screen.getByRole("link", { name: /chef-mina/i })).toHaveAttribute("href", "/?chef=chef-mina");
    expect(screen.getByText("In your kitchen")).toBeInTheDocument();
    expect(screen.getByText("From your kitchen")).toBeInTheDocument();
    expect(screen.getByText("chef-mina cooked your soup.")).toBeInTheDocument();
  });

  it("renders empty chef sections and activity guidance", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/chefs",
        Component: Chefs,
        loader: () => ({
          viewer: { id: "viewer", username: "viewer", photoUrl: null },
          fellowChefs: { total: 0, rows: [] },
          chefsUsingMyRecipes: { total: 0, rows: [] },
          activity: [],
        }),
      },
    ]);

    render(<Stub initialEntries={["/chefs"]} />);

    expect(await screen.findByText("No fellow chefs yet.")).toBeInTheDocument();
    expect(screen.getByText("No one has used your recipes yet.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No chef activity yet" })).toBeInTheDocument();
    expect(screen.getByText(/start building your kitchen graph/i)).toBeInTheDocument();
  });
});
