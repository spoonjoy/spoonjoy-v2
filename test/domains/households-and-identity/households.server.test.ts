// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptInvite,
  changeMemberRole,
  createHousehold,
  createInvite,
  getHousehold,
  householdChefIdsFor,
  leave,
  listHouseholds,
  previewInvite,
  removeFromHousehold,
  renameHousehold,
  revokeInvite,
} from "~/domains/households-and-identity/application/households.server";
import { d1HouseholdStore } from "~/domains/households-and-identity/adapters/d1-household-store.server";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";

let database: MigratedSqlite;
let store: ReturnType<typeof d1HouseholdStore>;
const now = new Date("2026-11-23T12:00:00.000Z");

function addUser(id: string) {
  database.sqlite
    .prepare(`INSERT INTO "User" ("id", "email", "username") VALUES (?, ?, ?)`)
    .run(id, `${id}@example.com`, `${id}_cooks`);
}

async function homeOf(ownerId: string, name = "The Lee kitchen") {
  const made = await createHousehold(store, { userId: ownerId, name, now });
  if (!made.ok) throw new Error(made.error);
  return made.value.id;
}

async function inviteInto(householdId: string, input: Record<string, unknown> = {}) {
  const made = await createInvite(store, { householdId, userId: "ann", input, now });
  if (!made.ok) throw new Error(made.error);
  return made.value;
}

beforeEach(() => {
  database = migratedSqliteD1();
  store = d1HouseholdStore(database.binding);
  for (const id of ["ann", "ben", "cal", "dee"]) addUser(id);
});

afterEach(() => database.close());

describe("creating and listing households", () => {
  it("makes the creator its owner and lists it for them only", async () => {
    const id = await homeOf("ann");
    expect(await listHouseholds(store, "ann")).toEqual([{ id, name: "The Lee kitchen", role: "owner", memberCount: 1 }]);
    expect(await listHouseholds(store, "ben")).toEqual([]);
  });

  it("refuses a household without a name", async () => {
    expect(await createHousehold(store, { userId: "ann", name: " ", now })).toEqual({
      ok: false,
      error: "Give the household a name.",
    });
  });

  it("lets one person belong to several households", async () => {
    const first = await homeOf("ann", "Home");
    const second = await homeOf("ann", "Grandma's");
    expect((await listHouseholds(store, "ann")).map((h) => h.id).sort()).toEqual([first, second].sort());
  });
});

describe("invites", () => {
  it("joins someone with a link, once, as the role the invite carries", async () => {
    const id = await homeOf("ann");
    const { token, invite } = await inviteInto(id, { role: "viewer" });
    expect(invite).toMatchObject({ role: "viewer", usesLeft: 1, email: null });
    expect(await previewInvite(store, token, now)).toEqual({ householdName: "The Lee kitchen", role: "viewer", status: "usable" });
    expect(await acceptInvite(store, { token, userId: "ben", userEmail: "ben@example.com", now })).toEqual({
      ok: true,
      value: { householdId: id, joined: true },
    });
    expect(await previewInvite(store, token, now)).toMatchObject({ status: "used" });
    expect(await acceptInvite(store, { token, userId: "cal", userEmail: "cal@example.com", now })).toEqual({
      ok: false,
      error: "This invite has already been used.",
    });
    const home = await getHousehold(store, id, "ben");
    expect(home?.members.map((m) => [m.username, m.role])).toEqual([
      ["ann_cooks", "owner"],
      ["ben_cooks", "viewer"],
    ]);
  });

  it("doesn't spend a use when a member opens the link again", async () => {
    const id = await homeOf("ann");
    const { token } = await inviteInto(id, { uses: 2 });
    expect(await acceptInvite(store, { token, userId: "ann", userEmail: "ann@example.com", now })).toEqual({
      ok: true,
      value: { householdId: id, joined: false },
    });
    expect((await getHousehold(store, id, "ann"))?.invites[0]?.usesLeft).toBe(2);
  });

  it("works only for the address an email invite was sent to", async () => {
    const id = await homeOf("ann");
    const { token } = await inviteInto(id, { email: "Ben@Example.com" });
    expect(await acceptInvite(store, { token, userId: "cal", userEmail: "cal@example.com", now })).toEqual({
      ok: false,
      error: "This invite was sent to a different email address.",
    });
    expect((await acceptInvite(store, { token, userId: "ben", userEmail: "BEN@example.com", now })).ok).toBe(true);
  });

  it("refuses an unknown, expired or revoked invite", async () => {
    const id = await homeOf("ann");
    expect(await previewInvite(store, "nope", now)).toBeNull();
    expect(await acceptInvite(store, { token: "nope", userId: "ben", userEmail: null, now })).toEqual({
      ok: false,
      error: "This invite link doesn't work. Ask for a new one.",
    });
    const short = await inviteInto(id, { days: 1 });
    expect(
      await acceptInvite(store, { token: short.token, userId: "ben", userEmail: null, now: new Date("2026-11-25T00:00:00Z") }),
    ).toEqual({ ok: false, error: "This invite has expired. Ask for a new one." });
    const revoked = await inviteInto(id);
    expect(await revokeInvite(store, { householdId: id, userId: "ann", inviteId: revoked.invite.id, now })).toEqual({
      ok: true,
      value: null,
    });
    expect(await acceptInvite(store, { token: revoked.token, userId: "ben", userEmail: null, now })).toEqual({
      ok: false,
      error: "This invite was turned off. Ask for a new one.",
    });
  });

  it("lets only owners invite or revoke, and shows invites only to owners", async () => {
    const id = await homeOf("ann");
    const { token, invite } = await inviteInto(id);
    await acceptInvite(store, { token, userId: "ben", userEmail: null, now });
    expect(await createInvite(store, { householdId: id, userId: "ben", input: {}, now })).toEqual({
      ok: false,
      error: "Only an owner can invite people.",
      forbidden: true,
    });
    expect(await revokeInvite(store, { householdId: id, userId: "ben", inviteId: invite.id, now })).toEqual({
      ok: false,
      error: "Only an owner can turn off invites.",
      forbidden: true,
    });
    expect(await revokeInvite(store, { householdId: id, userId: "ann", inviteId: "missing", now })).toEqual({
      ok: false,
      error: "That invite isn't in this household.",
    });
    expect((await getHousehold(store, id, "ben"))?.invites).toEqual([]);
    expect((await getHousehold(store, id, "ann"))?.invites).toHaveLength(1);
    expect(await createInvite(store, { householdId: id, userId: "ann", input: { uses: 0 }, now })).toEqual({
      ok: false,
      error: "An invite works 1 to 50 times.",
    });
  });
});

describe("membership", () => {
  async function kitchen() {
    const id = await homeOf("ann");
    const { token } = await inviteInto(id, { uses: 3 });
    for (const userId of ["ben", "cal"]) await acceptInvite(store, { token, userId, userEmail: null, now });
    return id;
  }

  it("shows a household only to its members", async () => {
    const id = await kitchen();
    expect(await getHousehold(store, id, "dee")).toBeNull();
    expect(await getHousehold(store, "missing", "ann")).toBeNull();
    expect((await getHousehold(store, id, "cal"))?.me.role).toBe("member");
  });

  it("lets only an owner rename the household, and everyone in it sees the new name", async () => {
    const id = await kitchen();
    expect(await renameHousehold(store, { householdId: id, userId: "ann", name: "  The Lee and Okafor kitchen ", now })).toEqual({
      ok: true,
      value: { id, name: "The Lee and Okafor kitchen" },
    });
    expect((await getHousehold(store, id, "cal"))?.name).toBe("The Lee and Okafor kitchen");
    expect((await listHouseholds(store, "ben"))[0]?.name).toBe("The Lee and Okafor kitchen");

    const refused = { ok: false, error: "Only an owner can rename the household.", forbidden: true };
    expect(await renameHousehold(store, { householdId: id, userId: "cal", name: "Cal's", now })).toEqual(refused);
    expect(await renameHousehold(store, { householdId: id, userId: "dee", name: "Dee's", now })).toEqual(refused);
    expect(await renameHousehold(store, { householdId: id, userId: "ann", name: " ", now })).toEqual({
      ok: false,
      error: "Give the household a name.",
    });
    expect((await getHousehold(store, id, "ann"))?.name).toBe("The Lee and Okafor kitchen");
  });

  it("lets an owner change a role and remove someone, with the model's refusals", async () => {
    const id = await kitchen();
    expect(await changeMemberRole(store, { householdId: id, userId: "ann", targetId: "cal", role: "viewer" })).toEqual({
      ok: true,
      value: null,
    });
    expect(await changeMemberRole(store, { householdId: id, userId: "ann", targetId: "cal", role: "boss" })).toEqual({
      ok: false,
      error: "Choose owner, member or view-only.",
    });
    expect(await changeMemberRole(store, { householdId: id, userId: "ben", targetId: "cal", role: "owner" })).toEqual({
      ok: false,
      error: "Only an owner can change roles.",
      forbidden: true,
    });
    expect(await removeFromHousehold(store, { householdId: id, userId: "ann", targetId: "cal" })).toEqual({ ok: true, value: null });
    expect(await removeFromHousehold(store, { householdId: id, userId: "ben", targetId: "ann" })).toEqual({
      ok: false,
      error: "Only an owner can remove people.",
      forbidden: true,
    });
    expect((await getHousehold(store, id, "ann"))?.members.map((m) => [m.userId, m.role])).toEqual([
      ["ann", "owner"],
      ["ben", "member"],
    ]);
  });

  it("lets a member leave, keeps the last owner until there's another, and deletes an empty household", async () => {
    const id = await kitchen();
    expect(await leave(store, { householdId: id, userId: "cal" })).toEqual({ ok: true, value: null });
    expect(await leave(store, { householdId: id, userId: "ann" })).toEqual({
      ok: false,
      error: "Make someone else an owner before you leave.",
      forbidden: true,
    });
    await changeMemberRole(store, { householdId: id, userId: "ann", targetId: "ben", role: "owner" });
    expect((await leave(store, { householdId: id, userId: "ann" })).ok).toBe(true);
    expect((await leave(store, { householdId: id, userId: "ben" })).ok).toBe(true);
    expect(await listHouseholds(store, "ben")).toEqual([]);
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "Household"`).get()).toEqual({ n: 0 });
  });

  it("names the cooks who share a household, for Kitchen's canRead", async () => {
    await kitchen();
    expect([...(await householdChefIdsFor(store, "ben"))].sort()).toEqual(["ann", "cal"]);
    expect([...(await householdChefIdsFor(store, "dee"))]).toEqual([]);
    expect(await store.emailOf("ben")).toBe("ben@example.com");
    expect(await store.emailOf("nobody")).toBeNull();
  });
});

describe("joining races", () => {
  it("refuses the loser when two people race for an invite's last use", async () => {
    const id = await homeOf("ann");
    const { token } = await inviteInto(id);
    const racing = { ...store, join: async (row: Parameters<typeof store.join>[0]) => {
      await store.join({ ...row, userId: "cal" });
      return store.join(row);
    } };
    expect(await acceptInvite(racing, { token, userId: "ben", userEmail: null, now })).toEqual({
      ok: false,
      error: "This invite has already been used.",
    });
    expect((await getHousehold(store, id, "ann"))?.members.map((m) => m.userId)).toEqual(["ann", "cal"]);
  });

  it("passes on a write error that isn't a lost race", async () => {
    const id = await homeOf("ann");
    const { invite } = await inviteInto(id, { uses: 2 });
    await expect(store.join({ inviteId: invite.id, householdId: id, userId: "ann", role: "member", now })).rejects.toThrow(/UNIQUE/);
  });
});
