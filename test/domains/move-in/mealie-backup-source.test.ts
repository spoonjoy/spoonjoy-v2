import { describe, expect, it } from "vitest";
import { bytesSource } from "~/domains/move-in/adapters/archive/zip";
import { openMealieBackup } from "~/domains/move-in/adapters/sources/mealie-backup/backup";
import { mealieBackupSource } from "~/domains/move-in/adapters/sources/mealie-backup/source";
import { makeZip } from "./support/make-zip";
import { mealieDatabase } from "./support/mealie-database";

const { tables, keys } = mealieDatabase();
const photo = new Uint8Array([82, 73, 70, 70]);

async function source() {
  return mealieBackupSource(await openMealieBackup(bytesSource(makeZip([
    { name: "database.json", data: JSON.stringify(tables) },
    { name: `data/recipes/${keys.pancakes}/images/original.webp`, data: photo, store: true },
  ]))));
}

describe("the backup as a move-in source", () => {
  it("opens the cook's kitchen and lists its recipes in the backup's order, with their photos", async () => {
    const backup = await source();
    expect(backup.version).toBe("v3.31.0");
    const key = (await backup.chooseKitchen("cook@example.com")) as string;
    const kitchen = await backup.openKitchen(key);
    if (!kitchen) throw new Error("expected the kitchen");
    expect(kitchen).toMatchObject({ key, name: "Home", size: 3 });
    expect(kitchen.entry(0)).toEqual({ sourceKey: keys.pancakes, title: "Pancakes" });
    expect(await kitchen.count()).toEqual({ photos: 1, tags: 1, categories: 1, tools: 1 });
    const pancakes = await kitchen.draft(0);
    expect(kitchen.hasPhoto(pancakes)).toBe(true);
    expect(await kitchen.readPhoto(pancakes)).toEqual(photo);
    const soup = await kitchen.draft(1);
    expect(kitchen.hasPhoto(soup)).toBe(false);
    await expect(kitchen.readPhoto(soup)).rejects.toThrow("the photo in the backup is damaged");
  });

  it("has no kitchen for a key the backup doesn't hold", async () => {
    expect(await (await source()).openKitchen("not-a-kitchen")).toBeNull();
  });
});
