import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { RecipeGrid, type PantryRecipeCard } from '~/components/pantry/RecipeGrid'

const recipes: PantryRecipeCard[] = [
  {
    id: 'r-1',
    title: 'Lemon Pasta',
    description: 'Bright pasta with garlic and lemon zest.',
    coverImageUrl: 'https://images.example.com/lemon-pasta.jpg',
    difficulty: 'Easy',
    cookTimeMinutes: 20,
    servings: '4',
    coverProvenanceLabel: 'Original photo',
  },
  {
    id: 'r-2',
    title: 'Spiced Chickpea Bowl',
    description: 'Roasted chickpeas with tahini drizzle.',
    difficulty: 'Medium',
    cookTimeMinutes: 35,
  },
]

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('RecipeGrid', () => {
  it('keeps recipe content and total count while growing the list through its next-page link', () => {
    const load = vi.fn()
    renderWithRouter(<RecipeGrid recipes={recipes} totalCount={55} loadMore={{
      hasMore: true, loading: false, href: '/users/ari?after=r-2', onShowMore: load,
    }} />)
    expect(screen.getByText('55 recipes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Lemon Pasta/ })).toHaveAttribute('href', '/recipes/r-1')
    expect(screen.getByRole('link', { name: /Lemon Pasta/ }).closest('article')).toHaveAttribute('data-ouro', 'item')
    const next = screen.getByRole('link', { name: 'Show more recipes' })
    expect(next).toHaveAttribute('href', '/users/ari?after=r-2')
    fireEvent.click(next)
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('renders recipe cards with titles and links', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    expect(screen.getByRole('link', { name: /lemon pasta/i })).toHaveAttribute('href', '/recipes/r-1')
    expect(screen.getByRole('link', { name: /spiced chickpea bowl/i })).toHaveAttribute('href', '/recipes/r-2')
  })

  it('marks the cover decorative because the title already names the link', () => {
    const { container } = renderWithRouter(<RecipeGrid recipes={recipes} />)

    const img = container.querySelector('img[src="https://images.example.com/lemon-pasta.jpg"]')
    expect(img).toHaveAttribute('alt', '')
  })

  it('names each row link by its title, as an HX Item in a list of recipes', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    const link = screen.getByRole('link', { name: 'Lemon Pasta' })
    expect(link).toHaveAttribute('href', '/recipes/r-1')
    expect(screen.getByRole('list', { name: 'Recipes' })).toContainElement(link)
    // The section's heading already says "Recipes"; the list is named for screen readers only.
    expect(screen.getAllByText('Recipes')).toHaveLength(1)
  })

  it('lists a growing list as plain rows with a hairline between them, as the divided list does', () => {
    const { container } = renderWithRouter(<RecipeGrid recipes={recipes} totalCount={55} loadMore={{
      hasMore: true, loading: false, href: '/users/ari?after=r-2', onShowMore: vi.fn(),
    }} />)
    for (const name of [/Lemon Pasta/, /Spiced Chickpea Bowl/]) {
      expect(screen.getByRole('link', { name }).closest('[data-ouro="item"]')).not.toHaveClass('border')
    }
    expect(container.querySelector('[data-ouro="show-more"]')).toHaveClass('sj-hairline-rows')
  })

  it('shows Ouro UI\'s Cover when a recipe has no photo, not a dark "Cover coming soon" box', () => {
    const { container } = renderWithRouter(<RecipeGrid recipes={recipes} />)

    expect(screen.queryByText('Cover coming soon')).not.toBeInTheDocument()
    const cover = container.querySelector('[data-ouro="cover"]')
    expect(cover).not.toBeNull()
    // Decoration beside the row's title, so it has no role of its own.
    expect(cover).not.toHaveAttribute('role')
    expect(cover).toHaveAttribute('data-shape', 'square')
  })

  it('renders cover provenance badges', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    expect(screen.getByText('Original photo')).toBeInTheDocument()
  })

  it('reads each row as its title and "Serves 4", with no description', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    expect(screen.getByText('Serves 4')).toBeInTheDocument()
    expect(screen.queryByText(/•/)).not.toBeInTheDocument()
  })

  it('does not double-prefix already-written servings phrases', () => {
    const recipe: PantryRecipeCard = { id: 'r-phrase', title: 'Party Pizza', servings: '2 pizzas' }
    renderWithRouter(<RecipeGrid recipes={[recipe]} />)

    expect(screen.getByText('2 pizzas')).toBeInTheDocument()
    expect(screen.queryByText('Serves 2 pizzas')).not.toBeInTheDocument()
  })

  it('does not render metadata row when the recipe states no servings', () => {
    renderWithRouter(<RecipeGrid recipes={[recipes[1]]} />)

    expect(screen.queryByText(/Serves/)).not.toBeInTheDocument()
  })

  it('renders servings alone', () => {
    const recipe: PantryRecipeCard = { id: 'r-3', title: 'Test', servings: '2' }
    renderWithRouter(<RecipeGrid recipes={[recipe]} />)

    expect(screen.getByText('Serves 2')).toBeInTheDocument()
    expect(screen.queryByText(/•/)).not.toBeInTheDocument()
  })

  it('renders total count', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    expect(screen.getByRole('heading', { level: 2, name: 'Recipes' })).toBeInTheDocument()
    expect(screen.getByText('2 recipes')).toBeInTheDocument()
  })

  it('renders empty state when no recipes are provided', () => {
    renderWithRouter(<RecipeGrid recipes={[]} />)

    expect(screen.getByText('No recipes yet')).toBeInTheDocument()
    expect(screen.getByText('Start by creating your first recipe for this pantry.')).toBeInTheDocument()
  })

  it('renders custom empty state props', () => {
    renderWithRouter(
      <RecipeGrid
        recipes={[]}
        emptyTitle="Nothing here"
        emptyMessage="Add some recipes"
        emptyCtaHref="/add"
      />
    )

    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('Add some recipes')).toBeInTheDocument()
  })

  it('hides the empty state CTA when explicitly disabled', () => {
    renderWithRouter(<RecipeGrid recipes={[]} emptyCtaHref={null} />)

    expect(screen.getByText('No recipes yet')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create recipe' })).toBeNull()
  })

  it('links each recipe to /recipes/:id', () => {
    const recipe: PantryRecipeCard = { id: 'abc', title: 'Soup' }
    renderWithRouter(<RecipeGrid recipes={[recipe]} />)

    expect(screen.getByRole('link', { name: /soup/i })).toHaveAttribute('href', '/recipes/abc')
  })
})
