import { RadioGroup, type RadioGroupOption } from '~/components/ouro/radio-group/radio-group'
import { SELECTABLE_RECIPE_VISIBILITIES, type RecipeVisibility } from '~/domains/kitchen'

const OPTIONS: Record<RecipeVisibility, RadioGroupOption> = {
  public: { value: 'public', label: 'Public', description: 'Anyone can find it, cook it and save it.' },
  household: { value: 'household', label: 'Household', description: 'Only you and the people in your household.' },
  private: { value: 'private', label: 'Only me', description: 'Hidden from everyone else, in search and on your profile.' },
}

export interface RecipeVisibilityFieldProps {
  /** The level shown picked; a level that is not one of `choices` (household without households) shows as Only me. */
  value: RecipeVisibility
  onChange: (value: RecipeVisibility) => void
  /** The levels the cook can choose, most open first. Public and Only me unless the page gives more. */
  choices?: readonly RecipeVisibility[]
  /** Names the field for a form post; the recipe builder reads `value` instead. */
  name?: string
  legend?: string
  disabled?: boolean
}

/** Who can see a recipe, or a cook's default for new ones. */
export function RecipeVisibilityField({
  value,
  onChange,
  choices = SELECTABLE_RECIPE_VISIBILITIES,
  name = 'visibility',
  legend = 'Who can see this recipe',
  disabled = false,
}: RecipeVisibilityFieldProps) {
  const chosen = (next: string): RecipeVisibility => choices.find((level) => level === next) ?? 'private'
  return (
    <RadioGroup
      legend={legend}
      name={name}
      options={choices.map((level) => OPTIONS[level])}
      value={chosen(value)}
      onValueChange={(next) => onChange(chosen(next))}
      disabled={disabled}
    />
  )
}
