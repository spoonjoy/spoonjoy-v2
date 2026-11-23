import { defineFlag } from "../define-flag";

declare module "../define-flag" {
  interface DeclaredFlags {
    households: true;
  }
}

export default defineFlag("households", "Households at /households: members, roles and invites, and the lists, plan and recipes they share.");
