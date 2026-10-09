import {
  parseIngredients,
  type IngredientParserConfigInput,
  type IngredientParseTelemetry,
  type ParsedIngredient,
} from '~/lib/ingredient-parse.server'
import { parseIngredientText } from '~/lib/ingredient-text-parser'

/**
 * The recipe editor's parse: the AI parser when it answers, otherwise the deterministic
 * rule-based parser ({@link parseIngredientText}), so typed ingredients are never dropped
 * because AI parsing is unavailable (no API key, a provider outage, a timeout or an unusable
 * answer). It throws the AI parser's error only when the rules find no ingredient either.
 */
export async function parseIngredientsWithRulesFallback(
  text: string,
  configInput?: IngredientParserConfigInput,
  telemetry?: IngredientParseTelemetry
): Promise<ParsedIngredient[]> {
  try {
    return await parseIngredients(text, configInput, telemetry)
  } catch (error) {
    const ruleParsed = parseIngredientText(text)
    if (ruleParsed.length > 0) return ruleParsed
    throw error
  }
}
