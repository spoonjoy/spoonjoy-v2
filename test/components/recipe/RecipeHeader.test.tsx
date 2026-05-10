import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { BrowserRouter } from 'react-router'
import { RecipeHeader } from '../../../app/components/recipe/RecipeHeader'

function renderWithRouter(ui: React.ReactElement) {
  return render(<BrowserRouter>{ui}</BrowserRouter>)
}

describe('RecipeHeader', () => {
  const legacyDefaultImageUrl =
    'https://res.cloudinary.com/dpjmyc4uz/image/upload/v1674541350/clbe7wr180009tkhggghtl1qd.png'

  const defaultProps = {
    title: 'Test Recipe',
    chefName: 'Test Chef',
    scaleFactor: 1,
    onScaleChange: vi.fn(),
  }

  describe('chef information', () => {
    it('renders chef name without link when chefId is not provided', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} />)

      const chefName = screen.getByText((content, element) => {
        return element?.tagName === 'STRONG' && element?.textContent === 'Test Chef'
      })
      expect(chefName).toBeInTheDocument()
      expect(chefName.closest('a')).toBeNull()
    })

    it('renders chef name as link when chefId is provided', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} chefId="chef-456" />)

      const chefName = screen.getByText((content, element) => {
        return element?.tagName === 'STRONG' && element?.textContent === 'Test Chef'
      })
      expect(chefName).toBeInTheDocument()
      const link = chefName.closest('a')
      expect(link).toBeInTheDocument()
      expect(link).toHaveAttribute('href', '/users/chef-456')
    })

    it('prefers canonical chef profile href over chefId fallback', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} chefId="chef-456" chefProfileHref="/users/test-chef" />)

      const chefName = screen.getByText((content, element) => {
        return element?.tagName === 'STRONG' && element?.textContent === 'Test Chef'
      })
      expect(chefName.closest('a')).toHaveAttribute('href', '/users/test-chef')
    })

    it('renders chef avatar with initials', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} />)
      expect(screen.getByTestId('chef-avatar')).toBeInTheDocument()
    })

    it('renders chef avatar with photo when provided', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} chefPhotoUrl="https://example.com/photo.jpg" />)
      expect(screen.getByTestId('chef-avatar')).toBeInTheDocument()
    })
  })

  describe('title and description', () => {
    it('renders recipe title', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} />)
      expect(screen.getByRole('heading', { name: 'Test Recipe' })).toBeInTheDocument()
    })

    it('renders description when provided', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} description="A delicious test recipe" />)
      expect(screen.getByText('A delicious test recipe')).toBeInTheDocument()
    })

    it('does not render description section when not provided', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} />)
      expect(screen.queryByText(/delicious/)).toBeNull()
    })
  })

  describe('recipe image', () => {
    it('renders recipe image when imageUrl is provided', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} imageUrl="https://example.com/recipe.jpg" />)

      expect(screen.getByTestId('recipe-image')).toBeInTheDocument()
      const img = screen.getByAltText('Photo of Test Recipe')
      expect(img).toHaveAttribute('src', 'https://example.com/recipe.jpg')
    })

    it('renders placeholder when imageUrl is not provided', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} />)
      expect(screen.getByTestId('recipe-image-placeholder')).toBeInTheDocument()
      expect(screen.getByText('No image available')).toBeInTheDocument()
    })

    it('renders placeholder for legacy default image URLs', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} imageUrl={legacyDefaultImageUrl} />)
      expect(screen.getByTestId('recipe-image-placeholder')).toBeInTheDocument()
      expect(screen.queryByTestId('recipe-image')).toBeNull()
    })
  })

  describe('scaling', () => {
    it('renders scale selector with current scale factor', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} scaleFactor={2} />)
      expect(screen.getByText('Servings:')).toBeInTheDocument()
    })

    it('calls onScaleChange when scale is changed', () => {
      const onScaleChange = vi.fn()
      renderWithRouter(<RecipeHeader {...defaultProps} onScaleChange={onScaleChange} />)
      expect(screen.getByText('Servings:')).toBeInTheDocument()
    })

    it('displays scaled servings when servings text is provided', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} servings="Serves 4" scaleFactor={2} />)
      expect(screen.getByText('Serves 8')).toBeInTheDocument()
    })

    it('does not display original servings note when scale factor is not 1', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} servings="Serves 4" scaleFactor={2} />)
      expect(screen.queryByText(/originally: Serves 4/)).toBeNull()
    })

    it('does not display original servings note when scale factor is 1', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} servings="Serves 4" scaleFactor={1} />)
      expect(screen.queryByText(/originally/)).toBeNull()
    })

    it('renders clear progress button when onClearProgress is provided', () => {
      const onClearProgress = vi.fn()
      renderWithRouter(<RecipeHeader {...defaultProps} onClearProgress={onClearProgress} />)
      expect(screen.getByRole('button', { name: 'Clear progress' })).toBeInTheDocument()
    })

    it('calls onClearProgress when button is clicked', async () => {
      const onClearProgress = vi.fn()
      renderWithRouter(<RecipeHeader {...defaultProps} onClearProgress={onClearProgress} />)
      await userEvent.click(screen.getByRole('button', { name: 'Clear progress' }))
      expect(onClearProgress).toHaveBeenCalledTimes(1)
    })

    it('does not render clear progress button when onClearProgress is not provided', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} />)
      expect(screen.queryByRole('button', { name: 'Clear progress' })).toBeNull()
    })
  })

  describe('no action buttons', () => {
    it('does not render edit, delete, share, or save buttons', () => {
      renderWithRouter(<RecipeHeader {...defaultProps} />)
      expect(screen.queryByRole('link', { name: /edit/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /share/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
    })
  })
})
