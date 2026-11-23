// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { db } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { action as createAction, loader as createLoader } from "~/routes/recipes.new";
import { action as editAction, loader as editLoader } from "~/routes/recipes.$id.edit";
import { action as settingsAction, loader as settingsLoader } from "~/routes/account.settings";
import { cleanupDatabase } from "../helpers/cleanup";

// While recipe_visibility is on, the create and edit forms carry who can see the recipe, and a
// new recipe starts at the cook's default. While it is off they ignore it, as before.

const FLAG_ON = { SPOONJOY_FLAGS: "recipe_visibility" };
const WITH_HOUSEHOLDS = { SPOONJOY_FLAGS: "recipe_visibility,households" };

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

  it("starts the create form at the cook's default, and hides the choice while it is off", async () => {
    type LoaderArgs = Parameters<typeof createLoader>[0];
    expect(await createLoader(args<LoaderArgs>(await get("http://localhost/recipes/new"), FLAG_ON)))
      .toEqual({ visibilityDefault: "private", visibilityChoices: ["public", "private"] });
    expect(await createLoader(args<LoaderArgs>(await get("http://localhost/recipes/new"), null)))
      .toEqual({ visibilityDefault: null, visibilityChoices: null });
  });

  it("creates the recipe at the level chosen, or the cook's default when none is sent", async () => {
    type ActionArgs = Parameters<typeof createAction>[0];
    await createAction(args<ActionArgs>(await post("http://localhost/recipes/new", { title: "Chosen Public", steps: "[]", visibility: "public" }), FLAG_ON));
    await createAction(args<ActionArgs>(await post("http://localhost/recipes/new", { title: "Default Private", steps: "[]" }), FLAG_ON));
    expect((await created("Chosen Public")).visibility).toBe("public");
    expect((await created("Default Private")).visibility).toBe("private");
  });

  it("ignores the choice while it is off, so the recipe is public as before", async () => {
    type ActionArgs = Parameters<typeof createAction>[0];
    await createAction(args<ActionArgs>(await post("http://localhost/recipes/new", { title: "Flag Off", steps: "[]", visibility: "private" }), null));
    expect((await created("Flag Off")).visibility).toBe("public");
  });

  it("shows the recipe's level in the editor and saves a new one, keeping it when none or household is sent", async () => {
    type EditLoaderArgs = Parameters<typeof editLoader>[0];
    type EditActionArgs = Parameters<typeof editAction>[0];
    const recipe = await db.recipe.create({ data: { title: "Edit Me", chefId: cookId } });
    const url = `http://localhost/recipes/${recipe.id}/edit`;
    const params = { id: recipe.id };

    expect((await editLoader(args<EditLoaderArgs>(await get(url), FLAG_ON, params))).visibility).toBe("public");
    expect((await editLoader(args<EditLoaderArgs>(await get(url), null, params))).visibility).toBeNull();
    // A stored level the editor can't name shows as the most closed one.
    await db.recipe.update({ where: { id: recipe.id }, data: { visibility: "unknown" } });
    expect((await editLoader(args<EditLoaderArgs>(await get(url), FLAG_ON, params))).visibility).toBe("private");
    await db.recipe.update({ where: { id: recipe.id }, data: { visibility: "public" } });

    await editAction(args<EditActionArgs>(await post(url, { title: "Edit Me", visibility: "private" }), FLAG_ON, params));
    expect((await created("Edit Me")).visibility).toBe("private");
    await editAction(args<EditActionArgs>(await post(url, { title: "Edit Me", visibility: "household" }), FLAG_ON, params));
    await editAction(args<EditActionArgs>(await post(url, { title: "Edit Me" }), FLAG_ON, params));
    await editAction(args<EditActionArgs>(await post(url, { title: "Edit Me", visibility: "public" }), null, params));
    expect((await created("Edit Me")).visibility).toBe("private");
  });

  it("sets the cook's default for new recipes in account settings, only while the choice is on", async () => {
    type SettingsActionArgs = Parameters<typeof settingsAction>[0];
    type SettingsLoaderArgs = Parameters<typeof settingsLoader>[0];
    const url = "http://localhost/account/settings";
    const stored = async () => (await db.user.findUniqueOrThrow({ where: { id: cookId }, select: { defaultRecipeVisibility: true } })).defaultRecipeVisibility;

    expect((await settingsLoader(args<SettingsLoaderArgs>(await get(url), FLAG_ON))).recipeVisibilityDefault).toBe("private");
    expect((await settingsLoader(args<SettingsLoaderArgs>(await get(url), null))).recipeVisibilityDefault).toBeNull();

    expect(await settingsAction(args<SettingsActionArgs>(await post(url, { intent: "setRecipeVisibilityDefault", visibility: "public" }), FLAG_ON)))
      .toMatchObject({ success: true, intent: "setRecipeVisibilityDefault" });
    expect(await stored()).toBe("public");
    for (const [visibility, env] of [["household", FLAG_ON], ["private", null]] as const) {
      expect(await settingsAction(args<SettingsActionArgs>(await post(url, { intent: "setRecipeVisibilityDefault", visibility }), env)))
        .toMatchObject({ success: false, error: "invalid_visibility" });
    }
    expect(await stored()).toBe("public");
  });

  it("offers Household on the create form and in the editor only while households is on, and saves it then", async () => {
    type LoaderArgs = Parameters<typeof createLoader>[0];
    type ActionArgs = Parameters<typeof createAction>[0];
    type EditLoaderArgs = Parameters<typeof editLoader>[0];
    type EditActionArgs = Parameters<typeof editAction>[0];
    const newUrl = "http://localhost/recipes/new";
    expect(await createLoader(args<LoaderArgs>(await get(newUrl), WITH_HOUSEHOLDS)))
      .toEqual({ visibilityDefault: "private", visibilityChoices: ["public", "household", "private"] });
    expect(await createLoader(args<LoaderArgs>(await get(newUrl), FLAG_ON)))
      .toEqual({ visibilityDefault: "private", visibilityChoices: ["public", "private"] });

    await createAction(args<ActionArgs>(await post(newUrl, { title: "Shared Stew", steps: "[]", visibility: "household" }), WITH_HOUSEHOLDS));
    await createAction(args<ActionArgs>(await post(newUrl, { title: "Not Yet Shared", steps: "[]", visibility: "household" }), FLAG_ON));
    expect((await created("Shared Stew")).visibility).toBe("household");
    expect((await created("Not Yet Shared")).visibility).toBe("private");

    const recipe = await db.recipe.create({ data: { title: "Edit Household", chefId: cookId } });
    const url = `http://localhost/recipes/${recipe.id}/edit`;
    const params = { id: recipe.id };
    expect(await editLoader(args<EditLoaderArgs>(await get(url), WITH_HOUSEHOLDS, params)))
      .toMatchObject({ visibility: "public", visibilityChoices: ["public", "household", "private"] });
    expect(await editLoader(args<EditLoaderArgs>(await get(url), FLAG_ON, params)))
      .toMatchObject({ visibility: "public", visibilityChoices: ["public", "private"] });
    await editAction(args<EditActionArgs>(await post(url, { title: "Edit Household", visibility: "household" }), FLAG_ON, params));
    expect((await created("Edit Household")).visibility).toBe("public");
    await editAction(args<EditActionArgs>(await post(url, { title: "Edit Household", visibility: "household" }), WITH_HOUSEHOLDS, params));
    expect((await created("Edit Household")).visibility).toBe("household");
    // With households off again the editor keeps the stored level.
    await editAction(args<EditActionArgs>(await post(url, { title: "Edit Household", visibility: "household" }), FLAG_ON, params));
    expect((await created("Edit Household")).visibility).toBe("household");
  });

  it("offers Household as the default for new recipes only while households is on", async () => {
    type SettingsActionArgs = Parameters<typeof settingsAction>[0];
    type SettingsLoaderArgs = Parameters<typeof settingsLoader>[0];
    type LoaderArgs = Parameters<typeof createLoader>[0];
    const url = "http://localhost/account/settings";
    const stored = async () => (await db.user.findUniqueOrThrow({ where: { id: cookId }, select: { defaultRecipeVisibility: true } })).defaultRecipeVisibility;

    expect(await settingsLoader(args<SettingsLoaderArgs>(await get(url), WITH_HOUSEHOLDS)))
      .toMatchObject({ recipeVisibilityDefault: "private", recipeVisibilityChoices: ["public", "household", "private"] });
    expect(await settingsLoader(args<SettingsLoaderArgs>(await get(url), FLAG_ON)))
      .toMatchObject({ recipeVisibilityDefault: "private", recipeVisibilityChoices: ["public", "private"] });

    expect(await settingsAction(args<SettingsActionArgs>(await post(url, { intent: "setRecipeVisibilityDefault", visibility: "household" }), WITH_HOUSEHOLDS)))
      .toMatchObject({ success: true, intent: "setRecipeVisibilityDefault" });
    expect(await stored()).toBe("household");
    expect((await createLoader(args<LoaderArgs>(await get("http://localhost/recipes/new"), WITH_HOUSEHOLDS))).visibilityDefault).toBe("household");
    // A household default is not one the cook can choose while households is off, so new recipes start public.
    expect((await createLoader(args<LoaderArgs>(await get("http://localhost/recipes/new"), FLAG_ON))).visibilityDefault).toBe("public");
  });
});
