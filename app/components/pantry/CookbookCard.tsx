import { Share2 } from 'lucide-react'
import { Heading } from '../ui/heading'
import { Link } from '../ui/link'
import { CookbookCoverArt } from '../cookbook/CookbookCoverArt'

export interface CookbookCardRecipeImage {
  coverImageUrl: string
  title: string
}

export interface CookbookCardProps {
  id: string
  title: string
  recipeCount: number
  /** First up-to-4 recipe images for the cover grid */
  recipeImages?: CookbookCardRecipeImage[]
  href?: string
  onShare?: (cookbookId: string) => void
}

export function CookbookCard({
  id,
  title,
  recipeCount,
  recipeImages = [],
  href,
  onShare,
}: CookbookCardProps) {
  const link = href ?? `/cookbooks/${id}`

  return (
    <article className="sj-hover-lift group relative overflow-hidden border border-[var(--sj-border-strong)] bg-[var(--sj-panel-solid)]">
      <Link href={link} className="block">
        <div className="relative">
          <CookbookCoverArt
            title={title}
            recipeCount={recipeCount}
            recipeImages={recipeImages}
            className="aspect-[4/3] border-0 shadow-none"
          />

          {onShare ? (
            <div className="absolute right-2 top-2">
              <button
                type="button"
                aria-label={`Share ${title}`}
                onClick={(e) => {
                  e.preventDefault()
                  onShare(id)
                }}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-[var(--sj-radius-control)] border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_82%,transparent)] text-[var(--sj-ink-soft)] backdrop-blur-sm transition-colors hover:bg-[var(--sj-panel-solid)] hover:text-[var(--sj-tomato)]"
              >
                <Share2 className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
      </Link>

      {/* Editorial title + recipe count */}
      <div className="px-4 py-3">
        <Link href={link} className="inline-flex min-h-11 items-center no-underline hover:text-[var(--sj-tomato)]">
          <Heading level={3} className="text-xl/7 font-semibold tracking-normal">
            {title}
          </Heading>
        </Link>
        <p className="font-sj-ui mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)]">
          {recipeCount} {recipeCount === 1 ? 'recipe' : 'recipes'}
        </p>
      </div>
    </article>
  )
}
