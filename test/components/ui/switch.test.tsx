import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Switch, SwitchField, SwitchGroup } from '~/components/ui/switch'
import { Label, Description } from '~/components/ui/fieldset'

describe('Switch', () => {
  describe('Switch component', () => {
    it('renders a switch', () => {
      render(<Switch aria-label="Test switch" />)
      expect(screen.getByRole('switch', { name: 'Test switch' })).toBeInTheDocument()
    })

    it('renders unchecked by default', () => {
      render(<Switch aria-label="Test switch" />)
      expect(screen.getByRole('switch')).not.toBeChecked()
    })

    it('renders checked when checked prop is true', () => {
      render(<Switch aria-label="Test switch" checked />)
      expect(screen.getByRole('switch')).toBeChecked()
    })

    it('renders with defaultChecked', () => {
      render(<Switch aria-label="Test switch" defaultChecked />)
      expect(screen.getByRole('switch')).toBeChecked()
    })

    it('calls onChange when clicked', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<Switch aria-label="Test switch" onChange={onChange} />)
      await user.click(screen.getByRole('switch'))
      expect(onChange).toHaveBeenCalledWith(true)
    })

    it('toggles checked state when clicked (uncontrolled)', async () => {
      const user = userEvent.setup()
      render(<Switch aria-label="Test switch" />)
      const switchEl = screen.getByRole('switch')
      expect(switchEl).not.toBeChecked()
      await user.click(switchEl)
      expect(switchEl).toBeChecked()
      await user.click(switchEl)
      expect(switchEl).not.toBeChecked()
    })

    it('applies custom className', () => {
      const { container } = render(<Switch aria-label="Test switch" className="custom-class" />)
      const switchEl = container.querySelector('[data-slot="control"]')
      expect(switchEl?.className).toContain('custom-class')
    })

    it('applies default color styles (dark/zinc)', () => {
      const { container } = render(<Switch aria-label="Test switch" />)
      const switchEl = container.querySelector('[data-slot="control"]')
      expect(switchEl?.className).toContain('[--switch-bg:var(--color-zinc-900)]')
    })

    it('renders with different color variants', () => {
      const colors = ['red', 'blue', 'green', 'indigo', 'zinc', 'white', 'dark'] as const
      colors.forEach((color) => {
        const { unmount } = render(<Switch aria-label={`${color} switch`} color={color} />)
        expect(screen.getByRole('switch', { name: `${color} switch` })).toBeInTheDocument()
        unmount()
      })
    })

    it('renders with dark/zinc and dark/white colors', () => {
      const { unmount } = render(<Switch aria-label="dark/zinc switch" color="dark/zinc" />)
      expect(screen.getByRole('switch', { name: 'dark/zinc switch' })).toBeInTheDocument()
      unmount()

      render(<Switch aria-label="dark/white switch" color="dark/white" />)
      expect(screen.getByRole('switch', { name: 'dark/white switch' })).toBeInTheDocument()
    })

    it('renders with all available color variants', () => {
      const allColors = [
        'dark/zinc',
        'dark/white',
        'dark',
        'zinc',
        'white',
        'red',
        'orange',
        'amber',
        'yellow',
        'lime',
        'green',
        'emerald',
        'teal',
        'cyan',
        'sky',
        'blue',
        'indigo',
        'violet',
        'purple',
        'fuchsia',
        'pink',
        'rose',
      ] as const
      allColors.forEach((color) => {
        const { unmount } = render(<Switch aria-label={`${color} switch`} color={color} />)
        expect(screen.getByRole('switch', { name: `${color} switch` })).toBeInTheDocument()
        unmount()
      })
    })

    it('renders disabled state', () => {
      const { container } = render(<Switch aria-label="Disabled switch" disabled />)
      const switchEl = container.querySelector('[data-slot="control"]')
      expect(switchEl).toHaveAttribute('data-disabled')
    })

    it('does not call onChange when disabled', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<Switch aria-label="Disabled switch" disabled onChange={onChange} />)
      await user.click(screen.getByRole('switch'))
      expect(onChange).not.toHaveBeenCalled()
    })

    it('renders the switch thumb (aria-hidden span)', () => {
      const { container } = render(<Switch aria-label="Test switch" />)
      const thumb = container.querySelector('span[aria-hidden="true"]')
      expect(thumb).toBeInTheDocument()
      expect(thumb?.className).toContain('rounded-full')
    })

    it('renders a coarse-pointer touch target', () => {
      const { container } = render(<Switch aria-label="Test switch" />)
      const touchTarget = container.querySelector('span[data-slot="touch-target"][aria-hidden="true"]')
      expect(touchTarget).toBeInTheDocument()
      expect(touchTarget?.className).toContain('size-[max(100%,2.75rem)]')
    })

    it('has accessible name from aria-label', () => {
      render(<Switch aria-label="Accessible switch" />)
      expect(screen.getByRole('switch', { name: 'Accessible switch' })).toBeInTheDocument()
    })

    it('has data-slot="control" attribute', () => {
      const { container } = render(<Switch aria-label="Test switch" />)
      expect(container.querySelector('[data-slot="control"]')).toBeInTheDocument()
    })

    it('passes additional props to switch', () => {
      render(<Switch aria-label="Test switch" data-testid="custom-switch" />)
      expect(screen.getByTestId('custom-switch')).toBeInTheDocument()
    })

    it('handles controlled checked state', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      const { rerender } = render(<Switch aria-label="Test switch" checked={false} onChange={onChange} />)
      const switchEl = screen.getByRole('switch')

      expect(switchEl).not.toBeChecked()

      await user.click(switchEl)
      expect(onChange).toHaveBeenCalledWith(true)

      // Re-render with updated checked state
      rerender(<Switch aria-label="Test switch" checked={true} onChange={onChange} />)
      expect(switchEl).toBeChecked()
    })

    it('applies base layout styles', () => {
      const { container } = render(<Switch aria-label="Test switch" />)
      const switchEl = container.querySelector('[data-slot="control"]')
      expect(switchEl?.className).toContain('inline-flex')
      expect(switchEl?.className).toContain('rounded-full')
    })

    it('has group and isolate classes for styling context', () => {
      const { container } = render(<Switch aria-label="Test switch" />)
      const switchEl = container.querySelector('[data-slot="control"]')
      expect(switchEl?.className).toContain('group')
      expect(switchEl?.className).toContain('isolate')
    })
  })

  describe('SwitchField component', () => {
    it('renders children', () => {
      render(
        <SwitchField>
          <Switch aria-label="Field switch" />
        </SwitchField>
      )
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })

    it('applies custom className', () => {
      render(
        <SwitchField className="custom-field" data-testid="field">
          <Switch aria-label="Field switch" />
        </SwitchField>
      )
      const field = screen.getByTestId('field')
      expect(field.className).toContain('custom-field')
    })

    it('has data-slot="field" attribute', () => {
      render(
        <SwitchField data-testid="field">
          <Switch aria-label="Field switch" />
        </SwitchField>
      )
      expect(screen.getByTestId('field')).toHaveAttribute('data-slot', 'field')
    })

    it('renders with label', () => {
      render(
        <SwitchField>
          <Switch />
          <Label>Enable notifications</Label>
        </SwitchField>
      )
      expect(screen.getByText('Enable notifications')).toBeInTheDocument()
    })

    it('renders with description', () => {
      render(
        <SwitchField>
          <Switch />
          <Label>Enable notifications</Label>
          <Description>Receive push notifications for updates</Description>
        </SwitchField>
      )
      expect(screen.getByText('Receive push notifications for updates')).toBeInTheDocument()
    })

    it('clicking label toggles switch', async () => {
      const user = userEvent.setup()
      render(
        <SwitchField>
          <Switch />
          <Label>Enable notifications</Label>
        </SwitchField>
      )
      const switchEl = screen.getByRole('switch')
      expect(switchEl).not.toBeChecked()

      await user.click(screen.getByText('Enable notifications'))
      expect(switchEl).toBeChecked()
    })

    it('applies grid layout classes', () => {
      render(
        <SwitchField data-testid="field">
          <Switch aria-label="Field switch" />
        </SwitchField>
      )
      const field = screen.getByTestId('field')
      expect(field.className).toContain('grid')
    })

    it('has correct grid column layout', () => {
      render(
        <SwitchField data-testid="field">
          <Switch aria-label="Field switch" />
        </SwitchField>
      )
      const field = screen.getByTestId('field')
      expect(field.className).toContain('grid-cols-[1fr_auto]')
    })

    it('renders with label and description together', () => {
      render(
        <SwitchField>
          <Switch />
          <Label>Dark mode</Label>
          <Description>Enable dark mode for the application</Description>
        </SwitchField>
      )
      expect(screen.getByText('Dark mode')).toBeInTheDocument()
      expect(screen.getByText('Enable dark mode for the application')).toBeInTheDocument()
      expect(screen.getByRole('switch')).toBeInTheDocument()
    })
  })

  describe('SwitchGroup component', () => {
    it('renders children', () => {
      render(
        <SwitchGroup>
          <SwitchField>
            <Switch />
            <Label>Option 1</Label>
          </SwitchField>
          <SwitchField>
            <Switch />
            <Label>Option 2</Label>
          </SwitchField>
        </SwitchGroup>
      )
      expect(screen.getByText('Option 1')).toBeInTheDocument()
      expect(screen.getByText('Option 2')).toBeInTheDocument()
    })

    it('renders multiple switches', () => {
      render(
        <SwitchGroup>
          <SwitchField>
            <Switch />
            <Label>Option 1</Label>
          </SwitchField>
          <SwitchField>
            <Switch />
            <Label>Option 2</Label>
          </SwitchField>
        </SwitchGroup>
      )
      expect(screen.getAllByRole('switch')).toHaveLength(2)
    })

    it('applies custom className', () => {
      render(
        <SwitchGroup className="custom-group" data-testid="group">
          <SwitchField>
            <Switch aria-label="Switch" />
          </SwitchField>
        </SwitchGroup>
      )
      const group = screen.getByTestId('group')
      expect(group.className).toContain('custom-group')
    })

    it('has data-slot="control" attribute', () => {
      render(
        <SwitchGroup data-testid="group">
          <SwitchField>
            <Switch aria-label="Switch" />
          </SwitchField>
        </SwitchGroup>
      )
      expect(screen.getByTestId('group')).toHaveAttribute('data-slot', 'control')
    })

    it('applies space-y-3 class for spacing', () => {
      render(
        <SwitchGroup data-testid="group">
          <SwitchField>
            <Switch aria-label="Switch" />
          </SwitchField>
        </SwitchGroup>
      )
      const group = screen.getByTestId('group')
      expect(group.className).toContain('space-y-3')
    })

    it('allows independent switch selection', async () => {
      const user = userEvent.setup()
      render(
        <SwitchGroup>
          <SwitchField>
            <Switch />
            <Label>Option 1</Label>
          </SwitchField>
          <SwitchField>
            <Switch />
            <Label>Option 2</Label>
          </SwitchField>
        </SwitchGroup>
      )
      const switches = screen.getAllByRole('switch')

      await user.click(switches[0])
      expect(switches[0]).toBeChecked()
      expect(switches[1]).not.toBeChecked()

      await user.click(switches[1])
      expect(switches[0]).toBeChecked()
      expect(switches[1]).toBeChecked()
    })

    it('renders is a div element', () => {
      render(
        <SwitchGroup data-testid="group">
          <SwitchField>
            <Switch aria-label="Switch" />
          </SwitchField>
        </SwitchGroup>
      )
      const group = screen.getByTestId('group')
      expect(group.tagName).toBe('DIV')
    })
  })

  describe('Full switch composition', () => {
    it('renders a complete switch field with all components', () => {
      render(
        <SwitchGroup>
          <SwitchField>
            <Switch color="blue" />
            <Label>Email notifications</Label>
            <Description>Receive email updates about your account</Description>
          </SwitchField>
          <SwitchField>
            <Switch color="blue" />
            <Label>Push notifications</Label>
            <Description>Receive push notifications on your device</Description>
          </SwitchField>
        </SwitchGroup>
      )

      expect(screen.getByText('Email notifications')).toBeInTheDocument()
      expect(screen.getByText('Receive email updates about your account')).toBeInTheDocument()
      expect(screen.getByText('Push notifications')).toBeInTheDocument()
      expect(screen.getByText('Receive push notifications on your device')).toBeInTheDocument()
      expect(screen.getAllByRole('switch')).toHaveLength(2)
    })

    it('supports keyboard navigation', async () => {
      const user = userEvent.setup()
      render(
        <SwitchGroup>
          <SwitchField>
            <Switch />
            <Label>Option 1</Label>
          </SwitchField>
          <SwitchField>
            <Switch />
            <Label>Option 2</Label>
          </SwitchField>
        </SwitchGroup>
      )

      const switches = screen.getAllByRole('switch')

      // Tab to first switch and toggle with Space
      await user.tab()
      expect(switches[0]).toHaveFocus()
      await user.keyboard(' ')
      expect(switches[0]).toBeChecked()

      // Tab to second switch
      await user.tab()
      expect(switches[1]).toHaveFocus()
      await user.keyboard(' ')
      expect(switches[1]).toBeChecked()
    })

    it('renders disabled switch in a group', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(
        <SwitchGroup>
          <SwitchField>
            <Switch onChange={onChange} />
            <Label>Option 1</Label>
          </SwitchField>
          <SwitchField>
            <Switch disabled onChange={onChange} />
            <Label>Option 2 (Disabled)</Label>
          </SwitchField>
        </SwitchGroup>
      )

      const switches = screen.getAllByRole('switch')
      expect(switches[1]).toHaveAttribute('data-disabled')

      await user.click(switches[0])
      expect(onChange).toHaveBeenCalledTimes(1)

      await user.click(switches[1])
      // Still only called once since disabled switch doesn't trigger onChange
      expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('supports form submission with value', () => {
      render(
        <form data-testid="form">
          <Switch aria-label="Test switch" defaultChecked />
        </form>
      )
      expect(screen.getByRole('switch')).toBeChecked()
    })

    it('renders multiple groups independently', async () => {
      const user = userEvent.setup()
      render(
        <>
          <SwitchGroup data-testid="group1">
            <SwitchField>
              <Switch />
              <Label>Group 1 Option</Label>
            </SwitchField>
          </SwitchGroup>
          <SwitchGroup data-testid="group2">
            <SwitchField>
              <Switch />
              <Label>Group 2 Option</Label>
            </SwitchField>
          </SwitchGroup>
        </>
      )

      const switches = screen.getAllByRole('switch')
      expect(switches).toHaveLength(2)

      await user.click(switches[0])
      expect(switches[0]).toBeChecked()
      expect(switches[1]).not.toBeChecked()
    })
  })
})
