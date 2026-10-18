import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "react-router";
import * as recipeRoute from "~/routes/recipes.$id";
import { getCookProgressStorageKey } from "~/hooks/use-route-cook-controller";
import { syncedCookProgressStorageKey } from "~/lib/cook-session-sync";

const deletedKey = syncedCookProgressStorageKey("user-1", "recipe-1");
const otherRecipeKey = syncedCookProgressStorageKey("user-1", "recipe-2");
const otherCookKey = syncedCookProgressStorageKey("user-2", "recipe-1");
const deviceKey = getCookProgressStorageKey("recipe-1");
const otherDeviceKey = getCookProgressStorageKey("recipe-2");
const pending = JSON.stringify({ progress: { scaleFactor: 2 }, server: { revision: 4 } });

beforeEach(() => {
  window.localStorage.clear();
  for (const key of [deletedKey, otherRecipeKey, otherCookKey, deviceKey, otherDeviceKey]) {
    window.localStorage.setItem(key, pending);
  }
});

function deleteOnClient(serverAction: () => Promise<unknown>, intent = "delete", userId = "user-1") {
  const body = new FormData();
  body.set("intent", intent);
  body.set("cookSessionUserId", userId);
  return recipeRoute.clientAction({
    request: new Request("https://spoonjoy.app/recipes/recipe-1", { method: "POST", body }),
    params: { id: "recipe-1" },
    serverAction,
  } as never);
}

function expectUnrelatedProgress() {
  for (const key of [otherRecipeKey, otherCookKey, otherDeviceKey]) {
    expect(window.localStorage.getItem(key)).toBe(pending);
  }
}

function expectPendingProgress() {
  expect(window.localStorage.getItem(deletedKey)).toBe(pending);
  expect(window.localStorage.getItem(deviceKey)).toBe(pending);
  expectUnrelatedProgress();
}

describe("confirmed recipe deletion on the client", () => {
  it.each(["thrown", "returned"])("clears only this cook/recipe after a %s success redirect", async (delivery) => {
    const response = redirect("/recipes");
    const result = deleteOnClient(async () => {
      if (delivery === "thrown") throw response;
      return response;
    });

    if (delivery === "thrown") await expect(result).rejects.toBe(response);
    else await expect(result).resolves.toBe(response);
    expect(window.localStorage.getItem(deletedKey)).toBeNull();
    expect(window.localStorage.getItem(deviceKey)).toBeNull();
    expectUnrelatedProgress();
  });

  it("does not clear signed-in entries when the page had device-only progress", async () => {
    await expect(deleteOnClient(async () => redirect("/recipes"), "delete", "")).resolves.toMatchObject({ status: 302 });
    expect(window.localStorage.getItem(deviceKey)).toBeNull();
    expect(window.localStorage.getItem(deletedKey)).toBe(pending);
    expectUnrelatedProgress();
  });

  it.each([400, 401, 403, 404, 412, 500])("keeps progress and propagates an unconfirmed %s error", async (status) => {
    const failure = new Response("Failed", { status });
    await expect(deleteOnClient(async () => { throw failure; })).rejects.toBe(failure);
    expectPendingProgress();
  });

  it("keeps progress and propagates a network error", async () => {
    const failure = new TypeError("Network unavailable");
    await expect(deleteOnClient(async () => { throw failure; })).rejects.toBe(failure);
    expectPendingProgress();
  });

  it("keeps progress when the server returns a retryable delete error", async () => {
    const failure = { intent: "delete", errorCode: "temporarily_unavailable", retryable: true };
    await expect(deleteOnClient(async () => failure)).resolves.toBe(failure);
    expectPendingProgress();
  });

  it.each(["/login", "/recipes/other", "/recipes?unrelated=true"])("does not treat a redirect to %s as confirmed deletion", async (location) => {
    const response = redirect(location);
    await expect(deleteOnClient(async () => { throw response; })).rejects.toBe(response);
    expectPendingProgress();
  });

  it("does not clear progress for another action that redirects to recipes", async () => {
    const response = redirect("/recipes");
    await expect(deleteOnClient(async () => { throw response; }, "fork")).rejects.toBe(response);
    expectPendingProgress();
  });

  it("still follows a confirmed redirect when localStorage is unavailable", async () => {
    const storage = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    const response = redirect("/recipes");
    try {
      await expect(deleteOnClient(async () => { throw response; })).rejects.toBe(response);
    } finally {
      storage.mockRestore();
    }
  });
});
