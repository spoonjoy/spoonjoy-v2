import type { Route } from "./+types/recipes.$id.steps.new";
import { redirect, data, useActionData, useLoaderData, useNavigate, useFetcher } from "react-router";
import { getIngredientParserEnv, getRequestDb } from "~/lib/route-platform.server";
import { revalidateUnlessIngredientParse } from "~/lib/ingredient-parse-revalidation";
import { requireUserId } from "~/lib/session.server";
import { Button } from "~/components/button";
import { Fieldset } from "~/components/ouro/field/fieldset";
import { Form } from "~/components/ouro/form/form";
import { Link } from "~/components/ouro/link/link";
import { Select } from "~/components/ouro/select/select";
import { TextArea } from "~/components/ouro/text-field/text-area";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Text } from "~/components/text";
import { useFormErrors } from "~/hooks/use-form-errors";
import { CookbookHeader, CookbookPage, RuledEmptyState } from "~/components/cookbook/page";
import { ChecklistRow } from "~/components/shopping/checklist-row";
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
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
import { touchNativeSyncRecipeOperation } from "~/lib/native-sync-invalidation.server";
import { requestD1 } from "~/lib/d1-read.server";
import { isD1GuardFailure } from "~/lib/d1-write.server";
import {
  D1_WRITE_UNAVAILABLE_CODE,
  D1_WRITE_UNAVAILABLE_MESSAGE,
  d1UnavailableHeaders,
  formWriteToken,
  idForWriteToken,
  isD1Unavailable,
  retryD1Write,
} from "~/lib/d1-write-retry.server";
import { useWriteToken } from "~/hooks/use-write-token";
import {
  createRecipeStepOnD1,
  ingredientAlreadyInRecipe,
  RECIPE_CHANGED_MESSAGE,
} from "~/lib/recipe-d1-edits.server";
import {
  IngredientParseError,
  type ParsedIngredient,
} from "~/lib/ingredient-parse.server";
import { parseIngredientsWithRulesFallback } from "~/lib/ingredient-parse-fallback.server";
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

export function meta({ data }: Route.MetaArgs) {
  if (!data) {
    return [
      { title: "New step - Spoonjoy" },
      { name: "description", content: "Add a new step to a Spoonjoy recipe." },
    ];
  }
  return [
    { title: `New step · ${data.recipe.title} - Spoonjoy` },
    { name: "description", content: `Add a new step to "${data.recipe.title}" on Spoonjoy.` },
  ];
}

// An ingredient parse changes no data; don't reload the page after one.
export const shouldRevalidate = revalidateUnlessIngredientParse;

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
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
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
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
      const parsedIngredients = await parseIngredientsWithRulesFallback(
        ingredientText,
        getIngredientParserEnv(context),
        { distinctId: userId }
      );
      return data({ parsedIngredients });
    } catch (error) {
      if (error instanceof IngredientParseError) {
        // A parse failure (no API key, provider down, unparseable text) is an
        // outcome the form shows next to the box, with the manual path, not a
        // failed request: a 4xx here makes every browser log a console error
        // while the person is just typing.
        return data({ errors: { parse: error.message } }, { status: 200 });
      }
      return data(
        { errors: { parse: "An unexpected error occurred while parsing ingredients" } },
        { status: 500 }
      );
    }
  }

  // The step's id comes from the form's token, made when the page opened, so a resubmit (after a
  // 503, or a double tap) finds the step the first submit wrote and goes to it.
  const stepToken = formWriteToken(formData.get("stepToken"));
  const stepId = stepToken ? await idForWriteToken(`step:${id}`, userId, stepToken) : crypto.randomUUID();
  const stepWritten = async () =>
    (await database.recipeStep.findFirst({ where: { id: stepId, recipeId: id }, select: { id: true } })) !== null;
  if (stepToken && (await stepWritten())) {
    return redirect(`/recipes/${id}/steps/${stepId}/edit?created=1`);
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

  // Empty steps (no ingredients or step output uses) are allowed here: ingredients and output
  // uses can be added afterward from the step's edit page.

  // Every ingredient is checked before anything is written, then the step, its output uses and
  // its ingredients are written together. A rejected save leaves the recipe as it was, so the
  // cook can fix the form and submit again without piling up copies of the step.
  const seenNames = new Set<string>();
  for (const ingredient of ingredients) {
    const name = ingredient.ingredientName.toLowerCase();
    if (seenNames.has(name)) {
      return data(
        { errors: { ingredientName: `${name} is listed more than once` } },
        { status: 400 }
      );
    }
    seenNames.add(name);
  }

  try {
    const rows = ingredients.map((ingredient) => ({
      quantity: ingredient.quantity,
      unitName: ingredient.unit.toLowerCase(),
      ingredientName: ingredient.ingredientName.toLowerCase(),
    }));
    const ingredientNames = rows.map((row) => row.ingredientName);

    const taken = await ingredientAlreadyInRecipe(database, id, ingredientNames);
    if (taken) {
      return data(
        { errors: { ingredientName: `${taken} is already in the recipe` } },
        { status: 400 }
      );
    }

    const stepTitleValue = stepTitle.trim() || null;
    const descriptionValue = description.trim();
    const d1 = requestD1(context);
    if (d1) {
      try {
        // The step's id is chosen before the first try, so after a transient D1 error the write
        // asks whether that step is in; if so it is done, and if not it runs again. A late apply
        // of the earlier try stops the retry's guards, and the same check then finds the step.
        await retryD1Write(
          { scope: "recipe.create_step", applied: async () => ((await stepWritten()) ? true : null) },
          async () => {
            await createRecipeStepOnD1(d1, {
              recipeId: id,
              stepId,
              stepNum: nextStepNum,
              stepTitle: stepTitleValue,
              description: descriptionValue,
              usesSteps,
              rows,
            });
            return true;
          },
        );
      } catch (error) {
        // Another request added a step or one of these ingredients in between; nothing was
        // written. That request may be an earlier submit of this same form, landing late: then
        // the step is the one this form writes.
        if (!isD1GuardFailure(error)) throw error;
        if (await stepWritten()) return redirect(`/recipes/${id}/steps/${stepId}/edit?created=1`);
        const raced = await ingredientAlreadyInRecipe(database, id, ingredientNames);
        return raced
          ? data({ errors: { ingredientName: `${raced} is already in the recipe` } }, { status: 400 })
          : data({ errors: { general: RECIPE_CHANGED_MESSAGE } }, { status: 409 });
      }
    } else {
      // Without a binding (unit tests, scripts) Prisma's transaction is real; the names are
      // created first so the ingredients can point at them.
      const resolved = [];
      for (const row of rows) {
        const unit = await database.unit.upsert({ where: { name: row.unitName }, update: {}, create: { name: row.unitName } });
        const ingredientRef = await database.ingredientRef.upsert({
          where: { name: row.ingredientName },
          update: {},
          create: { name: row.ingredientName },
        });
        resolved.push({ quantity: row.quantity, unitId: unit.id, ingredientRefId: ingredientRef.id });
      }
      await database.$transaction([
        database.recipeStep.create({
          data: {
            id: stepId,
            recipeId: id,
            stepNum: nextStepNum,
            stepTitle: stepTitleValue,
            description: descriptionValue,
          },
        }),
        ...(usesSteps.length > 0
          ? [database.stepOutputUse.createMany({
            data: usesSteps.map((outputStepNum) => ({ recipeId: id, inputStepNum: nextStepNum, outputStepNum })),
          })]
          : []),
        ...resolved.map((row) => database.ingredient.create({
          data: { recipeId: id, stepNum: nextStepNum, ...row },
        })),
        touchNativeSyncRecipeOperation(database, id),
      ]);
    }

    return redirect(`/recipes/${id}/steps/${stepId}/edit?created=1`);
  } catch (error) {
    // The database was briefly unavailable: a retryable 503 the form shows, keeping what the cook
    // entered, with the same token, so saving again writes the step once.
    if (isD1Unavailable(error)) {
      return data(
        { errors: { general: D1_WRITE_UNAVAILABLE_MESSAGE }, errorCode: D1_WRITE_UNAVAILABLE_CODE, retryable: true as const },
        { status: 503, headers: d1UnavailableHeaders() },
      );
    }
    // Validation + duplicate checks happened above and surface as 400s; reaching
    // here means the step/ingredient persistence itself failed (DB/infra fault).
    // The real error was previously discarded behind this generic 500 — capture
    // it (fire-and-forget, no-op without PostHog) so the failure isn't silent.
    const postHogConfig = resolvePostHogServerConfig(context.cloudflare?.env ?? {});
    if (postHogConfig.enabled) {
      const capture = captureException(postHogConfig, {
        error,
        distinctId: userId,
        route: new URL(request.url).pathname,
        method: request.method,
        extras: { action: "create_step", recipe_id: id },
      });
      const waitUntil = context.cloudflare?.ctx?.waitUntil;
      if (waitUntil) {
        waitUntil.call(context.cloudflare!.ctx!, capture);
      } else {
        void capture;
      }
    }
    return data(
      { errors: { general: "Failed to create step. Please try again." } },
      { status: 500 }
    );
  }
}

// The step form's own fields. An ingredient's errors show under the ingredient inputs.
const STEP_FIELDS = ["stepTitle", "usesSteps", "description"] as const;

export default function NewStep() {
  const { recipe, nextStepNum, availableSteps } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const [initialActionData] = useState(actionData);
  const createFetcher = useFetcher<ActionData>();
  const createData = createFetcher.data ?? initialActionData;
  const [ingredientInputMode, setIngredientInputMode] = useState<IngredientInputMode>("ai");
  const [ingredients, setIngredients] = useState<ParsedIngredient[]>([]);
  const [parsedIngredients, setParsedIngredients] = useState<ParsedIngredient[]>([]);
  // One step per opening of the page: a save after a 503, or a double tap, writes it once.
  const [stepToken] = useWriteToken();
  const navigate = useNavigate();
  const formErrors = useFormErrors(createData?.errors, STEP_FIELDS, createFetcher.data);

  const parsedListShown = ingredientInputMode !== "manual" && parsedIngredients.length > 0;

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
    <CookbookPage>
      <CookbookHeader
        eyebrow={`Step ${nextStepNum}`}
        title="Add Step"
        action={<Link href={`/recipes/${recipe.id}/edit`} className="inline-flex min-h-11 items-center">← Back to recipe</Link>}
      >
        <Text>Write the next bit of method for {recipe.title}.</Text>
      </CookbookHeader>

      <div className="mt-8 max-w-4xl">
        {/* The save's messages land on the fields by name; "general" shows at the top of the form. */}
        <Form method="post" errors={formErrors} render={<createFetcher.Form />} className="sj-form-section gap-6">
          <input type="hidden" name="stepToken" value={stepToken} />
            <TextField
              label="Step Title (optional)"
              name="stepTitle"
              maxLength={STEP_TITLE_MAX_LENGTH}
              placeholder="e.g., Prepare the dough"
            />

            {nextStepNum === 1 ? (
              <Fieldset legend="Uses output from">
                <Text className="italic">No previous steps available</Text>
              </Fieldset>
            ) : availableSteps.length > 0 && (
              <Select
                label="Uses output from (optional)"
                name="usesSteps"
                multiple
                placeholder="Select previous steps (optional)"
                options={availableSteps.map((step) => ({
                  value: String(step.stepNum),
                  label: `Step ${step.stepNum}${step.stepTitle ? `: ${step.stepTitle}` : ""}`,
                }))}
              />
            )}

            <TextArea
              label="Description"
              name="description"
              rows={6}
              required
              maxLength={STEP_DESCRIPTION_MAX_LENGTH}
              placeholder="Describe what to do in this step..."
            />

            <section className="border-t border-[var(--sj-border)] pt-6">
              <h2 className="font-sj-display text-3xl/9 font-semibold text-[var(--sj-ink)]">
                Ingredients
              </h2>
              <div className="mt-4">
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
                    {parsedListShown && (
                      <ParsedIngredientList
                        ingredients={parsedIngredients}
                        onEdit={handleEditParsed}
                        onRemove={handleRemoveParsed}
                        onAddAll={handleAddAll}
                      />
                    )}
                  </>
                )}

                {createData?.errors?.quantity && (
                  <p className="text-base/6 text-[var(--sj-tomato)] sm:text-sm/6" role="alert">
                    {createData.errors.quantity}
                  </p>
                )}
                {createData?.errors?.unitName && (
                  <p className="text-base/6 text-[var(--sj-tomato)] sm:text-sm/6" role="alert">
                    {createData.errors.unitName}
                  </p>
                )}
                {createData?.errors?.ingredientName && (
                  <p className="text-base/6 text-[var(--sj-tomato)] sm:text-sm/6" role="alert">
                    {createData.errors.ingredientName}
                  </p>
                )}
              </div>

              <input type="hidden" name="ingredientsJson" value={JSON.stringify(ingredients)} />

              {ingredients.length === 0 ? (
                // Parsed ingredients waiting for "Add All" are not "none yet".
                !parsedListShown && <RuledEmptyState title="No ingredients added yet" />
              ) : (
                <ul className="sj-list-ruled mt-4 list-none p-0">
                  {ingredients.map((ingredient, index) => (
                    <li key={`${ingredient.ingredientName}-${index}`}>
                      <ChecklistRow
                        name={ingredient.ingredientName}
                        quantity={`${ingredient.quantity} ${ingredient.unit}`}
                        action={
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={() => handleRemoveIngredient(index)}
                            aria-label={`Remove ${ingredient.ingredientName}`}
                          >
                            Remove
                          </Button>
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <div className="flex flex-col-reverse gap-3 border-t border-[var(--sj-border)] pt-4 sm:flex-row sm:justify-end">
              <Link href={`/recipes/${recipe.id}/edit`} className="inline-flex min-h-11 items-center self-center sm:self-auto">
                Cancel
              </Link>
              <Button type="submit">
                Create
              </Button>
            </div>
        </Form>
      </div>
    </CookbookPage>
  );
}
