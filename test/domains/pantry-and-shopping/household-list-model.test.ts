import { describe, expect, it } from "vitest";
import { validateHouseholdListItem, validateHouseholdListName } from "~/domains/pantry-and-shopping";

describe("household list model", () => {
  it("trims names and items, and refuses ones that aren't text", () => {
    expect(validateHouseholdListName("  Groceries ")).toEqual({ ok: true, value: "Groceries" });
    expect(validateHouseholdListName(undefined)).toEqual({ ok: false, error: "Give the list a name." });
    expect(validateHouseholdListItem(" eggs ")).toEqual({ ok: true, value: "eggs" });
    expect(validateHouseholdListItem(42)).toEqual({ ok: false, error: "Write what to buy." });
  });
});
