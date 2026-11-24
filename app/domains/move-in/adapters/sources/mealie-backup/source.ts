// The other app's admin backup as a move-in source. The backup holds every recipe already, so its drafts are made
// once when a kitchen opens, and each recipe and photo comes straight out of the zip.
import type { KitchenCounts, MoveInKitchen, MoveInSource } from "../../../application/source";
import type { RecipeDraft } from "../../../model/recipe-draft";
import type { MealieBackup } from "./backup";
import { chooseGroup, inspectGroup, listGroups, recipeDrafts } from "./database";

function kitchenOf(backup: MealieBackup, key: string, name: string): MoveInKitchen {
  const drafts = recipeDrafts(backup.database, key);
  const hasPhoto = (draft: RecipeDraft) => backup.hasFile(draft.photoPath);
  return {
    key,
    name,
    size: drafts.length,
    async count(): Promise<KitchenCounts> {
      const { tags, categories, tools } = inspectGroup(backup.database, key);
      return { photos: drafts.filter(hasPhoto).length, tags, categories, tools };
    },
    entry: (index) => ({ sourceKey: drafts[index].sourceKey, title: drafts[index].title }),
    draft: async (index) => drafts[index],
    hasPhoto,
    async readPhoto(draft) {
      const bytes = await backup.readFile(draft.photoPath).catch(() => null);
      if (!bytes) throw new Error("the photo in the backup is damaged");
      return bytes;
    },
  };
}

/** The app a backup's kitchen lives in, as its Source row records it. */
export const MEALIE_SOURCE_KIND = "mealie-backup";

export function mealieBackupSource(backup: MealieBackup): MoveInSource {
  return {
    kind: MEALIE_SOURCE_KIND,
    serverUrl: null,
    words: { there: "in the backup", again: "Moving the same backup in again" },
    version: backup.database.version.label,
    chooseKitchen: async (email) => chooseGroup(backup.database, email),
    async openKitchen(key) {
      const group = listGroups(backup.database).find((candidate) => candidate.key === key);
      return group ? kitchenOf(backup, key, group.name) : null;
    },
  };
}
