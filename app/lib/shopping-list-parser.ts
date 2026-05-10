export type ParsedItemDraft = {
  quantity: string;
  unitName: string;
  ingredientName: string;
  isAmbiguous: boolean;
  originalText: string;
};

export type ShoppingListActionData = {
  success?: boolean;
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

  return {
    quantity: String(parsedQuantity),
    unitName: first,
    ingredientName: rest.join(" "),
    isAmbiguous: false,
    originalText: text,
  };
}
