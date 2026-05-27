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
    href: '/recipes/r-1',
  },
  {
    id: 'r-2',
    title: 'Spiced Chickpea Bowl',
    description: 'Roasted chickpeas with tahini drizzle.',
    difficulty: 'Medium',
    cookTimeMinutes: 35,
    href: '/recipes/r-2',
  },
]

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('RecipeGrid', () => {
  it('renders recipe cards with titles and links', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    expect(screen.getByRole('link', { name: /lemon pasta/i })).toHaveAttribute('href', '/recipes/r-1')
    expect(screen.getByRole('link', { name: /spiced chickpea bowl/i })).toHaveAttribute('href', '/recipes/r-2')
  })

  it('renders hero images with correct alt text', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    const img = screen.getByAltText('Lemon Pasta')
    expect(img).toHaveAttribute('src', 'https://images.example.com/lemon-pasta.jpg')
  })

  it('renders placeholder when image is missing', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    expect(screen.getByText('No photo')).toBeInTheDocument()
  })

  it('renders servings and chef name metadata', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    expect(screen.getByText('Serves 4')).toBeInTheDocument()
    expect(screen.getByText('Chef Mario')).toBeInTheDocument()
  })

  it('does not double-prefix already-written servings phrases', () => {
    const recipe: PantryRecipeCard = { id: 'r-phrase', title: 'Party Pizza', servings: '2 pizzas' }
    renderWithRouter(<RecipeGrid recipes={[recipe]} />)

    expect(screen.getByText('2 pizzas')).toBeInTheDocument()
    expect(screen.queryByText('Serves 2 pizzas')).not.toBeInTheDocument()
  })

  it('renders dot separator between servings and chef name', () => {
    renderWithRouter(<RecipeGrid recipes={recipes} />)

    expect(screen.getByText('•')).toBeInTheDocument()
  })

  it('does not render metadata row when neither servings nor chefName provided', () => {
    renderWithRouter(<RecipeGrid recipes={[recipes[1]]} />)

    expect(screen.queryByText(/Serves/)).not.toBeInTheDocument()
  })

  it('renders servings only without separator when no chefName', () => {
    const recipe: PantryRecipeCard = { id: 'r-3', title: 'Test', servings: '2' }
    renderWithRouter(<RecipeGrid recipes={[recipe]} />)

    expect(screen.getByText('Serves 2')).toBeInTheDocument()
    expect(screen.queryByText('·')).not.toBeInTheDocument()
  })

  it('renders chefName only without separator when no servings', () => {
    const recipe: PantryRecipeCard = { id: 'r-4', title: 'Test', chefName: 'Anna' }
    renderWithRouter(<RecipeGrid recipes={[recipe]} />)

    expect(screen.getByText('Anna')).toBeInTheDocument()
    expect(screen.queryByText('·')).not.toBeInTheDocument()
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
    expect(screen.queryByRole('link', { name: 'Create Recipe' })).toBeNull()
  })

  it('defaults href to /recipes/:id when no href provided', () => {
    const recipe: PantryRecipeCard = { id: 'abc', title: 'Soup' }
    renderWithRouter(<RecipeGrid recipes={[recipe]} />)

    expect(screen.getByRole('link', { name: /soup/i })).toHaveAttribute('href', '/recipes/abc')
  })

  // Quick actions tests (#17)
  it('renders Share and Save buttons when handlers are provided', () => {
    renderWithRouter(<RecipeGrid recipes={[recipes[0]]} onShare={vi.fn()} onSave={vi.fn()} />)

    expect(screen.getByLabelText('Share Lemon Pasta')).toBeInTheDocument()
    expect(screen.getByLabelText('Save Lemon Pasta')).toBeInTheDocument()
  })

  it('hides quick action buttons when handlers are not provided', () => {
    renderWithRouter(<RecipeGrid recipes={[recipes[0]]} />)

    expect(screen.queryByLabelText('Share Lemon Pasta')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Save Lemon Pasta')).not.toBeInTheDocument()
  })

  it('renders only Share when only onShare is provided', () => {
    renderWithRouter(<RecipeGrid recipes={[recipes[0]]} onShare={vi.fn()} />)

    expect(screen.getByLabelText('Share Lemon Pasta')).toBeInTheDocument()
    expect(screen.queryByLabelText('Save Lemon Pasta')).not.toBeInTheDocument()
  })

  it('renders only Save when only onSave is provided', () => {
    renderWithRouter(<RecipeGrid recipes={[recipes[0]]} onSave={vi.fn()} />)

    expect(screen.queryByLabelText('Share Lemon Pasta')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Save Lemon Pasta')).toBeInTheDocument()
  })

  it('calls onShare with recipe id when Share is clicked', () => {
    const onShare = vi.fn()
    renderWithRouter(<RecipeGrid recipes={[recipes[0]]} onShare={onShare} />)

    fireEvent.click(screen.getByLabelText('Share Lemon Pasta'))
    expect(onShare).toHaveBeenCalledWith('r-1')
  })

  it('calls onSave with recipe id when Save is clicked', () => {
    const onSave = vi.fn()
    renderWithRouter(<RecipeGrid recipes={[recipes[0]]} onSave={onSave} />)

    fireEvent.click(screen.getByLabelText('Save Lemon Pasta'))
    expect(onSave).toHaveBeenCalledWith('r-1')
  })

  it('keeps the action rail out of the DOM when no handlers are provided', () => {
    const { container } = renderWithRouter(<RecipeGrid recipes={[recipes[0]]} />)

    expect(screen.queryByTestId('recipe-grid-actions')).toBeNull()
  })

  it('uses a ruled photo-index treatment instead of a card shell', () => {
    const { container } = renderWithRouter(<RecipeGrid recipes={[recipes[0]]} />)

    const tile = container.querySelector('.sj-photo-tile')
    expect(tile?.className).not.toContain('rounded')
    expect(container.querySelector('.sj-list-ruled')).not.toBeNull()
    expect(container.querySelector('.sj-card')).toBeNull()
  })

  it('keeps the layout free of generic hover-lift card affordances', () => {
    const { container } = renderWithRouter(<RecipeGrid recipes={[recipes[0]]} />)

    const article = container.querySelector('article')
    expect(article?.className).not.toContain('sj-hover-lift')
    expect(article?.className).not.toContain('shadow-lg')
    expect(article?.className).not.toContain('shadow-md')
  })

  it('renders image inside a landscape-to-square photo tile for a ruled index layout', () => {
    const { container } = renderWithRouter(<RecipeGrid recipes={[recipes[0]]} />)

    const tile = container.querySelector('.sj-photo-tile')
    expect(tile?.className).toContain('aspect-[4/3]')
    expect(tile?.className).toContain('sm:aspect-square')
  })
})
