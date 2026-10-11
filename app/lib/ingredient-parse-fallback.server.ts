import {
  isIngredientParseLimitError,
  isIngredientParseTextTooLongError,
  parseIngredients,
  type IngredientParserConfigInput,
  type IngredientParseTelemetry,
  type ParsedIngredient,
} from '~/lib/ingredient-parse.server'
import { parseIngredientText } from '~/lib/ingredient-text-parser'
import { captureEvent } from '~/lib/analytics-server'

/**
 * The recipe editor's parse: the AI parser when it answers, otherwise the deterministic
 * rule-based parser ({@link parseIngredientText}), so typed ingredients are never dropped
 * because AI parsing is unavailable (no API key, a provider outage, a timeout, an unusable
 * answer, or the user's parse rate limit). It throws the AI parser's error only when the rules
 * find no ingredient either.
 *
 * Text over the length cap is the exception: it is refused with the parser's own message, so
 * the person sees why and can split it, instead of a silent rules-only result.
 */
export async function parseIngredientsWithRulesFallback(
  text: string,
  configInput?: IngredientParserConfigInput,
  telemetry?: IngredientParseTelemetry
): Promise<ParsedIngredient[]> {
  return parseWithRulesFallback(
    text,
    configInput,
    telemetry,
    (error) => !isIngredientParseTextTooLongError(error)
  )
}

/**
 * The recipe import's parse: the AI parser, falling back to the rule-based parser only when one
 * of our own caps refused the call (text too long, or the user's parse rate limit), so a cap
 * never fails an import that would otherwise save. Provider failures still fail the import, as
 * they did before the caps existed.
 */
export async function parseIngredientsWithRulesFallbackOnLimit(
  text: string,
  configInput?: IngredientParserConfigInput,
  telemetry?: IngredientParseTelemetry
): Promise<ParsedIngredient[]> {
  return parseWithRulesFallback(text, configInput, telemetry, isIngredientParseLimitError)
}

async function parseWithRulesFallback(
  text: string,
  configInput: IngredientParserConfigInput,
  telemetry: IngredientParseTelemetry | undefined,
  fallsBackOn: (error: unknown) => boolean
): Promise<ParsedIngredient[]> {
  try {
    return await parseIngredients(text, configInput, telemetry)
  } catch (error) {
    if (!fallsBackOn(error)) throw error
    const ruleParsed = parseIngredientText(text)
    // The AI parser reports its own provider failures; this records how often the editor fell
    // back to the rules, why, and whether the rules found anything.
    if (telemetry?.postHogConfig) {
      await captureEvent(
        telemetry.postHogConfig,
        {
          event: 'spoonjoy.ingredient_parse.rules_fallback',
          distinctId: telemetry.distinctId ?? 'anon',
          properties: {
            error_name: error instanceof Error ? error.name : typeof error,
            error_code: isIngredientParseLimitError(error) ? error.code : null,
            rule_parsed_count: ruleParsed.length,
          },
        },
        telemetry.fetchImpl
      )
    }
    if (ruleParsed.length > 0) return ruleParsed
    throw error
  }
}
