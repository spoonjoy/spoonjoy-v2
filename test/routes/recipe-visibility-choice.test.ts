// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { db } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { action as createAction, loader as createLoader } from "~/routes/recipes.new";
import { action as editAction, loader as editLoader } from "~/routes/recipes.$id.edit";
import { action as settingsAction, loader as settingsLoader } from "~/routes/account.settings";
import { cleanupDatabase } from "../helpers/cleanup";

// The create and edit forms carry who can see the recipe (public, household or only me), and a new recipe starts at
// the cook's default.

const ENV = {};

let cookId: string;

async function cookie(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0]!;
}

async function post(url: string, fields: Record<string, string>) {
  const form = new UndiciFormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new UndiciRequest(url, { method: "POST", body: form, headers: { Cookie: await cookie(cookId) } }) as unknown as Request;
}

async function get(url: string) {
  return new UndiciRequest(url, { headers: { Cookie: await cookie(cookId) } }) as unknown as Request;
}

function args<T>(request: Request, env: Record<string, string> | null, params: Record<string, string> = {}) {
  return { request, params, context: { cloudflare: { env } } } as unknown as T;
}

async function created(title: string) {
  return db.recipe.findFirstOrThrow({ where: { chefId: cookId, title }, select: { id: true, visibility: true } });
}

describe("choosing who can see a recipe", () => {
  beforeEach(async () => {
    await cleanupDatabase();
    cookId = (await db.user.create({ data: { email: "choice_cook@example.com", username: "choice_cook", defaultRecipeVisibility: "private" } })).id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("starts the create form at the cook's default", async () => {
    type LoaderArgs = Parameters<typeof createLoader>[0];
    expect(await createLoader(args<LoaderArgs>(await get("http://localhost/recipes/new"), ENV)))
      .toEqual({ visibilityDefault: "private" });
  });

  it("creates the recipe at the level chosen, or the cook's default when none is sent", async () => {
    type ActionArgs = Parameters<typeof createAction>[0];
    await createAction(args<ActionArgs>(await post("http://localhost/recipes/new", { title: "Chosen Public", steps: "[]", visibility: "public" }), ENV));
    await createAction(args<ActionArgs>(await post("http://localhost/recipes/new", { title: "Default Private", steps: "[]" }), ENV));
    expect((await created("Chosen Public")).visibility).toBe("public");
    expect((await created("Default Private")).visibility).toBe("private");
  });

  it("shows the recipe's level in the editor and saves a new one, keeping it when none is sent", async () => {
    type EditLoaderArgs = Parameters<typeof editLoader>[0];
    type EditActionArgs = Parameters<typeof editAction>[0];
    const recipe = await db.recipe.create({ data: { title: "Edit Me", chefId: cookId } });
    const url = `http://localhost/recipes/${recipe.id}/edit`;
    const params = { id: recipe.id };

    expect((await editLoader(args<EditLoaderArgs>(await get(url), ENV, params))).visibility).toBe("public");
    // A stored level the editor can't name shows as the most closed one.
    await db.recipe.update({ where: { id: recipe.id }, data: { visibility: "unknown" } });
    expect((await editLoader(args<EditLoaderArgs>(await get(url), ENV, params))).visibility).toBe("private");
    await db.recipe.update({ where: { id: recipe.id }, data: { visibility: "public" } });

    await editAction(args<EditActionArgs>(await post(url, { title: "Edit Me", visibility: "private" }), ENV, params));
    expect((await created("Edit Me")).visibility).toBe("private");
    await editAction(args<EditActionArgs>(await post(url, { title: "Edit Me" }), ENV, params));
    expect((await created("Edit Me")).visibility).toBe("private");
  });

  it("sets the cook's default for new recipes in account settings, refusing a level that isn't one", async () => {
    type SettingsActionArgs = Parameters<typeof settingsAction>[0];
    type SettingsLoaderArgs = Parameters<typeof settingsLoader>[0];
    const url = "http://localhost/account/settings";
    const stored = async () => (await db.user.findUniqueOrThrow({ where: { id: cookId }, select: { defaultRecipeVisibility: true } })).defaultRecipeVisibility;

    expect((await settingsLoader(args<SettingsLoaderArgs>(await get(url), ENV))).recipeVisibilityDefault).toBe("private");

    expect(await settingsAction(args<SettingsActionArgs>(await post(url, { intent: "setRecipeVisibilityDefault", visibility: "public" }), ENV)))
      .toMatchObject({ success: true, intent: "setRecipeVisibilityDefault" });
    expect(await stored()).toBe("public");
    expect(await settingsAction(args<SettingsActionArgs>(await post(url, { intent: "setRecipeVisibilityDefault", visibility: "friends" }), ENV)))
      .toMatchObject({ success: false, error: "invalid_visibility" });
    expect(await stored()).toBe("public");
  });

  it("offers Household on the create form and in the editor, and saves it", async () => {
    type ActionArgs = Parameters<typeof createAction>[0];
    type EditLoaderArgs = Parameters<typeof editLoader>[0];
    type EditActionArgs = Parameters<typeof editAction>[0];
    await createAction(args<ActionArgs>(await post("http://localhost/recipes/new", { title: "Shared Stew", steps: "[]", visibility: "household" }), ENV));
    expect((await created("Shared Stew")).visibility).toBe("household");

    const recipe = await db.recipe.create({ data: { title: "Edit Household", chefId: cookId } });
    const url = `http://localhost/recipes/${recipe.id}/edit`;
    const params = { id: recipe.id };
    expect(await editLoader(args<EditLoaderArgs>(await get(url), ENV, params)))
      .toMatchObject({ visibility: "public" });
    await editAction(args<EditActionArgs>(await post(url, { title: "Edit Household", visibility: "household" }), ENV, params));
    expect((await created("Edit Household")).visibility).toBe("household");
    expect((await editLoader(args<EditLoaderArgs>(await get(url), ENV, params))).visibility).toBe("household");
  });

  it("offers Household as the default for new recipes", async () => {
    type SettingsActionArgs = Parameters<typeof settingsAction>[0];
    type SettingsLoaderArgs = Parameters<typeof settingsLoader>[0];
    type LoaderArgs = Parameters<typeof createLoader>[0];
    const url = "http://localhost/account/settings";
    const stored = async () => (await db.user.findUniqueOrThrow({ where: { id: cookId }, select: { defaultRecipeVisibility: true } })).defaultRecipeVisibility;

    expect(await settingsLoader(args<SettingsLoaderArgs>(await get(url), ENV)))
      .toMatchObject({ recipeVisibilityDefault: "private" });
    expect(await settingsAction(args<SettingsActionArgs>(await post(url, { intent: "setRecipeVisibilityDefault", visibility: "household" }), ENV)))
      .toMatchObject({ success: true, intent: "setRecipeVisibilityDefault" });
    expect(await stored()).toBe("household");
    expect(await settingsAction(args<SettingsActionArgs>(await post(url, { intent: "setRecipeVisibilityDefault", visibility: "friends" }), ENV)))
      .toMatchObject({ success: false, error: "invalid_visibility", message: "Choose public, household or only me." });
    expect((await createLoader(args<LoaderArgs>(await get("http://localhost/recipes/new"), ENV))).visibilityDefault).toBe("household");
  });
});
