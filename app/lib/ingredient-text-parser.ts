import type { ParsedIngredient } from '~/lib/ingredient-parse.server'

// A deterministic, offline ingredient parser: the web editor's fallback when AI parsing is
// unavailable, so typed ingredients are never dropped. It is a port of the native editor's
// `IngredientTextParser` (spoonjoy-apple, Sources/SpoonjoyCore/Features/RecipeEditor), which
// follows the rules of the AI parser's prompt, so web and native agree:
// - one ingredient per non-empty line; a comma inside a line stays in the name;
// - fractions, mixed numbers and unicode fractions become decimals, a range keeps its lower
//   number, and approximate words ("about", "~") and list bullets are dropped;
// - units become singular standard abbreviations, size words ("large") are units, and a line
//   with no unit word gets "whole"; "of" after a unit is dropped;
// - a line with no quantity is quantity 1 ("pinch of salt", "salt");
// - a line with no ingredient name ("2 cups") is skipped.

export const WHOLE_UNIT = 'whole'

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '¼': 0.25,
  '¾': 0.75,
  '⅕': 0.2,
  '⅖': 0.4,
  '⅗': 0.6,
  '⅘': 0.8,
  '⅙': 1 / 6,
  '⅚': 5 / 6,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
}

const UNIT_GROUPS: Record<string, string[]> = {
  cup: ['cup', 'cups'],
  tbsp: ['tbsp', 'tbsps', 'tbs', 'tbl', 'tablespoon', 'tablespoons'],
  tsp: ['tsp', 'tsps', 'teaspoon', 'teaspoons'],
  oz: ['oz', 'ounce', 'ounces'],
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  g: ['g', 'gram', 'grams'],
  kg: ['kg', 'kilogram', 'kilograms'],
  ml: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
  l: ['l', 'liter', 'liters', 'litre', 'litres'],
  clove: ['clove', 'cloves'],
  pinch: ['pinch', 'pinches'],
  dash: ['dash', 'dashes'],
  can: ['can', 'cans'],
  slice: ['slice', 'slices'],
  piece: ['piece', 'pieces'],
  stick: ['stick', 'sticks'],
  bunch: ['bunch', 'bunches'],
  sprig: ['sprig', 'sprigs'],
  head: ['head', 'heads'],
  package: ['package', 'packages', 'pkg'],
  // Size words are stored as the unit ("3 large eggs" is 3 / large / eggs), as Spoonjoy recipes do.
  small: ['small'],
  medium: ['medium'],
  large: ['large'],
}

const UNIT_ALIASES = new Map(
  Object.entries(UNIT_GROUPS).flatMap(([canonical, names]) => names.map((name) => [name, canonical] as const))
)

const APPROXIMATE_PREFIXES = ['approximately ', 'approx. ', 'approx ', 'about ', 'around ', '~']
const BULLETS = '-*•–—'

type Read = [value: number, rest: string]

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character)
}

function stripLeadingMarkers(line: string): string {
  let result = line
  while (result.length > 0 && BULLETS.includes(result[0]!) && (result.length === 1 || isWhitespace(result[1]))) {
    result = result.slice(1).trimStart()
  }
  return result
}

function stripApproximateWords(line: string): string {
  let result = line
  let changed = true
  while (changed) {
    changed = false
    for (const prefix of APPROXIMATE_PREFIXES) {
      if (result.toLowerCase().startsWith(prefix)) {
        result = result.slice(prefix.length).trim()
        changed = true
      }
    }
  }
  return result
}

/** Reads "1.5", "3/4", ".5" or a lone unicode fraction from the start of `text`. */
function readSimpleNumber(text: string): Read | null {
  const first = text[0]
  if (first !== undefined && first in UNICODE_FRACTIONS) return [UNICODE_FRACTIONS[first]!, text.slice(1)]
  const numeric = /^[0-9./]+/.exec(text)?.[0]
  if (!numeric) return null
  const rest = text.slice(numeric.length)
  const parts = numeric.split('/')
  if (parts.length === 2) {
    const numerator = Number(parts[0])
    const denominator = Number(parts[1])
    if (parts[0] !== '' && parts[1] !== '' && Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0) {
      return [numerator / denominator, rest]
    }
    return null
  }
  if (parts.length === 1) {
    const value = Number(numeric)
    return Number.isFinite(value) ? [value, rest] : null
  }
  return null
}

function readFraction(text: string): Read | null {
  const first = text[0]
  if (first !== undefined && first in UNICODE_FRACTIONS) return [UNICODE_FRACTIONS[first]!, text.slice(1)]
  const read = readSimpleNumber(text)
  if (!read || !text.slice(0, text.length - read[1].length).includes('/')) return null
  return read
}

/** Reads one number, optionally followed by a fraction ("1 1/2" or "1½"). */
function readNumber(text: string): Read | null {
  const whole = readSimpleNumber(text)
  if (!whole) return null
  const [value, afterWhole] = whole
  if (!text.slice(0, text.length - afterWhole.length).includes('/') && Number.isInteger(value)) {
    const fraction = readFraction(afterWhole.replace(/^ +/, ''))
    if (fraction) return [value + fraction[0], fraction[1]]
  }
  return whole
}

/** Reads a quantity ("2", "1/2", "1 1/2", "2-3", "2 to 3") from the start of `text`; a range keeps its lower number. */
function leadingQuantity(text: string): Read | null {
  const first = readNumber(text)
  if (!first) return null
  const trimmed = first[1].trimStart()
  for (const separator of ['to ', '-', '–']) {
    if (trimmed.toLowerCase().startsWith(separator)) {
      const upper = readNumber(trimmed.slice(separator.length).trimStart())
      if (upper) return [first[0], upper[1]]
    }
  }
  return first
}

function canonicalUnit(token: string): string | undefined {
  return UNIT_ALIASES.get(token.toLowerCase().replace(/^[.,]+|[.,]+$/g, ''))
}

/** Parses one line, or returns null when it has no ingredient name. */
export function parseIngredientLine(line: string): ParsedIngredient | null {
  let rest = stripApproximateWords(stripLeadingMarkers(line.trim()))

  let quantity = 1
  const read = leadingQuantity(rest)
  if (read) {
    quantity = read[0]
    rest = read[1]
  }

  let unit = WHOLE_UNIT
  const tokens = rest.split(/\s+/).filter(Boolean)
  const canonical = tokens[0] === undefined ? undefined : canonicalUnit(tokens[0])
  if (canonical) {
    unit = canonical
    tokens.shift()
    if (tokens[0]?.toLowerCase() === 'of') tokens.shift()
  }

  const ingredientName = tokens.join(' ').trim()
  if (!ingredientName) return null
  return { quantity, unit, ingredientName }
}

/** Parses a block of text, one ingredient per non-empty line. */
export function parseIngredientText(text: string): ParsedIngredient[] {
  return text.split(/\r\n|\r|\n/).flatMap((line) => {
    const parsed = parseIngredientLine(line)
    return parsed ? [parsed] : []
  })
}
