import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Fieldset, Legend, FieldGroup, Field, Label, Description, ErrorMessage } from '~/components/ui/fieldset'

describe('Fieldset', () => {
  describe('Fieldset component', () => {
    it('renders children', () => {
      render(
        <Fieldset>
          <Legend>Test Fieldset</Legend>
        </Fieldset>
      )
      expect(screen.getByText('Test Fieldset')).toBeInTheDocument()
    })

    it('renders as a fieldset element', () => {
      render(
        <Fieldset>
          <Legend>Fieldset Legend</Legend>
        </Fieldset>
      )
      expect(screen.getByRole('group')).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(
        <Fieldset className="custom-fieldset">
          <Legend>Styled Fieldset</Legend>
        </Fieldset>
      )
      const fieldset = container.querySelector('fieldset')
      expect(fieldset?.className).toContain('custom-fieldset')
    })

    it('applies default spacing classes', () => {
      const { container } = render(
        <Fieldset>
          <Legend>Fieldset</Legend>
        </Fieldset>
      )
      const fieldset = container.querySelector('fieldset')
      expect(fieldset?.className).toContain('*:data-[slot=text]:mt-1')
    })

    it('passes disabled prop to Headless.Fieldset', () => {
      render(
        <Fieldset disabled>
          <Legend>Disabled Fieldset</Legend>
        </Fieldset>
      )
      const fieldset = screen.getByRole('group')
      expect(fieldset).toHaveAttribute('disabled')
    })
  })

  describe('Legend component', () => {
    it('renders legend text', () => {
      render(
        <Fieldset>
          <Legend>My Legend</Legend>
        </Fieldset>
      )
      expect(screen.getByText('My Legend')).toBeInTheDocument()
    })

    it('applies custom className', () => {
      render(
        <Fieldset>
          <Legend className="custom-legend">Custom Legend</Legend>
        </Fieldset>
      )
      const legend = screen.getByText('Custom Legend')
      expect(legend.className).toContain('custom-legend')
    })

    it('applies default styling classes', () => {
      render(
        <Fieldset>
          <Legend>Styled Legend</Legend>
        </Fieldset>
      )
      const legend = screen.getByText('Styled Legend')
      expect(legend.className).toContain('text-base/6')
      expect(legend.className).toContain('font-semibold')
    })

    it('has data-slot="legend" attribute', () => {
      render(
        <Fieldset>
          <Legend>Slot Legend</Legend>
        </Fieldset>
      )
      const legend = screen.getByText('Slot Legend')
      expect(legend).toHaveAttribute('data-slot', 'legend')
    })
  })

  describe('FieldGroup component', () => {
    it('renders children', () => {
      render(
        <FieldGroup>
          <div>Field 1</div>
          <div>Field 2</div>
        </FieldGroup>
      )
      expect(screen.getByText('Field 1')).toBeInTheDocument()
      expect(screen.getByText('Field 2')).toBeInTheDocument()
    })

    it('renders as a div element', () => {
      render(
        <FieldGroup data-testid="field-group">
          <div>Content</div>
        </FieldGroup>
      )
      const group = screen.getByTestId('field-group')
      expect(group.tagName).toBe('DIV')
    })

    it('applies custom className', () => {
      render(
        <FieldGroup className="custom-group" data-testid="field-group">
          <div>Content</div>
        </FieldGroup>
      )
      const group = screen.getByTestId('field-group')
      expect(group.className).toContain('custom-group')
    })

    it('has data-slot="control" attribute', () => {
      render(
        <FieldGroup data-testid="field-group">
          <div>Content</div>
        </FieldGroup>
      )
      const group = screen.getByTestId('field-group')
      expect(group).toHaveAttribute('data-slot', 'control')
    })

    it('applies default space-y-8 class', () => {
      render(
        <FieldGroup data-testid="field-group">
          <div>Content</div>
        </FieldGroup>
      )
      const group = screen.getByTestId('field-group')
      expect(group.className).toContain('space-y-8')
    })
  })

  describe('Field component', () => {
    it('renders children', () => {
      render(
        <Field>
          <Label>Test Field</Label>
        </Field>
      )
      expect(screen.getByText('Test Field')).toBeInTheDocument()
    })

    it('applies custom className', () => {
      const { container } = render(
        <Field className="custom-field">
          <Label>Custom Field</Label>
        </Field>
      )
      const field = container.firstChild as HTMLElement
      expect(field.className).toContain('custom-field')
    })

    it('applies spacing classes for label and control', () => {
      const { container } = render(
        <Field>
          <Label>Field Label</Label>
        </Field>
      )
      const field = container.firstChild as HTMLElement
      expect(field.className).toContain('[&>[data-slot=label]+[data-slot=control]]:mt-3')
    })

    it('passes disabled prop to Headless.Field', () => {
      render(
        <Field disabled>
          <Label>Disabled Field</Label>
        </Field>
      )
      const label = screen.getByText('Disabled Field')
      expect(label).toHaveAttribute('data-disabled')
    })
  })

  describe('Label component', () => {
    it('renders label text', () => {
      render(
        <Field>
          <Label>My Label</Label>
        </Field>
      )
      expect(screen.getByText('My Label')).toBeInTheDocument()
    })

    it('applies custom className', () => {
      render(
        <Field>
          <Label className="custom-label">Custom Label</Label>
        </Field>
      )
      const label = screen.getByText('Custom Label')
      expect(label.className).toContain('custom-label')
    })

    it('applies default styling classes', () => {
      render(
        <Field>
          <Label>Styled Label</Label>
        </Field>
      )
      const label = screen.getByText('Styled Label')
      expect(label.className).toContain('text-base/6')
      expect(label.className).toContain('select-none')
    })

    it('has data-slot="label" attribute', () => {
      render(
        <Field>
          <Label>Slot Label</Label>
        </Field>
      )
      const label = screen.getByText('Slot Label')
      expect(label).toHaveAttribute('data-slot', 'label')
    })

    it('renders as a label element', () => {
      render(
        <Field>
          <Label>Label Element</Label>
        </Field>
      )
      const label = screen.getByText('Label Element')
      expect(label.tagName).toBe('LABEL')
    })
  })

  describe('Description component', () => {
    it('renders description text', () => {
      render(
        <Field>
          <Description>This is a description</Description>
        </Field>
      )
      expect(screen.getByText('This is a description')).toBeInTheDocument()
    })

    it('applies custom className', () => {
      render(
        <Field>
          <Description className="custom-desc">Custom Description</Description>
        </Field>
      )
      const desc = screen.getByText('Custom Description')
      expect(desc.className).toContain('custom-desc')
    })

    it('applies default styling classes', () => {
      render(
        <Field>
          <Description>Styled Description</Description>
        </Field>
      )
      const desc = screen.getByText('Styled Description')
      expect(desc.className).toContain('text-base/6')
      expect(desc.className).toContain('text-[var(--sj-ink-soft)]')
    })

    it('has data-slot="description" attribute', () => {
      render(
        <Field>
          <Description>Slot Description</Description>
        </Field>
      )
      const desc = screen.getByText('Slot Description')
      expect(desc).toHaveAttribute('data-slot', 'description')
    })
  })

  describe('ErrorMessage component', () => {
    it('renders error message text', () => {
      render(
        <Field>
          <ErrorMessage>This field is required</ErrorMessage>
        </Field>
      )
      expect(screen.getByText('This field is required')).toBeInTheDocument()
    })

    it('applies custom className', () => {
      render(
        <Field>
          <ErrorMessage className="custom-error">Custom Error</ErrorMessage>
        </Field>
      )
      const error = screen.getByText('Custom Error')
      expect(error.className).toContain('custom-error')
    })

    it('applies red text color classes', () => {
      render(
        <Field>
          <ErrorMessage>Error Text</ErrorMessage>
        </Field>
      )
      const error = screen.getByText('Error Text')
      expect(error.className).toContain('text-[var(--sj-tomato)]')
    })

    it('has data-slot="error" attribute', () => {
      render(
        <Field>
          <ErrorMessage>Slot Error</ErrorMessage>
        </Field>
      )
      const error = screen.getByText('Slot Error')
      expect(error).toHaveAttribute('data-slot', 'error')
    })

    it('applies default text sizing classes', () => {
      render(
        <Field>
          <ErrorMessage>Sized Error</ErrorMessage>
        </Field>
      )
      const error = screen.getByText('Sized Error')
      expect(error.className).toContain('text-base/6')
    })
  })

  describe('Full fieldset composition', () => {
    it('renders a complete form fieldset with all components', () => {
      render(
        <Fieldset>
          <Legend>Account Settings</Legend>
          <FieldGroup>
            <Field>
              <Label>Username</Label>
              <Description>Choose a unique username</Description>
              <input type="text" data-slot="control" />
            </Field>
            <Field>
              <Label>Email</Label>
              <Description>Enter your email address</Description>
              <input type="email" data-slot="control" />
              <ErrorMessage>Invalid email format</ErrorMessage>
            </Field>
          </FieldGroup>
        </Fieldset>
      )

      expect(screen.getByText('Account Settings')).toBeInTheDocument()
      expect(screen.getByText('Username')).toBeInTheDocument()
      expect(screen.getByText('Choose a unique username')).toBeInTheDocument()
      expect(screen.getByText('Email')).toBeInTheDocument()
      expect(screen.getByText('Enter your email address')).toBeInTheDocument()
      expect(screen.getByText('Invalid email format')).toBeInTheDocument()
    })

    it('renders nested fieldsets', () => {
      render(
        <Fieldset>
          <Legend>Outer Fieldset</Legend>
          <FieldGroup>
            <Fieldset>
              <Legend>Inner Fieldset</Legend>
              <Field>
                <Label>Inner Field</Label>
              </Field>
            </Fieldset>
          </FieldGroup>
        </Fieldset>
      )

      expect(screen.getByText('Outer Fieldset')).toBeInTheDocument()
      expect(screen.getByText('Inner Fieldset')).toBeInTheDocument()
      expect(screen.getByText('Inner Field')).toBeInTheDocument()
    })

    it('handles disabled state across all components', () => {
      render(
        <Fieldset disabled>
          <Legend>Disabled Fieldset</Legend>
          <FieldGroup>
            <Field>
              <Label>Disabled Label</Label>
              <Description>Disabled Description</Description>
            </Field>
          </FieldGroup>
        </Fieldset>
      )

      const legend = screen.getByText('Disabled Fieldset')
      const label = screen.getByText('Disabled Label')
      const description = screen.getByText('Disabled Description')

      expect(legend).toHaveAttribute('data-disabled')
      expect(label).toHaveAttribute('data-disabled')
      expect(description).toHaveAttribute('data-disabled')
    })
  })
})
