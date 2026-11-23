import { defineFlag } from "../define-flag";

declare module "../define-flag" {
  interface DeclaredFlags {
    nutrition: true;
  }
}

export default defineFlag("nutrition", "Calories and macros per serving on a recipe's page, from USDA FoodData Central.");
