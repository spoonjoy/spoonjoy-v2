// The Move in page as a person sees it: the upload form, a move-in under way, and what arrived.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createTestRoutesStub } from "../utils";
import MoveIn, { meta, type MoveInView } from "~/routes/move-in";

const UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;

// The upload in parts, held at each step the test lets it reach.
const sent = vi.hoisted(() => ({
  calls: [] as Array<{ file: File; app: string }>,
  run: null as null | ((options: { onProgress: (sent: number, total: number) => void; onChecking: () => void; signal: AbortSignal }) => Promise<unknown>),
}));
vi.mock("~/lib/move-in-upload", async (original) => ({
  ...(await original<typeof import("~/lib/move-in-upload")>()),
  uploadBackup: (file: File, options: { app: string; onProgress: (sent: number, total: number) => void; onChecking: () => void; signal: AbortSignal }) => {
    sent.calls.push({ file, app: options.app });
    return sent.run!(options);
  },
}));

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
    recipes: { found: 0, done: 0, created: 0, already: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 },
    photos: { found: 0, in: 0 },
    organizers: { tags: 0, categories: 0, tools: 0 },
    failure: null,
    notes: [],
    renamed: [],
    latest: [],
    runsOnServer: false,
    timeLeft: null,
    ...fields,
  };
}

function page(move: MoveInView | null, action: () => unknown = () => ({ error: null })) {
  const Stub = createTestRoutesStub([{ path: "/move-in", Component: MoveIn, loader: () => ({ move, uploadMaxBytes: UPLOAD_MAX_BYTES }), action }]);
  render(<Stub initialEntries={["/move-in"]} />);
}

afterEach(() => {
  cleanup();
  sent.calls.length = 0;
  sent.run = null;
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

  /** Puts `file` in the backup field, as the picker would, and presses Move in. */
  async function chooseAndSend(file: File | null) {
    const input = (await screen.findByLabelText(/^Backup zip/)) as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: file ? [file] : [] });
    input.required = false;
    await act(async () => {
      fireEvent.submit(input.form!);
    });
  }

  it("sends a backup in parts, says how much has been sent, then opens its move-in", async () => {
    let step!: { onProgress: (sent: number, total: number) => void; onChecking: () => void };
    let finish!: (outcome: unknown) => void;
    sent.run = (options) => {
      step = options;
      return new Promise((resolve) => (finish = resolve));
    };
    const moves: string[] = [];
    const Stub = createTestRoutesStub([{
      path: "/move-in",
      Component: MoveIn,
      loader: ({ request }: { request: Request }) => {
        const job = new URL(request.url).searchParams.get("job");
        if (job) moves.push(job);
        return { move: job ? view({ jobId: job }) : null, uploadMaxBytes: UPLOAD_MAX_BYTES };
      },
    }]);
    render(<Stub initialEntries={["/move-in"]} />);
    await chooseAndSend(new File([new Uint8Array(8)], "mealie.zip"));
    expect(sent.calls.map((call) => [call.file.name, call.app])).toEqual([["mealie.zip", "mealie"]]);
    // The count is in a live region, so a screen reader hears it as it changes.
    const status = () => (screen.getByText(/ sent$|^All of it arrived/) as HTMLElement).closest("[role=status]:not([data-ouro=spinner])");
    expect((await screen.findByText("0 MB of 0 MB sent")).closest("[role=status]")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Sending the backup…" }) as HTMLButtonElement).disabled).toBe(true);
    act(() => step.onProgress(84_000_000, 512_000_000));
    expect(within(status() as HTMLElement).getByText("84 MB of 512 MB sent")).toBeTruthy();
    act(() => step.onChecking());
    expect(within(status() as HTMLElement).getByText("All of it arrived. Checking the backup…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Checking the backup…" })).toBeTruthy();
    await act(async () => finish({ ok: true, jobId: "movein_9" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Moving in" })).toBeTruthy();
    expect(moves).toEqual(["movein_9"]);
  });

  it("says why a backup didn't move in, and offers the form again", async () => {
    sent.run = async () => ({ ok: false, error: "The connection dropped after 84 MB of 512 MB was sent." });
    page(null);
    await chooseAndSend(new File([new Uint8Array(8)], "mealie.zip"));
    expect(await screen.findByText("The connection dropped after 84 MB of 512 MB was sent.")).toBeTruthy();
    expect(screen.queryByText(/ sent$/)).toBeNull();
    expect((screen.getByRole("button", { name: "Move in" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("stops an upload on the cook's word, and goes back to the empty form saying so", async () => {
    let signal!: AbortSignal;
    sent.run = (options) => {
      signal = options.signal;
      return new Promise((resolve) =>
        signal.addEventListener("abort", () => resolve({ ok: false, stopped: true, error: "The upload was stopped, and nothing of it was kept. Choose a backup to start again." })),
      );
    };
    page(null);
    await chooseAndSend(new File([new Uint8Array(8)], "mealie.zip"));
    const stop = await screen.findByRole("button", { name: "Stop upload" });
    expect(signal.aborted).toBe(false);
    await act(async () => fireEvent.click(stop));
    expect(signal.aborted).toBe(true);
    expect(await screen.findByText("Upload stopped")).toBeTruthy();
    expect(screen.getByText("The upload was stopped, and nothing of it was kept. Choose a backup to start again.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop upload" })).toBeNull();
    expect(screen.queryByText(/ sent$/)).toBeNull();
    expect(screen.queryByText("That backup didn't move in")).toBeNull();
    expect((screen.getByRole("button", { name: "Move in" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("hides Stop upload once every part has arrived and the backup is being checked", async () => {
    let step!: { onChecking: () => void };
    sent.run = (options) => {
      step = options;
      return new Promise(() => undefined);
    };
    page(null);
    await chooseAndSend(new File([new Uint8Array(8)], "mealie.zip"));
    expect(await screen.findByRole("button", { name: "Stop upload" })).toBeTruthy();
    act(() => step.onChecking());
    expect(screen.queryByRole("button", { name: "Stop upload" })).toBeNull();
  });

  it("leaves a send with no file to the form, which says to choose one", async () => {
    const action = vi.fn(() => ({ error: "Choose your backup's .zip file first, then press Move in." }));
    page(null, action);
    await chooseAndSend(null);
    await vi.waitFor(() => expect(action).toHaveBeenCalled());
    expect(sent.calls).toEqual([]);
  });

  it("leaves the backup to the plain form on a page that isn't secure, where it can't tell files apart", async () => {
    vi.stubGlobal("crypto", {});
    const action = vi.fn(() => ({ error: null }));
    page(null, action);
    await chooseAndSend(new File([new Uint8Array(8)], "mealie.zip"));
    await vi.waitFor(() => expect(action).toHaveBeenCalled());
    expect(sent.calls).toEqual([]);
    vi.unstubAllGlobals();
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

  it("says the page can be closed when the move-in runs on the server", async () => {
    page(view({ runsOnServer: true }));
    expect(await screen.findByText("You can close this page; your recipes keep moving in without it.")).toBeTruthy();
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

  it("shows the newest recipes in as they arrive, each with its photo when it has one", async () => {
    page(view({
      recipes: { found: 20, done: 12, created: 12, already: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 },
      latest: [
        { id: "r12", title: "Lemon pie", photoUrl: "/photos/covers/import/movein-r12.webp" },
        { id: "r11", title: "Stew", photoUrl: null },
      ],
    }));
    expect(await screen.findByText("12 of 20 recipes in so far.")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Just moved in" });
    const pie = within(list).getByRole("link", { name: "Lemon pie" });
    expect(pie.getAttribute("href")).toBe("/recipes/r12");
    expect(pie.closest("li")?.querySelector("img")?.getAttribute("src")).toBe("/photos/covers/import/movein-r12.webp");
    expect(within(list).getByRole("link", { name: "Stew" }).closest("li")?.querySelector("img")).toBeNull();
  });

  it("holds a recipe's place with a muted tile the size of a photo until its photo is in", async () => {
    page(view({
      recipes: { found: 20, done: 2, created: 2, already: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 },
      latest: [{ id: "r12", title: "Lemon pie", photoUrl: "/photos/covers/import/movein-r12.webp" }, { id: "r11", title: "Stew", photoUrl: null }],
    }));
    const list = await screen.findByRole("list", { name: "Just moved in" });
    const fill = within(list).getByRole("link", { name: "Stew" }).closest("li")?.querySelector("svg")?.parentElement;
    const tile = fill?.parentElement;
    const photo = within(list).getByRole("link", { name: "Lemon pie" }).closest("li")?.querySelector("img")?.parentElement;
    // The photo's own slot, so the same 40px and the same corner radius as a photo, filled muted and hidden from
    // screen readers, which hear the title. (Journeys reads the computed radii in a real browser.)
    expect(tile?.className).toBe(photo?.className);
    expect(photo?.className).toContain("size-ouro-10");
    expect(photo?.className).toContain("rounded-ouro-md");
    expect(fill?.className).toContain("bg-muted");
    expect(fill?.getAttribute("aria-hidden")).toBe("true");
  });

  it("leaves the list out until a recipe is in", async () => {
    page(view());
    await screen.findByRole("heading", { level: 2, name: "Moving in" });
    expect(screen.queryByRole("list", { name: "Just moved in" })).toBeNull();
  });

  it("asks less often while a server-side move-in shows no change, and not at all while the page is hidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const action = vi.fn(() => ({ error: null }));
    page(view({ runsOnServer: true }), action);
    await screen.findByRole("heading", { level: 2, name: "Moving in" });
    // 3 s, then 6 s more, then 12 s more while nothing changes.
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(action).toHaveBeenCalledTimes(2);
    // Back in view, it asks at once.
    hidden.mockRestore();
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(3));
    // A change of view that leaves it hidden asks nothing.
    const stillHidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    expect(action).toHaveBeenCalledTimes(3);
    stillHidden.mockRestore();
  });

  it("starts the pace over when the backup has been read and its recipes are counted", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const action = vi.fn(() => ({ error: null }));
    let move = view({ runsOnServer: true });
    const Stub = createTestRoutesStub([{ path: "/move-in", Component: MoveIn, loader: () => ({ move, uploadMaxBytes: UPLOAD_MAX_BYTES }), action }]);
    render(<Stub initialEntries={["/move-in"]} />);
    await screen.findByText("Reading the backup…");
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    // The next ask, 6 s on, finds the backup read: 500 recipes found, none in yet.
    move = view({ runsOnServer: true, recipes: { ...view().recipes, found: 500 } });
    await act(async () => vi.advanceTimersByTimeAsync(6_000));
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(2));
    await screen.findByText("0 of 500 recipes in so far.");
    // So it asks again 3 s later, not 12.
    await act(async () => vi.advanceTimersByTimeAsync(3_500));
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(3));
  });

  it("keeps asking at the same pace, seen or not, when the page is what keeps the move-in going", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const action = vi.fn(() => ({ error: null }));
    page(view(), action);
    await screen.findByRole("heading", { level: 2, name: "Moving in" });
    await act(async () => vi.advanceTimersByTimeAsync(9_500));
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(3));
    // Out of sight too, since nothing else moves it along.
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(4));
    hidden.mockRestore();
  });

  it("counts recipes as they come in", async () => {
    page(view({ recipes: { found: 20, done: 1, created: 1, already: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 } }));
    expect(await screen.findByText("1 of 20 recipes in so far.")).toBeTruthy();
    expect(screen.queryByText(/left$/)).toBeNull();
  });

  it("says how long is left under the count, for anyone listening to the status too", async () => {
    page(view({ recipes: { found: 500, done: 84, created: 84, already: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 }, timeLeft: "About 6 minutes left" }));
    const line = await screen.findByText("About 6 minutes left");
    expect(line.closest("[role=status]")?.textContent).toContain("84 of 500 recipes in so far.");
  });

  it("shows what arrived, and what to look over", async () => {
    page(view({
      status: "done-with-issues",
      finished: true,
      recipes: { found: 5, done: 5, created: 1, already: 2, updated: 1, unchanged: 1, skipped: 1, failed: 1 },
      photos: { found: 2, in: 1 },
      notes: [
        { seq: 1, level: "warn", message: "Soup moved in without its photo." },
        { seq: 2, level: "error", message: "Stew didn't move in this time." },
        { seq: 3, level: "info", message: "Pie changed in the backup, but you've changed it in Spoonjoy too, so your version stays." },
      ],
      renamed: [{ seq: 4, message: 'You already had a recipe called "Soup", so this one is "Soup (2)".' }],
    }));
    expect(await screen.findByRole("heading", { level: 2, name: "1 recipe moved in" })).toBeTruthy();
    expect(screen.getByText("2 already here, 1 changed.")).toBeTruthy();
    expect(screen.queryByText("Already here")).toBeNull();
    for (const [term, details] of [["Recipes moved in", "1"], ["Photos", "1 of 2"], ["Left out", "1"], ["Didn't move in", "1"]]) {
      expect(screen.getByText(term).nextElementSibling?.textContent).toBe(details);
    }
    const notes = screen.getByRole("heading", { level: 3, name: "What to look over" }).parentElement as HTMLElement;
    expect(within(notes).getByText("Soup moved in without its photo.")).toBeTruthy();
    expect(within(notes).getByText("Stew didn't move in this time.")).toBeTruthy();
    expect(within(notes).getByText(/so your version stays\.$/)).toBeTruthy();
    // Renamed recipes fold into one line the cook can open, apart from what to look over.
    const renamed = screen.getByRole("button", { name: "1 recipe got a number, because you already had one by that name" });
    expect(within(notes).queryByText(/this one is "Soup \(2\)"/)).toBeNull();
    await act(async () => renamed.click());
    expect(await screen.findByText('You already had a recipe called "Soup", so this one is "Soup (2)".')).toBeTruthy();
    expect(screen.getByRole("link", { name: "See your recipes" }).getAttribute("href")).toBe("/my-recipes");
    expect(screen.getByRole("link", { name: "Move in another backup" }).getAttribute("href")).toBe("/move-in");
  });

  it("leaves out the rows with nothing to count", async () => {
    page(view({ status: "done", finished: true, recipes: { found: 2, done: 2, created: 2, already: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 }, photos: { found: 1, in: 1 } }));
    expect(await screen.findByRole("heading", { level: 2, name: "2 recipes moved in" })).toBeTruthy();
    expect(screen.queryByText(/already here/)).toBeNull();
    expect(screen.queryByRole("button", { name: /got a number/ })).toBeNull();
  });

  it("counts the tags, categories and tools that came over with the recipes", async () => {
    page(view({
      status: "done",
      finished: true,
      recipes: { found: 20, done: 20, created: 20, already: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 },
      photos: { found: 20, in: 20 },
      organizers: { tags: 8, categories: 6, tools: 0 },
    }));
    expect(await screen.findByRole("heading", { level: 2, name: "20 recipes moved in" })).toBeTruthy();
    for (const [term, details] of [["Recipes moved in", "20"], ["Photos", "20 of 20"], ["Tags", "8"], ["Categories", "6"]]) {
      expect(screen.getByText(term).nextElementSibling?.textContent).toBe(details);
    }
    expect(screen.queryByText("Tools")).toBeNull();
  });

  it("says when everything was already here", async () => {
    page(view({ status: "done", finished: true, recipes: { found: 2, done: 2, created: 0, already: 2, updated: 0, unchanged: 2, skipped: 0, failed: 0 }, photos: { found: 0, in: 0 }, organizers: { tags: 1, categories: 1, tools: 1 } }));
    expect(await screen.findByRole("heading", { level: 2, name: "Everything was already here" })).toBeTruthy();
    expect(screen.getByText("2 already here, 0 changed.")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 3, name: "What to look over" })).toBeNull();
    expect(screen.queryByText("Left out")).toBeNull();
    // Nothing moved, so no counts that read as if recipes or photos did.
    expect(screen.queryByText("Recipes moved in")).toBeNull();
    expect(screen.queryByText("Photos")).toBeNull();
    expect(document.querySelector("dl")).toBeNull();
    expect(screen.getByRole("link", { name: "See your recipes" })).toBeTruthy();
  });

  it("keeps the counts when a recipe already here changed", async () => {
    page(view({ status: "done", finished: true, recipes: { found: 2, done: 2, created: 0, already: 2, updated: 1, unchanged: 1, skipped: 0, failed: 0 }, photos: { found: 2, in: 2 } }));
    expect(await screen.findByRole("heading", { level: 2, name: "Everything was already here" })).toBeTruthy();
    expect(screen.getByText("2 already here, 1 changed.")).toBeTruthy();
    expect(screen.getByText("Recipes moved in").nextElementSibling?.textContent).toBe("0");
    expect(screen.getByText("Photos").nextElementSibling?.textContent).toBe("2 of 2");
  });

  it("says when nothing new came in", async () => {
    page(view({ status: "done", finished: true, recipes: { found: 1, done: 1, created: 0, already: 0, updated: 0, unchanged: 0, skipped: 1, failed: 0 }, photos: { found: 0, in: 0 } }));
    expect(await screen.findByRole("heading", { level: 2, name: "Nothing new to move in" })).toBeTruthy();
    expect(screen.queryByText(/already here/)).toBeNull();
    expect(screen.getByText("Left out").nextElementSibling?.textContent).toBe("1");
  });
});
