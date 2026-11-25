import { defineFlag } from "../define-flag";

declare module "../define-flag" {
  interface DeclaredFlags {
    "smart-cookbooks": true;
  }
}

export default defineFlag("smart-cookbooks", "Smart cookbooks: cookbooks defined by tag, category and tool rules (with and without) that fill themselves.");
