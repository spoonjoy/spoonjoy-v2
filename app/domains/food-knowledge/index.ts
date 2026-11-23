// Food knowledge (shared kernel): foods, units, conversion, nutrition, swaps, ingredient parsing and food names.
// Its public surface: code outside this context imports only from "~/domains/food-knowledge" (docs/domains.md).
export {
  formatAmount,
  formatQuantity,
  formatServingsLabel,
  isCountUnit,
  scaleQuantity,
  scaleServingsText,
  type FormatAmountOptions,
} from "./model/quantity";
export {
  combineAmounts,
  formatAmountIn,
  parseUnitSystem,
  resolveUnit,
  UNIT_SYSTEM_COOKIE,
  UNIT_SYSTEMS,
  unitSystemCookie,
  unitSystemFromCookie,
  type Amount,
  type KnownUnit,
  type UnitSystem,
} from "./model/units";
export {
  foodNutritionFor,
  gramsOf,
  NUTRITION_SOURCE,
  recipeNutrition,
  type FoodNutrition,
  type NutritionFacts,
  type RecipeNutrition,
} from "./model/nutrition";
