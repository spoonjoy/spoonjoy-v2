import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { db } from "~/lib/db.server";
import { OBJECTIONABLE_CONTENT_MESSAGE, OBJECTIONABLE_TERMS } from "~/lib/objectionable-terms";
import NewSmartCookbook, { action as newAction, loader as newLoader, meta as newMeta } from "~/routes/cookbooks.smart.new";
import SmartCookbookPage, { action as pageAction, loader as pageLoader, meta as pageMeta } from "~/routes/cookbooks.smart.$id";
import CookbooksIndex, { loader as cookbooksLoader } from "~/routes/cookbooks._index";
import { cleanupDatabase } from "../helpers/cleanup";
import { sqliteD1 } from "../helpers/sqlite-d1";
import { createTestRoutesStub } from "../utils";
import { createDrawerRecipe, createDrawerUser, sessionHeaders } from "./kitchen-drawer-test-utils";

// With a DB binding, Prisma is the tests' own SQLite, so a page reads its recipes from D1 and the rest through Prisma.
vi.mock("~/lib/db.server", async (original) => {
  const real = await original<typeof import("~/lib/db.server")>();
  return { ...real, get db() { return real.db; }, getDb: vi.fn(() => real.getLocalDb()) };
});

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

  it("offer every tag, category and tool the cook has, by kind and then by name, each submitting its id", async () => {
    const { cook, quick, dinner, pot } = await kitchen();
    const apple = await db.organizer.create({ data: { ownerId: cook.id, kind: "tag", name: "apple", slug: "apple" } });
    const loaded = await newLoader({ request: await signedIn("/cookbooks/smart/new", cook.id), context: ON, params: {} } as never);
    expect(loaded).toEqual({
      choices: [
        { value: apple.id, label: "apple", description: "Tag" },
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
      total: 1,
      recipes: [{ id: salad.id, title: "Quick salad", servings: null, coverImageUrl: null, coverProvenanceLabel: null }],
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
    await expect(create(cook.id, [["with", quick.id]])).resolves.toMatchObject({
      data: { error: "Give the cookbook a title of 80 characters or fewer.", values: { title: "" } },
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

  it("fill with each recipe's active cover and count every match, the same from D1 as from Prisma", async () => {
    const { cook, soup, salad, quick } = await kitchen();
    const cover = await db.recipeCover.create({ data: { recipeId: salad.id, imageUrl: "/photos/salad.jpg", sourceType: "chef-upload" } });
    await db.recipeCover.create({ data: { recipeId: soup.id, imageUrl: "/photos/not-active.jpg", sourceType: "spoon" } });
    await db.recipe.update({ where: { id: salad.id }, data: { activeCoverId: cover.id, coverMode: "manual" } });
    const id = redirectedTo(await create(cook.id, [["title", "Quick"], ["with", quick.id]]))!.split("/").pop()!;

    const fromPrisma = await page(cook.id, id);
    expect(fromPrisma).toMatchObject({
      total: 2,
      // Its new cover makes the salad the most recently changed, so it comes first.
      recipes: [
        { id: salad.id, title: "Quick salad", coverImageUrl: expect.stringContaining("salad") },
        { id: soup.id, title: "Quick soup", coverImageUrl: null, coverProvenanceLabel: null },
      ],
    });
    const d1 = sqliteD1();
    try {
      expect(await page(cook.id, id, "", { cloudflare: { env: { SPOONJOY_FLAGS: "smart-cookbooks", DB: d1.binding } } })).toEqual(fromPrisma);
      expect(d1.roundTrips()).toBeGreaterThan(0);
    } finally {
      d1.close();
    }
  });

  it("list on Cookbooks from D1 on the Worker as they do through Prisma", async () => {
    const { cook, quick } = await kitchen();
    await create(cook.id, [["title", "Quick"], ["with", quick.id]]);
    const load = async (context: object) =>
      cookbooksLoader({ request: await signedIn("/cookbooks", cook.id), context, params: {} } as never);
    const d1 = sqliteD1();
    try {
      const fromD1 = await load({ cloudflare: { env: { SPOONJOY_FLAGS: "smart-cookbooks", DB: d1.binding } } });
      expect(fromD1).toEqual(await load(ON));
      expect(fromD1).toMatchObject({ smartCookbooks: [{ title: "Quick" }] });
      expect(d1.roundTrips()).toBeGreaterThan(0);
    } finally {
      d1.close();
    }
  });

  it("rename from their page, refusing a title in use, an empty one or a word that isn't allowed, and delete from it, leaving the recipes", async () => {
    const { cook, quick, soup } = await kitchen();
    const other = await createDrawerUser("smart-other");
    const id = redirectedTo(await create(cook.id, [["title", "Quick"], ["with", quick.id]]))!.split("/").pop()!;
    await create(cook.id, [["title", "Taken"], ["with", quick.id]]);
    const change = async (fields: [string, string][], userId = cook.id, context: object = ON) =>
      settle(pageAction({
        request: await signedIn(`/cookbooks/smart/${id}`, userId, { method: "POST", body: new URLSearchParams(fields) }),
        context,
        params: { id },
      } as never));

    expect(await change([["intent", "rename"], ["title", "  Fast  ones "]])).toEqual({ renamed: "Fast ones" });
    await expect(change([["intent", "rename"], ["title", "Taken"]])).resolves.toMatchObject({
      data: { error: "You already have a smart cookbook with this title." },
      init: { status: 400 },
    });
    await expect(change([["intent", "rename"], ["title", ""]])).resolves.toMatchObject({ init: { status: 400 } });
    await expect(change([["intent", "rename"], ["title", OBJECTIONABLE_TERMS[0]!]])).resolves.toMatchObject({
      data: { error: OBJECTIONABLE_CONTENT_MESSAGE },
      init: { status: 400 },
    });
    await expect(change([["intent", "shout"]])).resolves.toMatchObject({ data: { error: "Choose Rename or Delete." }, init: { status: 400 } });
    expect(await change([["intent", "rename"], ["title", "Mine"]], other.id)).toMatchObject({ status: 404 });
    expect(await change([["intent", "delete"]], cook.id, OFF)).toMatchObject({ status: 404 });
    expect(await db.smartCookbook.findUnique({ where: { id } })).toMatchObject({ title: "Fast ones" });

    // Another cook's delete changes nothing; the cook's own goes to Cookbooks.
    expect(redirectedTo(await change([["intent", "delete"]], other.id))).toBe("/cookbooks");
    expect(await db.smartCookbook.count()).toBe(2);
    expect(redirectedTo(await change([["intent", "delete"]]))).toBe("/cookbooks");
    expect(await db.smartCookbook.findUnique({ where: { id } })).toBeNull();
    expect(await db.recipe.findUnique({ where: { id: soup.id } })).not.toBeNull();
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

  it("show their recipes in a regular cookbook's Contents, counting every match, and say what to do when none match", async () => {
    const tag = { side: "with", name: "Quick", kind: "Tag", href: "/tags/quick" };
    const shown = (id: string, rules: object[], recipes: object[] = [], total = recipes.length) => ({
      path: `/cookbooks/smart/${id}`,
      Component: SmartCookbookPage,
      loader: () => ({ cookbook: { id, title: "Quick ones" }, rules, missing: false, total, page: 1, hasPreviousPage: false, hasNextPage: false, recipes }),
    });
    const Stub = createTestRoutesStub([
      shown("full", [tag], [{ id: "r1", title: "Quick soup", servings: "4", coverImageUrl: null, coverProvenanceLabel: null }], 51),
      shown("tag", [tag]),
      shown("category", [{ ...tag, kind: "Category", name: "Dinner" }]),
      shown("tool", [{ ...tag, kind: "Tool", name: "Dutch oven" }]),
      shown("without", [{ ...tag, side: "without" }]),
    ]);

    render(<Stub initialEntries={["/cookbooks/smart/full"]} />);
    const contents = await screen.findByRole("region", { name: "Contents" });
    expect(within(contents).getByText("51 recipes")).toBeTruthy();
    expect(within(contents).getByRole("list", { name: "Recipes in Quick ones" })).toBeTruthy();
    expect(within(contents).getByRole("link", { name: /Quick soup/ }).getAttribute("href")).toBe("/recipes/r1");
    expect(screen.getByTestId("cookbook-recipe-cover-placeholder-r1")).toBeTruthy();
    cleanup();

    for (const [id, hint] of [
      ["tag", "Tag a recipe Quick to see it here."],
      ["category", "Put a recipe in Dinner to see it here."],
      ["tool", "Add Dutch oven to a recipe's tools to see it here."],
      ["without", "Recipes without these show up here."],
    ]) {
      render(<Stub initialEntries={[`/cookbooks/smart/${id}`]} />);
      expect(await screen.findByText("No recipes match yet")).toBeTruthy();
      expect(screen.getByText(hint!)).toBeTruthy();
      cleanup();
    }
  });

  it("show a refused new cookbook's reason, and Cookbooks with none or several", async () => {
    const rules = [{ side: "with", name: "Quick", kind: "Tag", href: "/tags/quick" }];
    const Stub = createTestRoutesStub([
      {
        path: "/cookbooks/smart/new",
        Component: NewSmartCookbook,
        loader: () => ({ choices: [], titleMaxLength: 80 }),
        action: () => ({ error: "You already have a smart cookbook with this title.", values: { title: "Quick", with: [], without: [] } }),
      },
      { path: "/cookbooks/none", Component: CookbooksIndex, loader: () => ({ query: "", cookbooks: [], smartCookbooks: [] }) },
      { path: "/cookbooks/two", Component: CookbooksIndex, loader: () => ({ query: "", cookbooks: [], smartCookbooks: [{ id: "a", title: "A", rules }, { id: "b", title: "B", rules: [] }] }) },
    ]);

    render(<Stub initialEntries={["/cookbooks/smart/new"]} />);
    fireEvent.change(await screen.findByRole("textbox", { name: "Title" }), { target: { value: "Quick" } });
    fireEvent.click(screen.getByRole("button", { name: "Create smart cookbook" }));
    expect(await screen.findByText("You already have a smart cookbook with this title.")).toBeTruthy();
    cleanup();

    render(<Stub initialEntries={["/cookbooks/none"]} />);
    expect(await screen.findByText("A smart cookbook fills itself with your recipes that match the tags, categories and tools you pick.")).toBeTruthy();
    cleanup();

    render(<Stub initialEntries={["/cookbooks/two"]} />);
    expect(await screen.findByText("2 cookbooks")).toBeTruthy();
    expect(screen.getByText("With Quick")).toBeTruthy();
  });

  it("rename from the page, show a refusal, and delete only after asking", async () => {
    const sent: string[] = [];
    const Stub = createTestRoutesStub([
      {
        path: "/cookbooks/smart/full",
        Component: SmartCookbookPage,
        loader: () => ({ cookbook: { id: "full", title: "Quick ones" }, rules: [], missing: false, page: 1, hasPreviousPage: false, hasNextPage: false, recipes: [] }),
        action: async ({ request }: { request: Request }) => {
          const form = await request.formData();
          sent.push(`${form.get("intent")}:${form.get("title") ?? ""}`);
          return { error: "You already have a smart cookbook with this title." };
        },
      },
    ]);
    render(<Stub initialEntries={["/cookbooks/smart/full"]} />);
    const rename = await screen.findByRole("form", { name: "Rename this cookbook" });
    expect(within(rename).getByRole("textbox", { name: "Title" })).toHaveValue("Quick ones");
    fireEvent.change(within(rename).getByRole("textbox", { name: "Title" }), { target: { value: "Taken" } });
    fireEvent.click(within(rename).getByRole("button", { name: "Rename" }));
    expect(await screen.findByText("You already have a smart cookbook with this title.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete cookbook" }));
    expect(await screen.findByRole("alertdialog", { name: "Delete Quick ones?" })).toBeTruthy();
    expect(sent).toEqual(["rename:Taken"]);
    fireEvent.click(screen.getByRole("button", { name: "Delete it" }));
    await waitFor(() => expect(sent).toEqual(["rename:Taken", "delete:"]));
  });
});
