import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRoutesStub } from "../utils";
import { createUserSessionCookie } from "~/lib/session.server";
import { migratedSqliteD1, type MigratedSqlite } from "../helpers/migrated-sqlite";
import ListsPage, { action as listsAction, loader as listsLoader, meta as listsMeta } from "~/routes/households.$id.lists._index";
import ListPage, { action as listAction, loader as listLoader, meta as listMeta } from "~/routes/households.$id.lists.$listId";

let database: MigratedSqlite;
let env: Record<string, unknown>;
const cookies: Record<string, string> = {};

type Answer = { type?: string; data?: unknown; init?: { status?: number } } & Record<string, unknown>;

async function call(
  fn: (args: never) => Promise<unknown>,
  params: Record<string, string>,
  user: string,
  fields?: Record<string, string>,
  using = env,
) {
  const init: Record<string, unknown> = { headers: { Cookie: cookies[user]! } };
  if (fields) {
    init.method = "POST";
    (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(fields).toString();
  }
  const path = params.listId ? `/households/${params.id}/lists/${params.listId}` : `/households/${params.id}/lists`;
  const request = new UndiciRequest(`http://localhost:3000${path}`, init) as unknown as Request;
  try {
    return (await fn({ request, params, context: { cloudflare: { env: using } } } as never)) as Answer | Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

// oxlint-disable-next-line typescript/no-explicit-any -- assertions read whatever shape each route returns
function payload(result: unknown): any {
  const answer = result as Answer;
  return answer?.type === "DataWithResponseInit" ? answer.data : answer;
}

function statusOf(result: unknown): number {
  if (result instanceof Response) return result.status;
  const answer = result as Answer;
  return answer?.type === "DataWithResponseInit" ? (answer.init?.status ?? 200) : 200;
}

const run = (sql: string) => database.sqlite.prepare(sql).run();

beforeEach(async () => {
  database = migratedSqliteD1();
  env = { DB: database.binding, SPOONJOY_FLAGS: "households" };
  for (const id of ["ann", "ben", "cal", "dee"]) {
    run(`INSERT INTO "User" ("id", "email", "username") VALUES ('${id}', '${id}@example.com', '${id}_cooks')`);
    cookies[id] = (await createUserSessionCookie(id, { DB: database.binding } as Parameters<typeof createUserSessionCookie>[1])).split(";")[0]!;
  }
  run(`INSERT INTO "Household" ("id", "name") VALUES ('h1', 'The Lee kitchen')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role") VALUES ('h1', 'ann', 'owner')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role") VALUES ('h1', 'ben', 'member')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role") VALUES ('h1', 'cal', 'viewer')`);
});

afterEach(() => {
  cleanup();
  database.close();
});

async function makeList(user = "ann", name = "Groceries"): Promise<string> {
  const made = (await call(listsAction, { id: "h1" }, user, { intent: "create", name })) as Response;
  return made.headers.get("Location")!.split("/").pop()!;
}

describe("/households/:id/lists", () => {
  it("hides the pages while the households flag is off, and from people outside the household", async () => {
    const off = { DB: database.binding };
    expect(statusOf(await call(listsLoader, { id: "h1" }, "ann", undefined, off))).toBe(404);
    expect(statusOf(await call(listsAction, { id: "h1" }, "ann", { intent: "create", name: "x" }, off))).toBe(404);
    expect(statusOf(await call(listLoader, { id: "h1", listId: "l" }, "ann", undefined, off))).toBe(404);
    expect(statusOf(await call(listAction, { id: "h1", listId: "l" }, "ann", { intent: "add", text: "x" }, off))).toBe(404);
    expect(statusOf(await call(listsLoader, { id: "h1" }, "dee"))).toBe(404);
    const listId = await makeList();
    expect(statusOf(await call(listLoader, { id: "h1", listId }, "dee"))).toBe(404);
  });

  it("makes a list, opens it, and lists it for everyone in the household", async () => {
    const listId = await makeList("ben");
    expect(payload(await call(listsLoader, { id: "h1" }, "cal"))).toEqual({
      household: { id: "h1", name: "The Lee kitchen" },
      canEdit: false,
      lists: [{ id: listId, name: "Groceries", itemCount: 0, openCount: 0 }],
    });
    expect(payload(await call(listsLoader, { id: "h1" }, "ben")).canEdit).toBe(true);
    expect(listsMeta({ data: { household: { name: "The Lee kitchen" } } } as never)).toEqual([{ title: "Shopping lists - The Lee kitchen - Spoonjoy" }]);
    expect(listsMeta({ data: undefined } as never)).toEqual([{ title: "Shopping lists - Spoonjoy" }]);
  });

  it("says why a list can't be made", async () => {
    const viewOnly = await call(listsAction, { id: "h1" }, "cal", { intent: "create", name: "Mine" });
    expect(statusOf(viewOnly)).toBe(400);
    expect(payload(viewOnly)).toEqual({ error: "View-only members can't change shared lists." });
    expect(payload(await call(listsAction, { id: "h1" }, "ann", { intent: "dance" }))).toEqual({ error: "Unknown action." });
  });

  it("adds, checks off and removes items, and deletes the list", async () => {
    const listId = await makeList();
    const at = { id: "h1", listId };
    expect(payload(await call(listAction, at, "ben", { intent: "add", text: "eggs" }))).toEqual({ done: "added" });
    const itemId = payload(await call(listLoader, at, "ann")).list.items[0].id;
    expect(payload(await call(listAction, at, "ben", { intent: "check", itemId, checked: "true" }))).toEqual({ done: "checked" });
    expect(payload(await call(listLoader, at, "cal"))).toEqual({
      household: { id: "h1", name: "The Lee kitchen" },
      list: { id: listId, name: "Groceries", canEdit: false, items: [{ id: itemId, text: "eggs", checked: true, addedBy: "ben_cooks" }] },
    });
    expect(payload(await call(listAction, at, "ben", { intent: "check", itemId, checked: "false" }))).toEqual({ done: "checked" });
    expect(payload(await call(listLoader, at, "ann")).list.items[0].checked).toBe(false);

    expect(payload(await call(listAction, at, "cal", { intent: "add", text: "cake" }))).toEqual({ error: "View-only members can't change shared lists." });
    expect(payload(await call(listAction, at, "cal", { intent: "check", itemId, checked: "true" }))).toEqual({ error: "View-only members can't change shared lists." });
    expect(payload(await call(listAction, at, "cal", { intent: "remove", itemId }))).toEqual({ error: "View-only members can't change shared lists." });
    expect(payload(await call(listAction, at, "cal", { intent: "delete" }))).toEqual({ error: "View-only members can't change shared lists." });
    expect(payload(await call(listAction, at, "ann", { intent: "dance" }))).toEqual({ error: "Unknown action." });

    expect(payload(await call(listAction, at, "ann", { intent: "remove", itemId }))).toEqual({ done: "removed" });
    expect(payload(await call(listLoader, at, "ann")).list.items).toEqual([]);
    const deleted = (await call(listAction, at, "ann", { intent: "delete" })) as Response;
    expect(deleted.headers.get("Location")).toBe("/households/h1/lists");
    expect(statusOf(await call(listLoader, at, "ann"))).toBe(404);
    expect(listMeta({ data: { list: { name: "Groceries" } } } as never)).toEqual([{ title: "Groceries - Spoonjoy" }]);
    expect(listMeta({ data: undefined } as never)).toEqual([{ title: "Shopping list - Spoonjoy" }]);
  });
});

describe("household list pages", () => {
  it("shows a household's lists, an empty state, and the new-list form only to people who can edit", async () => {
    const lists = [{ id: "l1", name: "Groceries", itemCount: 3, openCount: 2 }];
    const Stub = createTestRoutesStub([
      { path: "/households/:id/lists", Component: ListsPage, loader: () => ({ household: { id: "h1", name: "Home" }, canEdit: true, lists }) },
    ]);
    render(<Stub initialEntries={["/households/h1/lists"]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Shopping lists" })).toBeTruthy();
    const group = screen.getByRole("list", { name: "Shopping lists" });
    expect(within(group).getByRole("link", { name: /Groceries/ }).getAttribute("href")).toBe("/households/h1/lists/l1");
    expect(within(group).getByText("2 to get · 3 items")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "List name" })).toBeTruthy();
    cleanup();

    const Refused = createTestRoutesStub([
      {
        path: "/households/:id/lists",
        Component: ListsPage,
        loader: () => ({ household: { id: "h1", name: "Home" }, canEdit: true, lists: [{ id: "l2", name: "Party", itemCount: 1, openCount: 1 }] }),
        action: () => ({ error: "Give the list a name." }),
      },
    ]);
    const user = userEvent.setup();
    render(<Refused initialEntries={["/households/h1/lists"]} />);
    expect(await screen.findByText("1 to get · 1 item")).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: "List name" }), "x");
    await user.click(screen.getByRole("button", { name: "Make list" }));
    expect(await screen.findByText("Give the list a name.")).toBeTruthy();
    cleanup();

    const Empty = createTestRoutesStub([
      { path: "/households/:id/lists", Component: ListsPage, loader: () => ({ household: { id: "h1", name: "Home" }, canEdit: false, lists: [] }) },
    ]);
    render(<Empty initialEntries={["/households/h1/lists"]} />);
    expect(await screen.findByText("No shared lists yet")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "List name" })).toBeNull();
  });

  it("ticks an item at once, and shows what the server kept once it answers", async () => {
    let release: () => void = () => {};
    const server = { checked: false };
    const Stub = createTestRoutesStub([
      {
        path: "/households/:id/lists/:listId",
        Component: ListPage,
        loader: () => ({
          household: { id: "h1", name: "Home" },
          list: { id: "l1", name: "Groceries", canEdit: true, items: [{ id: "i1", text: "eggs", checked: server.checked, addedBy: null }] },
        }),
        action: async () => {
          await new Promise<void>((resolve) => (release = resolve));
          return { error: "View-only members can't change shared lists." };
        },
      },
    ]);
    const user = userEvent.setup();
    render(<Stub initialEntries={["/households/h1/lists/l1"]} />);
    const box = () => screen.getByRole("checkbox", { name: "eggs" });
    await screen.findByRole("heading", { level: 1, name: "Groceries" });
    await user.click(box());
    await vi.waitFor(() => expect(box().getAttribute("aria-checked")).toBe("true"));
    // Refused: the next load still has it unticked, and the tick goes.
    await act(async () => release());
    await vi.waitFor(() => expect(box().getAttribute("aria-checked")).toBe("false"));
  });

  it("lets a member check items off, remove them and delete the list, and shows view-only members the items alone", async () => {
    const submitted: Record<string, string>[] = [];
    const items = [
      { id: "i1", text: "eggs", checked: false, addedBy: "ben_cooks" },
      { id: "i2", text: "milk", checked: true, addedBy: null },
    ];
    const Stub = createTestRoutesStub([
      {
        path: "/households/:id/lists/:listId",
        Component: ListPage,
        loader: () => ({ household: { id: "h1", name: "Home" }, list: { id: "l1", name: "Groceries", canEdit: true, items } }),
        action: async ({ request }: { request: Request }) => {
          const fields = Object.fromEntries(await request.formData()) as Record<string, string>;
          submitted.push(fields);
          return fields.text === "bread" ? { error: "Keep it under 200 characters." } : { done: "ok" };
        },
      },
    ]);
    const user = userEvent.setup();
    render(<Stub initialEntries={["/households/h1/lists/l1"]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Groceries" })).toBeTruthy();
    expect(screen.getByText("Added by ben_cooks")).toBeTruthy();
    await user.click(screen.getByRole("checkbox", { name: "eggs" }));
    await screen.findByRole("checkbox", { name: "eggs" });
    expect(submitted[0]).toEqual({ intent: "check", itemId: "i1", checked: "true" });
    await user.click(screen.getByRole("button", { name: "Remove milk" }));
    expect(submitted[1]).toEqual({ intent: "remove", itemId: "i2" });
    await user.type(screen.getByRole("textbox", { name: "Add an item" }), "bread");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(submitted[2]).toEqual({ intent: "add", text: "bread" });
    expect(await screen.findByText("Keep it under 200 characters.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Delete list" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Delete Groceries?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(submitted[3]).toEqual({ intent: "delete" });
    cleanup();

    const ViewOnly = createTestRoutesStub([
      {
        path: "/households/:id/lists/:listId",
        Component: ListPage,
        loader: () => ({ household: { id: "h1", name: "Home" }, list: { id: "l1", name: "Groceries", canEdit: false, items: [items[0]] } }),
      },
    ]);
    render(<ViewOnly initialEntries={["/households/h1/lists/l1"]} />);
    expect((await screen.findByRole("checkbox", { name: "eggs" })).getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByRole("button", { name: "Remove eggs" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Add an item" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete list" })).toBeNull();
  });
});
