import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "~/components/button";
import { Text } from "~/components/text";
import { CookStepTimer, CookTimerTray } from "~/components/recipe/CookTimers";
import { IngredientList, type Ingredient } from "~/components/recipe/IngredientList";
import { ScaleSelector } from "~/components/recipe/ScaleSelector";
import { StepCard } from "~/components/recipe/StepCard";
import type { StepReference } from "~/components/recipe/StepOutputUseCallout";
import { StepsSectionHeading } from "~/components/recipe/StepsSectionHeading";
import type { CookTimersController } from "~/hooks/use-cook-timers";
import {
  clampStepIndex,
  stepIngredients,
  stepOutputUses,
  type CookController,
  type CookModeStep,
} from "~/components/cook/cook-controller";

const cookModeExitClass =
  "inline-flex min-h-12 min-w-11 items-center justify-center px-2 font-sj-ui text-xs font-bold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)] transition hover:text-[var(--sj-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)] sm:min-h-11 sm:px-2";

export interface RecipeCookViewProps {
  controller: CookController;
  /** Shown under "No steps added yet" for a recipe without steps, such as the owner's "Add steps". */
  emptyStepsAction?: ReactNode;
  /** The page's own content at the end of the steps section. */
  children?: ReactNode;
}

/**
 * A recipe's steps and its cook mode, drawn entirely from a `CookController`. It knows nothing of
 * routes, storage or accounts, so the recipe page and a page with a local controller show the
 * same thing. With cook mode open it is the whole page.
 */
export function RecipeCookView({ controller, emptyStepsAction, children }: RecipeCookViewProps) {
  const { recipe, checkedIngredientIds, checkedStepOutputIds, activeStepIndex, scaleFactor } = controller;
  const progressTotal = recipe.steps.reduce(
    (count, step) => count + stepIngredients(recipe, step.id).length + stepOutputUses(recipe, step.id).length,
    0,
  );
  const progressChecked = checkedIngredientIds.size + checkedStepOutputIds.size;

  if (controller.cookMode) {
    const step = recipe.steps[activeStepIndex];
    return (
      <CookModePanel
        recipeTitle={recipe.title}
        step={step}
        stepCount={recipe.steps.length}
        activeStepIndex={activeStepIndex}
        progressChecked={progressChecked}
        progressTotal={progressTotal}
        ingredients={stepIngredients(recipe, step.id)}
        stepOutputUses={stepOutputUses(recipe, step.id)}
        scaleFactor={scaleFactor}
        checkedIngredientIds={checkedIngredientIds}
        checkedStepOutputIds={checkedStepOutputIds}
        onIngredientToggle={controller.toggleIngredient}
        onStepOutputToggle={controller.toggleStepOutput}
        onScaleChange={controller.setScale}
        onPrevious={() => controller.goToStep(clampStepIndex(activeStepIndex - 1, recipe.steps.length))}
        onNext={() => controller.goToStep(clampStepIndex(activeStepIndex + 1, recipe.steps.length))}
        onStepSelect={controller.goToStep}
        onExit={controller.exitCookMode}
        timers={controller.timers}
        onGoToStepNum={(stepNum) => {
          // The tray only lists this recipe's steps, so the step is always found.
          controller.goToStep(Math.max(0, recipe.steps.findIndex((candidate) => candidate.stepNum === stepNum)));
        }}
      />
    );
  }

  /* istanbul ignore next -- @preserve browser scroll navigation */
  const handleStepReferenceClick = (stepNumber: number) => {
    // Scroll to the referenced step
    const stepElement = document.getElementById(`step-${stepNumber}`);
    if (stepElement) {
      stepElement.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <div id="steps" className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 print:max-w-none print:px-0 print:py-4">
      <StepsSectionHeading hasProgress={progressChecked > 0} onClearProgress={controller.clearProgress} />

      {recipe.steps.length === 0 ? (
        <div className="border-y border-dashed border-[var(--sj-border-strong)] py-8 text-center">
          <Text className="mb-4">No steps added yet</Text>
          {emptyStepsAction}
        </div>
      ) : (
        <div className="mt-6 border-y border-[var(--sj-border)] sm:mt-0">
          {recipe.steps.map((step) => (
            <div key={step.id} id={`step-${step.stepNum}`} className="border-b border-[var(--sj-border)] last:border-b-0 print:break-inside-avoid">
              <StepCard
                stepNumber={step.stepNum}
                title={step.stepTitle ?? undefined}
                description={step.description}
                ingredients={stepIngredients(recipe, step.id)}
                stepOutputUses={stepOutputUses(recipe, step.id)}
                scaleFactor={scaleFactor}
                checkedIngredientIds={checkedIngredientIds}
                onIngredientToggle={controller.toggleIngredient}
                checkedStepOutputIds={checkedStepOutputIds}
                onStepOutputToggle={controller.toggleStepOutput}
                onStepReferenceClick={handleStepReferenceClick}
              />
            </div>
          ))}
        </div>
      )}

      {children}
    </div>
  );
}

function CookModePanel({
  recipeTitle,
  step,
  stepCount,
  activeStepIndex,
  progressChecked,
  progressTotal,
  ingredients,
  stepOutputUses,
  scaleFactor,
  checkedIngredientIds,
  checkedStepOutputIds,
  onIngredientToggle,
  onStepOutputToggle,
  onScaleChange,
  onPrevious,
  onNext,
  onStepSelect,
  onExit,
  timers,
  onGoToStepNum,
}: {
  recipeTitle: string;
  step: CookModeStep;
  stepCount: number;
  activeStepIndex: number;
  progressChecked: number;
  progressTotal: number;
  ingredients: Ingredient[];
  stepOutputUses: StepReference[];
  scaleFactor: number;
  checkedIngredientIds: ReadonlySet<string>;
  checkedStepOutputIds: ReadonlySet<string>;
  onIngredientToggle: (id: string) => void;
  onStepOutputToggle: (id: string) => void;
  onScaleChange: (value: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onStepSelect: (index: number) => void;
  onExit: () => void;
  timers: CookTimersController;
  onGoToStepNum: (stepNum: number) => void;
}) {
  const stepTitle = step.stepTitle ?? `Step ${step.stepNum}`;
  const recipeProgressLabel = progressTotal > 0
    ? `${progressChecked} of ${progressTotal} checked`
    : "No checklist items";
  const pageProgressTotal = ingredients.length + stepOutputUses.length;
  const pageProgressChecked =
    ingredients.filter((ingredient) => checkedIngredientIds.has(ingredient.id)).length +
    stepOutputUses.filter((reference) => checkedStepOutputIds.has(reference.id)).length;
  const pageProgressLabel = pageProgressTotal > 0
    ? `${pageProgressChecked} of ${pageProgressTotal} checked`
    : "No checklist items";
  const isFirstStep = activeStepIndex === 0;
  const isLastStep = activeStepIndex >= stepCount - 1;
  const pageLabel = `Step ${activeStepIndex + 1} of ${stepCount}`;

  return (
    <section
      id="cook"
      data-testid="cook-mode-panel"
      className="h-[100svh] overflow-hidden bg-[var(--sj-page)] text-[var(--sj-ink)]"
      aria-labelledby="cook-mode-heading"
    >
      <div className="mx-auto flex h-[100svh] w-full max-w-7xl flex-col px-4 sm:px-6 lg:px-8">
        <header className="flex min-h-20 shrink-0 items-center justify-between gap-4 border-b border-[var(--sj-border)] py-4">
          <div className="min-w-0">
            <p className="sj-eyebrow">Now cooking</p>
            {/* Cook mode replaces the whole page (see the early return above), so this
                promotes the recipe title to the page's `h1` instead of adding a second,
                visually redundant one. */}
            <h1 className="font-sj-ui mt-1 truncate text-sm font-semibold text-[var(--sj-ink-soft)]">
              {recipeTitle}
            </h1>
            <p className="font-sj-ui mt-1 text-xs uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
              {recipeProgressLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onExit}
            className={cookModeExitClass}
          >
            Exit cook mode
          </button>
        </header>

        <CookTimerTray controller={timers} currentStepNum={step.stepNum} onGoToStep={onGoToStepNum} />

        <div
          data-testid="cook-mode-pager"
          className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto py-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-stretch lg:gap-12 lg:py-10"
        >
          <article
            key={step.stepNum}
            className="flex shrink-0 flex-col border-y border-[var(--sj-border-strong)] py-8 sm:py-10 lg:min-h-0 lg:shrink lg:justify-center lg:py-12"
          >
            <p className="font-sj-ui m-0 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--sj-brass)]">
              {pageLabel}
            </p>
            <h2
              id="cook-mode-heading"
              className="font-sj-display text-2xl/8 font-semibold tracking-normal text-[var(--sj-ink)] font-sj-display mt-5 max-w-4xl text-4xl/10 font-semibold tracking-normal text-[var(--sj-ink)] sm:text-6xl/15 lg:text-7xl/18"
            >
              {stepTitle}
            </h2>
            <p className="text-base/6 text-[var(--sj-ink-soft)] mt-7 max-w-3xl whitespace-pre-wrap text-xl/9 text-[var(--sj-ink)] sm:text-2xl/10">
              {step.description}
            </p>
            <CookStepTimer stepNum={step.stepNum} controller={timers} />
          </article>

          {/* A <div>, not <aside>: this ingredient checklist and scale selector are core
              cook-mode controls for the current step, not tangential "complementary"
              content, and root.tsx always wraps route content in a <main> landmark, so an
              <aside> here would violate landmark-complementary-is-top-level. */}
          <div className="mx-auto flex w-full max-w-[38rem] shrink-0 flex-col justify-between gap-8 border-y border-[var(--sj-border)] py-6 lg:min-h-0 lg:shrink lg:py-8">
            <div>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
                    On this page
                  </p>
                  <p className="font-sj-ui mt-2 text-xs uppercase tracking-[0.18em] text-[var(--sj-ink-soft)]">
                    {pageProgressLabel}
                  </p>
                </div>
                <p className="font-sj-display text-3xl/8 font-semibold tabular-nums text-[var(--sj-ink)]">
                  {activeStepIndex + 1}/{stepCount}
                </p>
              </div>

              {(ingredients.length > 0 || stepOutputUses.length > 0) ? (
                <div className="mt-6">
                  <IngredientList
                    ingredients={ingredients}
                    stepOutputUses={stepOutputUses}
                    scaleFactor={scaleFactor}
                    checkedIds={checkedIngredientIds}
                    checkedStepOutputIds={checkedStepOutputIds}
                    onToggle={onIngredientToggle}
                    onStepOutputToggle={onStepOutputToggle}
                  />
                </div>
              ) : (
                <p className="font-sj-body mt-6 text-base text-[var(--sj-ink-soft)]">
                  No ingredients to check on this step.
                </p>
              )}
            </div>

            <div className="mx-auto w-full max-w-[24rem]">
              <ScaleSelector value={scaleFactor} onChange={onScaleChange} />
            </div>
          </div>
        </div>

        <footer className="z-10 shrink-0 border-t border-[var(--sj-border)] bg-[var(--sj-page)] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <Button
              type="button"
              plain
              aria-label="Previous step"
              disabled={isFirstStep}
              onClick={onPrevious}
              className="justify-self-start"
            >
              <ChevronLeft data-slot="icon" aria-hidden="true" />
              <span className="hidden sm:inline">Previous step</span>
              <span className="sm:hidden">Prev</span>
            </Button>
            <nav
              aria-label="Cook steps"
              className="hidden items-center gap-2 sm:flex"
            >
              {Array.from({ length: stepCount }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => onStepSelect(index)}
                  aria-label={`Step ${index + 1}${index === activeStepIndex ? " current" : ""}`}
                  aria-current={index === activeStepIndex ? "step" : undefined}
                  className="group grid size-11 place-items-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)]"
                >
                  <span
                    aria-hidden="true"
                    className={`size-2.5 rounded-full transition ${
                      index === activeStepIndex
                        ? "bg-[var(--sj-ink)]"
                        : "bg-[var(--sj-border-strong)] group-hover:bg-[var(--sj-ink-soft)]"
                    }`}
                  />
                </button>
              ))}
            </nav>
            <Button
              type="button"
              aria-label="Next step"
              disabled={isLastStep}
              onClick={onNext}
              className="justify-self-end"
            >
              <span className="hidden sm:inline">Next step</span>
              <span className="sm:hidden">Next</span>
              <ChevronRight data-slot="icon" aria-hidden="true" />
            </Button>
          </div>
        </footer>
      </div>
    </section>
  );
}
