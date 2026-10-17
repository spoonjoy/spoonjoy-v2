import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Heading, Subheading } from '~/components/heading'

describe('Heading components', () => {
  describe('Heading', () => {
    it('renders children', () => {
      render(<Heading>Main heading</Heading>)
      expect(screen.getByText('Main heading')).toBeInTheDocument()
    })

    it('renders as h1 by default', () => {
      render(<Heading>Default heading</Heading>)
      expect(screen.getByRole('heading', { level: 1, name: 'Default heading' })).toBeInTheDocument()
    })

    it('renders at specified level', () => {
      render(<Heading level={3}>Level 3 heading</Heading>)
      expect(screen.getByRole('heading', { level: 3, name: 'Level 3 heading' })).toBeInTheDocument()
    })

    it('renders all heading levels correctly', () => {
      const levels = [1, 2, 3, 4, 5, 6] as const
      levels.forEach((level) => {
        const { unmount } = render(<Heading level={level}>Level {level}</Heading>)
        expect(screen.getByRole('heading', { level, name: `Level ${level}` })).toBeInTheDocument()
        unmount()
      })
    })

    it('applies custom className', () => {
      render(<Heading className="custom-heading">Styled heading</Heading>)
      expect(screen.getByText('Styled heading')).toHaveClass('custom-heading')
    })

    it('passes additional props', () => {
      render(<Heading data-testid="test-heading">With props</Heading>)
      expect(screen.getByTestId('test-heading')).toBeInTheDocument()
    })
  })

  describe('Subheading', () => {
    it('renders children', () => {
      render(<Subheading>Sub heading</Subheading>)
      expect(screen.getByText('Sub heading')).toBeInTheDocument()
    })

    it('renders as h2 by default', () => {
      render(<Subheading>Default subheading</Subheading>)
      expect(screen.getByRole('heading', { level: 2, name: 'Default subheading' })).toBeInTheDocument()
    })

    it('renders at specified level', () => {
      render(<Subheading level={4}>Level 4 subheading</Subheading>)
      expect(screen.getByRole('heading', { level: 4, name: 'Level 4 subheading' })).toBeInTheDocument()
    })

    it('applies custom className', () => {
      render(<Subheading className="custom-subheading">Styled subheading</Subheading>)
      expect(screen.getByText('Styled subheading')).toHaveClass('custom-subheading')
    })
  })
})
