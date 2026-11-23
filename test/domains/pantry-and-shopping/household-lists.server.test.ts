// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addHouseholdListItem,
  createHouseholdList,
  deleteHouseholdList,
  getHouseholdList,
  listHouseholdLists,
  removeHouseholdListItem,
  setHouseholdListItemChecked,
} from "~/domains/pantry-and-shopping/application/household-lists.server";
import { d1HouseholdListStore } from "~/domains/pantry-and-shopping/adapters/d1-household-list-store.server";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";

let database: MigratedSqlite;
let store: ReturnType<typeof d1HouseholdListStore>;
const now = new Date("2026-11-23T12:00:00.000Z");
const later = new Date("2026-11-23T12:05:00.000Z");
const run = (sql: string) => database.sqlite.prepare(sql).run();

beforeEach(() => {
  database = migratedSqliteD1();
  store = d1HouseholdListStore(database.binding);
  for (const id of ["ann", "ben", "cal", "dee"]) {
    run(`INSERT INTO "User" ("id", "email", "username") VALUES ('${id}', '${id}@example.com', '${id}_cooks')`);
  }
  run(`INSERT INTO "Household" ("id", "name") VALUES ('h1', 'Home')`);
  run(`INSERT INTO "Household" ("id", "name") VALUES ('h2', 'Cabin')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role") VALUES ('h1', 'ann', 'owner')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role") VALUES ('h1', 'ben', 'member')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role") VALUES ('h1', 'cal', 'viewer')`);
  run(`INSERT INTO "HouseholdMember" ("householdId", "userId", "role") VALUES ('h2', 'dee', 'owner')`);
});

afterEach(() => database.close());

async function listIn(householdId: string, userId: string, name: string) {
  const made = await createHouseholdList(store, { householdId, userId, name, now });
  if (!made.ok) throw new Error(made.error);
  return made.value.id;
}

describe("household shopping lists", () => {
  it("gives a household several lists that its members and owners make and everyone in it reads", async () => {
    await listIn("h1", "ann", "Groceries");
    await listIn("h1", "ben", "  Party  ");

    for (const userId of ["ann", "ben", "cal"]) {
      const seen = await listHouseholdLists(store, { householdId: "h1", userId });
      expect(seen?.lists.map((list) => list.name)).toEqual(["Groceries", "Party"]);
    }
    expect((await listHouseholdLists(store, { householdId: "h1", userId: "cal" }))?.canEdit).toBe(false);
    expect((await listHouseholdLists(store, { householdId: "h1", userId: "ben" }))?.canEdit).toBe(true);
    expect(await listHouseholdLists(store, { householdId: "h1", userId: "dee" })).toBeNull();
    expect((await listHouseholdLists(store, { householdId: "h2", userId: "dee" }))?.lists).toEqual([]);
  });

  it("refuses a list from someone view-only or outside the household, and a name it can't use", async () => {
    expect(await createHouseholdList(store, { householdId: "h1", userId: "cal", name: "Mine", now })).toEqual({
      ok: false,
      error: "View-only members can't change shared lists.",
    });
    expect(await createHouseholdList(store, { householdId: "h1", userId: "dee", name: "Mine", now })).toEqual({
      ok: false,
      error: "That household isn't one of yours.",
    });
    expect(await createHouseholdList(store, { householdId: "h1", userId: "ann", name: " ", now })).toEqual({
      ok: false,
      error: "Give the list a name.",
    });
    expect(await createHouseholdList(store, { householdId: "h1", userId: "ann", name: "x".repeat(81), now })).toEqual({
      ok: false,
      error: "Keep the name under 80 characters.",
    });
  });

  it("shares items: a member adds and checks them off, and everyone sees the same list", async () => {
    const listId = await listIn("h1", "ann", "Groceries");
    const milk = await addHouseholdListItem(store, { householdId: "h1", listId, userId: "ben", text: " 2 litres milk ", now });
    const eggs = await addHouseholdListItem(store, { householdId: "h1", listId, userId: "ann", text: "eggs", now });
    if (!milk.ok || !eggs.ok) throw new Error("not added");
    expect(await setHouseholdListItemChecked(store, { householdId: "h1", listId, userId: "ben", itemId: milk.value.id, checked: true, now: later })).toEqual({ ok: true, value: null });

    const seen = await getHouseholdList(store, { householdId: "h1", listId, userId: "cal" });
    expect(seen).toMatchObject({ id: listId, name: "Groceries", canEdit: false });
    expect(seen?.items.map(({ text, checked, addedBy }) => ({ text, checked, addedBy }))).toEqual([
      { text: "2 litres milk", checked: true, addedBy: "ben_cooks" },
      { text: "eggs", checked: false, addedBy: "ann_cooks" },
    ]);
    expect((await listHouseholdLists(store, { householdId: "h1", userId: "ann" }))?.lists).toEqual([
      { id: listId, name: "Groceries", itemCount: 2, openCount: 1 },
    ]);

    await setHouseholdListItemChecked(store, { householdId: "h1", listId, userId: "ann", itemId: milk.value.id, checked: false, now: later });
    expect(await removeHouseholdListItem(store, { householdId: "h1", listId, userId: "ann", itemId: eggs.value.id })).toEqual({ ok: true, value: null });
    const after = await getHouseholdList(store, { householdId: "h1", listId, userId: "ann" });
    expect(after?.items.map(({ text, checked }) => ({ text, checked }))).toEqual([{ text: "2 litres milk", checked: false }]);
  });

  it("keeps view-only members, outsiders and other households' lists from changing anything", async () => {
    const listId = await listIn("h1", "ann", "Groceries");
    const cabin = await listIn("h2", "dee", "Cabin");
    const added = await addHouseholdListItem(store, { householdId: "h1", listId, userId: "ann", text: "eggs", now });
    if (!added.ok) throw new Error(added.error);
    const itemId = added.value.id;
    const viewOnly = { ok: false, error: "View-only members can't change shared lists." };

    expect(await addHouseholdListItem(store, { householdId: "h1", listId, userId: "cal", text: "cake", now })).toEqual(viewOnly);
    expect(await setHouseholdListItemChecked(store, { householdId: "h1", listId, userId: "cal", itemId, checked: true, now })).toEqual(viewOnly);
    expect(await removeHouseholdListItem(store, { householdId: "h1", listId, userId: "cal", itemId })).toEqual(viewOnly);
    expect(await deleteHouseholdList(store, { householdId: "h1", listId, userId: "cal" })).toEqual(viewOnly);
    expect(await addHouseholdListItem(store, { householdId: "h1", listId, userId: "dee", text: "cake", now })).toEqual({
      ok: false,
      error: "That household isn't one of yours.",
    });
    // A list from another household, reached through a household the person is in, isn't found.
    const missing = { ok: false, error: "That list isn't in this household." };
    expect(await addHouseholdListItem(store, { householdId: "h1", listId: cabin, userId: "ann", text: "cake", now })).toEqual(missing);
    expect(await getHouseholdList(store, { householdId: "h1", listId: cabin, userId: "ann" })).toBeNull();
    expect(await getHouseholdList(store, { householdId: "h1", listId, userId: "dee" })).toBeNull();
    expect(await deleteHouseholdList(store, { householdId: "h1", listId: cabin, userId: "ann" })).toEqual(missing);
    expect(await addHouseholdListItem(store, { householdId: "h1", listId, userId: "ann", text: "  ", now })).toEqual({
      ok: false,
      error: "Write what to buy.",
    });
    expect(await addHouseholdListItem(store, { householdId: "h1", listId, userId: "ann", text: "x".repeat(201), now })).toEqual({
      ok: false,
      error: "Keep it under 200 characters.",
    });
    expect(await getHouseholdList(store, { householdId: "h1", listId, userId: "ann" })).toMatchObject({ items: [{ text: "eggs", checked: false }] });
  });

  it("deletes a list with its items, and goes when the household goes", async () => {
    const listId = await listIn("h1", "ann", "Groceries");
    await addHouseholdListItem(store, { householdId: "h1", listId, userId: "ann", text: "eggs", now });
    expect(await deleteHouseholdList(store, { householdId: "h1", listId, userId: "ben" })).toEqual({ ok: true, value: null });
    expect(database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "HouseholdListItem"`).get()).toEqual({ n: 0 });

    const kept = await listIn("h1", "ann", "Again");
    await addHouseholdListItem(store, { householdId: "h1", listId: kept, userId: "ben", text: "eggs", now });
    run(`DELETE FROM "User" WHERE "id" = 'ben'`);
    expect((await getHouseholdList(store, { householdId: "h1", listId: kept, userId: "ann" }))?.items[0]?.addedBy).toBeNull();
    run(`DELETE FROM "Household" WHERE "id" = 'h1'`);
    for (const table of ["HouseholdList", "HouseholdListItem"]) {
      expect(database.sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get(), table).toEqual({ n: 0 });
    }
  });
});
