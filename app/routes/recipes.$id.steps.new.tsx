import type { Route } from "./+types/recipes.$id.steps.new";
import { Form, redirect, data, useActionData, useLoaderData, useNavigate } from "react-router";
import { getIngredientParserEnv, getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { Fieldset, Field, Label, ErrorMessage } from "~/components/ui/fieldset";
import { Heading } from "~/components/ui/heading";
import { Text, Strong } from "~/components/ui/text";
import { Link } from "~/components/ui/link";
import { ValidationError } from "~/components/ui/validation-error";
import { Listbox, ListboxOption, ListboxLabel } from "~/components/ui/listbox";
import {
  validateStepTitle,
  validateStepDescription,
  validateStepReference,
  validateQuantity,
  validateUnitName,
  validateIngredientName,
  STEP_TITLE_MAX_LENGTH,
  STEP_DESCRIPTION_MAX_LENGTH,
} from "~/lib/validation";
import { createStepOutputUses } from "~/lib/step-output-use-mutations.server";
import {
  parseIngredients,
  IngredientParseError,
  type ParsedIngredient,
} from "~/lib/ingredient-parse.server";
import { useState } from "react";
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
    general?: string;
    parse?: string;
  };
  parsedIngredients?: ParsedIngredient[];
}

const STEP_CONTENT_REQUIREMENT_ERROR = "Add at least 1 ingredient or 1 step output use before saving this step.";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const { id } = params;

  const database = await getRequestDb(context);

  const recipe = await database.recipe.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      chefId: true,
      deletedAt: true,
      steps: {
        select: { stepNum: true },
        orderBy: { stepNum: "desc" },
        take: 1,
      },
    },
  });

  if (!recipe || recipe.deletedAt) {
    throw new Response("Recipe not found", { status: 404 });
  }

  if (recipe.chefId !== userId) {
    throw new Response("Unauthorized", { status: 403 });
  }

  const nextStepNum = recipe.steps.length > 0 ? recipe.steps[0].stepNum + 1 : 1;

  const availableSteps = nextStepNum > 1
    ? await database.recipeStep.findMany({
        where: {
          recipeId: id,
          stepNum: { lt: nextStepNum },
        },
        select: {
          stepNum: true,
          stepTitle: true,
        },
        orderBy: { stepNum: "asc" },
      })
    : [];

  return { recipe, nextStepNum, availableSteps };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const { id } = params;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  const database = await getRequestDb(context);

  // Verify ownership
  const recipe = await database.recipe.findUnique({
    where: { id },
    select: {
      chefId: true,
      deletedAt: true,
      steps: {
        select: { stepNum: true },
        orderBy: { stepNum: "desc" },
        take: 1,
      },
    },
  });

  if (!recipe || recipe.deletedAt) {
    throw new Response("Recipe not found", { status: 404 });
  }

  if (recipe.chefId !== userId) {
    throw new Response("Unauthorized", { status: 403 });
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
      return data(
        { errors: { parse: "An unexpected error occurred while parsing ingredients" } },
        { status: 500 }
      );
    }
  }

  const stepTitle = formData.get("stepTitle")?.toString() || "";
  const description = formData.get("description")?.toString() || "";
  const ingredientsJson = formData.get("ingredientsJson")?.toString() || "[]";

  let ingredients: ParsedIngredient[] = [];
  try {
    const parsed = JSON.parse(ingredientsJson);
    if (Array.isArray(parsed)) {
      ingredients = parsed;
    }
  } catch {
    ingredients = [];
  }

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

  const nextStepNum = recipe.steps.length > 0 ? recipe.steps[0].stepNum + 1 : 1;

  // Parse and validate selected step output uses
  const usesStepsRaw = formData.getAll("usesSteps");
  const parsedSteps = usesStepsRaw.map((s) => parseInt(s.toString(), 10));

  // Validate each selected step reference
  for (const outputStepNum of parsedSteps) {
    const validationResult = validateStepReference(outputStepNum, nextStepNum);
    if (!validationResult.valid) {
      errors.usesSteps = validationResult.error;
      break;
    }
  }

  for (const ingredient of ingredients) {
    const quantityResult = validateQuantity(ingredient.quantity);
    if (!quantityResult.valid) {
      errors.quantity = quantityResult.error;
      break;
    }

    const unitNameResult = validateUnitName(ingredient.unit);
    if (!unitNameResult.valid) {
      errors.unitName = unitNameResult.error;
      break;
    }

    const ingredientNameResult = validateIngredientName(ingredient.ingredientName);
    if (!ingredientNameResult.valid) {
      errors.ingredientName = ingredientNameResult.error;
      break;
    }
  }

  if (Object.keys(errors).length > 0) {
    return data({ errors }, { status: 400 });
  }

  // Filter to only valid step numbers and de-duplicate (extra safety)
  const usesSteps = [...new Set(parsedSteps.filter((n) => !isNaN(n) && n > 0 && n < nextStepNum))];

  // Note: We allow creating empty steps (no ingredients or dependencies) during initial creation.
  // Ingredients and dependencies can be added afterward via the step edit action.
  // This was changed to support the workflow where users create a step first, then add ingredients later.
  // Original validation required: if (usesSteps.length === 0 && ingredients.length === 0) { ... }

  try {
    const step = await database.recipeStep.create({
      data: {
        recipeId: id,
        stepNum: nextStepNum,
        stepTitle: stepTitle.trim() || null,
        description: description.trim(),
      },
    });

    if (usesSteps.length > 0) {
      await createStepOutputUses(database, id, nextStepNum, usesSteps);
    }

    for (const ingredient of ingredients) {
      const normalizedUnitName = ingredient.unit.toLowerCase();
      const normalizedIngredientName = ingredient.ingredientName.toLowerCase();

      let unit = await database.unit.findUnique({
        where: { name: normalizedUnitName },
      });

      if (!unit) {
        unit = await database.unit.create({
          data: { name: normalizedUnitName },
        });
      }

      let ingredientRef = await database.ingredientRef.findUnique({
        where: { name: normalizedIngredientName },
      });

      if (!ingredientRef) {
        ingredientRef = await database.ingredientRef.create({
          data: { name: normalizedIngredientName },
        });
      }

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

      await database.ingredient.create({
        data: {
          recipeId: id,
          stepNum: nextStepNum,
          quantity: ingredient.quantity,
          unitId: unit.id,
          ingredientRefId: ingredientRef.id,
        },
      });
    }

    return redirect(`/recipes/${id}/steps/${step.id}/edit?created=1`);
  } catch (error) {
    return data(
      { errors: { general: "Failed to create step. Please try again." } },
      { status: 500 }
    );
  }
}

export default function NewStep() {
  const { recipe, nextStepNum, availableSteps } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const [selectedSteps, setSelectedSteps] = useState<number[]>([]);
  const [ingredientInputMode, setIngredientInputMode] = useState<IngredientInputMode>("ai");
  const [ingredients, setIngredients] = useState<ParsedIngredient[]>([]);
  const [parsedIngredients, setParsedIngredients] = useState<ParsedIngredient[]>([]);
  const navigate = useNavigate();
  const stepTitleErrorId = "new-step-title-error";
  const usesStepsErrorId = "new-step-uses-steps-error";
  const descriptionErrorId = "new-step-description-error";

  const handleModeChange = (mode: IngredientInputMode) => {
    setIngredientInputMode(mode);
  };

  const handleManualAdd = (ingredient: { quantity: number; unit: string; ingredientName: string }) => {
    setIngredients((prev) => [...prev, ingredient]);
  };

  const handleParsed = (newParsedIngredients: ParsedIngredient[]) => {
    setParsedIngredients(newParsedIngredients);
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

  const handleAddAll = (newIngredients: ParsedIngredient[]) => {
    setIngredients((prev) => [...prev, ...newIngredients]);
    setParsedIngredients([]);
  };

  const handleRemoveIngredient = (index: number) => {
    setIngredients((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="font-sans leading-relaxed p-8">
      <div className="max-w-[800px] mx-auto">
        <div className="mb-8">
          <Heading level={1}>Add Step</Heading>
          <Link
            href={`/recipes/${recipe.id}/edit`}
            className="text-blue-600 no-underline"
          >
            ← Back to recipe
          </Link>
        </div>

        {/* istanbul ignore next -- @preserve */ actionData?.errors?.general && (
          <ValidationError error={actionData.errors.general} className="mb-4" />
        )}

        <div className="bg-zinc-100 p-4 rounded-lg mb-6">
          <Text className="m-0">
            <Strong>Step Number:</Strong> {nextStepNum}
          </Text>
        </div>

        <Form method="post" className="space-y-6">
          <Fieldset className="space-y-6">
            <Field>
              <Label>Step Title (optional)</Label>
              <Input
                type="text"
                name="stepTitle"
                maxLength={STEP_TITLE_MAX_LENGTH}
                placeholder="e.g., Prepare the dough"
                data-invalid={actionData?.errors?.stepTitle ? true : undefined}
                aria-invalid={actionData?.errors?.stepTitle ? true : undefined}
                aria-describedby={actionData?.errors?.stepTitle ? stepTitleErrorId : undefined}
              />
              {actionData?.errors?.stepTitle && (
                <ErrorMessage id={stepTitleErrorId}>
                  {actionData.errors.stepTitle}
                </ErrorMessage>
              )}
            </Field>

            {nextStepNum === 1 ? (
              <Field>
                <Label>Uses Output From</Label>
                <Text className="text-zinc-500 italic">No previous steps available</Text>
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
                  {availableSteps.map((step) => (
                    <ListboxOption key={step.stepNum} value={step.stepNum}>
                      <ListboxLabel>
                        Step {step.stepNum}{step.stepTitle ? `: ${step.stepTitle}` : ""}
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
              <Label>Description *</Label>
              <Textarea
                name="description"
                rows={6}
                required
                maxLength={STEP_DESCRIPTION_MAX_LENGTH}
                placeholder="Describe what to do in this step..."
                data-invalid={actionData?.errors?.description ? true : undefined}
                aria-invalid={actionData?.errors?.description ? true : undefined}
                aria-describedby={actionData?.errors?.description ? descriptionErrorId : undefined}
              />
              {actionData?.errors?.description && (
                <ErrorMessage id={descriptionErrorId}>
                  {actionData.errors.description}
                </ErrorMessage>
              )}
            </Field>

            <Field>
              <Label>Ingredients</Label>
              <div className="bg-zinc-100 p-6 rounded-lg flex flex-col gap-4">
                <IngredientInputToggle mode={ingredientInputMode} onChange={handleModeChange} />

                {ingredientInputMode === "manual" ? (
                  <ManualIngredientInput onAdd={handleManualAdd} />
                ) : (
                  <>
                    <IngredientParseInput
                      recipeId={recipe.id}
                      stepId="new"
                      onParsed={handleParsed}
                      onSwitchToManual={() => setIngredientInputMode("manual")}
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

                {actionData?.errors?.quantity && (
                  <ErrorMessage>{actionData.errors.quantity}</ErrorMessage>
                )}
                {actionData?.errors?.unitName && (
                  <ErrorMessage>{actionData.errors.unitName}</ErrorMessage>
                )}
                {actionData?.errors?.ingredientName && (
                  <ErrorMessage>{actionData.errors.ingredientName}</ErrorMessage>
                )}
              </div>

              <input type="hidden" name="ingredientsJson" value={JSON.stringify(ingredients)} />

              {ingredients.length === 0 ? (
                <div className="mt-4 bg-zinc-100 p-6 rounded-lg text-center">
                  <p className="text-zinc-500">No ingredients added yet</p>
                </div>
              ) : (
                <ul className="mt-4 flex flex-col gap-2 list-none p-0 m-0">
                  {ingredients.map((ingredient, index) => (
                    <li
                      key={`${ingredient.ingredientName}-${index}`}
                      className="bg-white border border-zinc-200 rounded p-3 px-4 flex justify-between items-center"
                    >
                      <span>
                        <strong>{ingredient.quantity}</strong> {ingredient.unit} {ingredient.ingredientName}
                      </span>
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => handleRemoveIngredient(index)}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Field>

            <div className="flex gap-4 justify-end pt-4">
              <Link href={`/recipes/${recipe.id}/edit`}>
                Cancel
              </Link>
              <Button type="submit">
                Create
              </Button>
            </div>
          </Fieldset>
        </Form>
      </div>
    </div>
  );
}
