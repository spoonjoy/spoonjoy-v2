import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { RecipeGrid, type PantryRecipeCard } from '~/components/pantry/RecipeGrid'
import { CookbookCoverArt } from '~/components/cookbook/CookbookCoverArt'
import { listImageProps, LIST_EAGER_COUNT } from '~/lib/image-loading'

function recipes(count: number): PantryRecipeCard[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r-${i}`,
    title: `Recipe ${i}`,
    coverImageUrl: `https://images.example.com/r-${i}.jpg`,
    href: `/recipes/r-${i}`,
  }))
}

function imagePreloads(html: string) {
  return html.match(/<link[^>]*rel="preload"[^>]*as="image"[^>]*>/g) ?? []
}

function imgTags(html: string) {
  return html.match(/<img[^>]*>/g) ?? []
}

describe('list image loading', () => {
  it('preloads only the first screen of a long recipe list during SSR', () => {
    const html = renderToString(
      <MemoryRouter>
        <RecipeGrid recipes={recipes(40)} />
      </MemoryRouter>,
    )

    // React 19 emits a preload for every <img> that is not loading="lazy".
    expect(imagePreloads(html).length).toBeLessThanOrEqual(LIST_EAGER_COUNT)
    const imgs = imgTags(html)
    expect(imgs).toHaveLength(40)
    expect(imgs.filter((tag) => tag.includes('loading="lazy"'))).toHaveLength(40 - LIST_EAGER_COUNT)
    expect(imgs[0]).toMatch(/fetchPriority="high"|fetchpriority="high"/)
    expect(imgs.every((tag) => tag.includes('decoding="async"'))).toBe(true)
  })

  it('loads shelf covers lazily but the cookbook page cover eagerly at high priority', () => {
    const images = [0, 1, 2, 3].map((i) => ({ coverImageUrl: `https://images.example.com/c-${i}.jpg`, title: `C${i}` }))
    const shelf = renderToString(<CookbookCoverArt title="Weeknights" recipeCount={4} recipeImages={images} />)
    expect(imagePreloads(shelf)).toHaveLength(0)
    expect(imgTags(shelf).every((tag) => tag.includes('loading="lazy"'))).toBe(true)

    const hero = renderToString(<CookbookCoverArt title="Weeknights" recipeCount={4} recipeImages={images} priority />)
    expect(imgTags(hero).every((tag) => /fetchPriority="high"|fetchpriority="high"/.test(tag))).toBe(true)
  })

  it('keeps the first card eager and only prioritizes it when no hero sits above the list', () => {
    expect(listImageProps(0)).toMatchObject({ loading: 'eager', fetchPriority: 'high' })
    expect(listImageProps(0, { prioritizeFirst: false })).toEqual({ loading: 'eager', decoding: 'async' })
    expect(listImageProps(LIST_EAGER_COUNT - 1).loading).toBe('eager')
    expect(listImageProps(LIST_EAGER_COUNT)).toEqual({ loading: 'lazy', decoding: 'async' })
  })
})
