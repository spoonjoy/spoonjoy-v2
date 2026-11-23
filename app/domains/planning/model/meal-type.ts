// Meal types, in the order a day is eaten; the week view lists a day's entries in this order.
export const MEAL_TYPES = [
  { id: "breakfast", label: "Breakfast" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
  { id: "side", label: "Side" },
  { id: "snack", label: "Snack" },
  { id: "drink", label: "Drink" },
  { id: "dessert", label: "Dessert" },
] as const;

export type MealType = (typeof MEAL_TYPES)[number]["id"];

const IDS: readonly string[] = MEAL_TYPES.map((type) => type.id);

export function parseMealType(value: unknown): MealType | null {
  const id = String(value ?? "").trim().toLowerCase();
  return IDS.includes(id) ? (id as MealType) : null;
}

export function mealTypeOrder(type: MealType): number {
  return IDS.indexOf(type);
}
