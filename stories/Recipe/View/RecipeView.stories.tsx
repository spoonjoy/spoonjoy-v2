import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Button } from '../../../app/components/ui/button'
import { Heading } from '../../../app/components/ui/heading'
import { Text } from '../../../app/components/ui/text'
import { RecipeHeader } from '../../../app/components/recipe/RecipeHeader'
import { StepCard } from '../../../app/components/recipe/StepCard'
import type { Ingredient } from '../../../app/components/recipe/IngredientList'
import type { StepReference } from '../../../app/components/recipe/StepOutputUseCallout'

type RecipeStep = {
  id: string
  stepNum: number
  title?: string
  description: string
  ingredients: Ingredient[]
  stepOutputUses: StepReference[]
}

type RecipeStoryData = {
  id: string
  title: string
  description?: string
  chefName: string
  chefId: string
  chefProfileHref: string
  chefPhotoUrl?: string
  imageUrl?: string
  servings?: string
  steps: RecipeStep[]
}

const soupRecipe: RecipeStoryData = {
  id: 'sunday-tomato-soup',
  title: 'Sunday Tomato Soup',
  description: 'A silky tomato soup with enough garlic to announce itself, built for grilled cheese and second helpings.',
  chefName: 'Ari Mendelow',
  chefId: 'ari',
  chefProfileHref: '/users/ari',
  chefPhotoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&h=200&fit=crop',
  imageUrl: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=1400&h=900&fit=crop',
  servings: '4 bowls',
  steps: [
    {
      id: 'step-1',
      stepNum: 1,
      title: 'Build the base',
      description: 'Warm the olive oil in a heavy pot. Add onion, garlic, and salt, then cook until the onion softens and the kitchen starts smelling promising.',
      ingredients: [
        { id: 'oil', quantity: 2, unit: 'tbsp', name: 'olive oil', iconKey: 'pantry' },
        { id: 'onion', quantity: 1, unit: 'medium', name: 'yellow onion, diced', iconKey: 'produce' },
        { id: 'garlic', quantity: 3, unit: 'cloves', name: 'garlic, sliced', iconKey: 'produce' },
      ],
      stepOutputUses: [],
    },
    {
      id: 'step-2',
      stepNum: 2,
      title: 'Simmer the soup',
      description: 'Add tomatoes, stock, and basil. Simmer for 25 minutes, stirring occasionally, until the tomatoes collapse into something cozy.',
      ingredients: [
        { id: 'tomatoes', quantity: 28, unit: 'oz', name: 'whole peeled tomatoes', iconKey: 'produce' },
        { id: 'stock', quantity: 2, unit: 'cups', name: 'vegetable stock', iconKey: 'pantry' },
        { id: 'basil', quantity: 0.25, unit: 'cup', name: 'fresh basil', iconKey: 'produce' },
      ],
      stepOutputUses: [{ id: 'base', stepNumber: 1, stepTitle: 'Build the base' }],
    },
    {
      id: 'step-3',
      stepNum: 3,
      title: 'Blend and finish',
      description: 'Blend until smooth. Stir in cream if you want a softer landing, then taste and adjust salt before serving.',
      ingredients: [
        { id: 'cream', quantity: 0.33, unit: 'cup', name: 'cream, optional', iconKey: 'dairy' },
        { id: 'salt', quantity: null, unit: '', name: 'salt, to taste', iconKey: 'pantry' },
      ],
      stepOutputUses: [{ id: 'soup', stepNumber: 2, stepTitle: 'Simmer the soup' }],
    },
  ],
}

const minimalRecipe: RecipeStoryData = {
  ...soupRecipe,
  id: 'toast',
  title: 'Perfect Toast',
  description: undefined,
  imageUrl: undefined,
  servings: '1 snack',
  steps: [
    {
      id: 'step-1',
      stepNum: 1,
      title: 'Toast and butter',
      description: 'Toast bread until deeply golden. Butter immediately so it melts into every corner.',
      ingredients: [
        { id: 'bread', quantity: 2, unit: 'slices', name: 'good bread', iconKey: 'pantry' },
        { id: 'butter', quantity: 1, unit: 'tbsp', name: 'salted butter', iconKey: 'dairy' },
      ],
      stepOutputUses: [],
    },
  ],
}

function RecipeViewMock({ recipe, initialScale = 1, isOwner = false }: { recipe: RecipeStoryData; initialScale?: number; isOwner?: boolean }) {
  const [scaleFactor, setScaleFactor] = useState(initialScale)
  const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(new Set())
  const [checkedStepOutputs, setCheckedStepOutputs] = useState<Set<string>>(new Set())

  const toggleIngredient = (id: string) => {
    setCheckedIngredients((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleStepOutput = (id: string) => {
    setCheckedStepOutputs((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearProgress = () => {
    setCheckedIngredients(new Set())
    setCheckedStepOutputs(new Set())
  }

  return (
    <div className="sj-page pb-24">
      <div className="mx-auto max-w-6xl px-4 pt-5 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <Button href="/recipes" plain>
            <ArrowLeft data-slot="icon" aria-hidden="true" />
            Back to recipes
          </Button>
          {isOwner ? <Button variant="destructive">Delete Recipe</Button> : null}
        </div>
      </div>

      <RecipeHeader
        title={recipe.title}
        description={recipe.description}
        chefName={recipe.chefName}
        chefId={recipe.chefId}
        chefProfileHref={recipe.chefProfileHref}
        chefPhotoUrl={recipe.chefPhotoUrl}
        imageUrl={recipe.imageUrl}
        servings={recipe.servings}
        scaleFactor={scaleFactor}
        onScaleChange={setScaleFactor}
        onClearProgress={clearProgress}
      />

      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="mb-6">
          <p className="sj-eyebrow">Cook mode</p>
          <Heading level={2} className="mt-3 text-3xl/9 font-semibold tracking-normal sm:text-4xl/11">
            Steps
          </Heading>
        </div>

        {recipe.steps.length === 0 ? (
          <div className="sj-card rounded-[var(--sj-radius-surface)] p-8 text-center">
            <Text className="mb-4">No steps added yet</Text>
            {isOwner ? <Button href={`/recipes/${recipe.id}/edit`}>Add Steps</Button> : null}
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--sj-radius-surface)] border border-[var(--sj-border)] bg-[var(--sj-panel)] shadow-[var(--sj-shadow-soft)] backdrop-blur-xl">
            {recipe.steps.map((step) => (
              <div key={step.id} id={`step-${step.stepNum}`} className="border-b border-[var(--sj-border)] last:border-b-0">
                <StepCard
                  stepNumber={step.stepNum}
                  title={step.title}
                  description={step.description}
                  ingredients={step.ingredients}
                  stepOutputUses={step.stepOutputUses}
                  scaleFactor={scaleFactor}
                  checkedIngredientIds={checkedIngredients}
                  onIngredientToggle={toggleIngredient}
                  checkedStepOutputIds={checkedStepOutputs}
                  onStepOutputToggle={toggleStepOutput}
                  onStepReferenceClick={() => undefined}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const meta: Meta<typeof RecipeViewMock> = {
  title: 'Recipe/View/RecipeView',
  component: RecipeViewMock,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'The current recipe-reading surface: hero header, scalable servings, checkable step ingredients, step-output references, and owner actions.',
      },
    },
  },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof meta>

export const ReaderView: Story = {
  args: {
    recipe: soupRecipe,
  },
}

export const OwnerView: Story = {
  args: {
    recipe: soupRecipe,
    isOwner: true,
  },
}

export const ScaledForCompany: Story = {
  args: {
    recipe: soupRecipe,
    initialScale: 2,
  },
}

export const MinimalRecipe: Story = {
  args: {
    recipe: minimalRecipe,
  },
}

export const EmptyOwnerRecipe: Story = {
  args: {
    recipe: {
      ...soupRecipe,
      id: 'empty-recipe',
      title: 'Draft Recipe',
      imageUrl: undefined,
      steps: [],
    },
    isOwner: true,
  },
}
