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
