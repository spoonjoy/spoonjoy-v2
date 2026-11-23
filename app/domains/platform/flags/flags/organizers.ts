import { defineFlag } from "../define-flag";

declare module "../define-flag" {
  interface DeclaredFlags {
    organizers: true;
  }
}

export default defineFlag("organizers", "Tags, categories and tools on recipes, their pages and filters, smart cookbooks and bulk actions on many recipes.");
