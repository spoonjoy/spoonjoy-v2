import { Button } from '../ui/button'
import { Heading, Subheading } from '../ui/heading'
import { Text } from '../ui/text'
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
        action={<Button href={createRecipeHref} className="w-full justify-center sm:w-auto">Create Recipe</Button>}
      >
        <Text>Your personal kitchen profile with recipes and pantry-ready favorites.</Text>
      </CookbookHeader>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start">
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
    </CookbookPage>
  )
}
