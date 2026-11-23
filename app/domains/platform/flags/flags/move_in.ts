import { defineFlag } from "../define-flag";

declare module "../define-flag" {
  interface DeclaredFlags {
    move_in: true;
  }
}

export default defineFlag("move_in", "The Move in page at /move-in: bring a kitchen over from another recipe app's backup.");
