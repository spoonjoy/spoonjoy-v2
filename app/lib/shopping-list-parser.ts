export type ParsedItemDraft = {
  quantity: string;
  unitName: string;
  ingredientName: string;
  isAmbiguous: boolean;
  originalText: string;
};

export type ShoppingListActionData = {
  success?: boolean;
  /** Set on a successful addItem, so the page knows to clear its Item field (R-M3-3). */
  intent?: "addItem";
  errors?: {
    parse?: string;
  };
  parseDraft?: ParsedItemDraft;
};

function parseFractionToken(token: string): number | null {
  const trimmed = token.trim();
  const mixed = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number.parseFloat(mixed[1]);
    const numerator = Number.parseFloat(mixed[2]);
    const denominator = Number.parseFloat(mixed[3]);
    return denominator > 0 ? whole + numerator / denominator : null;
  }

  const fraction = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    const numerator = Number.parseFloat(fraction[1]);
    const denominator = Number.parseFloat(fraction[2]);
    return denominator > 0 ? numerator / denominator : null;
  }

  const numeric = Number.parseFloat(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

// The words a cook writes as a unit. It matches the native app's IngredientTextParser, so both
// apps agree on what a unit is. Any other word after the amount is part of the name: "1 bell
// pepper" is one bell pepper. Size words are units, as Spoonjoy recipes store them.
const UNIT_WORDS = new Set([
  "cup", "cups",
  "tbsp", "tbsps", "tbs", "tbl", "tablespoon", "tablespoons",
  "tsp", "tsps", "teaspoon", "teaspoons",
  "oz", "ounce", "ounces",
  "lb", "lbs", "pound", "pounds",
  "g", "gram", "grams",
  "kg", "kilogram", "kilograms",
  "ml", "milliliter", "milliliters", "millilitre", "millilitres",
  "l", "liter", "liters", "litre", "litres",
  "clove", "cloves",
  "pinch", "pinches",
  "dash", "dashes",
  "can", "cans",
  "slice", "slices",
  "piece", "pieces",
  "stick", "sticks",
  "bunch", "bunches",
  "sprig", "sprigs",
  "head", "heads",
  "package", "packages", "pkg",
  "small", "medium", "large",
]);

/** The unit as written, without a trailing period ("Tbsp." is "Tbsp"), or null for a word that isn't one. */
function unitWord(token: string): string | null {
  const written = token.replace(/[.,]+$/, "");
  return UNIT_WORDS.has(written.toLowerCase()) ? written : null;
}

export const __internal__ = { parseFractionToken };

export function parseShoppingItemFallback(text: string): ParsedItemDraft {
  const normalized = text.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return {
      quantity: "",
      unitName: "",
      ingredientName: "",
      isAmbiguous: true,
      originalText: text,
    };
  }

  const dozenMatch = normalized.match(/^(a|an)\s+dozen\s+(.+)$/i);
  if (dozenMatch) {
    return {
      quantity: "12",
      unitName: "whole",
      ingredientName: dozenMatch[2].trim(),
      isAmbiguous: false,
      originalText: text,
    };
  }

  const amountMatch = normalized.match(/^((?:\d+\s+)?\d+\/\d+|\d+(?:\.\d+)?)\s+(.+)$/);
  if (!amountMatch) {
    return {
      quantity: "",
      unitName: "",
      ingredientName: normalized,
      isAmbiguous: true,
      originalText: text,
    };
  }

  const parsedQuantity = parseFractionToken(amountMatch[1]);
  const remainder = amountMatch[2].trim();
  const [first, ...rest] = remainder.split(" ");

  if (!parsedQuantity || !remainder) {
    return {
      quantity: "",
      unitName: "",
      ingredientName: normalized,
      isAmbiguous: true,
      originalText: text,
    };
  }

  if (rest.length === 0) {
    return {
      quantity: String(parsedQuantity),
      unitName: "whole",
      ingredientName: first,
      isAmbiguous: false,
      originalText: text,
    };
  }

  const unit = unitWord(first);
  if (!unit) {
    return {
      quantity: String(parsedQuantity),
      unitName: "whole",
      ingredientName: remainder,
      isAmbiguous: false,
      originalText: text,
    };
  }

  // "1 pinch of salt" is a pinch of salt.
  const nameWords = rest[0].toLowerCase() === "of" && rest.length > 1 ? rest.slice(1) : rest;
  return {
    quantity: String(parsedQuantity),
    unitName: unit,
    ingredientName: nameWords.join(" "),
    isAmbiguous: false,
    originalText: text,
  };
}
