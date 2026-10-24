import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { CookbookCard, type CookbookCardProps } from '~/components/pantry/CookbookCard'

const fourImages = [
  { coverImageUrl: '/img/a.jpg', title: 'Recipe A' },
  { coverImageUrl: '/img/b.jpg', title: 'Recipe B' },
  { coverImageUrl: '/img/c.jpg', title: 'Recipe C' },
  { coverImageUrl: '/img/d.jpg', title: 'Recipe D' },
]

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

const base: CookbookCardProps = {
  id: 'cb-1',
  title: 'Italian Classics',
  recipeCount: 12,
  recipeImages: fourImages,
}

describe('CookbookCard', () => {
  it('renders title and recipe count', () => {
    renderWithRouter(<CookbookCard {...base} />)

    expect(screen.getAllByText('Italian Classics').length).toBeGreaterThan(0)
    expect(screen.getAllByText('12 recipes').length).toBeGreaterThan(0)
  })

  it('renders singular "recipe" when count is 1', () => {
    renderWithRouter(<CookbookCard {...base} recipeCount={1} />)

    expect(screen.getAllByText('1 recipe').length).toBeGreaterThan(0)
  })

  it('links to cookbook page', () => {
    renderWithRouter(<CookbookCard {...base} />)

    const links = screen.getAllByRole('link', { name: /italian classics/i })
    expect(links[0]).toHaveAttribute('href', '/cookbooks/cb-1')
  })

  // #19 — 4-image grid cover
  it('renders 2×2 image grid when 4+ recipe images provided', () => {
    const { container } = renderWithRouter(<CookbookCard {...base} />)

    const imgs = container.querySelectorAll('img')
    expect(imgs.length).toBe(4)
    expect(imgs[0]).toHaveAttribute('src', '/img/a.jpg')
    expect(imgs[3]).toHaveAttribute('src', '/img/d.jpg')
  })

  it('renders only first 4 images even if more provided', () => {
    const fiveImages = [...fourImages, { coverImageUrl: '/img/e.jpg', title: 'Recipe E' }]
    const { container } = renderWithRouter(<CookbookCard {...base} recipeImages={fiveImages} />)

    expect(container.querySelectorAll('img').length).toBe(4)
  })

  it('renders single hero image when fewer than 4 images', () => {
    const { container } = renderWithRouter(
      <CookbookCard {...base} recipeImages={[fourImages[0]]} />
    )

    const imgs = container.querySelectorAll('img')
    expect(imgs.length).toBe(1)
    expect(imgs[0]).toHaveAttribute('alt', 'Recipe A')
  })

  it('renders default placeholder when no recipe images', () => {
    renderWithRouter(<CookbookCard {...base} recipeImages={[]} />)

    expect(screen.getAllByText('Italian Classics').length).toBeGreaterThan(0)
    expect(screen.getAllByText('12 recipes').length).toBeGreaterThan(0)
    expect(screen.getByText('Spoonjoy')).toBeInTheDocument()
  })

  it('renders default placeholder when recipeImages not provided', () => {
    renderWithRouter(<CookbookCard id="cb-2" title="Empty" recipeCount={0} />)

    expect(screen.getAllByText('Empty').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0 recipes').length).toBeGreaterThan(0)
  })

  it('is one HX Card link named by its title, with the count as its description', () => {
    renderWithRouter(<CookbookCard {...base} />)

    const card = screen.getByRole('article')
    expect(card).toHaveAttribute('data-ouro', 'card')
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 3, name: 'Italian Classics' })).toBeInTheDocument()
  })

  it('does not render emoji tiles', () => {
    const { container } = renderWithRouter(<CookbookCard {...base} />)

    expect(container.textContent).not.toContain('📖')
  })
})
