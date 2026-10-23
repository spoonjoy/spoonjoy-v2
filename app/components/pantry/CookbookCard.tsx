import { Card } from '~/components/ouro/card/card'
import { CookbookCoverArt } from '../cookbook/CookbookCoverArt'

export interface CookbookCardRecipeImage {
  coverImageUrl: string | null
  title: string
  coverProvenanceLabel?: string | null
}

export interface CookbookCardProps {
  id: string
  title: string
  recipeCount: number
  /** First up-to-4 recipe images for the cover grid */
  recipeImages?: CookbookCardRecipeImage[]
}

/** A cookbook on a chef's page: HX Card, linked to the cookbook, with its cover art as the media. */
export function CookbookCard({ id, title, recipeCount, recipeImages = [] }: CookbookCardProps) {
  return (
    <Card
      as="article"
      href={`/cookbooks/${id}`}
      title={title}
      description={`${recipeCount} ${recipeCount === 1 ? 'recipe' : 'recipes'}`}
      size="sm"
      media={
        <CookbookCoverArt
          title={title}
          recipeCount={recipeCount}
          recipeImages={recipeImages}
          titleAsHeading={false}
          className="aspect-[4/3] border-0 shadow-none"
        />
      }
    />
  )
}
