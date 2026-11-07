import { formatScaledAmount, formatStepReferenceName, IngredientList, type Ingredient, type StepReference } from './IngredientList'

export interface StepCardProps {
  /** Step number (1-indexed) */
  stepNumber: number
  /** Optional step title */
  title?: string
  /** Step instructions/description */
  description: string
  /** Ingredients needed for this step */
  ingredients: Ingredient[]
  /** References to outputs from previous steps */
  stepOutputUses: StepReference[]
  /** Scale factor for ingredient quantities */
  scaleFactor: number
  /** Ingredient ids the cook has ticked off */
  checkedIngredientIds: ReadonlySet<string>
  /** Called with an ingredient's id when it is ticked or unticked */
  onIngredientToggle: (id: string) => void
  /** Step output ids the cook has ticked off */
  checkedStepOutputIds: ReadonlySet<string>
  /** Called with a step output's id when it is ticked or unticked */
  onStepOutputToggle: (id: string) => void
  /** The step the cook is on: marked so they find their place again. */
  current?: boolean
}

/**
 * A single recipe step section showing step number, ingredients, step uses, and instructions.
 *
 * Features:
 * - Editorial step heading treatment
 * - Optional step title
 * - The step's ingredients as a checklist, scaled
 * - Spacious vertical rhythm for reading
 */
export function StepCard({
  stepNumber,
  title,
  description,
  ingredients,
  stepOutputUses,
  scaleFactor,
  checkedIngredientIds,
  onIngredientToggle,
  checkedStepOutputIds,
  onStepOutputToggle,
  current = false,
}: StepCardProps) {
  return (
    <article
      className="sj-step-card px-5 py-8 sm:px-8 sm:py-10"
      aria-labelledby={`step-${stepNumber}-heading`}
      data-current-step={current ? "" : undefined}
    >
      <div className="sj-step-card-head space-y-3">
        <div className="flex items-baseline gap-3">
          <p
            data-testid="step-number"
            className="font-sj-ui m-0 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--sj-ink-soft)]"
          >
            Step {stepNumber}
          </p>
          {current ? (
            <p data-testid="current-step-marker" className="font-sj-ui m-0 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--sj-brass)]">
              You are here
            </p>
          ) : null}
        </div>
        {title && (
          <h3
            id={`step-${stepNumber}-heading`}
            className="font-sj-display m-0 text-2xl font-semibold tracking-normal text-[var(--sj-ink)] sm:text-3xl"
          >
            {title}
          </h3>
        )}
        {!title && <span id={`step-${stepNumber}-heading`} className="sr-only">Step {stepNumber}</span>}
      </div>

      <div className="sj-step-card-body mt-8 space-y-8">
        {(ingredients.length > 0 || stepOutputUses.length > 0) && (
          <div data-testid="step-ingredients-block" className="sj-step-ingredients mx-auto w-full max-w-[38rem]">
            {/* The ticks are this cook's progress, not the recipe: paper gets the plain list below. */}
            <div className="print:hidden">
              <IngredientList
                ingredients={ingredients}
                scaleFactor={scaleFactor}
                checkedIds={checkedIngredientIds}
                onToggle={onIngredientToggle}
                stepOutputUses={stepOutputUses}
                checkedStepOutputIds={checkedStepOutputIds}
                onStepOutputToggle={onStepOutputToggle}
              />
            </div>
            <ul data-testid="step-print-ingredients" className="m-0 hidden list-none p-0 font-sj-ui text-base text-[var(--sj-ink)] print:block">
              {stepOutputUses.map((reference) => (
                <li key={reference.id}>{formatStepReferenceName(reference)}</li>
              ))}
              {ingredients.map((ingredient) => (
                <li key={ingredient.id}>
                  {[formatScaledAmount(ingredient, scaleFactor), ingredient.name].filter(Boolean).join(' ')}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="sj-step-method font-sj-body m-0 whitespace-pre-wrap text-base leading-loose text-[var(--sj-ink)] sm:text-lg">
          {description}
        </p>
      </div>
    </article>
  )
}
