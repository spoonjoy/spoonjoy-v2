import { defineFlag } from "../define-flag";

declare module "../define-flag" {
  interface DeclaredFlags {
    "meal-planner": true;
  }
}

export default defineFlag("meal-planner", "The meal planner at /plan: a week of recipes and notes, and its API and MCP tools.");
