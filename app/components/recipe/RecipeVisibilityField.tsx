import { RadioGroup, type RadioGroupOption } from '~/components/ouro/radio-group/radio-group'
import { RECIPE_VISIBILITY_CHOICES, type RecipeVisibility } from '~/domains/kitchen'

const OPTIONS: Record<RecipeVisibility, RadioGroupOption> = {
  public: { value: 'public', label: 'Public', description: 'Anyone can find it, cook it and save it.' },
  household: { value: 'household', label: 'Household', description: 'Only you and the people in your household.' },
  private: { value: 'private', label: 'Only me', description: 'Hidden from everyone else, in search and on your profile.' },
}

export interface RecipeVisibilityFieldProps {
  /** The level shown picked. */
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
      options={RECIPE_VISIBILITY_CHOICES.map((level) => OPTIONS[level])}
      value={value}
      onValueChange={(next) => onChange(next as RecipeVisibility)}
      disabled={disabled}
    />
  )
}
