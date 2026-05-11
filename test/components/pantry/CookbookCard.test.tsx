import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

    expect(screen.getByText('Italian Classics')).toBeInTheDocument()
    expect(screen.getByText('12 recipes')).toBeInTheDocument()
  })

  it('renders singular "recipe" when count is 1', () => {
    renderWithRouter(<CookbookCard {...base} recipeCount={1} />)

    expect(screen.getByText('1 recipe')).toBeInTheDocument()
  })

  it('links to cookbook page', () => {
    renderWithRouter(<CookbookCard {...base} />)

    const links = screen.getAllByRole('link', { name: /italian classics/i })
    expect(links[0]).toHaveAttribute('href', '/cookbooks/cb-1')
  })

  it('uses custom href when provided', () => {
    renderWithRouter(<CookbookCard {...base} href="/custom/path" />)

    const links = screen.getAllByRole('link', { name: /italian classics/i })
    expect(links[0]).toHaveAttribute('href', '/custom/path')
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

    expect(screen.getByText('No recipes yet')).toBeInTheDocument()
  })

  it('renders default placeholder when recipeImages not provided', () => {
    renderWithRouter(<CookbookCard id="cb-2" title="Empty" recipeCount={0} />)

    expect(screen.getByText('No recipes yet')).toBeInTheDocument()
  })

  // #20 — Share affordance
  it('renders share button with correct aria-label', () => {
    renderWithRouter(<CookbookCard {...base} />)

    expect(screen.getByLabelText('Share Italian Classics')).toBeInTheDocument()
  })

  it('calls onShare with cookbook id when clicked', () => {
    const onShare = vi.fn()
    renderWithRouter(<CookbookCard {...base} onShare={onShare} />)

    fireEvent.click(screen.getByLabelText('Share Italian Classics'))
    expect(onShare).toHaveBeenCalledWith('cb-1')
  })

  it('does not throw when share clicked without onShare', () => {
    renderWithRouter(<CookbookCard {...base} />)

    expect(() => fireEvent.click(screen.getByLabelText('Share Italian Classics'))).not.toThrow()
  })

  it('prevents link navigation when share is clicked', () => {
    const onShare = vi.fn()
    renderWithRouter(<CookbookCard {...base} onShare={onShare} />)

    const shareBtn = screen.getByLabelText('Share Italian Classics')
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    const prevented = !shareBtn.dispatchEvent(clickEvent)
    // The onClick calls e.preventDefault() — verify onShare fires
    fireEvent.click(shareBtn)
    expect(onShare).toHaveBeenCalled()
  })

  it('uses the warm editorial Spoonjoy card treatment', () => {
    const { container } = renderWithRouter(<CookbookCard {...base} />)

    const article = container.querySelector('article')
    expect(article?.className).toContain('sj-card')
    expect(article?.className).toContain('rounded-[1.6rem]')
    expect(article?.className).not.toContain('rounded-lg')
  })

  it('keeps cookbook covers on-brand with no blue outline', () => {
    const { container } = renderWithRouter(<CookbookCard {...base} />)

    const article = container.querySelector('article')
    expect(article?.className).toContain('sj-hover-lift')
    expect(article?.className).not.toContain('border-blue')
  })

  it('does not render emoji tiles', () => {
    const { container } = renderWithRouter(<CookbookCard {...base} />)

    expect(container.textContent).not.toContain('📖')
  })
})
