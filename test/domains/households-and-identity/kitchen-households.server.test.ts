import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppLoadContext } from "react-router";
import { createHousehold, d1HouseholdStore, kitchenHouseholds } from "~/domains/households-and-identity";
import { migratedSqliteD1, type MigratedSqlite } from "../../helpers/migrated-sqlite";

let database: MigratedSqlite;
const now = new Date("2026-11-23T12:00:00.000Z");

function contextWith(env: Record<string, unknown>): AppLoadContext {
  return { cloudflare: { env } } as unknown as AppLoadContext;
}

beforeEach(() => {
  database = migratedSqliteD1();
  database.sqlite.prepare(`INSERT INTO "User" ("id", "email", "username") VALUES ('ann', 'ann@example.com', 'ann_cooks')`).run();
});

afterEach(() => database.sqlite.close());

describe("kitchenHouseholds", () => {
  it("lists the cook's households by name while the households flag is on, and an empty list before they have one", async () => {
    const context = contextWith({ DB: database.binding, SPOONJOY_FLAGS: "households" });
    expect(await kitchenHouseholds(context, "ann")).toEqual([]);

    const store = d1HouseholdStore(database.binding as never);
    const made = await createHousehold(store, { userId: "ann", name: "The Lee kitchen", now });
    if (!made.ok) throw new Error(made.error);
    expect(await kitchenHouseholds(context, "ann")).toEqual([{ id: made.value.id, name: "The Lee kitchen" }]);
  });

  it("leaves the section out while the households flag is off, or with no D1 binding", async () => {
    expect(await kitchenHouseholds(contextWith({ DB: database.binding }), "ann")).toBeNull();
    expect(await kitchenHouseholds(contextWith({ SPOONJOY_FLAGS: "households" }), "ann")).toBeNull();
  });
});
