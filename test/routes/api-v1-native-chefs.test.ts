import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import { loader } from "~/routes/api.v1.$";
import { createApiCredential } from "~/lib/api-auth.server";
import { createUser } from "~/lib/auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestRecipe } from "../utils";

function routeArgs(request: Request) {
  return {
    request,
    params: { "*": "me/chefs" },
    context: { cloudflare: { env: { NODE_ENV: "production", SPOONJOY_BASE_URL: "https://spoonjoy.app" } } },
  } as any;
}

function chefsRequest(token: string | null, requestId: string) {
  return new UndiciRequest("http://localhost/api/v1/me/chefs", {
    headers: {
      "X-Request-Id": requestId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }) as unknown as Request;
}

describe("API v1 native chefs", () => {
  let db: Awaited<ReturnType<typeof getLocalDb>>;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("returns the same fellow chefs, kitchen visitors, and activity as the web Chefs route", async () => {
    const viewer = await createUser(db, "chefs-viewer@example.com", `chefs_viewer_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const other = await createUser(db, "chefs-other@example.com", `chefs_other_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    await db.user.update({ where: { id: other.id }, data: { photoUrl: "/photos/profiles/other/avatar.jpg" } });
    const otherRecipe = await db.recipe.create({ data: { ...createTestRecipe(other.id), title: "Other Lemon Pasta" } });
    const viewerRecipe = await db.recipe.create({ data: { ...createTestRecipe(viewer.id), title: "Viewer Soup" } });
    await db.recipeSpoon.create({
      data: { recipeId: otherRecipe.id, chefId: viewer.id, cookedAt: new Date("2026-06-02T10:00:00.000Z") },
    });
    await db.recipeSpoon.create({
      data: { recipeId: viewerRecipe.id, chefId: other.id, cookedAt: new Date("2026-06-03T10:00:00.000Z") },
    });
    const credential = await createApiCredential(db, viewer.id, "Native chefs reader", { scopes: ["kitchen:read"] });

    const response = await loader(routeArgs(chefsRequest(credential.token, "req_native_chefs")));
    const payload = await response.json() as any;

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("private");
    expect(payload.data.viewer).toEqual({ id: viewer.id, username: viewer.username, photoUrl: null });
    expect(payload.data.fellowChefs.total).toBe(1);
    expect(payload.data.fellowChefs.rows[0]).toMatchObject({
      chefId: other.id,
      username: other.username,
      photoUrl: "https://spoonjoy.app/photos/profiles/other/avatar.jpg",
      interactionCounts: { spoons: 1, forks: 0, cookbookSaves: 0 },
      latestInteractionAt: "2026-06-02T10:00:00.000Z",
    });
    expect(payload.data.chefsUsingMyRecipes.rows.map((row: any) => row.chefId)).toEqual([other.id]);
    expect(payload.data.activity.map((row: any) => [row.direction, row.kind, row.label])).toEqual([
      ["inbound", "spooned", `${other.username} cooked your Viewer Soup.`],
      ["outbound", "spooned", `You cooked Other Lemon Pasta from ${other.username}.`],
    ]);
    expect(payload.data.activity[0]).toMatchObject({ eventAt: "2026-06-03T10:00:00.000Z", recipe: { id: viewerRecipe.id, title: "Viewer Soup" }, cookbook: null });
  });

  it("returns empty lists for a chef with no chef graph and requires auth", async () => {
    const viewer = await createUser(db, "chefs-empty@example.com", `chefs_empty_${faker.string.alphanumeric(8)}`, "correctHorseBatteryStaple");
    const credential = await createApiCredential(db, viewer.id, "Native chefs reader", { scopes: ["kitchen:read"] });
    const empty = await (await loader(routeArgs(chefsRequest(credential.token, "req_native_chefs_empty")))).json() as any;
    expect(empty.data.fellowChefs).toEqual({ total: 0, rows: [] });
    expect(empty.data.activity).toEqual([]);

    const anonymous = await loader(routeArgs(chefsRequest(null, "req_native_chefs_anon")));
    expect(anonymous.status).toBe(401);
  });
});
