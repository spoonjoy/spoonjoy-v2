// What a move-in reads: the other app's kitchens, however they arrive. A backup file has every recipe to hand; another
// app's own server has to be asked for each one. So a kitchen lists its recipes cheaply, in a fixed order the job's
// cursor counts through, and hands over each recipe and its photo only when the move-in reaches it.
import type { RecipeDraft } from "../model/recipe-draft";

/** What inspect reports about a kitchen before its recipes move in. */
export interface KitchenCounts {
  photos: number;
  tags: number;
  categories: number;
  tools: number;
}

/** A recipe as the kitchen lists it: enough to name it in the report without asking for the whole recipe. */
export interface KitchenEntry {
  sourceKey: string;
  title: string;
}

export interface MoveInKitchen {
  /** The kitchen's key in the other app, which the Source row keeps so a later move-in finds the same kitchen. */
  key: string;
  name: string;
  /** How many recipes the kitchen holds. */
  size: number;
  count(): Promise<KitchenCounts>;
  /** The recipe at `index`, from 0 up to `size`, in the same order on every run. */
  entry(index: number): KitchenEntry;
  draft(index: number): Promise<RecipeDraft>;
  hasPhoto(draft: RecipeDraft): boolean;
  readPhoto(draft: RecipeDraft): Promise<Uint8Array>;
}

export interface MoveInSource {
  /** The other app's version, as the Source row records it. */
  version: string;
  /** The kitchen to bring when the cook hasn't chosen one: the one that's clearly theirs, or null to ask. */
  chooseKitchen(email: string | null): Promise<string | null>;
  /** The kitchen with this key, or null when the source has no such kitchen. */
  openKitchen(key: string): Promise<MoveInKitchen | null>;
}
