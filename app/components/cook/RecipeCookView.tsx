import { useRef, type ReactNode } from "react";
import { Button } from "~/components/ouro/button/button";
import { NumberField } from "~/components/ouro/number-field/number-field";
import { Pagination } from "~/components/ouro/pagination/pagination";
import { Text } from "~/components/ouro/text/text";
import { CookStepTimer, CookTimerTray } from "~/components/recipe/CookTimers";
import { IngredientList, type Ingredient, type StepReference } from "~/components/recipe/IngredientList";
import { StepCard } from "~/components/recipe/StepCard";
import { StepsSectionHeading } from "~/components/recipe/StepsSectionHeading";
import type { CookTimer } from "~/lib/cook-timers";
import { useViewportTopVar } from "~/hooks/use-viewport-top-var";
import {
  SCALE_RANGE,
  clampStepIndex,
  stepIngredients,
  stepOutputUses,
  type CookController,
  type CookModeStep,
} from "~/components/cook/cook-controller";

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
        onStepSelect={(index) => controller.goToStep(clampStepIndex(index, recipe.steps.length))}
        onExit={controller.exitCookMode}
        timers={controller.timers}
        onGoToStepNum={(stepNum) => {
          // The tray only lists this recipe's steps, so the step is always found.
          controller.goToStep(Math.max(0, recipe.steps.findIndex((candidate) => candidate.stepNum === stepNum)));
        }}
      />
    );
  }

  return (
    <div id="steps" className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 print:max-w-none print:px-0 print:py-4">
      <StepsSectionHeading hasProgress={progressChecked > 0} onClearProgress={controller.clearProgress} />

      {recipe.steps.length === 0 ? (
        <div className="border-y border-dashed border-[var(--sj-border-strong)] py-8 text-center">
          <Text tone="muted" className="mb-4">No steps added yet</Text>
          {emptyStepsAction}
        </div>
      ) : (
        <div className="mt-6 border-y border-[var(--sj-border)] sm:mt-0" data-fold-columns="">
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
  onStepSelect: (index: number) => void;
  onExit: () => void;
  timers: readonly CookTimer[];
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
  const pageLabel = `Step ${activeStepIndex + 1} of ${stepCount}`;
  // On a tall or half-open foldable, fold.css ends the step's row on the fold; it needs to know
  // where the pager starts.
  const pagerRef = useRef<HTMLDivElement>(null);
  useViewportTopVar(pagerRef, "--sj-cook-pager-top");

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
          <Button variant="plain" tone="secondary" onClick={onExit}>
            Exit cook mode
          </Button>
        </header>

        <CookTimerTray timers={timers} currentStepNum={step.stepNum} onGoToStep={onGoToStepNum} />

        <div
          ref={pagerRef}
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
            <CookStepTimer timer={timers.find((timer) => timer.stepNum === step.stepNum)} />
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
              <NumberField
                label="Scale"
                value={scaleFactor}
                {...SCALE_RANGE}
                format={{ maximumFractionDigits: 2 }}
                decrementLabel="Decrease scale"
                incrementLabel="Increase scale"
                onValueChange={(next) => {
                  if (next !== null) onScaleChange(next);
                }}
              />
            </div>
          </div>
        </div>

        <footer className="z-10 shrink-0 border-t border-[var(--sj-border)] bg-[var(--sj-page)] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Pagination
            label="Cook steps"
            page={activeStepIndex + 1}
            pageCount={stepCount}
            onPageChange={(page) => onStepSelect(page - 1)}
            previousLabel="Previous step"
            nextLabel="Next step"
            pageLabel="Step {page}"
            summaryLabel="Step {page} of {pageCount}"
          />
        </footer>
      </div>
    </section>
  );
}
