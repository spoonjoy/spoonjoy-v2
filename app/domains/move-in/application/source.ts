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
  /**
   * For a kitchen that can change while it moves in, such as one on its own server: the recipe at `index`'s place in
   * the order, which the job keeps instead of a count, so a recipe deleted or added meanwhile moves no other recipe
   * past the cursor or back behind it. A backup never changes, so it has none and the cursor counts.
   */
  mark?(index: number): string;
  /** Where the recipes after a `mark` start, whether or not the recipe it was made from is still there. */
  indexAfter?(mark: string): number;
  draft(index: number): Promise<RecipeDraft>;
  hasPhoto(draft: RecipeDraft): boolean;
  readPhoto(draft: RecipeDraft): Promise<Uint8Array>;
}

/** How the report names where the kitchen is, so its notes read right for a backup and for a server alike. */
export interface SourceWords {
  /** Where things the move-in leaves behind stay: "in the backup". */
  there: string;
  /** What the cook does to try again: "Moving the same backup in again". */
  again: string;
}

export interface MoveInSource {
  /**
   * The app the kitchen lives in, as its Source row records it. A backup of a kitchen and that kitchen's own server
   * give the same app and the same keys, so moving in from either finds what the other brought.
   */
  kind: string;
  /** The server's address, for a source read from one. */
  serverUrl: string | null;
  words: SourceWords;
  /** The other app's version, as the Source row records it. */
  version: string;
  /** The kitchen to bring when the cook hasn't chosen one: the one that's clearly theirs, or null to ask. */
  chooseKitchen(email: string | null): Promise<string | null>;
  /** The kitchen with this key, or null when the source has no such kitchen. */
  openKitchen(key: string): Promise<MoveInKitchen | null>;
}

/**
 * The other app's server can't be reached or is struggling right now. Like a database outage, it is passed on, for the
 * queue to try the segment again later, rather than counted against the recipe the move-in was on.
 */
export class SourceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceUnavailableError";
  }
}
