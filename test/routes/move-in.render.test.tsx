// The Move in page as a person sees it: the upload form, a move-in under way, and what arrived.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import MoveIn, { meta, type MoveInView } from "~/routes/move-in";

const MAX_BYTES = 50 * 1024 * 1024;

// The test DOM can't put a file in the form, so the browser's own check would stop it being sent: a test sets the
// states that follow a send here instead.
const routerState = vi.hoisted(() => ({ navigation: null as string | null, actionData: undefined as unknown }));
vi.mock("react-router", async (original) => {
  const actual = await original<typeof import("react-router")>();
  return {
    ...actual,
    useNavigation: () => (routerState.navigation ? { ...actual.useNavigation(), state: routerState.navigation } : actual.useNavigation()),
    useActionData: () => routerState.actionData ?? actual.useActionData(),
  };
});

function view(fields: Partial<MoveInView> = {}): MoveInView {
  return {
    jobId: "movein_1",
    status: "running",
    finished: false,
    archiveName: "mealie.zip",
    recipes: { found: 0, done: 0, created: 0, unchanged: 0, skipped: 0, failed: 0 },
    photos: { found: 0, in: 0 },
    failure: null,
    notes: [],
    runsOnServer: false,
    ...fields,
  };
}

function page(move: MoveInView | null, action: () => unknown = () => ({ error: null })) {
  const Stub = createTestRoutesStub([{ path: "/move-in", Component: MoveIn, loader: () => ({ move, maxBytes: MAX_BYTES }), action }]);
  render(<Stub initialEntries={["/move-in"]} />);
}

afterEach(() => {
  cleanup();
  routerState.navigation = null;
  routerState.actionData = undefined;
  vi.useRealTimers();
});

describe("the Move in page", () => {
  it("keeps itself out of search results", () => {
    expect(meta()).toEqual([{ title: "Move in - Spoonjoy" }, { name: "robots", content: "noindex" }]);
  });

  it("asks for a backup", async () => {
    page(null);
    expect(await screen.findByRole("heading", { level: 1, name: "Bring your kitchen with you." })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /^Mealie/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move in" })).toBeTruthy();
    expect(screen.queryByText("That backup didn't move in")).toBeNull();
  });

  it("says it is checking a backup on its way, and why one didn't move in", async () => {
    routerState.navigation = "submitting";
    routerState.actionData = { error: "That zip isn't a backup." };
    page(null);
    expect(await screen.findByRole("button", { name: "Checking the backup…" })).toBeTruthy();
    expect(screen.getByText("That zip isn't a backup.")).toBeTruthy();
  });

  it("offers the form again, with what went wrong, when a move-in failed", async () => {
    page(view({ status: "failed", finished: true, failure: "The backup is damaged." }));
    expect(await screen.findByText("The backup is damaged.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move in" })).toBeTruthy();
  });

  it("shows a move-in under way and keeps it going", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const action = vi.fn(() => ({ error: null }));
    page(view(), action);
    expect(await screen.findByRole("heading", { level: 2, name: "Moving in" })).toBeTruthy();
    expect(screen.getByText("Reading the backup…")).toBeTruthy();
    expect(screen.getByText("You can leave this page; the move carries on when you come back.")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    await vi.waitFor(() => expect(action).toHaveBeenCalled());
  });

  it("asks once at a time while a slow answer is on its way", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const action = vi.fn(() => new Promise(() => undefined));
    page(view(), action);
    await screen.findByRole("heading", { level: 2, name: "Moving in" });
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("counts recipes as they come in", async () => {
    page(view({ recipes: { found: 20, done: 1, created: 1, unchanged: 0, skipped: 0, failed: 0 } }));
    expect(await screen.findByText("1 of 20 recipes in so far.")).toBeTruthy();
  });

  it("shows what arrived, and what to look over", async () => {
    page(view({
      status: "done-with-issues",
      finished: true,
      recipes: { found: 4, done: 4, created: 1, unchanged: 1, skipped: 1, failed: 1 },
      photos: { found: 2, in: 1 },
      notes: [
        { seq: 1, level: "warn", message: "Soup moved in without its photo." },
        { seq: 2, level: "error", message: "Stew didn't move in this time." },
      ],
    }));
    expect(await screen.findByRole("heading", { level: 2, name: "1 recipe moved in" })).toBeTruthy();
    for (const [term, details] of [["Recipes moved in", "1"], ["Photos", "1 of 2"], ["Already here", "1"], ["Left out", "1"], ["Didn't move in", "1"]]) {
      expect(screen.getByText(term).nextElementSibling?.textContent).toBe(details);
    }
    const notes = screen.getByRole("heading", { level: 3, name: "What to look over" }).parentElement as HTMLElement;
    expect(within(notes).getByText("Soup moved in without its photo.")).toBeTruthy();
    expect(within(notes).getByText("Stew didn't move in this time.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See your recipes" }).getAttribute("href")).toBe("/my-recipes");
    expect(screen.getByRole("link", { name: "Move in another backup" }).getAttribute("href")).toBe("/move-in");
  });

  it("leaves out the rows with nothing to count", async () => {
    page(view({ status: "done", finished: true, recipes: { found: 2, done: 2, created: 2, unchanged: 0, skipped: 0, failed: 0 }, photos: { found: 1, in: 1 } }));
    expect(await screen.findByRole("heading", { level: 2, name: "2 recipes moved in" })).toBeTruthy();
    expect(screen.queryByText("Already here")).toBeNull();
  });

  it("says when nothing new came in", async () => {
    page(view({ status: "done", finished: true, recipes: { found: 2, done: 2, created: 0, unchanged: 2, skipped: 0, failed: 0 }, photos: { found: 0, in: 0 } }));
    expect(await screen.findByRole("heading", { level: 2, name: "Nothing new to move in" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: "What to look over" })).toBeNull();
    expect(screen.queryByText("Left out")).toBeNull();
  });
});
