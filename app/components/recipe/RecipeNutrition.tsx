import { DescriptionList } from '~/components/ouro/description-list/description-list'
import { Heading } from '~/components/ouro/text/heading'
import { Link } from '~/components/ouro/link/link'
import { Text } from '~/components/ouro/text/text'
import { formatGrams, recipeNutrition } from '~/domains/food-knowledge'

export interface RecipeNutritionProps {
  ingredients: readonly { name: string; quantity: number | string | null | undefined; unit: string | null | undefined }[]
  /** As the recipe writes it: "4", or "4-6", read as its first number. */
  servings: number | string | null | undefined
}

/**
 * A recipe's calories and macros per serving, from USDA FoodData Central, saying how many of its ingredients they
 * cover. Nothing when Spoonjoy can weigh none of them.
 */
export function RecipeNutrition({ ingredients, servings }: RecipeNutritionProps) {
  const nutrition = recipeNutrition(ingredients, typeof servings === 'string' ? Number.parseFloat(servings) : servings)
  if (nutrition.weighed === 0) return null
  const facts = nutrition.perServing ?? nutrition.total
  const whose = nutrition.perServing ? 'Per serving' : 'For the whole recipe'
  const noun = nutrition.of === 1 ? 'ingredient' : 'ingredients'
  return (
    <section className="mt-10 space-y-4" data-testid="recipe-nutrition" aria-labelledby="recipe-nutrition-heading">
      <Heading level={2} size="xl" id="recipe-nutrition-heading">
        Nutrition
      </Heading>
      <Text tone="muted">{`${whose}, from ${nutrition.weighed} of ${nutrition.of} ${noun}.`}</Text>
      <DescriptionList
        className="max-w-md"
        items={[
          { term: 'Calories', details: `${Math.round(facts.kcal)} kcal` },
          { term: 'Protein', details: formatGrams(facts.protein) },
          { term: 'Carbohydrate', details: formatGrams(facts.carbs) },
          { term: 'Fat', details: formatGrams(facts.fat) },
          { term: 'Fiber', details: formatGrams(facts.fiber) },
        ]}
      />
      <Text tone="muted" size="sm">
        Estimated from <Link href="https://fdc.nal.usda.gov/">USDA FoodData Central</Link>.
      </Text>
    </section>
  )
}
