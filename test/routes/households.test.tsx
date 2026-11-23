import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest } from "undici";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRoutesStub } from "../utils";
import { createUserSessionCookie } from "~/lib/session.server";
import { migratedSqliteD1, type MigratedSqlite } from "../helpers/migrated-sqlite";
import HouseholdsIndex, { action as indexAction, loader as indexLoader, meta as indexMeta } from "~/routes/households._index";
import HouseholdPage, { action as householdAction, loader as householdLoader, meta as householdMeta } from "~/routes/households.$id";
import JoinPage, { action as joinAction, loader as joinLoader, meta as joinMeta } from "~/routes/join.$token";

let database: MigratedSqlite;
let flagsOn: Record<string, unknown>;
const cookies: Record<string, string> = {};

function addUser(id: string) {
  database.sqlite
    .prepare(`INSERT INTO "User" ("id", "email", "username") VALUES (?, ?, ?)`)
    .run(id, `${id}@example.com`, `${id}_cooks`);
}

type RouteArgs = { request: Request; params: Record<string, string>; context: { cloudflare: { env: unknown } } };
type Answer = { type?: string; data?: unknown; init?: { status?: number } } & Record<string, unknown>;

async function call(fn: (args: never) => Promise<unknown>, path: string, user: string | null, fields?: Record<string, string>, env = flagsOn) {
  const headers: Record<string, string> = {};
  if (user) headers.Cookie = cookies[user]!;
  const init: Record<string, unknown> = { headers };
  if (fields) {
    init.method = "POST";
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(fields).toString();
  }
  const request = new UndiciRequest(`http://localhost:3000${path}`, init);
  const params = Object.fromEntries(
    [...path.matchAll(/\/(households|join)\/([^/?]+)/g)].map((m) => [m[1] === "join" ? "token" : "id", m[2]]),
  );
  try {
    const args: RouteArgs = { request: request as unknown as Request, params, context: { cloudflare: { env } } };
    return (await fn(args as never)) as Answer | Response;
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

async function makeHousehold(name = "The Lee kitchen"): Promise<string> {
  const result = (await call(indexAction, "/households", "ann", { intent: "create", name })) as Response;
  return result.headers.get("Location")!.replace("/households/", "");
}

async function makeInvite(id: string, role = "member"): Promise<string> {
  const result = payload(await call(householdAction, `/households/${id}`, "ann", { intent: "invite", role }));
  return new URL(result.inviteUrl).pathname.replace("/join/", "");
}

beforeEach(async () => {
  database = migratedSqliteD1();
  flagsOn = { DB: database.binding, SPOONJOY_FLAGS: "households" };
  for (const id of ["ann", "ben", "cal"]) {
    addUser(id);
    cookies[id] = (await createUserSessionCookie(id, { DB: database.binding } as Parameters<typeof createUserSessionCookie>[1])).split(";")[0]!;
  }
});

afterEach(() => {
  cleanup();
  database.close();
});

describe("households flag", () => {
  it("hides every households page while the flag is off", async () => {
    const off = { DB: database.binding };
    expect(statusOf(await call(indexLoader, "/households", "ann", undefined, off))).toBe(404);
    expect(statusOf(await call(indexAction, "/households", "ann", { intent: "create", name: "x" }, off))).toBe(404);
    expect(statusOf(await call(householdLoader, "/households/h", "ann", undefined, off))).toBe(404);
    expect(statusOf(await call(householdAction, "/households/h", "ann", { intent: "leave" }, off))).toBe(404);
    expect(statusOf(await call(joinLoader, "/join/t", "ann", undefined, off))).toBe(404);
    expect(statusOf(await call(joinAction, "/join/t", "ann", {}, off))).toBe(404);
  });

  it("sends a signed-out visitor to sign in, and back to the invite after", async () => {
    const result = (await call(joinLoader, "/join/abc", null)) as Response;
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("/login?redirectTo=%2Fjoin%2Fabc");
  });

});

describe("/households", () => {
  it("titles the page", () => {
    expect(indexMeta()).toEqual([
      { title: "Households - Spoonjoy" },
      { name: "description", content: "Share recipes, shopping lists and a meal plan with the people you cook with." },
    ]);
  });

  it("creates a household and lists it with its owner's role", async () => {
    const id = await makeHousehold();
    expect(payload(await call(indexLoader, "/households", "ann"))).toEqual({
      households: [{ id, name: "The Lee kitchen", role: "owner", roleLabel: "Owner", memberCount: 1 }],
      maxNameLength: 80,
    });
  });

  it("says why a household can't be made, keeping the form", async () => {
    const result = await call(indexAction, "/households", "ann", { intent: "create", name: "  " });
    expect(statusOf(result)).toBe(400);
    expect(payload(result)).toEqual({ error: "Give the household a name." });
    expect(payload(await call(indexAction, "/households", "ann", { intent: "create" }))).toEqual({ error: "Give the household a name." });
    expect(payload(await call(indexAction, "/households", "ann", { intent: "dance" }))).toEqual({ error: "Unknown action." });
  });

  it("refuses a name the content filter blocks", async () => {
    const result = await call(indexAction, "/households", "ann", { intent: "create", name: "kkk kitchen" });
    expect(statusOf(result)).toBe(400);
  });

  it("shows an empty state, then the household list", async () => {
    const Stub = createTestRoutesStub([
      { path: "/households", Component: HouseholdsIndex, loader: () => ({ households: [], maxNameLength: 80 }) },
    ]);
    render(<Stub initialEntries={["/households"]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Cook together" })).toBeTruthy();
    expect(screen.getByText("No households yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create household" })).toBeTruthy();
    cleanup();

    const Listed = createTestRoutesStub([
      {
        path: "/households",
        Component: HouseholdsIndex,
        loader: () => ({
          households: [
            { id: "h1", name: "Home", role: "owner", roleLabel: "Owner", memberCount: 3 },
            { id: "h2", name: "Grandma's", role: "viewer", roleLabel: "View-only", memberCount: 1 },
          ],
          maxNameLength: 80,
        }),
        action: () => ({ error: "Give the household a name." }),
      },
    ]);
    render(<Listed initialEntries={["/households"]} />);
    const list = await screen.findByRole("list", { name: "Your households" });
    expect(within(list).getByRole("link", { name: /Home/ }).getAttribute("href")).toBe("/households/h1");
    expect(within(list).getByText("Owner · 3 people")).toBeTruthy();
    expect(within(list).getByText("View-only · 1 person")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Household name"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Create household" }));
    expect(await screen.findByText("Give the household a name.")).toBeTruthy();
  });
});

describe("/households/:id", () => {
  it("titles the page with the household's name", () => {
    expect(householdMeta({ data: { household: { name: "Home" } } } as unknown as Parameters<typeof householdMeta>[0])).toEqual([{ title: "Home - Spoonjoy" }]);
    expect(householdMeta({ data: undefined } as unknown as Parameters<typeof householdMeta>[0])).toEqual([{ title: "Household - Spoonjoy" }]);
  });

  it("shows a household to its members only", async () => {
    const id = await makeHousehold();
    const seen = payload(await call(householdLoader, `/households/${id}`, "ann"));
    expect(seen.household).toMatchObject({ id, name: "The Lee kitchen", myRole: "owner", canInvite: true, canManage: true });
    expect(seen.household.members).toEqual([
      { userId: "ann", username: "ann_cooks", photoUrl: null, role: "owner", roleLabel: "Owner", me: true },
    ]);
    expect(statusOf(await call(householdLoader, `/households/${id}`, "ben"))).toBe(404);
  });

  it("makes an invite link that joins someone, who then sees the household", async () => {
    const id = await makeHousehold();
    const token = await makeInvite(id, "viewer");
    const preview = payload(await call(joinLoader, `/join/${token}`, "ben"));
    expect(preview).toEqual({ invite: { householdName: "The Lee kitchen", role: "viewer", status: "usable" } });
    const joined = (await call(joinAction, `/join/${token}`, "ben", {})) as Response;
    expect(joined.headers.get("Location")).toBe(`/households/${id}`);
    const seen = payload(await call(householdLoader, `/households/${id}`, "ben"));
    expect(seen.household.myRole).toBe("viewer");
    expect(seen.household.canInvite).toBe(false);
    expect(seen.household.members.map((m: { username: string }) => m.username)).toEqual(["ann_cooks", "ben_cooks"]);
  });

  it("refuses an invite from a non-owner, and lets a member leave", async () => {
    const id = await makeHousehold();
    await call(joinAction, `/join/${await makeInvite(id)}`, "ben", {});
    const refused = await call(householdAction, `/households/${id}`, "ben", { intent: "invite", role: "member" });
    expect(statusOf(refused)).toBe(400);
    expect(payload(refused)).toEqual({ error: "Only an owner can invite people." });
    const owner = await call(householdAction, `/households/${id}`, "ann", { intent: "leave" });
    expect(payload(owner)).toEqual({ error: "Make someone else an owner before you leave." });
    const left = (await call(householdAction, `/households/${id}`, "ben", { intent: "leave" })) as Response;
    expect(left.headers.get("Location")).toBe("/households");
    expect(payload(await call(householdAction, `/households/${id}`, "ann", { intent: "dance" }))).toEqual({ error: "Unknown action." });
  });

  it("lets an owner change someone's role and remove them, and no one else", async () => {
    const id = await makeHousehold();
    await call(joinAction, `/join/${await makeInvite(id)}`, "ben", {});
    expect(payload(await call(householdLoader, `/households/${id}`, "ann")).household.canManage).toBe(true);
    expect(payload(await call(householdLoader, `/households/${id}`, "ben")).household.canManage).toBe(false);

    const changed = await call(householdAction, `/households/${id}`, "ann", { intent: "role", targetId: "ben", role: "viewer" });
    expect(payload(changed)).toEqual({ done: "role" });
    const seen = payload(await call(householdLoader, `/households/${id}`, "ann"));
    expect(seen.household.members.map((m: { userId: string; role: string }) => [m.userId, m.role])).toEqual([
      ["ann", "owner"],
      ["ben", "viewer"],
    ]);

    const refused = await call(householdAction, `/households/${id}`, "ben", { intent: "role", targetId: "ann", role: "viewer" });
    expect(statusOf(refused)).toBe(400);
    expect(payload(refused)).toEqual({ error: "Only an owner can change roles." });
    expect(payload(await call(householdAction, `/households/${id}`, "ben", { intent: "remove", targetId: "ann" }))).toEqual({
      error: "Only an owner can remove people.",
    });

    expect(payload(await call(householdAction, `/households/${id}`, "ann", { intent: "role", role: "viewer" }))).toEqual({
      error: "That person isn't in this household.",
    });
    expect(payload(await call(householdAction, `/households/${id}`, "ann", { intent: "remove" }))).toEqual({
      error: "That person isn't in this household.",
    });
    expect(payload(await call(householdAction, `/households/${id}`, "ann", { intent: "remove", targetId: "ben" }))).toEqual({ done: "removed" });
    expect(statusOf(await call(householdLoader, `/households/${id}`, "ben"))).toBe(404);
  });

  it("gives owners a menu on everyone else's row to change their role or remove them", async () => {
    const submitted: Array<Record<string, string>> = [];
    const Stub = createTestRoutesStub([
      {
        path: "/households/:id",
        Component: HouseholdPage,
        loader: () => ({
          household: {
            id: "h1",
            name: "Home",
            myRole: "owner",
            canInvite: true,
            canManage: true,
            roleChoices: [
              { value: "owner", label: "Owner" },
              { value: "member", label: "Member" },
              { value: "viewer", label: "View-only" },
            ],
            members: [
              { userId: "ann", username: "ann_cooks", photoUrl: null, role: "owner", roleLabel: "Owner", me: true },
              { userId: "ben", username: "ben_cooks", photoUrl: null, role: "member", roleLabel: "Member", me: false },
            ],
          },
        }),
        action: async ({ request }: { request: Request }) => {
          submitted.push(Object.fromEntries((await request.formData()) as unknown as Iterable<[string, string]>));
          return { done: "role" };
        },
      },
    ]);
    const user = userEvent.setup();
    render(<Stub initialEntries={["/households/h1"]} />);
    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(screen.queryByRole("button", { name: "Actions for ann_cooks" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Actions for ben_cooks" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "View-only" }));
    await vi.waitFor(() => expect(submitted).toEqual([{ intent: "role", targetId: "ben", role: "viewer" }]));

    // The menu comes back once the change is saved.
    await user.click(await screen.findByRole("button", { name: "Actions for ben_cooks" }));
    await user.click(await screen.findByRole("menuitem", { name: "Remove from household" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Remove ben_cooks?" });
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await vi.waitFor(() => expect(submitted[1]).toEqual({ intent: "remove", targetId: "ben" }));
  });

  it("shows a row saving until the server answers, then its role, and keeps the old role with the reason when refused", async () => {
    const server = { benRole: "member" as "member" | "viewer", refuse: false };
    let release: () => void = () => {};
    const labels = { owner: "Owner", member: "Member", viewer: "View-only" } as const;
    const Stub = createTestRoutesStub([
      {
        path: "/households/:id",
        Component: HouseholdPage,
        loader: () => ({
          household: {
            id: "h1",
            name: "Home",
            myRole: "owner",
            canInvite: false,
            canManage: true,
            roleChoices: [
              { value: "owner", label: "Owner" },
              { value: "member", label: "Member" },
              { value: "viewer", label: "View-only" },
            ],
            members: [
              { userId: "ann", username: "ann_cooks", photoUrl: null, role: "owner", roleLabel: "Owner", me: true },
              { userId: "ben", username: "ben_cooks", photoUrl: null, role: server.benRole, roleLabel: labels[server.benRole], me: false },
            ],
          },
        }),
        action: async ({ request }: { request: Request }) => {
          const role = (await request.formData()).get("role") as "member" | "viewer";
          await new Promise<void>((resolve) => (release = resolve));
          if (server.refuse) return { error: "Only an owner can change roles." };
          server.benRole = role;
          return { done: "role" };
        },
      },
    ]);
    const user = userEvent.setup();
    render(<Stub initialEntries={["/households/h1"]} />);
    await screen.findByRole("heading", { level: 1, name: "Home" });
    const people = () => screen.getByRole("list", { name: "People" });

    await user.click(screen.getByRole("button", { name: "Actions for ben_cooks" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "View-only" }));
    // While the server decides, the row says it's saving and still shows the role it has.
    expect(await within(people()).findByText("Saving")).toBeTruthy();
    expect(within(people()).getByText("Member")).toBeTruthy();
    expect(within(people()).queryByText("View-only")).toBeNull();
    expect(screen.queryByRole("button", { name: "Actions for ben_cooks" })).toBeNull();
    release();
    expect(await within(people()).findByText("View-only")).toBeTruthy();
    expect(within(people()).queryByText("Saving")).toBeNull();

    server.refuse = true;
    await user.click(await screen.findByRole("button", { name: "Actions for ben_cooks" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Member" }));
    expect(await within(people()).findByText("Saving")).toBeTruthy();
    release();
    expect(await screen.findByText("Only an owner can change roles.")).toBeTruthy();
    expect(within(people()).getByText("View-only")).toBeTruthy();
    expect(within(people()).queryByText("Saving")).toBeNull();
  });

  it("gives someone who can't manage people no member menus", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/households/:id",
        Component: HouseholdPage,
        loader: () => ({
          household: {
            id: "h1",
            name: "Home",
            myRole: "member",
            canInvite: false,
            canManage: false,
            members: [
              { userId: "ann", username: "ann_cooks", photoUrl: null, role: "owner", roleLabel: "Owner", me: false },
              { userId: "ben", username: "ben_cooks", photoUrl: null, role: "member", roleLabel: "Member", me: true },
            ],
          },
        }),
      },
    ]);
    render(<Stub initialEntries={["/households/h1"]} />);
    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(screen.queryByRole("button", { name: "Actions for ann_cooks" })).toBeNull();
  });

  it("shows people, the invite form for owners and a new link once", async () => {
    const household = {
      id: "h1",
      name: "Home",
      myRole: "owner",
      canInvite: true,
      members: [
        { userId: "ann", username: "ann_cooks", photoUrl: null, role: "owner", roleLabel: "Owner", me: true },
        { userId: "ben", username: "ben_cooks", photoUrl: "/photos/ben.jpg", role: "viewer", roleLabel: "View-only", me: false },
      ],
    };
    const Stub = createTestRoutesStub([
      {
        path: "/households/:id",
        Component: HouseholdPage,
        loader: () => ({ household }),
        action: () => ({ inviteUrl: "https://spoonjoy.app/join/tok", invitedAs: "as a member", inviteDays: 14 }),
      },
    ]);
    render(<Stub initialEntries={["/households/h1"]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Home" })).toBeTruthy();
    const people = screen.getByRole("list", { name: "People" });
    expect(within(people).getByText("ann_cooks (you)")).toBeTruthy();
    expect(within(people).getByText("View-only")).toBeTruthy();
    const shared = screen.getByRole("list", { name: "Shared" });
    expect(within(shared).getByRole("link", { name: /Shopping lists/ }).getAttribute("href")).toBe("/households/h1/lists");
    await userEvent.click(screen.getByRole("button", { name: "Make invite link" }));
    expect(await screen.findByDisplayValue("https://spoonjoy.app/join/tok")).toBeTruthy();
    expect(screen.getByText("Anyone with this link joins as a member. It works once, for 14 days.")).toBeTruthy();
  });

  it("hides the invite form from someone who can't invite, and shows an action's error", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/households/:id",
        Component: HouseholdPage,
        loader: () => ({
          household: {
            id: "h1",
            name: "Home",
            myRole: "member",
            canInvite: false,
            members: [{ userId: "ben", username: "ben_cooks", photoUrl: null, role: "member", roleLabel: "Member", me: true }],
          },
        }),
        action: () => ({ error: "Make someone else an owner before you leave." }),
      },
    ]);
    render(<Stub initialEntries={["/households/h1"]} />);
    await screen.findByRole("heading", { level: 1, name: "Home" });
    expect(screen.queryByRole("button", { name: "Make invite link" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Leave household" }));
    expect(await screen.findByText("Make someone else an owner before you leave.")).toBeTruthy();
  });
});

describe("/join/:token", () => {
  it("titles the page", () => {
    expect(joinMeta()).toEqual([{ title: "Join a household - Spoonjoy" }]);
  });

  it("says when a link doesn't work, and refuses to join with it", async () => {
    expect(payload(await call(joinLoader, "/join/nope", "ben"))).toEqual({ invite: null });
    const refused = await call(joinAction, "/join/nope", "ben", {});
    expect(statusOf(refused)).toBe(400);
    expect(payload(refused)).toEqual({ error: "This invite link doesn't work. Ask for a new one." });
  });

  it("offers to join, or says why it can't", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/join/:token",
        Component: JoinPage,
        loader: () => ({ invite: { householdName: "Home", role: "member", status: "usable" } }),
        action: () => ({ error: "This invite has already been used." }),
      },
    ]);
    render(<Stub initialEntries={["/join/t"]} />);
    expect(await screen.findByRole("heading", { level: 1, name: "Join Home" })).toBeTruthy();
    expect(screen.getByText("You'll join as a member: you can add to the shared lists and plan.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Join household" }));
    expect(await screen.findByText("This invite has already been used.")).toBeTruthy();
    cleanup();

    for (const [invite, text] of [
      [{ householdName: "Home", role: "viewer", status: "usable" }, "You'll join view-only: you can see what it shares."],
      [{ householdName: "Home", role: "member", status: "expired" }, "This invite has expired. Ask for a new one."],
      [{ householdName: "Home", role: "member", status: "revoked" }, "This invite was turned off. Ask for a new one."],
      [{ householdName: "Home", role: "member", status: "used" }, "This invite has already been used."],
      [null, "This invite link doesn't work. Ask for a new one."],
    ] as const) {
      const Page = createTestRoutesStub([{ path: "/join/:token", Component: JoinPage, loader: () => ({ invite }) }]);
      render(<Page initialEntries={["/join/t"]} />);
      expect(await screen.findByText(text)).toBeTruthy();
      cleanup();
    }
  });
});
