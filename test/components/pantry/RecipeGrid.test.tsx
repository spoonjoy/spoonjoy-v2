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
    chefName: 'Chef Mario',
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
    expect(screen.getByText('55 total')).toBeInTheDocument()
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
  })

  it('renders placeholder when image is missing', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    expect(screen.getByText('Cover coming soon')).toBeInTheDocument()
  })

  it('renders cover provenance badges', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    expect(screen.getByText('Original photo')).toBeInTheDocument()
  })

  it('renders servings and chef name metadata', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    expect(screen.getByText('Serves 4 • Chef Mario')).toBeInTheDocument()
  })

  it('does not double-prefix already-written servings phrases', () => {
    const recipe: PantryRecipeCard = { id: 'r-phrase', title: 'Party Pizza', servings: '2 pizzas' }
    renderWithRouter(<RecipeGrid recipes={[recipe]} />)

    expect(screen.getByText('2 pizzas')).toBeInTheDocument()
    expect(screen.queryByText('Serves 2 pizzas')).not.toBeInTheDocument()
  })

  it('does not render metadata row when neither servings nor chefName provided', () => {
    renderWithRouter(<RecipeGrid recipes={[recipes[1]]} />)

    expect(screen.queryByText(/Serves/)).not.toBeInTheDocument()
  })

  it('renders servings only without separator when no chefName', () => {
    const recipe: PantryRecipeCard = { id: 'r-3', title: 'Test', servings: '2' }
    renderWithRouter(<RecipeGrid recipes={[recipe]} />)

    expect(screen.getByText('Serves 2')).toBeInTheDocument()
    expect(screen.queryByText(/•/)).not.toBeInTheDocument()
  })

  it('renders chefName only without separator when no servings', () => {
    const recipe: PantryRecipeCard = { id: 'r-4', title: 'Test', chefName: 'Anna' }
    renderWithRouter(<RecipeGrid recipes={[recipe]} />)

    expect(screen.getByText('Anna')).toBeInTheDocument()
    expect(screen.queryByText(/•/)).not.toBeInTheDocument()
  })

  it('renders total count', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    expect(screen.getByText('2 total')).toBeInTheDocument()
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
