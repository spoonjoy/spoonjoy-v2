import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Listbox, ListboxOption, ListboxLabel, ListboxDescription } from '~/components/ui/listbox'

interface TestOption {
  id: number
  name: string
  description?: string
}

const testOptions: TestOption[] = [
  { id: 1, name: 'Apple', description: 'A red fruit' },
  { id: 2, name: 'Banana', description: 'A yellow fruit' },
  { id: 3, name: 'Cherry', description: 'A small red fruit' },
]

describe('Listbox', () => {
  describe('Listbox component', () => {
    it('renders with placeholder', () => {
      render(
        <Listbox placeholder="Select a fruit" aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      expect(screen.getByText('Select a fruit')).toBeInTheDocument()
    })

    it('renders with aria-label', () => {
      render(
        <Listbox aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      expect(screen.getByRole('button', { name: 'Fruit selector' })).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(
        <Listbox className="custom-listbox" aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      const control = container.querySelector('[data-slot="control"]')
      expect(control?.className).toContain('custom-listbox')
    })

    it('renders listbox button', () => {
      render(
        <Listbox aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('renders chevron icon', () => {
      const { container } = render(
        <Listbox aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      const svg = container.querySelector('svg[aria-hidden="true"]')
      expect(svg).toBeInTheDocument()
    })

    it('shows options when listbox button is clicked', async () => {
      const user = userEvent.setup()
      render(
        <Listbox aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      expect(await screen.findByRole('listbox')).toBeInTheDocument()
    })

    it('calls onChange when option is selected', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Listbox onChange={onChange} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      await user.click(screen.getByText('Apple'))
      expect(onChange).toHaveBeenCalledWith(testOptions[0])
    })

    it('displays selected value', async () => {
      const user = userEvent.setup()
      render(
        <Listbox aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      await user.click(screen.getByText('Banana'))
      await waitFor(() => {
        expect(screen.getByText('Banana')).toBeInTheDocument()
      })
    })

    it('supports autoFocus prop', () => {
      render(
        <Listbox autoFocus aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      expect(screen.getByRole('button')).toHaveFocus()
    })

    it('supports disabled state', () => {
      render(
        <Listbox disabled aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      expect(screen.getByRole('button')).toHaveAttribute('data-disabled', '')
    })

    it('supports controlled value', () => {
      render(
        <Listbox value={testOptions[1]} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      expect(screen.getByText('Banana')).toBeInTheDocument()
    })

    it('supports defaultValue', () => {
      render(
        <Listbox defaultValue={testOptions[2]} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      expect(screen.getByText('Cherry')).toBeInTheDocument()
    })

    it('renders data-slot="control" on button', () => {
      const { container } = render(
        <Listbox aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      const control = container.querySelector('[data-slot="control"]')
      expect(control).toBeInTheDocument()
    })

    it('applies placeholder styles to placeholder text', () => {
      const { container } = render(
        <Listbox placeholder="Select a fruit" aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      const placeholder = screen.getByText('Select a fruit')
      expect(placeholder?.className).toContain('text-[var(--sj-ink-soft)]')
    })

    it('can be used with name prop for form submission', () => {
      render(
        <Listbox name="fruit" value={testOptions[0]} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      expect(screen.getByRole('button')).toBeInTheDocument()
    })
  })

  describe('ListboxOption', () => {
    it('renders option with children', async () => {
      const user = userEvent.setup()
      render(
        <Listbox aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      expect(screen.getByText('Apple')).toBeInTheDocument()
      expect(screen.getByText('Banana')).toBeInTheDocument()
      expect(screen.getByText('Cherry')).toBeInTheDocument()
    })

    it('marks selected option with data-selected attribute', async () => {
      const user = userEvent.setup()
      render(
        <Listbox value={testOptions[0]} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      // The selected option should have the data-selected attribute set by HeadlessUI
      const selectedOption = screen.getByRole('option', { selected: true })
      expect(selectedOption).toHaveAttribute('data-selected', '')
    })

    it('renders option content correctly in dropdown', async () => {
      const user = userEvent.setup()
      render(
        <Listbox aria-label="Fruit selector">
          <ListboxOption value={testOptions[0]}>
            <ListboxLabel>{testOptions[0].name}</ListboxLabel>
          </ListboxOption>
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      // Verify the option is rendered and clickable
      const option = screen.getByRole('option')
      expect(option).toBeInTheDocument()
      expect(screen.getByText('Apple')).toBeInTheDocument()
    })

    it('supports disabled option', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Listbox onChange={onChange} aria-label="Fruit selector">
          <ListboxOption value={testOptions[0]} disabled>
            <ListboxLabel>{testOptions[0].name}</ListboxLabel>
          </ListboxOption>
          <ListboxOption value={testOptions[1]}>
            <ListboxLabel>{testOptions[1].name}</ListboxLabel>
          </ListboxOption>
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      // Try to click the disabled option
      await user.click(screen.getByText('Apple'))
      // onChange should not be called for disabled option
      expect(onChange).not.toHaveBeenCalled()
    })

    it('allows selecting non-disabled option after disabled option', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Listbox onChange={onChange} aria-label="Fruit selector">
          <ListboxOption value={testOptions[0]} disabled>
            <ListboxLabel>{testOptions[0].name}</ListboxLabel>
          </ListboxOption>
          <ListboxOption value={testOptions[1]}>
            <ListboxLabel>{testOptions[1].name}</ListboxLabel>
          </ListboxOption>
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      await user.click(screen.getByText('Banana'))
      expect(onChange).toHaveBeenCalledWith(testOptions[1])
    })
  })

  describe('ListboxLabel', () => {
    it('renders label text', () => {
      const { container } = render(<ListboxLabel>Test Label</ListboxLabel>)
      expect(screen.getByText('Test Label')).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(<ListboxLabel className="custom-label">Label</ListboxLabel>)
      const label = container.querySelector('span')
      expect(label?.className).toContain('custom-label')
    })

    it('applies truncate class for text overflow', () => {
      const { container } = render(<ListboxLabel>Label</ListboxLabel>)
      const label = container.querySelector('span')
      expect(label?.className).toContain('truncate')
    })

    it('applies margin classes', () => {
      const { container } = render(<ListboxLabel>Label</ListboxLabel>)
      const label = container.querySelector('span')
      expect(label?.className).toContain('ml-2.5')
    })

    it('passes through additional props', () => {
      render(<ListboxLabel data-testid="label-test">Label</ListboxLabel>)
      expect(screen.getByTestId('label-test')).toBeInTheDocument()
    })
  })

  describe('ListboxDescription', () => {
    it('renders description text', () => {
      render(<ListboxDescription>A red fruit</ListboxDescription>)
      expect(screen.getByText('A red fruit')).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(
        <ListboxDescription className="custom-desc">Description text</ListboxDescription>
      )
      const descContainer = container.querySelector('span')
      expect(descContainer?.className).toContain('custom-desc')
    })

    it('applies text-[var(--sj-ink-soft)] class for muted styling', () => {
      const { container } = render(
        <ListboxDescription>Description text</ListboxDescription>
      )
      const descContainer = container.querySelector('span')
      expect(descContainer?.className).toContain('text-[var(--sj-ink-soft)]')
    })

    it('applies flex-1 class for flexible sizing', () => {
      const { container } = render(
        <ListboxDescription>Description text</ListboxDescription>
      )
      const descContainer = container.querySelector('span')
      expect(descContainer?.className).toContain('flex-1')
    })

    it('truncates long description text', () => {
      const { container } = render(
        <ListboxDescription>Very long description text that should be truncated</ListboxDescription>
      )
      const innerSpan = container.querySelector('span > span')
      expect(innerSpan?.className).toContain('truncate')
    })

    it('passes through additional props', () => {
      render(<ListboxDescription data-testid="desc-test">Description</ListboxDescription>)
      expect(screen.getByTestId('desc-test')).toBeInTheDocument()
    })
  })

  describe('Full listbox composition', () => {
    it('renders a complete listbox with labels and descriptions', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Listbox onChange={onChange} placeholder="Select a fruit..." aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
              <ListboxDescription>{option.description}</ListboxDescription>
            </ListboxOption>
          ))}
        </Listbox>
      )

      expect(screen.getByText('Select a fruit...')).toBeInTheDocument()

      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')

      expect(screen.getByText('Apple')).toBeInTheDocument()
      expect(screen.getByText('A red fruit')).toBeInTheDocument()
      expect(screen.getByText('Banana')).toBeInTheDocument()
      expect(screen.getByText('A yellow fruit')).toBeInTheDocument()
      expect(screen.getByText('Cherry')).toBeInTheDocument()
      expect(screen.getByText('A small red fruit')).toBeInTheDocument()

      await user.click(screen.getByText('Cherry'))
      expect(onChange).toHaveBeenCalledWith(testOptions[2])
    })

    it('handles keyboard navigation', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Listbox onChange={onChange} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )

      const button = screen.getByRole('button')
      await user.click(button)
      await screen.findByRole('listbox')

      await user.keyboard('{ArrowDown}')
      await user.keyboard('{Enter}')

      expect(onChange).toHaveBeenCalled()
    })

    it('closes listbox when pressing Escape', async () => {
      const user = userEvent.setup()
      render(
        <Listbox aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )

      await user.click(screen.getByRole('button'))
      expect(await screen.findByRole('listbox')).toBeInTheDocument()

      await user.keyboard('{Escape}')
      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      })
    })

    it('closes listbox after selection', async () => {
      const user = userEvent.setup()
      render(
        <Listbox aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )

      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      await user.click(screen.getByText('Apple'))

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      })
    })
  })

  describe('Multi-select mode', () => {
    it('defaults to single-select when multiple prop is not specified', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Listbox onChange={onChange} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      await user.click(screen.getByText('Apple'))
      // Should receive single value, not array
      expect(onChange).toHaveBeenCalledWith(testOptions[0])
    })

    it('supports multiple={false} explicitly', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Listbox multiple={false} onChange={onChange} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      await user.click(screen.getByText('Apple'))
      expect(onChange).toHaveBeenCalledWith(testOptions[0])
    })

    it('supports multiple={true} for multi-select', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Listbox multiple={true} onChange={onChange} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      await user.click(screen.getByText('Apple'))
      // Multi-select should return array
      expect(onChange).toHaveBeenCalledWith([testOptions[0]])
    })

    it('allows selecting multiple items in multi-select mode', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Listbox multiple={true} onChange={onChange} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      await user.click(screen.getByText('Apple'))
      await user.click(screen.getByText('Banana'))
      // Second call should have both items
      expect(onChange).toHaveBeenLastCalledWith([testOptions[0], testOptions[1]])
    })

    it('keeps listbox open after selection in multi-select mode', async () => {
      const user = userEvent.setup()
      render(
        <Listbox multiple={true} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      await user.click(screen.getByText('Apple'))
      // Listbox should still be open
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    it('supports controlled value as array in multi-select mode', () => {
      render(
        <Listbox multiple={true} value={[testOptions[0], testOptions[2]]} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      // Selected items should be displayed
      expect(screen.getByText('Apple')).toBeInTheDocument()
      expect(screen.getByText('Cherry')).toBeInTheDocument()
    })

    it('supports defaultValue as array in multi-select mode', () => {
      render(
        <Listbox multiple={true} defaultValue={[testOptions[1]]} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      expect(screen.getByText('Banana')).toBeInTheDocument()
    })

    it('allows deselecting items in multi-select mode', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Listbox multiple={true} defaultValue={[testOptions[0]]} onChange={onChange} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      // Click the Apple option in the listbox (not the button display) to deselect
      const appleOption = screen.getByRole('option', { name: /Apple/ })
      await user.click(appleOption)
      expect(onChange).toHaveBeenCalledWith([])
    })

    it('displays placeholder when no items selected in multi-select mode', () => {
      render(
        <Listbox multiple={true} placeholder="Select fruits" aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      expect(screen.getByText('Select fruits')).toBeInTheDocument()
    })

    it('marks multiple selected options in multi-select mode', async () => {
      const user = userEvent.setup()
      render(
        <Listbox multiple={true} value={[testOptions[0], testOptions[2]]} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')
      const selectedOptions = screen.getAllByRole('option', { selected: true })
      expect(selectedOptions.length).toBe(2)
    })
  })

  describe('Accessibility', () => {
    it('supports aria-label on listbox button', () => {
      render(
        <Listbox aria-label="Select your favorite fruit">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )
      expect(screen.getByRole('button', { name: 'Select your favorite fruit' })).toBeInTheDocument()
    })

    it('has correct ARIA attributes on listbox options', async () => {
      const user = userEvent.setup()
      render(
        <Listbox aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )

      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')

      const options = screen.getAllByRole('option')
      expect(options.length).toBe(3)
    })

    it('marks selected option with aria-selected', async () => {
      const user = userEvent.setup()
      render(
        <Listbox value={testOptions[1]} aria-label="Fruit selector">
          {testOptions.map((option) => (
            <ListboxOption key={option.id} value={option}>
              <ListboxLabel>{option.name}</ListboxLabel>
            </ListboxOption>
          ))}
        </Listbox>
      )

      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')

      const selectedOption = screen.getByRole('option', { selected: true })
      expect(selectedOption).toBeInTheDocument()
    })

    it('marks disabled options with aria-disabled', async () => {
      const user = userEvent.setup()
      render(
        <Listbox aria-label="Fruit selector">
          <ListboxOption value={testOptions[0]} disabled>
            <ListboxLabel>{testOptions[0].name}</ListboxLabel>
          </ListboxOption>
          <ListboxOption value={testOptions[1]}>
            <ListboxLabel>{testOptions[1].name}</ListboxLabel>
          </ListboxOption>
        </Listbox>
      )

      await user.click(screen.getByRole('button'))
      await screen.findByRole('listbox')

      const options = screen.getAllByRole('option')
      expect(options[0]).toHaveAttribute('aria-disabled', 'true')
    })
  })
})
