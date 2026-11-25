import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { redirect } from "react-router";
import { db } from "~/lib/db.server";
import { OBJECTIONABLE_CONTENT_MESSAGE, OBJECTIONABLE_TERMS } from "~/lib/objectionable-terms";
import TagPage, { action as tagAction, loader as tagLoader } from "~/routes/tags.$slug";
import { action as categoryAction } from "~/routes/categories.$slug";
import { action as toolAction } from "~/routes/tools.$slug";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRoutesStub } from "../utils";
import { createDrawerRecipe, createDrawerUser, sessionHeaders } from "./kitchen-drawer-test-utils";

const ON = { cloudflare: { env: {} } };

const ACTIONS = { tag: { action: tagAction, path: "/tags" }, category: { action: categoryAction, path: "/categories" }, tool: { action: toolAction, path: "/tools" } } as const;
type Kind = keyof typeof ACTIONS;

async function post(kind: Kind, slug: string, userId: string, fields: Record<string, string>, context: object = ON) {
  const { action, path } = ACTIONS[kind];
  const request = new UndiciRequest(`http://localhost:3000${path}/${slug}`, {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: await sessionHeaders(userId),
  }) as unknown as Request;
  try {
    return await action({ request, context, params: { slug } } as never);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

function redirectedTo(result: unknown): string | null {
  return result instanceof Response && result.status >= 300 && result.status < 400 ? result.headers.get("Location") : null;
}

async function kitchen() {
  const cook = await createDrawerUser("organizer-manage");
  const soup = await createDrawerRecipe({ chefId: cook.id, title: "Soup" });
  const stew = await createDrawerRecipe({ chefId: cook.id, title: "Stew" });
  const organizer = (kind: string, name: string) =>
    db.organizer.create({ data: { ownerId: cook.id, kind, name, slug: name.toLowerCase().replace(/\s+/g, "-") } });
  const quick = await organizer("tag", "Quick");
  const fast = await organizer("tag", "Fast");
  const quickTool = await organizer("tool", "Quick");
  await db.recipeOrganizer.createMany({
    data: [
      { recipeId: soup.id, organizerId: quick.id },
      { recipeId: stew.id, organizerId: fast.id },
      { recipeId: soup.id, organizerId: fast.id },
    ],
  });
  return { cook, soup, stew, quick, fast, quickTool };
}

describe("managing an organizer from its page", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    cleanup();
    await cleanupDatabase();
  });

  it("rename it and go to its new page", async () => {
    const { cook, quick } = await kitchen();

    const result = await post("tag", "quick", cook.id, { intent: "rename", name: "  Super   Quick " });

    expect(redirectedTo(result)).toBe("/tags/super-quick");
    expect(await db.organizer.findUnique({ where: { id: quick.id } })).toMatchObject({ name: "Super Quick", slug: "super-quick" });
  });

  it("refuse a name another of the same kind has, an empty one or an unkind word, and keep the name", async () => {
    const { cook, quick } = await kitchen();

    await expect(post("tag", "quick", cook.id, { intent: "rename", name: "fast" })).resolves.toMatchObject({
      data: { error: "You already have a tag called that. Merge them instead." },
      init: { status: 400 },
    });
    await expect(post("tag", "quick", cook.id, { intent: "rename", name: "   " })).resolves.toMatchObject({
      data: { error: "Give the tag a name of 60 characters or fewer." },
      init: { status: 400 },
    });
    await expect(post("tag", "quick", cook.id, { intent: "rename", name: OBJECTIONABLE_TERMS[0]! })).resolves.toMatchObject({
      data: { error: OBJECTIONABLE_CONTENT_MESSAGE },
      init: { status: 400 },
    });
    // A tool may share a tag's name.
    expect(redirectedTo(await post("tool", "quick", cook.id, { intent: "rename", name: "Fast" }))).toBe("/tools/fast");
    expect(await db.organizer.findUnique({ where: { id: quick.id } })).toMatchObject({ name: "Quick" });
  });

  it("merge it into another of the same kind: its recipes move over once each, it goes, and the page goes to the kept one", async () => {
    const { cook, soup, stew, quick, fast } = await kitchen();

    const result = await post("tag", "quick", cook.id, { intent: "merge", into: "fast" });

    expect(redirectedTo(result)).toBe("/tags/fast");
    expect(await db.organizer.findUnique({ where: { id: quick.id } })).toBeNull();
    const links = await db.recipeOrganizer.findMany({ where: { organizerId: fast.id }, select: { recipeId: true } });
    expect(links.map((link) => link.recipeId).sort()).toEqual([soup.id, stew.id].sort());
  });

  it("move a smart cookbook's rule on the merged tag to the tag it merged into", async () => {
    const { cook, quick, fast } = await kitchen();
    const cookbook = await db.smartCookbook.create({ data: { ownerId: cook.id, title: "Quick ones" } });
    await db.smartCookbookRule.create({ data: { cookbookId: cookbook.id, side: "with", organizerId: quick.id, position: 0 } });

    expect(redirectedTo(await post("tag", "quick", cook.id, { intent: "merge", into: "fast" }))).toBe("/tags/fast");

    const rules = await db.smartCookbookRule.findMany({ where: { cookbookId: cookbook.id }, select: { side: true, organizerId: true } });
    expect(rules).toEqual([{ side: "with", organizerId: fast.id }]);
  });

  it("refuse to merge into itself, into one of another kind or into one that isn't there", async () => {
    const { cook, quick } = await kitchen();

    for (const into of ["quick", "nope", ""]) {
      await expect(post("tag", "quick", cook.id, { intent: "merge", into })).resolves.toMatchObject({
        data: { error: "Choose another tag to merge into." },
        init: { status: 400 },
      });
    }
    expect(await db.organizer.findUnique({ where: { id: quick.id } })).not.toBeNull();
  });

  it("delete it and go back to the list, leaving its recipes", async () => {
    const { cook, soup, quick } = await kitchen();

    expect(redirectedTo(await post("tag", "quick", cook.id, { intent: "delete" }))).toBe("/tags");
    expect(await db.organizer.findUnique({ where: { id: quick.id } })).toBeNull();
    expect(await db.recipe.findUnique({ where: { id: soup.id } })).not.toBeNull();
    expect(redirectedTo(await post("category", "nope", cook.id, { intent: "delete" }))).toBeNull();
  });

  it("are not found for another cook or a missing organizer, and refuse an unknown intent", async () => {
    const { cook, quick } = await kitchen();
    const stranger = await createDrawerUser("organizer-stranger");

    expect((await post("tag", "quick", stranger.id, { intent: "delete" }) as Response).status).toBe(404);
    expect((await post("category", "nope", cook.id, { intent: "delete" }) as Response).status).toBe(404);
    await expect(post("tag", "quick", cook.id, { intent: "shout" })).resolves.toMatchObject({ init: { status: 400 } });
    expect(await db.organizer.findUnique({ where: { id: quick.id } })).not.toBeNull();
  });

  it("offer the cook's other organizers of the same kind to merge into", async () => {
    const { cook } = await kitchen();
    const request = new UndiciRequest("http://localhost:3000/tags/quick", { headers: await sessionHeaders(cook.id) }) as unknown as Request;

    const result = await tagLoader({ request, context: ON, params: { slug: "quick" } } as never);

    expect(result.others).toEqual([{ name: "Fast", slug: "fast" }]);
  });

  it("show Rename, Merge and Delete on the page, show a refusal, and ask before deleting", async () => {
    const sent = vi.fn();
    const Stub = createTestRoutesStub([{
      path: "/tags/:slug",
      Component: TagPage,
      loader: () => ({ organizer: { name: "Quick", slug: "quick" }, recipes: [], others: [{ name: "Fast", slug: "fast" }] }),
      action: async ({ request }: { request: Request }) => {
        const intent = (await request.formData()).get("intent");
        sent(intent);
        return intent === "rename" ? { error: "You already have a tag called that. Merge them instead." } : null;
      },
    }]);

    render(<Stub initialEntries={["/tags/quick"]} />);

    const rename = await screen.findByRole("form", { name: "Rename this tag" });
    expect(within(rename).getByRole("textbox", { name: "Name" })).toHaveValue("Quick");
    expect(within(rename).getByRole("button", { name: "Rename" })).toBeInTheDocument();
    const merge = screen.getByRole("form", { name: "Merge this tag" });
    expect(within(merge).getByRole("combobox", { name: "Merge into" })).toBeInTheDocument();
    expect(within(merge).getByRole("option", { name: "Fast" })).toHaveValue("fast");
    fireEvent.click(screen.getByRole("button", { name: "Delete tag" }));
    expect(await screen.findByRole("alertdialog", { name: "Delete Quick?" })).toBeInTheDocument();
    expect(screen.getByText("Its recipes stay. They just won't have this tag.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete it" }));
    await waitFor(() => expect(sent).toHaveBeenCalledWith("delete"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    fireEvent.click(within(rename).getByRole("button", { name: "Rename" }));
    expect(await screen.findByText("You already have a tag called that. Merge them instead.")).toBeInTheDocument();
    expect(sent).toHaveBeenLastCalledWith("rename");
  });

  it("show the kept tag's own name in the Name box after a merge moves to its page without a reload", async () => {
    const names: Record<string, string> = { quick: "Quick", fast: "Fast" };
    const Stub = createTestRoutesStub([{
      path: "/tags/:slug",
      Component: TagPage,
      loader: ({ params }: { params: { slug?: string } }) => ({
        organizer: { name: names[params.slug!]!, slug: params.slug! },
        recipes: [],
        others: Object.keys(names).filter((slug) => slug !== params.slug).map((slug) => ({ name: names[slug]!, slug })),
      }),
      action: () => redirect("/tags/fast"),
    }]);

    render(<Stub initialEntries={["/tags/quick"]} />);
    const merge = await screen.findByRole("form", { name: "Merge this tag" });
    fireEvent.click(within(merge).getByRole("button", { name: "Merge" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Fast" })).toBeInTheDocument();
    expect(within(screen.getByRole("form", { name: "Rename this tag" })).getByRole("textbox", { name: "Name" })).toHaveValue("Fast");
  });

  it("leave Merge out when there's nothing of the same kind to merge into", async () => {
    const Stub = createTestRoutesStub([{
      path: "/tags/:slug",
      Component: TagPage,
      loader: () => ({ organizer: { name: "Quick", slug: "quick" }, recipes: [], others: [] }),
    }]);

    render(<Stub initialEntries={["/tags/quick"]} />);

    expect(await screen.findByRole("form", { name: "Rename this tag" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Merge this tag" })).not.toBeInTheDocument();
  });
});
