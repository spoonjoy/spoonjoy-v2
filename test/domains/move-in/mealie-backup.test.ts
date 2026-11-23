import { describe, expect, it } from "vitest";
import { bytesSource } from "~/domains/move-in/adapters/archive/zip";
import { DATABASE_MAX_BYTES, openMealieBackup } from "~/domains/move-in/adapters/sources/mealie-backup/backup";
import { MoveInError } from "~/domains/move-in/model/move-in-error";
import { makeZip, type ZipInput } from "./support/make-zip";
import { mealieDatabase } from "./support/mealie-database";

const { tables, keys } = mealieDatabase();
const photo = new Uint8Array([82, 73, 70, 70]);

function backupZip(prefix = "", extra: ZipInput[] = []) {
  return makeZip([
    { name: `${prefix}database.json`, data: JSON.stringify(tables) },
    { name: `${prefix}data/recipes/${keys.pancakes}/images/original.webp`, data: photo, store: true },
    { name: `${prefix}data/.secret`, data: "do-not-read" },
    ...extra,
  ]);
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MoveInError) return error.code;
    throw error;
  }
  throw new Error("expected a MoveInError");
}

describe("openMealieBackup", () => {
  it("reads database.json and finds each recipe's photo", async () => {
    const backup = await openMealieBackup(bytesSource(backupZip()));
    expect(backup.database.version.label).toBe("v3.31.0");
    expect(await backup.readFile(`data/recipes/${keys.pancakes}/images/original.webp`)).toEqual(photo);
    expect(await backup.readFile(`data/recipes/${keys.soup}/images/original.webp`)).toBeNull();
    expect(backup.hasFile(`data/recipes/${keys.pancakes}/images/original.webp`)).toBe(true);
    expect(backup.hasFile(`data/recipes/${keys.soup}/images/original.webp`)).toBe(false);
    expect(backup.hasFile("data/.secret")).toBe(false);
  });

  it("steps into one top folder, as when a zip is unzipped and zipped again", async () => {
    const backup = await openMealieBackup(bytesSource(backupZip("mealie_backup/", [{ name: "__MACOSX/mealie_backup/._database.json", data: "x" }])));
    expect(await backup.readFile(`data/recipes/${keys.pancakes}/images/original.webp`)).toEqual(photo);
  });

  it("never reads the server's secret", async () => {
    const backup = await openMealieBackup(bytesSource(backupZip()));
    expect(await backup.readFile("data/.secret")).toBeNull();
    expect(await backup.readFile("data/./.secret")).toBeNull();
  });

  it("refuses paths that climb out of the backup, and calls a damaged photo a broken zip", async () => {
    const backup = await openMealieBackup(bytesSource(backupZip("", [{ name: "data/broken.webp", data: "x", method: 12 }])));
    expect(await backup.readFile(`data/../database.json`)).toBeNull();
    expect(await codeOf(backup.readFile("data/broken.webp"))).toBe("broken-zip");
  });

  it("calls a file that is not a zip a broken zip", async () => {
    expect(await codeOf(openMealieBackup(bytesSource(new TextEncoder().encode("not a zip, just some words here"))))).toBe("broken-zip");
  });

  it("calls a zip without database.json not a backup", async () => {
    expect(await codeOf(openMealieBackup(bytesSource(makeZip([{ name: "recipes/pancakes.json", data: "{}" }]))))).toBe("not-a-backup");
    expect(await codeOf(openMealieBackup(bytesSource(makeZip([
      { name: "a/database.json", data: "{}" },
      { name: "b/database.json", data: "{}" },
    ]))))).toBe("not-a-backup");
  });

  it("calls a database.json that is not JSON a broken zip", async () => {
    expect(await codeOf(openMealieBackup(bytesSource(makeZip([{ name: "database.json", data: "{not json" }]))))).toBe("broken-zip");
  });

  it("calls a damaged database.json entry a broken zip", async () => {
    expect(await codeOf(openMealieBackup(bytesSource(makeZip([{ name: "database.json", data: "{}", method: 12 }]))))).toBe("broken-zip");
  });

  it("refuses a database.json larger than it can hold", async () => {
    const zip = makeZip([{ name: "database.json", data: "{}" }]);
    const view = new DataView(zip.buffer);
    const directoryOffset = view.getUint32(zip.length - 22 + 16, true);
    view.setUint32(directoryOffset + 24, DATABASE_MAX_BYTES + 1, true);
    expect(await codeOf(openMealieBackup(bytesSource(zip)))).toBe("backup-too-large");
  });

  it("passes on errors that are not about the archive", async () => {
    const failing = { size: 100, read: async () => Promise.reject(new Error("blob store down")) };
    await expect(openMealieBackup(failing)).rejects.toThrow("blob store down");
  });
});
