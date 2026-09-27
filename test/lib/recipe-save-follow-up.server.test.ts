// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAfterRecipeSave } from "~/lib/recipe-save-follow-up.server";

// Work that follows a committed recipe save never fails the save: a failure is captured with
// the save's surface and swallowed.

const request = new Request("https://spoonjoy.test/recipes/new?draft=1", { method: "POST" });

function capturedExceptions(fetchMock: ReturnType<typeof vi.spyOn>) {
  return fetchMock.mock.calls
    .map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body)) as { event: string; properties: Record<string, unknown> })
    .filter((payload) => payload.event === "$exception")
    .map((payload) => payload.properties);
}

describe("runAfterRecipeSave", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the follow-up and captures nothing when it succeeds", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const followUp = vi.fn().mockResolvedValue(undefined);

    await runAfterRecipeSave(followUp, { env: { POSTHOG_KEY: "ph_test" }, distinctId: "chef", request, surface: "recipe_create" });

    expect(followUp).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("swallows a failure without an env to capture it with", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(runAfterRecipeSave(() => Promise.reject(new Error("queue down")), {
      env: undefined, distinctId: "chef", request, surface: "recipe_create",
    })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("captures a failure fire-and-forget when there is no waitUntil", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await expect(runAfterRecipeSave(() => Promise.reject(new Error("queue down")), {
      env: { POSTHOG_KEY: "ph_test" }, distinctId: "chef", request, surface: "recipe_edit",
    })).resolves.toBeUndefined();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(capturedExceptions(fetchMock)).toEqual([
      expect.objectContaining({ $exception_message: "queue down", surface: "recipe_edit", stage: "after_save" }),
    ]);
  });

  it("hands the capture to waitUntil when there is one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const waitUntil = vi.fn();

    await runAfterRecipeSave(() => Promise.reject(new Error("queue down")), {
      env: { POSTHOG_KEY: "ph_test" }, waitUntil, distinctId: "chef", request, surface: "recipe_create",
    });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]![0];
  });
});
