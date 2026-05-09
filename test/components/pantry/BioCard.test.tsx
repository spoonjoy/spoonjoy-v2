import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { BioCard } from '~/components/pantry/BioCard'

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('BioCard', () => {
  it('renders profile name and bio', () => {
    renderWithRouter(
      <BioCard
        name="Chef Rowan"
        bio="Home cook sharing weeknight comfort food."
        recipeCount={12}
        cookbookCount={3}
      />
    )

    expect(screen.getByRole('heading', { name: 'Chef Rowan' })).toBeInTheDocument()
    expect(screen.getByText('Home cook sharing weeknight comfort food.')).toBeInTheDocument()
  })

  it('renders profile link when profileHref is provided', () => {
    renderWithRouter(
      <BioCard
        name="Chef Rowan"
        bio="Bio"
        recipeCount={12}
        cookbookCount={3}
        profileHref="/users/chef-rowan"
      />
    )

    expect(screen.getByRole('link', { name: 'Chef Rowan' })).toHaveAttribute('href', '/users/chef-rowan')
  })

  it('shows profile stats as badges', () => {
    renderWithRouter(
      <BioCard
        name="Chef Rowan"
        bio="Bio"
        recipeCount={12}
        cookbookCount={3}
      />
    )

    expect(screen.getByText('12 recipes')).toBeInTheDocument()
    expect(screen.getByText('3 cookbooks')).toBeInTheDocument()
  })

  it('renders location and joined metadata when provided', () => {
    renderWithRouter(
      <BioCard
        name="Chef Rowan"
        bio="Bio"
        recipeCount={12}
        cookbookCount={3}
        location="Portland, OR"
        joinedLabel="Joined May 2026"
      />
    )

    expect(screen.getByText('Portland, OR • Joined May 2026')).toBeInTheDocument()
  })

  it('invokes edit profile callback when edit button is clicked', async () => {
    const onEditProfile = vi.fn()
    renderWithRouter(
      <BioCard
        name="Chef Rowan"
        bio="Bio"
        recipeCount={12}
        cookbookCount={3}
        onEditProfile={onEditProfile}
      />
    )

    await userEvent.click(screen.getByRole('button', { name: /edit profile/i }))
    expect(onEditProfile).toHaveBeenCalledTimes(1)
  })
})
