import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { RecipeBuilder, type RecipeBuilderData } from '../../../app/components/recipe/RecipeBuilder'

const recipeWithSteps: RecipeBuilderData = {
  id: 'recipe-sunday-soup',
  title: 'Sunday Tomato Soup',
  description: 'A bright, low-fuss soup for chilly afternoons and grilled-cheese diplomacy.',
  servings: '4 bowls',
  imageUrl: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=1000&h=700&fit=crop',
  steps: [
    {
      id: 'step-1',
      stepNum: 1,
      stepTitle: 'Soften the aromatics',
      description: 'Warm olive oil in a heavy pot. Add onion, garlic, and a pinch of salt; cook until glossy and soft.',
      duration: 8,
      ingredients: [
        { quantity: 2, unit: 'tbsp', ingredientName: 'olive oil' },
        { quantity: 1, unit: 'medium', ingredientName: 'yellow onion, diced' },
        { quantity: 3, unit: 'cloves', ingredientName: 'garlic, sliced' },
      ],
    },
    {
      id: 'step-2',
      stepNum: 2,
      stepTitle: 'Simmer and blend',
      description: 'Add tomatoes and stock. Simmer until the flavors settle down together, then blend until smooth.',
      duration: 25,
      ingredients: [
        { quantity: 28, unit: 'oz', ingredientName: 'canned whole tomatoes' },
        { quantity: 2, unit: 'cups', ingredientName: 'vegetable stock' },
      ],
    },
  ],
}

const meta: Meta<typeof RecipeBuilder> = {
  title: 'Recipe/Input/RecipeBuilder',
  component: RecipeBuilder,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The current recipe creation/editing surface: details, image upload, steps, ingredients, and save/cancel actions in one flow.',
      },
    },
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="sj-page p-4 sm:p-8">
        <div className="mx-auto max-w-4xl">
        <Story />
        </div>
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof meta>

export const NewRecipe: Story = {
  args: {
    onSave: fn(),
    onCancel: fn(),
  },
}

export const NewRecipeWithValidation: Story = {
  args: {
    onSave: fn(),
    onCancel: fn(),
    errors: {
      title: 'Give this recipe a name before saving.',
      steps: 'Add at least one step so future-you knows what to do.',
    },
  },
}

export const EditingRecipe: Story = {
  args: {
    recipe: recipeWithSteps,
    onSave: fn(),
    onCancel: fn(),
  },
}

export const SavingRecipe: Story = {
  args: {
    recipe: recipeWithSteps,
    onSave: fn(),
    onCancel: fn(),
    loading: true,
  },
}

export const DetailsOnly: Story = {
  args: {
    recipe: {
      ...recipeWithSteps,
      id: 'recipe-details-only',
      steps: [],
    },
    showSteps: false,
    onSave: fn(),
    onCancel: fn(),
  },
}
