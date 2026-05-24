import { Share2 } from 'lucide-react'
import { Heading } from '../ui/heading'
import { Link } from '../ui/link'

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

/**
 * Cookbook cover: 4+ recipes → 2×2 image grid, fewer → single hero or default.
 * Warm editorial cookbook cover with enough texture to feel like a real object.
 */
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
      {/* Cover image area */}
      <Link href={link} className="block">
        <div className="relative">
          {recipeImages.length >= 4 ? (
            <CoverGrid images={recipeImages.slice(0, 4)} />
          ) : recipeImages.length > 0 ? (
            <img
              src={recipeImages[0].coverImageUrl}
              alt={recipeImages[0].title}
              className="aspect-[4/3] w-full object-cover"
            />
          ) : (
            <div className="font-sj-ui flex aspect-[4/3] w-full items-center justify-center bg-[var(--sj-flour)] text-xs uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
              No recipes yet
            </div>
          )}

          {/* Share icon — top-right, same style as recipe quick actions */}
          <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              aria-label={`Share ${title}`}
              onClick={(e) => {
                e.preventDefault()
                onShare?.(id)
              }}
              className="rounded-[var(--sj-radius-control)] border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-panel-solid)_82%,transparent)] p-2 text-[var(--sj-ink-soft)] backdrop-blur-sm transition-colors hover:bg-[var(--sj-panel-solid)] hover:text-[var(--sj-tomato)]"
            >
              <Share2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </Link>

      {/* Editorial title + recipe count */}
      <div className="px-4 py-3">
        <Link href={link} className="no-underline hover:text-[var(--sj-tomato)]">
          <Heading level={3} className="text-xl/7 font-semibold tracking-[-0.02em]">
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

/** 2×2 grid of recipe hero images for cookbook covers */
function CoverGrid({ images }: { images: CookbookCardRecipeImage[] }) {
  return (
    <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2">
      {images.map((img, i) => (
        <img
          key={i}
          src={img.coverImageUrl}
          alt={img.title}
          className="h-full w-full object-cover"
        />
      ))}
    </div>
  )
}
