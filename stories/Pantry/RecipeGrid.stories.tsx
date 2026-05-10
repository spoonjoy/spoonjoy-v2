import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { RecipeGrid } from '../../app/components/pantry/RecipeGrid'

const recipes = [
  {
    id: 'r-1',
    title: 'Lemon Pasta',
    description: 'Bright pasta with garlic, lemon zest, and parmesan.',
    imageUrl: 'https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=900&h=600&fit=crop',
    difficulty: 'Easy' as const,
    cookTimeMinutes: 20,
    servings: '2',
    chefName: 'Ari',
    href: '/recipes/r-1',
  },
  {
    id: 'r-2',
    title: 'Spiced Chickpea Bowl',
    description: 'Roasted chickpeas, fluffy rice, and tahini drizzle.',
    difficulty: 'Medium' as const,
    cookTimeMinutes: 35,
    servings: '4',
    chefName: 'Slugger',
    href: '/recipes/r-2',
  },
  {
    id: 'r-3',
    title: 'Roast Chicken and Root Veg',
    description: 'One-pan dinner with crisp skin and caramelized vegetables.',
    imageUrl: 'https://images.unsplash.com/photo-1518492104633-130d0cc84637?w=900&h=600&fit=crop',
    difficulty: 'Hard' as const,
    cookTimeMinutes: 70,
    servings: '6',
    chefName: 'Grandma',
    href: '/recipes/r-3',
  },
]

const meta: Meta<typeof RecipeGrid> = {
  title: 'Pantry/RecipeGrid',
  component: RecipeGrid,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'The current pantry recipe grid, including the empty state and optional card quick actions.',
      },
    },
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    recipes,
  },
}

export const WithQuickActions: Story = {
  args: {
    recipes,
    onShare: fn(),
    onSave: fn(),
  },
}

export const Empty: Story = {
  args: {
    recipes: [],
  },
}

export const EmptyWithoutCallToAction: Story = {
  args: {
    recipes: [],
    emptyTitle: 'No saved recipes yet',
    emptyMessage: 'Recipes you save from another pantry will collect here.',
    emptyCtaHref: null,
  },
}
