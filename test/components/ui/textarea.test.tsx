import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Textarea } from '~/components/ui/textarea'
import { createRef } from 'react'

describe('Textarea', () => {
  describe('Textarea component', () => {
    it('renders a textarea element', () => {
      render(<Textarea aria-label="Test textarea" />)
      expect(screen.getByRole('textbox', { name: 'Test textarea' })).toBeInTheDocument()
    })

    it('renders with placeholder', () => {
      render(<Textarea placeholder="Enter text" />)
      expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument()
    })

    it('applies custom className to wrapper span', () => {
      const { container } = render(<Textarea className="custom-class" />)
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper?.className).toContain('custom-class')
    })

    it('renders with data-slot="control" attribute on wrapper', () => {
      const { container } = render(<Textarea />)
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper).toBeInTheDocument()
    })

    it('supports disabled state', () => {
      render(<Textarea disabled aria-label="Disabled textarea" />)
      const textarea = screen.getByLabelText('Disabled textarea')
      expect(textarea).toBeDisabled()
    })

    it('supports required attribute', () => {
      render(<Textarea required aria-label="Required textarea" />)
      const textarea = screen.getByLabelText('Required textarea')
      expect(textarea).toBeRequired()
    })

    it('supports value and onChange', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<Textarea value="" onChange={onChange} aria-label="Controlled textarea" />)
      const textarea = screen.getByLabelText('Controlled textarea')
      await user.type(textarea, 'hello')
      expect(onChange).toHaveBeenCalled()
    })

    it('supports uncontrolled textarea with defaultValue', () => {
      render(<Textarea defaultValue="initial" aria-label="Uncontrolled textarea" />)
      const textarea = screen.getByLabelText('Uncontrolled textarea')
      expect(textarea).toHaveValue('initial')
    })

    it('forwards ref to textarea element', () => {
      const ref = createRef<HTMLTextAreaElement>()
      render(<Textarea ref={ref} aria-label="Ref textarea" />)
      expect(ref.current).toBeInstanceOf(HTMLTextAreaElement)
      expect(ref.current?.tagName).toBe('TEXTAREA')
    })

    it('applies basic layout classes to textarea', () => {
      const { container } = render(<Textarea />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('rounded-lg')
      expect(textarea?.className).toContain('w-full')
    })

    it('applies typography classes', () => {
      const { container } = render(<Textarea />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('text-base/6')
    })

    it('applies border classes', () => {
      const { container } = render(<Textarea />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('border')
    })

    it('supports autoFocus', () => {
      render(<Textarea autoFocus aria-label="AutoFocus textarea" />)
      const textarea = screen.getByLabelText('AutoFocus textarea')
      expect(textarea).toHaveFocus()
    })

    it('supports name attribute', () => {
      render(<Textarea name="test-name" aria-label="Named textarea" />)
      const textarea = screen.getByLabelText('Named textarea')
      expect(textarea).toHaveAttribute('name', 'test-name')
    })

    it('supports id attribute', () => {
      render(<Textarea id="test-id" aria-label="ID textarea" />)
      const textarea = screen.getByLabelText('ID textarea')
      expect(textarea).toHaveAttribute('id', 'test-id')
    })

    it('supports maxLength attribute', () => {
      render(<Textarea maxLength={100} aria-label="MaxLength textarea" />)
      const textarea = screen.getByLabelText('MaxLength textarea')
      expect(textarea).toHaveAttribute('maxLength', '100')
    })

    it('supports minLength attribute', () => {
      render(<Textarea minLength={10} aria-label="MinLength textarea" />)
      const textarea = screen.getByLabelText('MinLength textarea')
      expect(textarea).toHaveAttribute('minLength', '10')
    })

    it('supports readOnly attribute', () => {
      render(<Textarea readOnly aria-label="ReadOnly textarea" />)
      const textarea = screen.getByLabelText('ReadOnly textarea')
      expect(textarea).toHaveAttribute('readonly')
    })

    it('allows user to type in the textarea', async () => {
      const user = userEvent.setup()
      render(<Textarea aria-label="Type test" />)
      const textarea = screen.getByLabelText('Type test')
      await user.type(textarea, 'Hello World')
      expect(textarea).toHaveValue('Hello World')
    })

    it('clears textarea on clear', async () => {
      const user = userEvent.setup()
      render(<Textarea aria-label="Clear test" defaultValue="test" />)
      const textarea = screen.getByLabelText('Clear test')
      await user.clear(textarea)
      expect(textarea).toHaveValue('')
    })

    it('supports multiline text input', async () => {
      const user = userEvent.setup()
      render(<Textarea aria-label="Multiline test" />)
      const textarea = screen.getByLabelText('Multiline test')
      await user.type(textarea, 'Line 1{enter}Line 2{enter}Line 3')
      expect(textarea).toHaveValue('Line 1\nLine 2\nLine 3')
    })

    it('supports rows attribute', () => {
      render(<Textarea rows={5} aria-label="Rows textarea" />)
      const textarea = screen.getByLabelText('Rows textarea')
      expect(textarea).toHaveAttribute('rows', '5')
    })

    it('supports cols attribute', () => {
      render(<Textarea cols={40} aria-label="Cols textarea" />)
      const textarea = screen.getByLabelText('Cols textarea')
      expect(textarea).toHaveAttribute('cols', '40')
    })
  })

  describe('Resizable prop', () => {
    it('applies resize-y class by default (resizable=true)', () => {
      const { container } = render(<Textarea />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('resize-y')
      expect(textarea?.className).not.toContain('resize-none')
    })

    it('applies resize-y class when resizable is explicitly true', () => {
      const { container } = render(<Textarea resizable={true} />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('resize-y')
      expect(textarea?.className).not.toContain('resize-none')
    })

    it('applies resize-none class when resizable is false', () => {
      const { container } = render(<Textarea resizable={false} />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('resize-none')
      expect(textarea?.className).not.toContain('resize-y')
    })
  })

  describe('Wrapper styling', () => {
    it('wrapper has relative positioning', () => {
      const { container } = render(<Textarea />)
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper?.className).toContain('relative')
    })

    it('wrapper has block display', () => {
      const { container } = render(<Textarea />)
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper?.className).toContain('block')
    })

    it('wrapper has full width', () => {
      const { container } = render(<Textarea />)
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper?.className).toContain('w-full')
    })

    it('wrapper contains before pseudo element styling', () => {
      const { container } = render(<Textarea />)
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper?.className).toContain('before:absolute')
    })

    it('wrapper contains after pseudo element styling for focus ring', () => {
      const { container } = render(<Textarea />)
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper?.className).toContain('after:pointer-events-none')
    })

    it('wrapper contains disabled state styling', () => {
      const { container } = render(<Textarea />)
      const wrapper = container.querySelector('[data-slot="control"]')
      expect(wrapper?.className).toContain('has-data-disabled:opacity-50')
    })
  })

  describe('Textarea styling', () => {
    it('textarea has transparent background', () => {
      const { container } = render(<Textarea />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('bg-transparent')
    })

    it('textarea has placeholder color styling', () => {
      const { container } = render(<Textarea />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('placeholder:text-[var(--sj-ink-soft)]')
    })

    it('textarea has focus outline hidden', () => {
      const { container } = render(<Textarea />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('focus:outline-hidden')
    })

    it('textarea has invalid state styling', () => {
      const { container } = render(<Textarea />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('data-invalid:border-[var(--sj-tomato)]')
    })

    it('textarea has disabled border styling', () => {
      const { container } = render(<Textarea />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('disabled:border-[var(--sj-border)]')
    })

    it('textarea has hover border styling', () => {
      const { container } = render(<Textarea />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('data-hover:border-[var(--sj-brass)]')
    })

    it('textarea has appearance-none', () => {
      const { container } = render(<Textarea />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('appearance-none')
    })

    it('textarea has full height', () => {
      const { container } = render(<Textarea />)
      const textarea = container.querySelector('textarea')
      expect(textarea?.className).toContain('h-full')
    })
  })

  describe('Accessibility', () => {
    it('supports aria-label', () => {
      render(<Textarea aria-label="Accessible textarea" />)
      expect(screen.getByLabelText('Accessible textarea')).toBeInTheDocument()
    })

    it('can be associated with a label via id', () => {
      render(
        <>
          <label htmlFor="labeled-textarea">My Label</label>
          <Textarea id="labeled-textarea" />
        </>
      )
      expect(screen.getByLabelText('My Label')).toBeInTheDocument()
    })

    it('renders as a textbox role', () => {
      render(<Textarea aria-label="Textbox textarea" />)
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    it('supports invalid state via data attribute', () => {
      const { container } = render(<Textarea invalid aria-label="Invalid textarea" />)
      const textarea = container.querySelector('textarea')
      expect(textarea).toHaveAttribute('data-invalid')
    })

    it('supports aria-required', () => {
      render(<Textarea aria-label="Required textarea" aria-required="true" />)
      const textarea = screen.getByLabelText('Required textarea')
      expect(textarea).toHaveAttribute('aria-required', 'true')
    })
  })

  describe('Event handling', () => {
    it('calls onFocus when focused', async () => {
      const user = userEvent.setup()
      const onFocus = vi.fn()
      render(<Textarea onFocus={onFocus} aria-label="Focus test" />)
      const textarea = screen.getByLabelText('Focus test')
      await user.click(textarea)
      expect(onFocus).toHaveBeenCalledTimes(1)
    })

    it('calls onBlur when blurred', async () => {
      const user = userEvent.setup()
      const onBlur = vi.fn()
      render(<Textarea onBlur={onBlur} aria-label="Blur test" />)
      const textarea = screen.getByLabelText('Blur test')
      await user.click(textarea)
      await user.tab()
      expect(onBlur).toHaveBeenCalledTimes(1)
    })

    it('calls onKeyDown when key is pressed', async () => {
      const user = userEvent.setup()
      const onKeyDown = vi.fn()
      render(<Textarea onKeyDown={onKeyDown} aria-label="KeyDown test" />)
      const textarea = screen.getByLabelText('KeyDown test')
      await user.click(textarea)
      await user.keyboard('a')
      expect(onKeyDown).toHaveBeenCalled()
    })

    it('calls onKeyUp when key is released', async () => {
      const user = userEvent.setup()
      const onKeyUp = vi.fn()
      render(<Textarea onKeyUp={onKeyUp} aria-label="KeyUp test" />)
      const textarea = screen.getByLabelText('KeyUp test')
      await user.click(textarea)
      await user.keyboard('a')
      expect(onKeyUp).toHaveBeenCalled()
    })
  })
})
