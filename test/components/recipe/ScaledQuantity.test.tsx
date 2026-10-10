import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScaledQuantity } from '../../../app/components/recipe/ScaledQuantity'

describe('ScaledQuantity', () => {
  describe('rendering', () => {
    it('renders quantity, unit, and name', () => {
      render(<ScaledQuantity quantity={2} unit="cups" name="flour" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('2 cups flour')
    })

    it('renders without unit when not provided', () => {
      render(<ScaledQuantity quantity={3} name="large eggs" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('3 large eggs')
    })

    it('renders with empty unit', () => {
      render(<ScaledQuantity quantity={3} unit="" name="large eggs" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('3 large eggs')
    })
  })

  describe('formatting', () => {
    it('formats 0.5 as ½', () => {
      render(<ScaledQuantity quantity={0.5} unit="cup" name="sugar" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('½ cup sugar')
    })

    it('formats 1.5 as 1 ½', () => {
      render(<ScaledQuantity quantity={1.5} unit="cups" name="milk" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('1 ½ cups milk')
    })

    it('formats 0.25 as ¼', () => {
      render(<ScaledQuantity quantity={0.25} unit="tsp" name="salt" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('¼ tsp salt')
    })

    it('formats 0.75 as ¾', () => {
      render(<ScaledQuantity quantity={0.75} unit="cup" name="butter" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('¾ cup butter')
    })

    it('formats 1/3 as ⅓', () => {
      render(<ScaledQuantity quantity={1 / 3} unit="cup" name="oil" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('⅓ cup oil')
    })

    it('formats whole numbers without fractions', () => {
      render(<ScaledQuantity quantity={2} unit="cups" name="flour" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('2 cups flour')
    })
  })

  describe('scaling', () => {
    it('scales quantity by default factor of 1', () => {
      render(<ScaledQuantity quantity={2} unit="cups" name="flour" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('2 cups flour')
    })

    it('doubles quantity with scaleFactor 2', () => {
      render(<ScaledQuantity quantity={1} unit="cup" name="butter" scaleFactor={2} />)
      const element = screen.getByTestId('scaled-quantity')
      // Past one, the unit reads in the plural.
      expect(element).toHaveTextContent('2 cups butter')
    })

    it('halves quantity with scaleFactor 0.5', () => {
      render(<ScaledQuantity quantity={2} unit="cups" name="sugar" scaleFactor={0.5} />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('1 cups sugar')
    })

    it('applies 1.5x scale correctly', () => {
      render(<ScaledQuantity quantity={2} unit="cups" name="flour" scaleFactor={1.5} />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('3 cups flour')
    })

    it('formats scaled fractions correctly', () => {
      // 1 cup × 0.5 = 0.5 cup → ½ cup
      render(<ScaledQuantity quantity={1} unit="cup" name="cream" scaleFactor={0.5} />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('½ cup cream')
    })
  })

  describe('edge cases', () => {
    it('handles null quantity', () => {
      render(<ScaledQuantity quantity={null} unit="cup" name="optional garnish" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('cup optional garnish')
    })

    it('handles undefined quantity', () => {
      render(<ScaledQuantity quantity={undefined} unit="tbsp" name="optional spice" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('tbsp optional spice')
    })

    it('handles zero quantity', () => {
      render(<ScaledQuantity quantity={0} unit="tbsp" name="optional chili" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('0 tbsp optional chili')
    })

    it('handles large quantities', () => {
      render(<ScaledQuantity quantity={24} unit="cups" name="flour" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('24 cups flour')
    })

    it('handles very small quantities', () => {
      render(<ScaledQuantity quantity={0.125} unit="tsp" name="cayenne" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element).toHaveTextContent('⅛ tsp cayenne')
    })
  })

  describe('accessibility', () => {
    it('has testid for testing', () => {
      render(<ScaledQuantity quantity={1} unit="cup" name="flour" />)
      expect(screen.getByTestId('scaled-quantity')).toBeInTheDocument()
    })

    it('renders as span element', () => {
      render(<ScaledQuantity quantity={1} unit="cup" name="flour" />)
      const element = screen.getByTestId('scaled-quantity')
      expect(element.tagName).toBe('SPAN')
    })
  })
})
