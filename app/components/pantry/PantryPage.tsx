import { Button } from '../ui/button'
import { Heading, Subheading } from '../ui/heading'
import { Text } from '../ui/text'
import { BioCard, type BioCardProps } from './BioCard'
import { RecipeGrid, type PantryRecipeCard } from './RecipeGrid'

export interface PantryPageProps {
  profile: BioCardProps
  recipes: PantryRecipeCard[]
  createRecipeHref?: string
}

export function PantryPage({
  profile,
  recipes,
  createRecipeHref = '/recipes/new',
}: PantryPageProps) {
  return (
    <div className="sj-page px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="sj-eyebrow">Pantry</p>
          <Heading level={1} className="mt-4 text-4xl/11 font-bold tracking-[-0.04em] sm:text-6xl/15">
            Pantry
          </Heading>
          <Text className="mt-3 max-w-2xl text-base/7">
            Your personal kitchen profile with recipes and pantry-ready favorites.
          </Text>
        </div>

        <Button href={createRecipeHref} className="w-full justify-center sm:w-auto">
          Create Recipe
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        <aside className="lg:col-span-4">
          <BioCard {...profile} />
        </aside>

        <section className="lg:col-span-8">
          <Subheading level={2} className="mb-4 text-2xl/8">
            Pantry Recipes
          </Subheading>
          <RecipeGrid recipes={recipes} />
        </section>
      </div>
      </div>
    </div>
  )
}
