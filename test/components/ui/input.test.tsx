import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input, InputGroup } from '~/components/ui/input'
import { createRef } from 'react'

describe('Input', () => {
  describe('Input component', () => {
    it('renders an input element', () => {
      render(<Input aria-label="Test input" />)
      expect(screen.getByRole('textbox', { name: 'Test input' })).toBeInTheDocument()
    })

    it('renders with placeholder', () => {
      render(<Input placeholder="Enter text" />)
      expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument()
    })

    it('applies custom className to wrapper span', () => {
      const { container } = render(<Input className="custom-class" />)
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper?.className).toContain('custom-class')
    })

    it('renders with data-slot="control" attribute on wrapper', () => {
      const { container } = render(<Input />)
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('supports different input types', () => {
      const types = ['text', 'email', 'password', 'search', 'tel', 'number', 'url'] as const
      types.forEach((type) => {
        const { unmount } = render(<Input type={type} aria-label={`${type} input`} />)
        const input = screen.getByLabelText(`${type} input`)
        expect(input).toHaveAttribute('type', type)
        unmount()
      })
    })

    it('supports date input types', () => {
      const dateTypes = ['date', 'datetime-local', 'month', 'time', 'week'] as const
      dateTypes.forEach((type) => {
        const { unmount } = render(<Input type={type} aria-label={`${type} input`} />)
        const input = screen.getByLabelText(`${type} input`)
        expect(input).toHaveAttribute('type', type)
        unmount()
      })
    })

    it('supports disabled state', () => {
      render(<Input disabled aria-label="Disabled input" />)
      const input = screen.getByLabelText('Disabled input')
      expect(input).toBeDisabled()
    })

    it('supports required attribute', () => {
      render(<Input required aria-label="Required input" />)
      const input = screen.getByLabelText('Required input')
      expect(input).toBeRequired()
    })

    it('supports value and onChange', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<Input value="" onChange={onChange} aria-label="Controlled input" />)
      const input = screen.getByLabelText('Controlled input')
      await user.type(input, 'hello')
      expect(onChange).toHaveBeenCalled()
    })

    it('supports uncontrolled input with defaultValue', () => {
      render(<Input defaultValue="initial" aria-label="Uncontrolled input" />)
      const input = screen.getByLabelText('Uncontrolled input')
      expect(input).toHaveValue('initial')
    })

    it('forwards ref to input element', () => {
      const ref = createRef<HTMLInputElement>()
      render(<Input ref={ref} aria-label="Ref input" />)
      expect(ref.current).toBeInstanceOf(HTMLInputElement)
      expect(ref.current?.tagName).toBe('INPUT')
    })

    it('applies basic layout classes to input', () => {
      const { container } = render(<Input />)
      const input = container.querySelector('input')
      expect(input?.className).toContain('rounded-[var(--sj-radius-small)]')
      expect(input?.className).toContain('w-full')
    })

    it('applies typography classes', () => {
      const { container } = render(<Input />)
      const input = container.querySelector('input')
      expect(input?.className).toContain('text-base/6')
    })

    it('applies border classes', () => {
      const { container } = render(<Input />)
      const input = container.querySelector('input')
      expect(input?.className).toContain('border')
    })

    it('supports autoFocus', () => {
      render(<Input autoFocus aria-label="AutoFocus input" />)
      const input = screen.getByLabelText('AutoFocus input')
      expect(input).toHaveFocus()
    })

    it('supports name attribute', () => {
      render(<Input name="test-name" aria-label="Named input" />)
      const input = screen.getByLabelText('Named input')
      expect(input).toHaveAttribute('name', 'test-name')
    })

    it('supports id attribute', () => {
      render(<Input id="test-id" aria-label="ID input" />)
      const input = screen.getByLabelText('ID input')
      expect(input).toHaveAttribute('id', 'test-id')
    })

    it('supports maxLength attribute', () => {
      render(<Input maxLength={10} aria-label="MaxLength input" />)
      const input = screen.getByLabelText('MaxLength input')
      expect(input).toHaveAttribute('maxLength', '10')
    })

    it('supports minLength attribute', () => {
      render(<Input minLength={5} aria-label="MinLength input" />)
      const input = screen.getByLabelText('MinLength input')
      expect(input).toHaveAttribute('minLength', '5')
    })

    it('supports pattern attribute', () => {
      render(<Input pattern="[A-Za-z]+" aria-label="Pattern input" />)
      const input = screen.getByLabelText('Pattern input')
      expect(input).toHaveAttribute('pattern', '[A-Za-z]+')
    })

    it('supports readOnly attribute', () => {
      render(<Input readOnly aria-label="ReadOnly input" />)
      const input = screen.getByLabelText('ReadOnly input')
      expect(input).toHaveAttribute('readonly')
    })

    it('allows user to type in the input', async () => {
      const user = userEvent.setup()
      render(<Input aria-label="Type test" />)
      const input = screen.getByLabelText('Type test')
      await user.type(input, 'Hello World')
      expect(input).toHaveValue('Hello World')
    })

    it('clears input on clear', async () => {
      const user = userEvent.setup()
      render(<Input aria-label="Clear test" defaultValue="test" />)
      const input = screen.getByLabelText('Clear test')
      await user.clear(input)
      expect(input).toHaveValue('')
    })
  })

  describe('InputGroup component', () => {
    it('renders children', () => {
      render(
        <InputGroup>
          <Input aria-label="Grouped input" />
        </InputGroup>
      )
      expect(screen.getByLabelText('Grouped input')).toBeInTheDocument()
    })

    it('renders with data-slot="control" attribute', () => {
      const { container } = render(
        <InputGroup>
          <Input />
        </InputGroup>
      )
      const group = container.querySelector('[data-slot="control"]')
      expect(group).toBeInTheDocument()
    })

    it('applies relative positioning class', () => {
      const { container } = render(
        <InputGroup>
          <Input />
        </InputGroup>
      )
      const group = container.firstChild as HTMLElement
      expect(group?.className).toContain('relative')
    })

    it('applies isolate class', () => {
      const { container } = render(
        <InputGroup>
          <Input />
        </InputGroup>
      )
      const group = container.firstChild as HTMLElement
      expect(group?.className).toContain('isolate')
    })

    it('applies block class', () => {
      const { container } = render(
        <InputGroup>
          <Input />
        </InputGroup>
      )
      const group = container.firstChild as HTMLElement
      expect(group?.className).toContain('block')
    })

    it('renders with icon slot styling', () => {
      const { container } = render(
        <InputGroup>
          <span data-slot="icon">Icon</span>
          <Input />
        </InputGroup>
      )
      const icon = container.querySelector('[data-slot="icon"]')
      expect(icon).toBeInTheDocument()
    })

    it('renders input with icon before', () => {
      render(
        <InputGroup>
          <span data-slot="icon" data-testid="leading-icon">Search</span>
          <Input aria-label="Search input" />
        </InputGroup>
      )
      expect(screen.getByTestId('leading-icon')).toBeInTheDocument()
      expect(screen.getByLabelText('Search input')).toBeInTheDocument()
    })

    it('renders input with icon after', () => {
      render(
        <InputGroup>
          <Input aria-label="Email input" />
          <span data-slot="icon" data-testid="trailing-icon">@</span>
        </InputGroup>
      )
      expect(screen.getByTestId('trailing-icon')).toBeInTheDocument()
      expect(screen.getByLabelText('Email input')).toBeInTheDocument()
    })

    it('renders input with icons on both sides', () => {
      render(
        <InputGroup>
          <span data-slot="icon" data-testid="leading-icon">$</span>
          <Input aria-label="Amount input" />
          <span data-slot="icon" data-testid="trailing-icon">.00</span>
        </InputGroup>
      )
      expect(screen.getByTestId('leading-icon')).toBeInTheDocument()
      expect(screen.getByTestId('trailing-icon')).toBeInTheDocument()
      expect(screen.getByLabelText('Amount input')).toBeInTheDocument()
    })
  })

  describe('Input with InputGroup composition', () => {
    it('renders a complete input group with leading icon', () => {
      render(
        <InputGroup>
          <span data-slot="icon" aria-hidden="true">
            Search
          </span>
          <Input placeholder="Search..." aria-label="Search" />
        </InputGroup>
      )
      expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
      expect(screen.getByText('Search')).toBeInTheDocument()
    })

    it('renders a password input with visibility toggle placeholder', () => {
      render(
        <InputGroup>
          <Input type="password" placeholder="Enter password" aria-label="Password" />
          <span data-slot="icon" data-testid="visibility-icon">
            Eye
          </span>
        </InputGroup>
      )
      const input = screen.getByPlaceholderText('Enter password')
      expect(input).toHaveAttribute('type', 'password')
      expect(screen.getByTestId('visibility-icon')).toBeInTheDocument()
    })

    it('allows interaction with input in InputGroup', async () => {
      const user = userEvent.setup()
      render(
        <InputGroup>
          <span data-slot="icon">@</span>
          <Input placeholder="Username" aria-label="Username" />
        </InputGroup>
      )
      const input = screen.getByLabelText('Username')
      await user.type(input, 'johndoe')
      expect(input).toHaveValue('johndoe')
    })
  })

  describe('Accessibility', () => {
    it('supports aria-label', () => {
      render(<Input aria-label="Accessible input" />)
      expect(screen.getByLabelText('Accessible input')).toBeInTheDocument()
    })

    it('can be associated with a label via id', () => {
      render(
        <>
          <label htmlFor="labeled-input">My Label</label>
          <Input id="labeled-input" />
        </>
      )
      expect(screen.getByLabelText('My Label')).toBeInTheDocument()
    })

    it('renders as an input with textbox role by default', () => {
      render(<Input aria-label="Textbox input" />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })
  })
})
