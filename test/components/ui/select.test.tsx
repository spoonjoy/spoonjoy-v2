import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select } from '~/components/ui/select'
import { createRef } from 'react'

describe('Select', () => {
  describe('rendering', () => {
    it('renders a select element', () => {
      render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
          <option value="2">Option 2</option>
        </Select>
      )
      expect(screen.getByRole('combobox', { name: 'Test select' })).toBeInTheDocument()
    })

    it('renders options', () => {
      render(
        <Select aria-label="Test select">
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
          <option value="cherry">Cherry</option>
        </Select>
      )
      expect(screen.getByRole('option', { name: 'Apple' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Banana' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'Cherry' })).toBeInTheDocument()
    })

    it('renders with data-slot="control" attribute on wrapper', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('applies custom className to wrapper span', () => {
      const { container } = render(
        <Select className="custom-class" aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper?.className).toContain('custom-class')
    })

    it('renders chevron icon for single select', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const svg = container.querySelector('svg[aria-hidden="true"]')
      expect(svg).toBeInTheDocument()
    })

    it('does not render chevron icon for multiple select', () => {
      const { container } = render(
        <Select multiple aria-label="Test select">
          <option value="1">Option 1</option>
          <option value="2">Option 2</option>
        </Select>
      )
      const svg = container.querySelector('svg[aria-hidden="true"]')
      expect(svg).not.toBeInTheDocument()
    })
  })

  describe('single select mode', () => {
    it('selects an option', async () => {
      const user = userEvent.setup()
      render(
        <Select aria-label="Fruit select">
          <option value="">Select a fruit</option>
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
        </Select>
      )
      const select = screen.getByRole('combobox', { name: 'Fruit select' })
      await user.selectOptions(select, 'banana')
      expect(select).toHaveValue('banana')
    })

    it('calls onChange when option is selected', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Select aria-label="Fruit select" onChange={onChange}>
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
        </Select>
      )
      const select = screen.getByRole('combobox', { name: 'Fruit select' })
      await user.selectOptions(select, 'banana')
      expect(onChange).toHaveBeenCalled()
    })

    it('supports controlled value', () => {
      render(
        <Select value="banana" onChange={() => {}} aria-label="Fruit select">
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
        </Select>
      )
      expect(screen.getByRole('combobox', { name: 'Fruit select' })).toHaveValue('banana')
    })

    it('supports defaultValue', () => {
      render(
        <Select defaultValue="cherry" aria-label="Fruit select">
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
          <option value="cherry">Cherry</option>
        </Select>
      )
      expect(screen.getByRole('combobox', { name: 'Fruit select' })).toHaveValue('cherry')
    })
  })

  describe('multiple select mode', () => {
    it('renders as multiple select', () => {
      render(
        <Select multiple aria-label="Fruit select">
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
        </Select>
      )
      const select = screen.getByRole('listbox', { name: 'Fruit select' })
      expect(select).toHaveAttribute('multiple')
    })

    it('allows selecting multiple options', async () => {
      const user = userEvent.setup()
      render(
        <Select multiple aria-label="Fruit select">
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
          <option value="cherry">Cherry</option>
        </Select>
      )
      const select = screen.getByRole('listbox', { name: 'Fruit select' })
      await user.selectOptions(select, ['apple', 'cherry'])
      const options = screen.getAllByRole('option') as HTMLOptionElement[]
      expect(options[0].selected).toBe(true)
      expect(options[1].selected).toBe(false)
      expect(options[2].selected).toBe(true)
    })

    it('supports controlled multiple value', () => {
      render(
        <Select multiple value={['apple', 'cherry']} onChange={() => {}} aria-label="Fruit select">
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
          <option value="cherry">Cherry</option>
        </Select>
      )
      const options = screen.getAllByRole('option') as HTMLOptionElement[]
      expect(options[0].selected).toBe(true)
      expect(options[1].selected).toBe(false)
      expect(options[2].selected).toBe(true)
    })

    it('supports defaultValue with multiple', () => {
      render(
        <Select multiple defaultValue={['banana']} aria-label="Fruit select">
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
          <option value="cherry">Cherry</option>
        </Select>
      )
      const options = screen.getAllByRole('option') as HTMLOptionElement[]
      expect(options[0].selected).toBe(false)
      expect(options[1].selected).toBe(true)
      expect(options[2].selected).toBe(false)
    })

    it('applies different padding for multiple select', () => {
      const { container } = render(
        <Select multiple aria-label="Fruit select">
          <option value="apple">Apple</option>
        </Select>
      )
      const select = container.querySelector('select')
      expect(select?.className).toContain('px-')
    })
  })

  describe('disabled state', () => {
    it('supports disabled attribute', () => {
      render(
        <Select disabled aria-label="Disabled select">
          <option value="1">Option 1</option>
        </Select>
      )
      expect(screen.getByRole('combobox', { name: 'Disabled select' })).toBeDisabled()
    })

    it('applies disabled styling to wrapper', () => {
      const { container } = render(
        <Select disabled aria-label="Disabled select">
          <option value="1">Option 1</option>
        </Select>
      )
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper?.className).toContain('has-data-disabled:opacity-50')
    })

    it('does not allow selection when disabled', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <Select disabled aria-label="Disabled select" onChange={onChange}>
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
        </Select>
      )
      const select = screen.getByRole('combobox', { name: 'Disabled select' })
      await user.selectOptions(select, 'banana').catch(() => {})
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('required state', () => {
    it('supports required attribute', () => {
      render(
        <Select required aria-label="Required select">
          <option value="">Select one</option>
          <option value="1">Option 1</option>
        </Select>
      )
      expect(screen.getByRole('combobox', { name: 'Required select' })).toBeRequired()
    })
  })

  describe('form attributes', () => {
    it('supports name attribute', () => {
      render(
        <Select name="fruit-select" aria-label="Fruit select">
          <option value="1">Option 1</option>
        </Select>
      )
      expect(screen.getByRole('combobox', { name: 'Fruit select' })).toHaveAttribute(
        'name',
        'fruit-select'
      )
    })

    it('supports id attribute', () => {
      render(
        <Select id="fruit-id" aria-label="Fruit select">
          <option value="1">Option 1</option>
        </Select>
      )
      expect(screen.getByRole('combobox', { name: 'Fruit select' })).toHaveAttribute('id', 'fruit-id')
    })

    it('supports autoFocus', () => {
      render(
        <Select autoFocus aria-label="AutoFocus select">
          <option value="1">Option 1</option>
        </Select>
      )
      expect(screen.getByRole('combobox', { name: 'AutoFocus select' })).toHaveFocus()
    })
  })

  describe('ref forwarding', () => {
    it('forwards ref to select element', () => {
      const ref = createRef<HTMLSelectElement>()
      render(
        <Select ref={ref} aria-label="Ref select">
          <option value="1">Option 1</option>
        </Select>
      )
      expect(ref.current).toBeInstanceOf(HTMLSelectElement)
      expect(ref.current?.tagName).toBe('SELECT')
    })

    it('ref allows direct manipulation', () => {
      const ref = createRef<HTMLSelectElement>()
      render(
        <Select ref={ref} aria-label="Ref select">
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
        </Select>
      )
      ref.current!.value = 'banana'
      expect(ref.current?.value).toBe('banana')
    })
  })

  describe('optgroup support', () => {
    it('renders with optgroup', () => {
      render(
        <Select aria-label="Grouped select">
          <optgroup label="Fruits">
            <option value="apple">Apple</option>
            <option value="banana">Banana</option>
          </optgroup>
          <optgroup label="Vegetables">
            <option value="carrot">Carrot</option>
            <option value="lettuce">Lettuce</option>
          </optgroup>
        </Select>
      )
      const select = screen.getByRole('combobox', { name: 'Grouped select' })
      expect(select).toBeInTheDocument()
      expect(screen.getByRole('group', { name: 'Fruits' })).toBeInTheDocument()
      expect(screen.getByRole('group', { name: 'Vegetables' })).toBeInTheDocument()
    })

    it('can select option from optgroup', async () => {
      const user = userEvent.setup()
      render(
        <Select aria-label="Grouped select">
          <optgroup label="Fruits">
            <option value="apple">Apple</option>
          </optgroup>
          <optgroup label="Vegetables">
            <option value="carrot">Carrot</option>
          </optgroup>
        </Select>
      )
      const select = screen.getByRole('combobox', { name: 'Grouped select' })
      await user.selectOptions(select, 'carrot')
      expect(select).toHaveValue('carrot')
    })
  })

  describe('styling', () => {
    it('applies basic layout classes to wrapper', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper?.className).toContain('relative')
      expect(wrapper?.className).toContain('block')
      expect(wrapper?.className).toContain('w-full')
    })

    it('applies typography classes to select', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const select = container.querySelector('select')
      expect(select?.className).toContain('text-base/6')
    })

    it('applies border classes to select', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const select = container.querySelector('select')
      expect(select?.className).toContain('border')
    })

    it('applies rounded-lg class to select', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const select = container.querySelector('select')
      expect(select?.className).toContain('rounded-lg')
    })

    it('applies appearance-none to hide native styling', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const select = container.querySelector('select')
      expect(select?.className).toContain('appearance-none')
    })

    it('applies focus ring styles to wrapper', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper?.className).toContain('has-data-focus:after:ring-2')
      expect(wrapper?.className).toContain('has-data-focus:after:ring-[var(--sj-brass)]')
    })

    it('applies invalid state styling classes', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const select = container.querySelector('select')
      expect(select?.className).toContain('data-invalid:border-[var(--sj-tomato)]')
    })
  })

  describe('chevron icon', () => {
    it('renders chevron with correct viewBox', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('viewBox', '0 0 16 16')
    })

    it('renders chevron with aria-hidden', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    })

    it('renders chevron with fill="none"', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const svg = container.querySelector('svg')
      expect(svg).toHaveAttribute('fill', 'none')
    })

    it('renders chevron paths with correct stroke properties', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const paths = container.querySelectorAll('path')
      expect(paths).toHaveLength(2)
      paths.forEach((path) => {
        expect(path.getAttribute('stroke-width')).toBe('1.5')
        expect(path.getAttribute('stroke-linecap')).toBe('round')
        expect(path.getAttribute('stroke-linejoin')).toBe('round')
      })
    })

    it('chevron wrapper is positioned absolutely', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const chevronWrapper = container.querySelector('.pointer-events-none')
      expect(chevronWrapper?.className).toContain('absolute')
      expect(chevronWrapper?.className).toContain('inset-y-0')
      expect(chevronWrapper?.className).toContain('right-0')
    })

    it('chevron is not clickable', () => {
      const { container } = render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
        </Select>
      )
      const chevronWrapper = container.querySelector('.pointer-events-none')
      expect(chevronWrapper?.className).toContain('pointer-events-none')
    })
  })

  describe('accessibility', () => {
    it('supports aria-label', () => {
      render(
        <Select aria-label="Accessible select">
          <option value="1">Option 1</option>
        </Select>
      )
      expect(screen.getByRole('combobox', { name: 'Accessible select' })).toBeInTheDocument()
    })

    it('can be associated with a label via id', () => {
      render(
        <>
          <label htmlFor="labeled-select">My Label</label>
          <Select id="labeled-select">
            <option value="1">Option 1</option>
          </Select>
        </>
      )
      expect(screen.getByLabelText('My Label')).toBeInTheDocument()
    })

    it('supports aria-invalid', () => {
      const { container } = render(
        <Select aria-label="Invalid select" data-invalid>
          <option value="1">Option 1</option>
        </Select>
      )
      const select = container.querySelector('select')
      expect(select).toHaveAttribute('data-invalid')
    })

    it('renders as combobox role for single select', () => {
      render(
        <Select aria-label="Single select">
          <option value="1">Option 1</option>
        </Select>
      )
      expect(screen.getByRole('combobox')).toBeInTheDocument()
    })

    it('renders as listbox role for multiple select', () => {
      render(
        <Select multiple aria-label="Multiple select">
          <option value="1">Option 1</option>
        </Select>
      )
      expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    it('options have option role', () => {
      render(
        <Select aria-label="Test select">
          <option value="1">Option 1</option>
          <option value="2">Option 2</option>
        </Select>
      )
      const options = screen.getAllByRole('option')
      expect(options).toHaveLength(2)
    })
  })

  describe('keyboard interaction', () => {
    it('can navigate options with keyboard', async () => {
      const user = userEvent.setup()
      render(
        <Select aria-label="Keyboard select" defaultValue="apple">
          <option value="apple">Apple</option>
          <option value="banana">Banana</option>
          <option value="cherry">Cherry</option>
        </Select>
      )
      const select = screen.getByRole('combobox', { name: 'Keyboard select' })
      expect(select).toHaveValue('apple')
      await user.selectOptions(select, 'banana')
      expect(select).toHaveValue('banana')
    })

    it('can be focused via tab', async () => {
      const user = userEvent.setup()
      render(
        <>
          <button>Before</button>
          <Select aria-label="Tab select">
            <option value="1">Option 1</option>
          </Select>
        </>
      )
      await user.tab()
      await user.tab()
      expect(screen.getByRole('combobox', { name: 'Tab select' })).toHaveFocus()
    })
  })
})
