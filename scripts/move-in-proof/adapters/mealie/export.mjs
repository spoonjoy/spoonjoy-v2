// Exports a seeded kitchen the ways a person moving in could bring it: the admin's full backup
// zip, each recipe's JSON, and (where the version offers it) each recipe's own zip with its photo.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stableStringify } from "../../kitchen.mjs";
export async function exportKitchen({ profile, seeded, recipes, outDir, log = () => {} }) {
  const adminSession = seeded.adminSession;
  const before = new Set((await adminSession.get("/api/admin/backups")).imports.map((backup) => backup.name));
  await adminSession.request("POST", "/api/admin/backups");
  const backups = (await adminSession.get("/api/admin/backups")).imports;
  const backup = backups.find((candidate) => !before.has(candidate.name));
  if (!backup) throw new Error("The source app made no new backup.");
  const { fileToken } = await adminSession.get(`/api/admin/backups/${encodeURIComponent(backup.name)}`);
  const zip = await adminSession.download("/api/utils/download", { token: fileToken });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "backup.zip"), zip);
  log(`backup.zip (${zip.length} bytes)`);

  const recipeDir = path.join(outDir, "recipes");
  mkdirSync(recipeDir, { recursive: true });
  for (const recipe of recipes) {
    writeFileSync(path.join(recipeDir, `${recipe.slug}.json`), `${stableStringify(recipe, 2)}\n`);
  }

  let recipeZips = 0;
  if (profile.recipeZipExport) {
    const zipDir = path.join(outDir, "recipe-zips");
    mkdirSync(zipDir, { recursive: true });
    const owner = seeded.sessions.owner;
    // One at a time: the server builds every recipe zip at the same temporary path, so two
    // exports at once overwrite each other's file mid-download.
    for (const recipe of recipes) {
      const { token } = await owner.request("POST", `/api/recipes/${recipe.slug}/exports`, { idempotent: true });
      const zip = await owner.download(`/api/recipes/${recipe.slug}/exports/zip`, { token });
      const endOfDirectory = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      if (endOfDirectory < 0 || !zip.includes(Buffer.from(`${recipe.slug}.json`))) {
        throw new Error(`The zip export of ${recipe.slug} is incomplete (${zip.length} bytes).`);
      }
      writeFileSync(path.join(zipDir, `${recipe.slug}.zip`), zip);
      recipeZips += 1;
    }
  }
  log(`${recipes.length} recipe JSON files, ${recipeZips} recipe zips`);
  return { backupBytes: zip.length, recipeFiles: recipes.length, recipeZips };
}
