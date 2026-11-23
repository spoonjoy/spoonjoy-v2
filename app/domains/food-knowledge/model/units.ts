// Units and conversion between the recipe as written, metric, US customary and imperial.
//
// Volume converts to volume and mass to mass, exactly, through each unit's size in millilitres or grams. Nothing
// converts between volume and mass (that needs a food's density), and counted or loose units (clove, pinch, can)
// stay as written. Teaspoons and tablespoons are 5 ml and 15 ml everywhere: the US spoons differ by under 1.5%,
// well inside kitchen rounding, and cooks in every system keep measuring with spoons.
import { formatAmount, formatQuantity, type FormatAmountOptions } from "./quantity";

/** How a cook wants amounts written. `original` is the recipe as its author wrote it. */
export type UnitSystem = "original" | "metric" | "us" | "imperial";

/** The systems a cook can pick, in the order a picker shows them. */
export const UNIT_SYSTEMS: readonly { value: UnitSystem; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "metric", label: "Metric" },
  { value: "us", label: "US" },
  { value: "imperial", label: "Imperial" },
];

/** A stored or submitted system, or `original` for anything else. */
export function parseUnitSystem(value: unknown): UnitSystem {
  return UNIT_SYSTEMS.some((system) => system.value === value) ? (value as UnitSystem) : "original";
}

/** The cookie that keeps a cook's unit system in this browser, signed in or not, so the first render already uses it. */
export const UNIT_SYSTEM_COOKIE = "sj_units";

/** The unit system in a request's `Cookie` header, or `original`. */
export function unitSystemFromCookie(header: string | null | undefined): UnitSystem {
  const pair = (header ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${UNIT_SYSTEM_COOKIE}=`));
  return parseUnitSystem(pair?.slice(UNIT_SYSTEM_COOKIE.length + 1));
}

/** The `document.cookie` assignment that keeps `system` for a year, across the whole site. */
export function unitSystemCookie(system: UnitSystem): string {
  return `${UNIT_SYSTEM_COOKIE}=${system}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

type Dimension = "volume" | "mass";

/** A unit Spoonjoy can convert: its size in millilitres (volume) or grams (mass). */
export interface KnownUnit {
  slug: string;
  dimension: Dimension;
  toBase: number;
}

const US_CUP_ML = 236.5882365;
const US_FL_OZ_ML = 29.5735295625;
const IMPERIAL_FL_OZ_ML = 28.4130625;
const IMPERIAL_PINT_ML = 568.26125;
const OUNCE_G = 28.349523125;
const POUND_G = 453.59237;

// Each unit with the ways recipes write it, already lower-cased and without dots. A cup, pint, quart, gallon or
// fluid ounce is read as US unless the recipe says imperial or UK.
const UNITS: readonly (KnownUnit & { names: readonly string[] })[] = [
  { slug: "teaspoon", dimension: "volume", toBase: 5, names: ["teaspoon", "teaspoons", "tsp", "tsps"] },
  { slug: "tablespoon", dimension: "volume", toBase: 15, names: ["tablespoon", "tablespoons", "tbsp", "tbsps", "tbs", "tbl"] },
  { slug: "us-fluid-ounce", dimension: "volume", toBase: US_FL_OZ_ML, names: ["fl oz", "floz", "fluid ounce", "fluid ounces"] },
  { slug: "cup", dimension: "volume", toBase: US_CUP_ML, names: ["cup", "cups", "c"] },
  { slug: "us-pint", dimension: "volume", toBase: US_CUP_ML * 2, names: ["pint", "pints", "pt", "pts", "us pint", "us pints"] },
  { slug: "us-quart", dimension: "volume", toBase: US_CUP_ML * 4, names: ["quart", "quarts", "qt", "qts"] },
  { slug: "us-gallon", dimension: "volume", toBase: US_CUP_ML * 16, names: ["gallon", "gallons", "gal"] },
  {
    slug: "imperial-fluid-ounce",
    dimension: "volume",
    toBase: IMPERIAL_FL_OZ_ML,
    names: ["imperial fl oz", "uk fl oz", "imperial fluid ounce", "imperial fluid ounces"],
  },
  {
    slug: "imperial-pint",
    dimension: "volume",
    toBase: IMPERIAL_PINT_ML,
    names: ["imperial pint", "imperial pints", "uk pint", "uk pints"],
  },
  { slug: "milliliter", dimension: "volume", toBase: 1, names: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"] },
  { slug: "centiliter", dimension: "volume", toBase: 10, names: ["cl", "centiliter", "centiliters", "centilitre", "centilitres"] },
  { slug: "deciliter", dimension: "volume", toBase: 100, names: ["dl", "deciliter", "deciliters", "decilitre", "decilitres"] },
  { slug: "liter", dimension: "volume", toBase: 1000, names: ["l", "liter", "liters", "litre", "litres"] },
  { slug: "milligram", dimension: "mass", toBase: 0.001, names: ["mg", "milligram", "milligrams"] },
  { slug: "gram", dimension: "mass", toBase: 1, names: ["g", "gram", "grams", "gramme", "grammes"] },
  { slug: "kilogram", dimension: "mass", toBase: 1000, names: ["kg", "kilogram", "kilograms", "kilo", "kilos"] },
  { slug: "ounce", dimension: "mass", toBase: OUNCE_G, names: ["oz", "ounce", "ounces"] },
  { slug: "pound", dimension: "mass", toBase: POUND_G, names: ["lb", "lbs", "pound", "pounds"] },
];

const UNITS_BY_NAME = new Map(UNITS.flatMap((unit) => unit.names.map((name) => [name, unit] as const)));

/** The convertible unit a recipe's unit text names, or null for a unit that is counted, loose or unknown. */
export function resolveUnit(text: string | null | undefined): KnownUnit | null {
  const trimmed = text?.trim() ?? "";
  // A capital T is the tablespoon of handwritten cards; a lower-case t could be either spoon.
  if (trimmed === "T") return UNITS_BY_NAME.get("tbsp") as KnownUnit;
  const name = trimmed.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  return UNITS_BY_NAME.get(name) ?? null;
}

/** One rung of a system's ladder: the unit amounts are written in from `from` base units up. */
interface Rung {
  slug: string;
  from: number;
  toBase: number;
  singular: string;
  plural?: string;
  /** Written as a decimal ("1.5 g"); otherwise as a cook's fraction ("1 ½ cups"). */
  decimal?: boolean;
  round?: (value: number) => number;
}

// A larger unit takes over a little before a whole one of it, within 2.5%, so 59 ml is "¼ cup", not "4 tbsp".
const TAKE_OVER = 0.975;

// The furthest a converted amount may be rounded from the exact one before it is not worth showing.
const MAX_ROUNDING_ERROR = 0.25;

function roundSmallMetric(value: number): number {
  if (value < 10) return Math.round(value * 2) / 2;
  if (value < 50) return Math.round(value);
  return Math.round(value / 5) * 5;
}

const roundLargeMetric = (value: number) => Math.round(value * 100) / 100;
const roundHalf = (value: number) => Math.round(value * 2) / 2;

const TEASPOON: Rung = { slug: "teaspoon", from: 0, toBase: 5, singular: "tsp" };
const TABLESPOON: Rung = { slug: "tablespoon", from: 15 * TAKE_OVER, toBase: 15, singular: "tbsp" };
const OUNCE: Rung = { slug: "ounce", from: 0, toBase: OUNCE_G, singular: "oz" };
const POUND: Rung = { slug: "pound", from: POUND_G * TAKE_OVER, toBase: POUND_G, singular: "lb" };

const LADDERS: Record<Exclude<UnitSystem, "original">, Record<Dimension, readonly Rung[]>> = {
  metric: {
    volume: [
      TEASPOON,
      TABLESPOON,
      { slug: "milliliter", from: 60 * TAKE_OVER, toBase: 1, singular: "ml", decimal: true, round: roundSmallMetric },
      { slug: "liter", from: 1000 * TAKE_OVER, toBase: 1000, singular: "l", decimal: true, round: roundLargeMetric },
    ],
    mass: [
      { slug: "gram", from: 0, toBase: 1, singular: "g", decimal: true, round: roundSmallMetric },
      { slug: "kilogram", from: 1000 * TAKE_OVER, toBase: 1000, singular: "kg", decimal: true, round: roundLargeMetric },
    ],
  },
  us: {
    volume: [
      TEASPOON,
      TABLESPOON,
      { slug: "cup", from: (US_CUP_ML / 4) * TAKE_OVER, toBase: US_CUP_ML, singular: "cup", plural: "cups" },
      { slug: "us-gallon", from: US_CUP_ML * 16 * TAKE_OVER, toBase: US_CUP_ML * 16, singular: "gallon", plural: "gallons" },
    ],
    mass: [OUNCE, POUND],
  },
  imperial: {
    volume: [
      TEASPOON,
      TABLESPOON,
      {
        slug: "imperial-fluid-ounce",
        from: IMPERIAL_FL_OZ_ML * 2 * TAKE_OVER,
        toBase: IMPERIAL_FL_OZ_ML,
        singular: "fl oz",
        round: roundHalf,
      },
      { slug: "imperial-pint", from: IMPERIAL_PINT_ML * TAKE_OVER, toBase: IMPERIAL_PINT_ML, singular: "pint", plural: "pints" },
    ],
    mass: [OUNCE, POUND],
  },
};

function rungFor(rungs: readonly Rung[], base: number): Rung {
  return rungs.reduce((chosen, rung) => (base >= rung.from ? rung : chosen));
}

/**
 * An amount written in a cook's unit system: "1 cup" in metric is "235 ml". Spoonjoy's one way of writing an
 * amount (`formatAmount`) does the rest, and anything that cannot convert is written as the recipe has it.
 *
 * @example
 * formatAmountIn("metric", 1, "cup") // "235 ml"
 * formatAmountIn("us", 1, "kg") // "2 ¼ lb"
 * formatAmountIn("metric", 2, "clove") // "2 cloves"
 */
export function formatAmountIn(
  system: UnitSystem,
  quantity: number | string | null | undefined,
  unit: string | null | undefined,
  options: FormatAmountOptions = {},
): string {
  const asWritten = () => formatAmount(quantity, unit, options);
  if (system === "original") return asWritten();
  const known = resolveUnit(unit);
  const numeric = typeof quantity === "string" ? Number.parseFloat(quantity) : quantity;
  if (!known || numeric == null || !Number.isFinite(numeric) || numeric <= 0) return asWritten();

  const base = numeric * known.toBase;
  const rung = rungFor(LADDERS[system][known.dimension], base);
  if (rung.slug === known.slug) return asWritten();

  const exact = base / rung.toBase;
  const value = (rung.round ?? ((n: number) => n))(exact);
  // A tiny amount that would show as 0, or as a fraction far from it (2 g is not "⅛ oz"), stays as written.
  const shown = rung.decimal ? value : Math.round(value * 8) / 8;
  if (shown === 0 || Math.abs(shown - exact) / exact > MAX_ROUNDING_ERROR) return asWritten();
  const text = rung.decimal ? String(value) : formatQuantity(value);
  const unitText = rung.plural && value > 1 && text !== "1" ? rung.plural : rung.singular;
  return `${text} ${unitText}`;
}
