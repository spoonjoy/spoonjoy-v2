import type { Route } from "./+types/recipes.$id.steps.$stepId.edit";
import { Form, redirect, data, useActionData, useLoaderData, useSearchParams, useSubmit } from "react-router";
import { getIngredientParserEnv, getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { useEffect, useState } from "react";
import { ConfirmationDialog } from "~/components/confirmation-dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { ErrorMessage, Field, Label } from "~/components/ui/fieldset";
import { Text } from "~/components/ui/text";
import { Link } from "~/components/ui/link";
import { ValidationError } from "~/components/ui/validation-error";
import { useToast } from "~/components/ui/toast";
import { Listbox, ListboxOption, ListboxLabel } from "~/components/ui/listbox";
import { CookbookHeader, CookbookPage, RuledEmptyState, SettingsPanel } from "~/components/cookbook/page";
import { ChecklistRow } from "~/components/shopping/checklist-row";
import {
  deleteExistingStepOutputUses,
  createStepOutputUses,
} from "~/lib/step-output-use-mutations.server";
import { validateStepDeletion } from "~/lib/step-deletion-validation.server";
import {
  parseIngredients,
  IngredientParseError,
  type ParsedIngredient,
} from "~/lib/ingredient-parse.server";
import {
  validateStepTitle,
  validateStepDescription,
  validateQuantity,
  validateUnitName,
  validateIngredientName,
  validateStepReference,
  STEP_TITLE_MAX_LENGTH,
  STEP_DESCRIPTION_MAX_LENGTH,
} from "~/lib/validation";
import { IngredientInputToggle, type IngredientInputMode } from "~/components/recipe/IngredientInputToggle";
import { ManualIngredientInput } from "~/components/recipe/ManualIngredientInput";
import { IngredientParseInput } from "~/components/recipe/IngredientParseInput";
import { ParsedIngredientList } from "~/components/recipe/ParsedIngredientList";

interface ActionData {
  errors?: {
    stepTitle?: string;
    description?: string;
    quantity?: string;
    unitName?: string;
    ingredientName?: string;
    usesSteps?: string;
    stepDeletion?: string;
    general?: string;
    parse?: string;
  };
  success?: boolean;
  parsedIngredients?: ParsedIngredient[];
}

const STEP_CONTENT_REQUIREMENT_ERROR = "Add at least 1 ingredient or 1 step output use before saving this step.";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const { id, stepId } = params;

  const database = await getRequestDb(context);

  const recipe = await database.recipe.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      chefId: true,
      deletedAt: true,
    },
  });

  if (!recipe || recipe.deletedAt) {
    throw new Response("Recipe not found", { status: 404 });
  }

  if (recipe.chefId !== userId) {
    throw new Response("Unauthorized", { status: 403 });
  }

  const step = await database.recipeStep.findUnique({
    where: { id: stepId },
    include: {
      ingredients: {
        include: {
          unit: true,
          ingredientRef: true,
        },
      },
      usingSteps: {
        include: {
          outputOfStep: {
            select: { stepNum: true, stepTitle: true },
          },
        },
        orderBy: { outputStepNum: "asc" },
      },
    },
  });

  if (!step || step.recipeId !== id) {
    throw new Response("Step not found", { status: 404 });
  }

  // Get available steps (all steps with stepNum < current step's stepNum)
  const availableSteps = await database.recipeStep.findMany({
    where: {
      recipeId: id,
      stepNum: { lt: step.stepNum },
    },
    select: {
      stepNum: true,
      stepTitle: true,
    },
    orderBy: { stepNum: "asc" },
  });

  return { recipe, step, availableSteps };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const { id, stepId } = params;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  const database = await getRequestDb(context);

  // Verify ownership
  const recipe = await database.recipe.findUnique({
    where: { id },
    select: { chefId: true, deletedAt: true },
  });

  if (!recipe || recipe.deletedAt) {
    throw new Response("Recipe not found", { status: 404 });
  }

  if (recipe.chefId !== userId) {
    throw new Response("Unauthorized", { status: 403 });
  }

  const step = await database.recipeStep.findUnique({
    where: { id: stepId },
    select: { id: true, recipeId: true, stepNum: true },
  });

  if (!step || step.recipeId !== id) {
    throw new Response("Step not found", { status: 404 });
  }

  // Handle parseIngredients intent
  if (intent === "parseIngredients") {
    const ingredientText = formData.get("ingredientText")?.toString() || "";

    try {
      const parsedIngredients = await parseIngredients(
        ingredientText,
        getIngredientParserEnv(context)
      );
      return data({ parsedIngredients });
    } catch (error) {
      if (error instanceof IngredientParseError) {
        return data(
          { errors: { parse: error.message } },
          { status: 400 }
        );
      }
      // Unexpected errors
      return data(
        { errors: { parse: "An unexpected error occurred while parsing ingredients" } },
        { status: 500 }
      );
    }
  }

  // Handle delete intent
  if (intent === "delete") {
    // Validate step can be deleted (no dependencies)
    const validationResult = await validateStepDeletion(database, id, step.stepNum);
    if (!validationResult.valid) {
      return data(
        { errors: { stepDeletion: validationResult.error } },
        { status: 400 }
      );
    }

    await database.recipeStep.delete({
      where: { id: stepId },
    });
    return redirect(`/recipes/${id}/edit`);
  }

  // Handle add ingredient intent
  if (intent === "addIngredient") {
    /* istanbul ignore next -- @preserve
     * formData null fallbacks: These fallbacks handle edge cases where form fields
     * are missing from the request (e.g., malformed requests). The UI form always
     * sends all fields, so these branches cannot be exercised via normal user flow.
     * Defensive coding pattern - validation errors will still catch invalid values.
     */
    const quantity = parseFloat(formData.get("quantity")?.toString() || "0");
    const unitName = formData.get("unitName")?.toString() || "";
    const ingredientName = formData.get("ingredientName")?.toString() || "";

    // Validate ingredient fields
    const ingredientErrors: ActionData["errors"] = {};

    const quantityResult = validateQuantity(quantity);
    if (!quantityResult.valid) {
      ingredientErrors.quantity = quantityResult.error;
    }

    const unitNameResult = validateUnitName(unitName);
    if (!unitNameResult.valid) {
      ingredientErrors.unitName = unitNameResult.error;
    }

    const ingredientNameResult = validateIngredientName(ingredientName);
    if (!ingredientNameResult.valid) {
      ingredientErrors.ingredientName = ingredientNameResult.error;
    }

    if (Object.keys(ingredientErrors).length > 0) {
      return data({ errors: ingredientErrors }, { status: 400 });
    }

    // Get or create unit
    let unit = await database.unit.findUnique({
      where: { name: unitName.toLowerCase() },
    });

    if (!unit) {
      unit = await database.unit.create({
        data: { name: unitName.toLowerCase() },
      });
    }

    // Get or create ingredient ref
    let ingredientRef = await database.ingredientRef.findUnique({
      where: { name: ingredientName.toLowerCase() },
    });

    if (!ingredientRef) {
      ingredientRef = await database.ingredientRef.create({
        data: { name: ingredientName.toLowerCase() },
      });
    }

    // Check for duplicate ingredient in recipe
    const existingIngredient = await database.ingredient.findFirst({
      where: {
        recipeId: id,
        ingredientRefId: ingredientRef.id,
      },
    });

    if (existingIngredient) {
      return data(
        { errors: { ingredientName: "This ingredient is already in the recipe" } },
        { status: 400 }
      );
    }

    // Create ingredient
    await database.ingredient.create({
      data: {
        recipeId: id,
        stepNum: (await database.recipeStep.findUnique({ where: { id: stepId }, select: { stepNum: true } }))!.stepNum,
        quantity,
        unitId: unit.id,
        ingredientRefId: ingredientRef.id,
      },
    });

    return data({ success: true });
  }

  // Handle delete ingredient intent
  if (intent === "deleteIngredient") {
    const ingredientId = formData.get("ingredientId")?.toString();
    if (ingredientId) {
      await database.ingredient.delete({
        where: { id: ingredientId },
      });
      return data({ success: true });
    }
  }

  // Handle update step
  const stepTitle = formData.get("stepTitle")?.toString() || "";
  const description = formData.get("description")?.toString() || "";

  const errors: ActionData["errors"] = {};

  // Validation
  const stepTitleResult = validateStepTitle(stepTitle || null);
  if (!stepTitleResult.valid) {
    errors.stepTitle = stepTitleResult.error;
  }

  const descriptionResult = validateStepDescription(description);
  if (!descriptionResult.valid) {
    errors.description = descriptionResult.error;
  }

  // Parse and validate selected step output uses
  const usesStepsRaw = formData.getAll("usesSteps");
  const parsedSteps = usesStepsRaw.map((s) => parseInt(s.toString(), 10));

  // Validate each selected step reference
  for (const outputStepNum of parsedSteps) {
    const validationResult = validateStepReference(outputStepNum, step.stepNum);
    if (!validationResult.valid) {
      errors.usesSteps = validationResult.error;
      break; // Show first error
    }
  }

  if (Object.keys(errors).length > 0) {
    return data({ errors }, { status: 400 });
  }

  // Filter to only valid step numbers and de-duplicate (extra safety)
  const usesSteps = [...new Set(parsedSteps.filter((n) => !isNaN(n) && n > 0 && n < step.stepNum))];

  const stepIngredientCount = await database.ingredient.count({
    where: {
      recipeId: id,
      stepNum: step.stepNum,
    },
  });

  if (stepIngredientCount === 0 && usesSteps.length === 0) {
    errors.usesSteps = STEP_CONTENT_REQUIREMENT_ERROR;
    return data({ errors }, { status: 400 });
  }

  try {
    await database.recipeStep.update({
      where: { id: stepId },
      data: {
        stepTitle: stepTitle.trim() || null,
        description: description.trim(),
      },
    });

    // Update step output uses: delete existing and create new
    await deleteExistingStepOutputUses(database, id, step.stepNum);
    if (usesSteps.length > 0) {
      await createStepOutputUses(database, id, step.stepNum, usesSteps);
    }

    return redirect(`/recipes/${id}/edit`);
  } catch (error) {
    return data(
      { errors: { general: "Failed to update step. Please try again." } },
      { status: 500 }
    );
  }
}

export default function EditStep() {
  const { recipe, step, availableSteps } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const [showIngredientForm, setShowIngredientForm] = useState(false);
  const [ingredientToRemove, setIngredientToRemove] = useState<string | null>(null);
  const [ingredientInputMode, setIngredientInputMode] = useState<IngredientInputMode>('ai');
  const [parsedIngredients, setParsedIngredients] = useState<ParsedIngredient[]>([]);
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();

  // Initialize selected steps from existing usingSteps
  const [selectedSteps, setSelectedSteps] = useState<number[]>(
    step.usingSteps?.map((u) => u.outputStepNum) || []
  );

  const stepDeletionError = actionData?.errors?.stepDeletion;
  const stepTitleErrorId = "edit-step-title-error";
  const usesStepsErrorId = "edit-step-uses-steps-error";
  const descriptionErrorId = "edit-step-description-error";

  const stepDeletionErrorElement = stepDeletionError
    ? <ValidationError error={stepDeletionError} className="mb-4" />
    : null;

  useEffect(() => {
    if (searchParams.get("created") === "1") {
      showToast({ message: "Step created successfully." });
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("created");
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams, showToast]);

  // Ingredient input mode handlers
  const handleModeChange = (mode: IngredientInputMode) => {
    setIngredientInputMode(mode);
  };

  const handleManualAdd = (ingredient: { quantity: number; unit: string; ingredientName: string }) => {
    const formData = new FormData();
    formData.set("intent", "addIngredient");
    formData.set("quantity", String(ingredient.quantity));
    formData.set("unitName", ingredient.unit);
    formData.set("ingredientName", ingredient.ingredientName);
    submit(formData, { method: "post" });
  };

  const handleParsed = (ingredients: ParsedIngredient[]) => {
    setParsedIngredients(ingredients);
  };

  const handleEditParsed = (index: number, ingredient: ParsedIngredient) => {
    setParsedIngredients((prev) => {
      const updated = [...prev];
      updated[index] = ingredient;
      return updated;
    });
  };

  const handleRemoveParsed = (index: number) => {
    setParsedIngredients((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddAll = (ingredients: ParsedIngredient[]) => {
    // Add all parsed ingredients sequentially
    for (const ingredient of ingredients) {
      const formData = new FormData();
      formData.set("intent", "addIngredient");
      formData.set("quantity", String(ingredient.quantity));
      formData.set("unitName", ingredient.unit);
      formData.set("ingredientName", ingredient.ingredientName);
      submit(formData, { method: "post" });
    }
    // Clear parsed ingredients after adding all
    setParsedIngredients([]);
  };

  return (
    <CookbookPage>
      <CookbookHeader
        eyebrow={`Step ${step.stepNum}`}
        title="Edit Step"
        action={<Link href={`/recipes/${recipe.id}/edit`} className="sj-link inline-flex min-h-11 items-center">← Back to recipe</Link>}
      >
        <Text>Keep the method for {recipe.title} easy to follow in the kitchen.</Text>
      </CookbookHeader>

      <div className="mt-8 max-w-4xl">
        {actionData?.errors?.general && (
          <ValidationError error={actionData.errors.general} className="mb-4" />
        )}

        <Form method="post" className="sj-form-section flex flex-col gap-6">
          <Field>
            <Label>
              Step Title (optional)
            </Label>
            <Input
              type="text"
              name="stepTitle"
              maxLength={STEP_TITLE_MAX_LENGTH}
              defaultValue={step.stepTitle || ""}
              invalid={!!actionData?.errors?.stepTitle}
              aria-invalid={actionData?.errors?.stepTitle ? true : undefined}
              aria-describedby={actionData?.errors?.stepTitle ? stepTitleErrorId : undefined}
            />
            {actionData?.errors?.stepTitle && (
              <ErrorMessage id={stepTitleErrorId}>{actionData.errors.stepTitle}</ErrorMessage>
            )}
          </Field>

          {step.stepNum === 1 ? (
            <Field>
              <Label>Uses Output From</Label>
              <Text className="italic">No previous steps available</Text>
            </Field>
          ) : availableSteps.length > 0 && (
            <Field>
              <Label>Uses Output From (optional)</Label>
              <Listbox
                multiple
                value={selectedSteps}
                onChange={setSelectedSteps}
                aria-label="Select previous steps"
                aria-invalid={actionData?.errors?.usesSteps ? true : undefined}
                aria-describedby={actionData?.errors?.usesSteps ? usesStepsErrorId : undefined}
                placeholder="Select previous steps (optional)"
              >
                {availableSteps.map((availableStep) => (
                  <ListboxOption key={availableStep.stepNum} value={availableStep.stepNum}>
                    <ListboxLabel>
                      Step {availableStep.stepNum}{availableStep.stepTitle ? `: ${availableStep.stepTitle}` : ""}
                    </ListboxLabel>
                  </ListboxOption>
                ))}
              </Listbox>
              {actionData?.errors?.usesSteps && (
                <ErrorMessage id={usesStepsErrorId}>
                  {actionData.errors.usesSteps}
                </ErrorMessage>
              )}
              {selectedSteps.map((stepNum) => (
                <input key={stepNum} type="hidden" name="usesSteps" value={stepNum} />
              ))}
            </Field>
          )}

          <Field>
            <Label>
              Description *
            </Label>
            <Textarea
              name="description"
              rows={6}
              required
              maxLength={STEP_DESCRIPTION_MAX_LENGTH}
              defaultValue={step.description}
              invalid={!!actionData?.errors?.description}
              aria-invalid={actionData?.errors?.description ? true : undefined}
              aria-describedby={actionData?.errors?.description ? descriptionErrorId : undefined}
            />
            {actionData?.errors?.description && (
              <ErrorMessage id={descriptionErrorId}>
                {actionData.errors.description}
              </ErrorMessage>
            )}
          </Field>

          <div className="flex flex-col-reverse gap-3 border-t border-[var(--sj-border)] pt-4 sm:flex-row sm:justify-end">
            <Button href={`/recipes/${recipe.id}/edit`} plain>
              Cancel
            </Button>
            <Button type="submit">
              Update
            </Button>
          </div>
        </Form>

        <div className="mt-4">{stepDeletionErrorElement}</div>

        <SettingsPanel
          title="Ingredients"
          action={
            <Button onClick={() => setShowIngredientForm(!showIngredientForm)}>
              {showIngredientForm ? "Cancel" : "+ Add Ingredient"}
            </Button>
          }
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          </div>

          {showIngredientForm && (
            <div className="mb-4 border-y border-[var(--sj-border)] py-5">
              {/* Toggle between AI and Manual modes */}
              <IngredientInputToggle onChange={handleModeChange} />

              {/* Conditional rendering based on mode */}
              {ingredientInputMode === "manual" ? (
                <ManualIngredientInput onAdd={handleManualAdd} />
              ) : (
                <>
                  <IngredientParseInput
                    recipeId={recipe.id}
                    stepId={step.id}
                    onParsed={handleParsed}
                    onSwitchToManual={() => setIngredientInputMode('manual')}
                  />
                  {parsedIngredients.length > 0 && (
                    <ParsedIngredientList
                      ingredients={parsedIngredients}
                      onEdit={handleEditParsed}
                      onRemove={handleRemoveParsed}
                      onAddAll={handleAddAll}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {step.ingredients.length === 0 ? (
            <RuledEmptyState title="No ingredients added yet" />
          ) : (
            <div className="sj-list-ruled">
              {step.ingredients.map((ingredient) => (
                <div key={ingredient.id}>
                  <ChecklistRow
                    name={ingredient.ingredientRef.name}
                    quantity={`${ingredient.quantity} ${ingredient.unit.name}`}
                    action={
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => setIngredientToRemove(ingredient.id)}
                      >
                        Remove
                      </Button>
                    }
                  />
                  <span className="sr-only">{ingredient.quantity}</span>
                  <span className="sr-only">
                    {ingredient.unit.name} {ingredient.ingredientRef.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SettingsPanel>

        {/* Remove ingredient confirmation dialog */}
        <ConfirmationDialog
          open={!!ingredientToRemove}
          onClose={() => setIngredientToRemove(null)}
          onConfirm={() => {
            /* istanbul ignore next -- @preserve TypeScript requires null check; dialog only opens when ingredientToRemove is truthy */
            if (!ingredientToRemove) return;
            const formData = new FormData();
            formData.set("intent", "deleteIngredient");
            formData.set("ingredientId", ingredientToRemove);
            submit(formData, { method: "post" });
            setIngredientToRemove(null);
          }}
          title="Remove this ingredient?"
          description="This ingredient will be removed from the step."
          confirmLabel="Remove it"
          cancelLabel="Keep it"
          destructive
        />
      </div>
    </CookbookPage>
  );
}
