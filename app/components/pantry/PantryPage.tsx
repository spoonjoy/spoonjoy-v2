import { Button } from '../button'
import { Heading } from '~/components/ouro/text/heading'
import { Text } from '../text'
import { CookbookHeader, CookbookPage } from '~/components/cookbook/page'
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
    <CookbookPage>
      <CookbookHeader
        eyebrow="Pantry"
        title="Pantry"
        action={<Button href={createRecipeHref} className="w-full justify-center sm:w-auto">Create recipe</Button>}
      >
        <Text>Your personal kitchen profile with recipes and pantry-ready favorites.</Text>
      </CookbookHeader>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
        <aside className="lg:col-span-4">
          <BioCard {...profile} />
        </aside>

        <section className="lg:col-span-8">
          <Heading level={2} size="xl" className="mb-4">
            Pantry Recipes
          </Heading>
          <RecipeGrid recipes={recipes} />
        </section>
      </div>
    </CookbookPage>
  )
}
