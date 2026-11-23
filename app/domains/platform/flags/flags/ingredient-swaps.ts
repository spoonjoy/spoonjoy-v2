import { defineFlag } from "../define-flag";

declare module "../define-flag" {
  interface DeclaredFlags {
    "ingredient-swaps": true;
  }
}

export default defineFlag("ingredient-swaps", "What to use instead of an ingredient, shown under it in cook mode.");
