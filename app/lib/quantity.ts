import Fraction from 'fraction.js'

/**
 * Unicode fraction characters for common cooking fractions
 */
const UNICODE_FRACTIONS: Record<string, string> = {
  '1/2': '½',
  '1/3': '⅓',
  '2/3': '⅔',
  '1/4': '¼',
  '3/4': '¾',
  '1/5': '⅕',
  '2/5': '⅖',
  '3/5': '⅗',
  '4/5': '⅘',
  '1/6': '⅙',
  '5/6': '⅚',
  '1/8': '⅛',
  '3/8': '⅜',
  '5/8': '⅝',
  '7/8': '⅞',
}

/**
 * Converts a fraction string (e.g., "1/2") to its Unicode character if available
 */
function toUnicodeFraction(fractionStr: string): string {
  return UNICODE_FRACTIONS[fractionStr] || fractionStr
}

/**
 * Rounds a number to the nearest common cooking fraction (1/8 precision for most values)
 */
function roundToNearestFraction(n: number): Fraction {
  // First, check if we're already very close to a clean eighth
  // This takes priority over thirds/sixths matching
  const eighthsRounded = Math.round(n * 8) / 8
  if (Math.abs(n - eighthsRounded) < 0.02) {
    return new Fraction(eighthsRounded)
  }

  // Handle special cases for thirds (1/3, 2/3) which don't divide evenly by 1/8
  const thirds = [1 / 3, 2 / 3, 4 / 3, 5 / 3, 7 / 3, 8 / 3]
  for (const third of thirds) {
    if (Math.abs(n - third) < 0.05) {
      return new Fraction(third)
    }
  }

  // Handle sixths (1/6, 5/6)
  const sixths = [1 / 6, 5 / 6, 7 / 6, 11 / 6]
  for (const sixth of sixths) {
    if (Math.abs(n - sixth) < 0.03) {
      return new Fraction(sixth)
    }
  }

  // Round to nearest 1/8 for other values
  return new Fraction(eighthsRounded)
}

/**
 * Formats a number as a pretty fraction string using Unicode characters
 *
 * @param quantity - The number to format
 * @returns A formatted string with Unicode fractions (e.g., "1 ½", "¼", "3")
 *
 * @example
 * formatQuantity(1.5) // "1 ½"
 * formatQuantity(0.25) // "¼"
 * formatQuantity(2) // "2"
 */
export function formatQuantity(quantity: number): string {
  // Handle null, undefined, and NaN
  if (quantity == null || Number.isNaN(quantity)) {
    return ''
  }

  // Handle negative numbers
  const isNegative = quantity < 0
  const absQuantity = Math.abs(quantity)

  // Round to nearest common fraction
  const fraction = roundToNearestFraction(absQuantity)

  // Get the fraction string (e.g., "1 1/2" or "1/4")
  const fractionStr = fraction.toFraction(true) // true = mixed fractions

  // Handle zero
  if (fractionStr === '0') {
    return '0'
  }

  // Parse and convert to Unicode fractions
  const parts = fractionStr.split(' ')
  let result: string

  if (parts.length === 2) {
    // Mixed fraction: "1 1/2" -> "1 ½"
    const whole = parts[0]
    const frac = toUnicodeFraction(parts[1])
    result = `${whole} ${frac}`
  } else if (parts[0].includes('/')) {
    // Simple fraction: "1/2" -> "½"
    result = toUnicodeFraction(parts[0])
  } else {
    // Whole number: "2" -> "2"
    result = parts[0]
  }

  // Add negative sign if needed
  if (isNegative && result !== '0') {
    result = `-${result}`
  }

  return result
}

/**
 * Scales a quantity by a factor
 *
 * @param quantity - The original quantity
 * @param scaleFactor - The factor to multiply by
 * @returns The scaled quantity
 *
 * @example
 * scaleQuantity(2, 1.5) // 3
 * scaleQuantity(0.5, 2) // 1
 */
export function scaleQuantity(quantity: number, scaleFactor: number): number {
  // Handle null/undefined
  if (quantity == null || scaleFactor == null) {
    return 0
  }

  return quantity * scaleFactor
}

/**
 * Scales all numbers in a servings text string
 *
 * @param text - The servings text (e.g., "Serves 4", "Makes 12 cookies")
 * @param scaleFactor - The factor to multiply by
 * @returns The text with all numbers scaled
 *
 * @example
 * scaleServingsText("Serves 4", 2) // "Serves 8"
 * scaleServingsText("Feeds 2-4 people", 2) // "Feeds 4-8 people"
 */
export function scaleServingsText(text: string, scaleFactor: number): string {
  // Handle null/undefined
  if (text == null) {
    return ''
  }

  if (text === '') {
    return ''
  }

  // Match integers and decimals
  const numberRegex = /(\d+\.?\d*)/g

  return text.replace(numberRegex, (match) => {
    const num = parseFloat(match)
    const scaled = num * scaleFactor

    // If the result is a whole number, return it as such
    if (Number.isInteger(scaled)) {
      return String(scaled)
    }

    // Otherwise, format as a pretty fraction
    return formatQuantity(scaled)
  })
}

/**
 * Formats a stored recipe servings value for static labels.
 *
 * The schema stores freeform text, so avoid producing awkward doubles like
 * "Serves 4 servings" when the author already wrote a full phrase.
 */
export function formatServingsLabel(text: string | null | undefined): string {
  if (text == null) {
    return ''
  }

  const trimmed = text.trim()
  if (trimmed === '') {
    return ''
  }

  if (/^(serves?|servings?|makes?|yields?|feeds?|for)\b/i.test(trimmed)) {
    return trimmed
  }

  if (/^\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?$/.test(trimmed)) {
    return `Serves ${trimmed}`
  }

  return trimmed
}
