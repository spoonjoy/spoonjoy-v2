import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  SaveToCookbookDropdown,
  type Cookbook,
} from '../../../app/components/recipe/SaveToCookbookDropdown'

const sampleCookbooks: Cookbook[] = [
  { id: 'cb1', title: 'Weeknight Dinners' },
  { id: 'cb2', title: 'Holiday Favorites' },
  { id: 'cb3', title: 'Quick & Easy' },
]

describe('SaveToCookbookDropdown', () => {
  describe('rendering', () => {
    it('treats a null cookbook collection defensively as empty', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={null as unknown as Cookbook[]}
          onSave={vi.fn()}
        />
      )

      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(screen.getByText(/no cookbooks yet/i)).toBeInTheDocument()
    })

    it('renders save button', () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
        />
      )
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
    })

    it('renders bookmark icon', () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
        />
      )
      const button = screen.getByRole('button', { name: /save/i })
      expect(button.querySelector('svg')).toBeInTheDocument()
    })

    it('opens dropdown when clicked', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      expect(screen.getByText('Weeknight Dinners')).toBeInTheDocument()
    })

    it('shows all cookbooks in dropdown', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      for (const cookbook of sampleCookbooks) {
        expect(screen.getByText(cookbook.title)).toBeInTheDocument()
      }
    })
  })

  describe('selection behavior', () => {
    it('calls onSave when cookbook is selected', async () => {
      const onSave = vi.fn()
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={onSave}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText('Holiday Favorites'))

      expect(onSave).toHaveBeenCalledWith('cb2')
    })

    it('marks already-saved cookbooks', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          savedInCookbookIds={new Set(['cb1', 'cb3'])}
          onSave={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(screen.getByText(/Weeknight Dinners.*✓/)).toBeInTheDocument()
      expect(screen.getByText(/Quick & Easy.*✓/)).toBeInTheDocument()
    })

    it('does not call onSave for already-saved cookbook', async () => {
      const onSave = vi.fn()
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          savedInCookbookIds={new Set(['cb1'])}
          onSave={onSave}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      const savedItem = screen.getByText(/Weeknight Dinners.*✓/)
      await userEvent.click(savedItem)

      expect(onSave).not.toHaveBeenCalled()
    })
  })

  describe('create new cookbook (legacy onCreateNew)', () => {
    it('shows create new option when onCreateNew provided', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
          onCreateNew={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(screen.getByText(/create new cookbook/i)).toBeInTheDocument()
    })

    it('calls onCreateNew when clicked (no onCreateAndSave)', async () => {
      const onCreateNew = vi.fn()
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
          onCreateNew={onCreateNew}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText(/create new cookbook/i))

      expect(onCreateNew).toHaveBeenCalled()
    })

    it('does not show create option when neither onCreateNew nor onCreateAndSave provided', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(screen.queryByText(/create new cookbook/i)).toBeNull()
    })
  })

  describe('inline create cookbook (onCreateAndSave)', () => {
    it('shows inline input when create is clicked with onCreateAndSave', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
          onCreateAndSave={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText(/create new cookbook/i))

      expect(screen.getByTestId('inline-create-cookbook')).toBeInTheDocument()
      expect(screen.getByLabelText(/new cookbook name/i)).toBeInTheDocument()
    })

    it('calls onCreateAndSave on submit', async () => {
      const onCreateAndSave = vi.fn()
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
          onCreateAndSave={onCreateAndSave}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText(/create new cookbook/i))

      const input = screen.getByLabelText(/new cookbook name/i)
      await userEvent.type(input, 'My New Cookbook')
      await userEvent.click(screen.getByRole('button', { name: /^create$/i }))

      expect(onCreateAndSave).toHaveBeenCalledWith('My New Cookbook')
    })

    it('calls onCreateAndSave on Enter key', async () => {
      const onCreateAndSave = vi.fn()
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
          onCreateAndSave={onCreateAndSave}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText(/create new cookbook/i))

      const input = screen.getByLabelText(/new cookbook name/i)
      await userEvent.type(input, 'Enter Cookbook{Enter}')

      expect(onCreateAndSave).toHaveBeenCalledWith('Enter Cookbook')
    })

    it('cancels inline create on Escape key', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
          onCreateAndSave={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText(/create new cookbook/i))

      expect(screen.getByTestId('inline-create-cookbook')).toBeInTheDocument()

      const input = screen.getByLabelText(/new cookbook name/i)
      await userEvent.type(input, '{Escape}')

      expect(screen.queryByTestId('inline-create-cookbook')).not.toBeInTheDocument()
    })

    it('cancels inline create on Cancel button click', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
          onCreateAndSave={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText(/create new cookbook/i))

      expect(screen.getByTestId('inline-create-cookbook')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(screen.queryByTestId('inline-create-cookbook')).not.toBeInTheDocument()
    })

    it('does not submit with empty/whitespace title', async () => {
      const onCreateAndSave = vi.fn()
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
          onCreateAndSave={onCreateAndSave}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText(/create new cookbook/i))

      // Try to submit with empty input
      await userEvent.click(screen.getByRole('button', { name: /^create$/i }))
      expect(onCreateAndSave).not.toHaveBeenCalled()

      // Try with whitespace only
      const input = screen.getByLabelText(/new cookbook name/i)
      await userEvent.type(input, '   {Enter}')
      expect(onCreateAndSave).not.toHaveBeenCalled()
    })

    it('trims whitespace from title before submitting', async () => {
      const onCreateAndSave = vi.fn()
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
          onCreateAndSave={onCreateAndSave}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText(/create new cookbook/i))

      const input = screen.getByLabelText(/new cookbook name/i)
      await userEvent.type(input, '  Trimmed Title  {Enter}')

      expect(onCreateAndSave).toHaveBeenCalledWith('Trimmed Title')
    })

    it('resets input after successful submit', async () => {
      const onCreateAndSave = vi.fn()
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
          onCreateAndSave={onCreateAndSave}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText(/create new cookbook/i))

      const input = screen.getByLabelText(/new cookbook name/i)
      await userEvent.type(input, 'Test{Enter}')

      // After submit, inline form should be hidden (reset)
      expect(screen.queryByTestId('inline-create-cookbook')).not.toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows empty message when no cookbooks', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={[]}
          onSave={vi.fn()}
          onCreateAndSave={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(screen.getByText(/no cookbooks yet/i)).toBeInTheDocument()
    })

    it('shows create first cookbook option when empty', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={[]}
          onSave={vi.fn()}
          onCreateNew={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(screen.getByText(/create your first cookbook/i)).toBeInTheDocument()
    })

    it('shows inline create in empty state with onCreateAndSave', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={[]}
          onSave={vi.fn()}
          onCreateAndSave={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText(/create your first cookbook/i))

      expect(screen.getByTestId('inline-create-cookbook')).toBeInTheDocument()
    })

    it('calls onCreateAndSave from empty state', async () => {
      const onCreateAndSave = vi.fn()
      render(
        <SaveToCookbookDropdown
          cookbooks={[]}
          onSave={vi.fn()}
          onCreateAndSave={onCreateAndSave}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText(/create your first cookbook/i))

      const input = screen.getByLabelText(/new cookbook name/i)
      await userEvent.type(input, 'First Cookbook{Enter}')

      expect(onCreateAndSave).toHaveBeenCalledWith('First Cookbook')
    })

    it('cancels inline create in empty state on Escape', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={[]}
          onSave={vi.fn()}
          onCreateAndSave={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText(/create your first cookbook/i))

      const input = screen.getByLabelText(/new cookbook name/i)
      await userEvent.type(input, '{Escape}')

      expect(screen.queryByTestId('inline-create-cookbook')).not.toBeInTheDocument()
    })

    it('cancels inline create in empty state on Cancel button', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={[]}
          onSave={vi.fn()}
          onCreateAndSave={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))
      await userEvent.click(screen.getByText(/create your first cookbook/i))

      await userEvent.click(screen.getByRole('button', { name: /cancel/i }))

      expect(screen.queryByTestId('inline-create-cookbook')).not.toBeInTheDocument()
    })

    it('does not show create option in empty state when no callbacks', async () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={[]}
          onSave={vi.fn()}
        />
      )
      await userEvent.click(screen.getByRole('button', { name: /save/i }))

      expect(screen.queryByText(/create/i)).toBeNull()
    })
  })

  describe('disabled state', () => {
    it('disables button when disabled prop is true', () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
          disabled
        />
      )
      expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
    })
  })

  describe('accessibility', () => {
    it('has accessible button label', () => {
      render(
        <SaveToCookbookDropdown
          cookbooks={sampleCookbooks}
          onSave={vi.fn()}
        />
      )
      expect(screen.getByRole('button', { name: /save.*cookbook/i })).toBeInTheDocument()
    })
  })
})
