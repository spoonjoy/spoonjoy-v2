import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanup, render, screen, within } from "@testing-library/react";
import { db } from "~/lib/db.server";
import { OBJECTIONABLE_CONTENT_MESSAGE, OBJECTIONABLE_TERMS } from "~/lib/objectionable-terms";
import NewSmartCookbook, { action as newAction, loader as newLoader, meta as newMeta } from "~/routes/cookbooks.smart.new";
import SmartCookbookPage, { loader as pageLoader, meta as pageMeta } from "~/routes/cookbooks.smart.$id";
import CookbooksIndex, { loader as cookbooksLoader } from "~/routes/cookbooks._index";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRoutesStub } from "../utils";
import { createDrawerRecipe, createDrawerUser, sessionHeaders } from "./kitchen-drawer-test-utils";

const ON = { cloudflare: { env: { SPOONJOY_FLAGS: "smart-cookbooks" } } };
const OFF = { cloudflare: { env: {} } };

async function signedIn(path: string, userId: string, init: RequestInit = {}) {
  return new UndiciRequest(`http://localhost:3000${path}`, { ...init, headers: await sessionHeaders(userId) }) as unknown as Request;
}

async function settle(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

function redirectedTo(result: unknown): string | null {
  return result instanceof Response && result.status >= 300 && result.status < 400 ? result.headers.get("Location") : null;
}

async function create(userId: string, fields: [string, string][], context: object = ON) {
  const request = await signedIn("/cookbooks/smart/new", userId, { method: "POST", body: new URLSearchParams(fields) });
  return settle(newAction({ request, context, params: {} } as never));
}

async function page(userId: string, id: string, query = "", context: object = ON) {
  return settle(pageLoader({ request: await signedIn(`/cookbooks/smart/${id}${query}`, userId), context, params: { id } } as never));
}

/** A cook with three recipes: a quick soup made in a Dutch oven, a quick salad, and a slow stew. */
async function kitchen() {
  const cook = await createDrawerUser("smart-cookbooks");
  const soup = await createDrawerRecipe({ chefId: cook.id, title: "Quick soup", updatedAt: new Date("2026-01-03") });
  const salad = await createDrawerRecipe({ chefId: cook.id, title: "Quick salad", updatedAt: new Date("2026-01-02") });
  const stew = await createDrawerRecipe({ chefId: cook.id, title: "Slow stew", updatedAt: new Date("2026-01-01") });
  const organizer = (kind: string, name: string) =>
    db.organizer.create({ data: { ownerId: cook.id, kind, name, slug: name.toLowerCase().replace(/\s+/g, "-") } });
  const quick = await organizer("tag", "Quick");
  const dinner = await organizer("category", "Dinner");
  const pot = await organizer("tool", "Dutch oven");
  await db.recipeOrganizer.createMany({
    data: [
      { recipeId: soup.id, organizerId: quick.id },
      { recipeId: salad.id, organizerId: quick.id },
      { recipeId: soup.id, organizerId: dinner.id },
      { recipeId: stew.id, organizerId: dinner.id },
      { recipeId: soup.id, organizerId: pot.id },
    ],
  });
  return { cook, soup, salad, stew, quick, dinner, pot };
}

describe("smart cookbooks", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    cleanup();
    await cleanupDatabase();
  });

  it("are not found while the smart-cookbooks flag is off, and leave the Cookbooks page as it was", async () => {
    const { cook } = await kitchen();
    const newRequest = await signedIn("/cookbooks/smart/new", cook.id);
    expect(await settle(newLoader({ request: newRequest, context: OFF, params: {} } as never))).toMatchObject({ status: 404 });
    expect(await create(cook.id, [["title", "Quick"]], OFF)).toMatchObject({ status: 404 });
    expect(await page(cook.id, "anything", "", OFF)).toMatchObject({ status: 404 });
    const cookbooks = await cookbooksLoader({ request: await signedIn("/cookbooks", cook.id), context: OFF, params: {} } as never);
    expect(cookbooks.smartCookbooks).toBeNull();
  });

  it("offer every tag, category and tool the cook has, by kind, each submitting its id", async () => {
    const { cook, quick, dinner, pot } = await kitchen();
    const loaded = await newLoader({ request: await signedIn("/cookbooks/smart/new", cook.id), context: ON, params: {} } as never);
    expect(loaded).toEqual({
      choices: [
        { value: quick.id, label: "Quick", description: "Tag" },
        { value: dinner.id, label: "Dinner", description: "Category" },
        { value: pot.id, label: "Dutch oven", description: "Tool" },
      ],
      titleMaxLength: 80,
    });
    expect(newMeta()).toEqual([{ title: "New smart cookbook - Spoonjoy" }]);
  });

  it("make one from with and without rules, open it, and fill it with the cook's matching recipes", async () => {
    const { cook, soup, salad, quick, pot } = await kitchen();
    const made = await create(cook.id, [["title", " Quick  ones "], ["with", quick.id], ["without", pot.id]]);
    const location = redirectedTo(made);
    expect(location).toMatch(/^\/cookbooks\/smart\/.+$/);
    const id = location!.split("/").pop()!;
    const loaded = await page(cook.id, id);
    expect(loaded).toEqual({
      cookbook: { id, title: "Quick ones" },
      rules: [
        { side: "with", name: "Quick", kind: "Tag", href: "/tags/quick" },
        { side: "without", name: "Dutch oven", kind: "Tool", href: "/tools/dutch-oven" },
      ],
      missing: false,
      page: 1,
      hasPreviousPage: false,
      hasNextPage: false,
      recipes: [{ id: salad.id, title: "Quick salad", description: null, servings: null }],
    });
    expect(soup.id).not.toBe(salad.id);
    expect(pageMeta({ data: loaded } as never)).toEqual([{ title: "Quick ones - Spoonjoy" }]);
    expect(pageMeta({ data: undefined } as never)).toEqual([{ title: "Smart cookbook - Spoonjoy" }]);
  });

  it("refuse a form with no title, no rules, or a word that isn't allowed, and keep what the cook picked", async () => {
    const { cook, quick, pot } = await kitchen();
    await expect(create(cook.id, [["title", " "], ["with", quick.id]])).resolves.toMatchObject({
      data: { error: "Give the cookbook a title of 80 characters or fewer.", values: { title: " ", with: [quick.id], without: [] } },
      init: { status: 400 },
    });
    await expect(create(cook.id, [["title", "Nothing"]])).resolves.toMatchObject({
      data: { error: "Pick at least one tag, category or tool for the cookbook to fill with or leave out." },
      init: { status: 400 },
    });
    await expect(create(cook.id, [["title", "Both"], ["with", pot.id], ["without", pot.id]])).resolves.toMatchObject({
      data: { error: "A tag, category or tool can't be both in and out. Remove it from one side." },
      init: { status: 400 },
    });
    await expect(create(cook.id, [["title", OBJECTIONABLE_TERMS[0]!], ["with", quick.id]])).resolves.toMatchObject({
      data: { error: OBJECTIONABLE_CONTENT_MESSAGE },
      init: { status: 400 },
    });
    expect(redirectedTo(await create(cook.id, [["title", "Quick"], ["with", quick.id]]))).not.toBeNull();
    await expect(create(cook.id, [["title", " Quick "], ["with", quick.id]])).resolves.toMatchObject({
      data: { error: "You already have a smart cookbook with this title." },
      init: { status: 400 },
    });
    expect(await db.smartCookbook.count()).toBe(1);
  });

  it("are only their cook's, and say so when a tag they need is deleted", async () => {
    const { cook, quick } = await kitchen();
    const other = await createDrawerUser("smart-other");
    const id = redirectedTo(await create(cook.id, [["title", "Quick"], ["with", quick.id]]))!.split("/").pop()!;
    expect(await page(other.id, id)).toMatchObject({ status: 404 });
    await db.organizer.delete({ where: { id: quick.id } });
    expect(await page(cook.id, id)).toMatchObject({ rules: [{ side: "with", gone: true }], missing: true, recipes: [] });
  });

  it("list on the Cookbooks page with their rules", async () => {
    const { cook, quick, pot } = await kitchen();
    await create(cook.id, [["title", "Quick"], ["with", quick.id], ["without", pot.id]]);
    const loaded = await cookbooksLoader({ request: await signedIn("/cookbooks", cook.id), context: ON, params: {} } as never);
    expect(loaded.smartCookbooks).toEqual([
      expect.objectContaining({
        title: "Quick",
        rules: [
          { side: "with", name: "Quick", kind: "Tag", href: "/tags/quick" },
          { side: "without", name: "Dutch oven", kind: "Tool", href: "/tools/dutch-oven" },
        ],
      }),
    ]);
  });

  it("show the form, a cookbook's rules and recipes, and the Cookbooks page's smart list", async () => {
    const recipes = [{ id: "r1", title: "Quick salad", description: "Crunchy", servings: "2" }];
    const rules = [
      { side: "with", name: "Quick", kind: "Tag", href: "/tags/quick" },
      { side: "without", gone: true },
    ];
    const Stub = createTestRoutesStub([
      { path: "/cookbooks/smart/new", Component: NewSmartCookbook, loader: () => ({ choices: [{ value: "t1", label: "Quick", description: "Tag" }], titleMaxLength: 80 }) },
      { path: "/cookbooks/smart/full", Component: SmartCookbookPage, loader: () => ({ cookbook: { id: "full", title: "Quick ones" }, rules, missing: false, page: 1, hasPreviousPage: false, hasNextPage: true, recipes }) },
      { path: "/cookbooks/smart/gone", Component: SmartCookbookPage, loader: () => ({ cookbook: { id: "gone", title: "Gone" }, rules: [{ side: "with", gone: true }], missing: true, page: 1, hasPreviousPage: false, hasNextPage: false, recipes: [] }) },
      { path: "/cookbooks", Component: CookbooksIndex, loader: () => ({ query: "", cookbooks: [], smartCookbooks: [{ id: "full", title: "Quick ones", rules }] }) },
    ]);

    render(<Stub initialEntries={["/cookbooks/smart/new"]} />);
    expect(await screen.findByRole("heading", { name: "New smart cookbook" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Title" })).toBeTruthy();
    expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(2);
    cleanup();

    render(<Stub initialEntries={["/cookbooks/smart/full"]} />);
    expect(await screen.findByRole("heading", { name: "Quick ones" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tag: Quick" }).getAttribute("href")).toBe("/tags/quick");
    expect(screen.getByText("Deleted")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Recipes in Quick ones" });
    expect(within(list).getByRole("link", { name: /Quick salad/ }).getAttribute("href")).toBe("/recipes/r1");
    expect(screen.getByRole("navigation", { name: "Quick ones pagination" })).toBeTruthy();
    cleanup();

    render(<Stub initialEntries={["/cookbooks/smart/gone"]} />);
    expect(await screen.findByText("A tag, category or tool this cookbook needs was deleted, so nothing can match.")).toBeTruthy();
    expect(screen.getByText("Nothing")).toBeTruthy();
    cleanup();

    render(<Stub initialEntries={["/cookbooks"]} />);
    const smart = await screen.findByRole("list", { name: "Smart cookbooks" });
    expect(within(smart).getByRole("link", { name: /Quick ones/ }).getAttribute("href")).toBe("/cookbooks/smart/full");
    expect(screen.getByRole("link", { name: "New smart cookbook" }).getAttribute("href")).toBe("/cookbooks/smart/new");
  });
});
