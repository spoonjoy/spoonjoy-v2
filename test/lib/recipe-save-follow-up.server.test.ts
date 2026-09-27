// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAfterRecipeSave } from "~/lib/recipe-save-follow-up.server";

// Work that follows a committed recipe save never fails the save: a failure is logged, captured
// with the save's surface when PostHog is configured, and swallowed.

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

  it("logs and swallows a failure without an env to capture it with", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("queue down");

    await expect(runAfterRecipeSave(() => Promise.reject(error), {
      env: undefined, distinctId: "chef", request, surface: "recipe_create",
    })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("recipe save follow-up failed", { surface: "recipe_create", error });
  });

  it("logs a failure when PostHog is configured off", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const error = new Error("queue down");

    await runAfterRecipeSave(() => Promise.reject(error), {
      env: { POSTHOG_KEY: "ph_test", POSTHOG_DISABLED: "true" }, distinctId: "chef", request, surface: "recipe_edit",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("recipe save follow-up failed", { surface: "recipe_edit", error });
  });

  it("logs and captures a failure fire-and-forget when there is no waitUntil", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runAfterRecipeSave(() => Promise.reject(new Error("queue down")), {
      env: { POSTHOG_KEY: "ph_test" }, distinctId: "chef", request, surface: "recipe_edit",
    })).resolves.toBeUndefined();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(capturedExceptions(fetchMock)).toEqual([
      expect.objectContaining({ $exception_message: "queue down", surface: "recipe_edit", stage: "after_save" }),
    ]);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it("hands the capture to waitUntil when there is one", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const waitUntil = vi.fn();

    await runAfterRecipeSave(() => Promise.reject(new Error("queue down")), {
      env: { POSTHOG_KEY: "ph_test" }, waitUntil, distinctId: "chef", request, surface: "recipe_create",
    });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]![0];
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});
