import { RadioGroup, type RadioGroupOption } from '~/components/ouro/radio-group/radio-group'
import type { RecipeVisibility } from '~/domains/kitchen'

// The choices a cook has today, in the order SELECTABLE_RECIPE_VISIBILITIES gives them.
const OPTIONS: RadioGroupOption[] = [
  { value: 'public', label: 'Public', description: 'Anyone can find it, cook it and save it.' },
  { value: 'private', label: 'Only me', description: 'Hidden from everyone else, in search and on your profile.' },
]

export interface RecipeVisibilityFieldProps {
  /** The level shown picked; a household recipe shows as Only me until households ship. */
  value: RecipeVisibility
  onChange: (value: RecipeVisibility) => void
  /** Names the field for a form post; the recipe builder reads `value` instead. */
  name?: string
  legend?: string
  disabled?: boolean
}

/** Who can see a recipe, or a cook's default for new ones. */
export function RecipeVisibilityField({
  value,
  onChange,
  name = 'visibility',
  legend = 'Who can see this recipe',
  disabled = false,
}: RecipeVisibilityFieldProps) {
  return (
    <RadioGroup
      legend={legend}
      name={name}
      options={OPTIONS}
      value={value === 'public' ? 'public' : 'private'}
      onValueChange={(next) => onChange(next === 'private' ? 'private' : 'public')}
      disabled={disabled}
    />
  )
}
