import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "~/components/ouro/button/button";
import { NumberField } from "~/components/ouro/number-field/number-field";
import { Pagination } from "~/components/ouro/pagination/pagination";
import { Text } from "~/components/ouro/text/text";
import { CookStepTimer, CookTimerTray } from "~/components/recipe/CookTimers";
import { IngredientList, type Ingredient, type StepReference } from "~/components/recipe/IngredientList";
import { StepCard } from "~/components/recipe/StepCard";
import { StepsSectionHeading } from "~/components/recipe/StepsSectionHeading";
import { UnitSystemControl } from "~/components/recipe/UnitSystemControl";
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

/**
 * The control that opens cook mode, given focus back when cook mode closes. Cook mode replaces the
 * page, so the panel that held focus goes with it; without this, focus falls to the page itself.
 * Focus brings the control into view, unless `preventScroll` says the page puts its own scroll back
 * (the recipe page returns to the step the cook was on).
 */
export function useCookModeReturnFocus<T extends HTMLElement>(cookMode: boolean, { preventScroll = false } = {}) {
  const ref = useRef<T>(null);
  const wasCookMode = useRef(cookMode);
  useEffect(() => {
    if (wasCookMode.current && !cookMode) ref.current?.focus({ preventScroll });
    wasCookMode.current = cookMode;
  }, [cookMode, preventScroll]);
  return ref;
}

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
  // The step the cook is on, marked once they have started.
  const hasCookProgress = progressChecked > 0 || activeStepIndex > 0;

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
    <div id="steps" className="mx-auto max-w-4xl scroll-mt-24 px-4 py-8 sm:px-6 sm:py-10 lg:px-8 print:max-w-none print:px-0 print:py-4">
      <StepsSectionHeading hasProgress={progressChecked > 0} onClearProgress={controller.clearProgress} />

      {recipe.steps.length === 0 ? (
        <div className="border-y border-dashed border-[var(--sj-border-strong)] py-8 text-center">
          <Text tone="muted" className="mb-4">No steps added yet</Text>
          {emptyStepsAction}
        </div>
      ) : (
        // On a wide window, and on a foldable held like a book, the steps are a cookbook spread:
        // each step's ingredients on the left page and its method on the right (app/styles/fold.css).
        <div className="sj-cookbook-spread mt-6 border-y border-[var(--sj-border)] sm:mt-0">
          {recipe.steps.map((step, index) => (
            <div key={step.id} id={`step-${step.stepNum}`} className="scroll-mt-24 border-b border-[var(--sj-border)] last:border-b-0 print:break-inside-avoid">
              <StepCard
                current={hasCookProgress && index === activeStepIndex}
                stepNumber={step.stepNum}
                title={step.stepTitle ?? undefined}
                duration={step.duration}
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
    ? `${pageProgressChecked} of ${pageProgressTotal}`
    : "No checklist items";
  const pageLabel = `Step ${activeStepIndex + 1} of ${stepCount}`;
  // On a tall or half-open foldable, fold.css ends the step's row on the fold; it needs to know
  // where the pager starts.
  const pagerRef = useRef<HTMLDivElement>(null);
  useViewportTopVar(pagerRef, "--sj-cook-pager-top");
  // Cook mode replaces the page, and the control that opened it goes with it: focus moves to the
  // recipe's name at the top, so a screen reader says where the cook is and Tab starts from there.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      id="cook"
      data-testid="cook-mode-panel"
      className="h-[100svh] overflow-hidden bg-[var(--sj-page)] text-[var(--sj-ink)]"
      aria-labelledby="cook-mode-heading"
    >
      <div className="mx-auto flex h-[100svh] w-full max-w-7xl flex-col px-4 sm:px-6 lg:px-8">
        {/* The one-book cook step (desk target.md, Cook step): close (×) at the top left, as the
            Apple app has it, then the recipe and how much of it is checked. */}
        <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-[var(--sj-border)] py-3">
          <Button variant="outline" tone="secondary" aria-label="Exit cook mode" onClick={onExit}>
            <X />
          </Button>
          <div className="min-w-0">
            {/* Cook mode replaces the whole page (see the early return above), so this
                promotes the recipe title to the page's `h1` instead of adding a second,
                visually redundant one. */}
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="font-sj-ui truncate text-sm font-semibold text-[var(--sj-ink-soft)] outline-none"
            >
              {recipeTitle}
            </h1>
            <p className="font-sj-ui mt-0.5 text-xs text-[var(--sj-ink-soft)]">
              {recipeProgressLabel}
            </p>
          </div>
        </header>

        <CookTimerTray timers={timers} currentStepNum={step.stepNum} onGoToStep={onGoToStepNum} />

        <div
          ref={pagerRef}
          data-testid="cook-mode-pager"
          className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto py-6 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-stretch lg:gap-12 lg:py-10"
        >
          <article
            key={step.stepNum}
            className="flex shrink-0 flex-col py-2 sm:py-6 lg:min-h-0 lg:shrink lg:justify-center lg:py-10"
          >
            <p className="font-sj-ui m-0 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--sj-brass)]">
              {pageLabel}
            </p>
            <h2
              id="cook-mode-heading"
              className="font-sj-display mt-3 max-w-4xl text-2xl/8 font-semibold tracking-normal text-[var(--sj-ink)] sm:text-3xl/9"
            >
              {stepTitle}
            </h2>
            <p className="sj-type-display mt-5 max-w-3xl whitespace-pre-wrap text-[var(--sj-ink)] lg:text-6xl/[1.05]">
              {step.description}
            </p>
            <CookStepTimer timer={timers.find((timer) => timer.stepNum === step.stepNum)} />
          </article>

          {/* A <div>, not <aside>: this ingredient checklist and scale selector are core
              cook-mode controls for the current step, not tangential "complementary"
              content, and root.tsx always wraps route content in a <main> landmark, so an
              <aside> here would violate landmark-complementary-is-top-level. */}
          <div className="mx-auto flex w-full max-w-[38rem] shrink-0 flex-col justify-between gap-8 rounded-ouro-lg bg-[var(--sj-panel)] p-5 lg:min-h-0 lg:shrink lg:p-6">
            <div>
              {/* The step's own ingredients, as the Apple app heads them: "For this step · 0 of 2". */}
              <h3 className="font-sj-ui text-sm font-semibold text-[var(--sj-ink-soft)]">
                For this step · <span>{pageProgressLabel}</span>
              </h3>

              {(ingredients.length > 0 || stepOutputUses.length > 0) ? (
                <div className="mt-4">
                  {/* "For this step" names the list, so its own "Ingredients" is read but not shown,
                      as in the Apple app (desk target.md, Cook step). */}
                  <IngredientList
                    hideLabel
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

            <div className="mx-auto flex w-full max-w-[24rem] flex-col gap-4">
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
              <UnitSystemControl />
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
