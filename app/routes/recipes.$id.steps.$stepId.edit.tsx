import type { Route } from "./+types/recipes.$id.steps.$stepId.edit";
import { redirect, data, useActionData, useFetcher, useLoaderData, useSearchParams, useSubmit } from "react-router";
import { getIngredientParserEnv, getRequestDb } from "~/lib/route-platform.server";
import { requestD1 } from "~/lib/d1-read.server";
import {
  addStepIngredientsOnD1,
  deleteRecipeStepOnD1,
  deleteStepIngredientOnD1,
  ingredientAlreadyInRecipe,
  RECIPE_CHANGED_MESSAGE,
  recipeEditorUnavailable,
  stepDeletionRaceAnswer,
  updateRecipeStepOnD1,
} from "~/lib/recipe-d1-edits.server";
import { isD1GuardFailure } from "~/lib/d1-write.server";
import { revalidateUnlessIngredientParse } from "~/lib/ingredient-parse-revalidation";
import { requireUserId } from "~/lib/session.server";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "~/components/ouro/dialog/confirm-dialog";
import { Button } from "~/components/ouro/button/button";
import { Alert } from "~/components/ouro/alert/alert";
import { Fieldset } from "~/components/ouro/field/fieldset";
import { Form, type FormErrors } from "~/components/ouro/form/form";
import { formErrors as bindFormErrors } from "~/lib/ouro/form-answer";
import { Link } from "~/components/ouro/link/link";
import { Select } from "~/components/ouro/select/select";
import { TextArea } from "~/components/ouro/text-field/text-area";
import { TextField } from "~/components/ouro/text-field/text-field";
import { Text } from "~/components/ouro/text/text";
import { toast } from "~/lib/ouro/toast";
import { CookbookPage, RuledEmptyState, SettingsPanel } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { touchNativeSyncRecipe, touchNativeSyncRecipeOperation } from "~/lib/native-sync-invalidation.server";
import { validateStepDeletion } from "~/lib/step-deletion-validation.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
import {
  IngredientParseError,
  type ParsedIngredient,
} from "~/lib/ingredient-parse.server";
import { parseIngredientsWithRulesFallback } from "~/lib/ingredient-parse-fallback.server";
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
const NO_INGREDIENTS_TO_ADD_ERROR = "There are no ingredients to add.";

interface IngredientDraft {
  quantity: number;
  unitName: string;
  ingredientName: string;
}

// Reads one entry of an "Add All" batch into trimmed, lowercased fields; anything
// that is not the expected shape comes out empty or NaN and fails validation.
function readIngredientDraft(entry: unknown): IngredientDraft {
  const candidate = (entry ?? {}) as Record<string, unknown>;
  return {
    quantity: Number(candidate.quantity),
    unitName: typeof candidate.unit === "string" ? candidate.unit.trim().toLowerCase() : "",
    ingredientName: typeof candidate.ingredientName === "string" ? candidate.ingredientName.trim().toLowerCase() : "",
  };
}

function ingredientDraftErrors(ingredient: IngredientDraft): NonNullable<ActionData["errors"]> {
  const errors: NonNullable<ActionData["errors"]> = {};
  const quantityResult = validateQuantity(ingredient.quantity);
  if (!quantityResult.valid) errors.quantity = quantityResult.error;
  const unitNameResult = validateUnitName(ingredient.unitName);
  if (!unitNameResult.valid) errors.unitName = unitNameResult.error;
  const ingredientNameResult = validateIngredientName(ingredient.ingredientName);
  if (!ingredientNameResult.valid) errors.ingredientName = ingredientNameResult.error;
  return errors;
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) {
    return [
      { title: "Edit step - Spoonjoy" },
      { name: "description", content: "Edit a step in a Spoonjoy recipe." },
    ];
  }
  return [
    { title: `Edit step · ${data.recipe.title} - Spoonjoy` },
    { name: "description", content: `Edit a step in "${data.recipe.title}" on Spoonjoy.` },
  ];
}

// An ingredient parse changes no data; don't reload the page after one.
export const shouldRevalidate = revalidateUnlessIngredientParse;

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
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
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
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

    const d1 = requestD1(context);
    if (d1) {
      try {
        await deleteRecipeStepOnD1(d1, { recipeId: id, stepId, stepNum: step.stepNum });
      } catch (error) {
        // The step moved, went away or gained a dependent step in between; nothing was deleted.
        const unavailable = recipeEditorUnavailable(error, "stepDeletion");
        if (unavailable) return unavailable;
        if (!isD1GuardFailure(error)) throw error;
        const answer = await stepDeletionRaceAnswer(database, id, stepId);
        return data({ errors: { stepDeletion: answer.error } }, { status: answer.status });
      }
    } else {
      await database.$transaction([
        database.recipeStep.delete({
          where: { id: stepId },
        }),
        touchNativeSyncRecipeOperation(database, id),
      ]);
    }
    return redirect(`/recipes/${id}/edit`);
  }

  // "Add All" sends the whole parsed batch in one request, so either every
  // ingredient is added or none is and the reason is shown. (It used to submit
  // once per ingredient, and each submission cancelled the one before it.)
  if (intent === "addIngredients") {
    let entries: unknown;
    try {
      entries = JSON.parse(formData.get("ingredientsJson")?.toString() ?? "");
    } catch {
      entries = null;
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return data({ errors: { general: NO_INGREDIENTS_TO_ADD_ERROR } }, { status: 400 });
    }

    const drafts = entries.map(readIngredientDraft);
    const seenNames = new Set<string>();
    for (const [index, draft] of drafts.entries()) {
      const draftErrors = ingredientDraftErrors(draft);
      if (Object.keys(draftErrors).length > 0) {
        // Name the row to fix: by ingredient, or by position when it has no name.
        const label = draft.ingredientName || `Ingredient ${index + 1}`;
        const namedErrors = Object.fromEntries(
          Object.entries(draftErrors).map(([field, message]) => [field, `${label}: ${message}`])
        );
        return data({ errors: namedErrors }, { status: 400 });
      }
      if (seenNames.has(draft.ingredientName)) {
        return data(
          { errors: { ingredientName: `${draft.ingredientName} is listed more than once` } },
          { status: 400 }
        );
      }
      seenNames.add(draft.ingredientName);
    }

    // A read only: the units and ingredient names are created with the add, in its batch.
    const already = await ingredientAlreadyInRecipe(database, id, drafts.map((draft) => draft.ingredientName));
    if (already) {
      return data({ errors: { ingredientName: `${already} is already in the recipe` } }, { status: 400 });
    }

    const d1 = requestD1(context);
    if (d1) {
      try {
        await addStepIngredientsOnD1(d1, { recipeId: id, stepId, stepNum: step.stepNum, rows: drafts });
      } catch (error) {
        // Another request added one of these ingredients, or moved the step, in between;
        // none were added, and no unit or ingredient name was created.
        const unavailable = recipeEditorUnavailable(error);
        if (unavailable) return unavailable;
        if (!isD1GuardFailure(error)) throw error;
        const taken = await ingredientAlreadyInRecipe(database, id, drafts.map((draft) => draft.ingredientName));
        return taken
          ? data({ errors: { ingredientName: `${taken} is already in the recipe` } }, { status: 400 })
          : data({ errors: { general: RECIPE_CHANGED_MESSAGE } }, { status: 409 });
      }
    } else {
      const rows = [];
      for (const draft of drafts) {
        const unit = await database.unit.upsert({
          where: { name: draft.unitName },
          update: {},
          create: { name: draft.unitName },
        });
        const ingredientRef = await database.ingredientRef.upsert({
          where: { name: draft.ingredientName },
          update: {},
          create: { name: draft.ingredientName },
        });
        rows.push({ quantity: draft.quantity, unitId: unit.id, ingredientRefId: ingredientRef.id });
      }
      await database.$transaction([
        ...rows.map((row) =>
          database.ingredient.create({
            data: { recipeId: id, stepNum: step.stepNum, ...row },
          })
        ),
        touchNativeSyncRecipeOperation(database, id),
      ]);
    }

    return data({ success: true });
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

    const unitKey = unitName.toLowerCase();
    const ingredientKey = ingredientName.toLowerCase();

    // Check for duplicate ingredient in recipe. A read only: the unit and ingredient name
    // are created with the add, in its batch.
    if (await ingredientAlreadyInRecipe(database, id, [ingredientKey])) {
      return data(
        { errors: { ingredientName: "This ingredient is already in the recipe" } },
        { status: 400 }
      );
    }

    // Create ingredient
    const d1 = requestD1(context);
    if (d1) {
      try {
        await addStepIngredientsOnD1(d1, {
          recipeId: id,
          stepId,
          stepNum: step.stepNum,
          rows: [{ quantity, unitName: unitKey, ingredientName: ingredientKey }],
        });
      } catch (error) {
        // Another request added this ingredient, or moved the step, in between.
        const unavailable = recipeEditorUnavailable(error, "ingredientName");
        if (unavailable) return unavailable;
        if (!isD1GuardFailure(error)) throw error;
        return await ingredientAlreadyInRecipe(database, id, [ingredientKey])
          ? data({ errors: { ingredientName: "This ingredient is already in the recipe" } }, { status: 400 })
          : data({ errors: { general: RECIPE_CHANGED_MESSAGE } }, { status: 409 });
      }
    } else {
      const unit = await database.unit.upsert({ where: { name: unitKey }, update: {}, create: { name: unitKey } });
      const ingredientRef = await database.ingredientRef.upsert({
        where: { name: ingredientKey },
        update: {},
        create: { name: ingredientKey },
      });
      await database.$transaction([
        database.ingredient.create({
          data: {
            recipeId: id,
            stepNum: step.stepNum,
            quantity,
            unitId: unit.id,
            ingredientRefId: ingredientRef.id,
          },
        }),
        touchNativeSyncRecipeOperation(database, id),
      ]);
    }

    return data({ success: true });
  }

  // Handle delete ingredient intent
  if (intent === "deleteIngredient") {
    const ingredientId = formData.get("ingredientId")?.toString();
    const d1 = requestD1(context);
    if (ingredientId && d1) {
      try {
        await deleteStepIngredientOnD1(d1, { recipeId: id, stepNum: step.stepNum, ingredientId });
      } catch (error) {
        const unavailable = recipeEditorUnavailable(error, "ingredientName");
        if (unavailable) return unavailable;
        throw error;
      }
      return data({ success: true });
    }
    if (ingredientId) {
      const deleted = await database.ingredient.deleteMany({
        where: {
          id: ingredientId,
          recipeId: id,
          stepNum: step.stepNum,
        },
      });
      if (deleted.count > 0) {
        await touchNativeSyncRecipe(database, id);
      }
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
    const d1 = requestD1(context);
    if (d1) {
      // One atomic batch: the step, its replaced output uses and the recipe touch.
      try {
        await updateRecipeStepOnD1(d1, {
          recipeId: id,
          stepId,
          stepNum: step.stepNum,
          stepTitle: stepTitle.trim() || null,
          description: description.trim(),
          usesSteps,
        });
      } catch (error) {
        // The step moved, went away or lost its last ingredient in between; nothing was saved.
        const unavailable = recipeEditorUnavailable(error);
        if (unavailable) return unavailable;
        if (!isD1GuardFailure(error)) throw error;
        const current = await database.recipeStep.findUnique({ where: { id: stepId }, select: { stepNum: true } });
        if (!current) return data({ errors: { general: "Step not found" } }, { status: 404 });
        const ingredients = await database.ingredient.count({ where: { recipeId: id, stepNum: current.stepNum } });
        return ingredients === 0 && usesSteps.length === 0
          ? data({ errors: { usesSteps: STEP_CONTENT_REQUIREMENT_ERROR } }, { status: 400 })
          : data({ errors: { general: RECIPE_CHANGED_MESSAGE } }, { status: 409 });
      }
      return redirect(`/recipes/${id}/edit`);
    }

    // One transaction: the step, its replaced output uses and the recipe touch land together.
    const uniqueUses = [...new Set(usesSteps)];
    await database.$transaction([
      database.recipeStep.update({
        where: { id: stepId },
        data: {
          stepTitle: stepTitle.trim() || null,
          description: description.trim(),
        },
      }),
      database.stepOutputUse.deleteMany({ where: { recipeId: id, inputStepNum: step.stepNum } }),
      ...(uniqueUses.length > 0
        ? [database.stepOutputUse.createMany({
          data: uniqueUses.map((outputStepNum) => ({ recipeId: id, inputStepNum: step.stepNum, outputStepNum })),
        })]
        : []),
      touchNativeSyncRecipeOperation(database, id),
    ]);

    return redirect(`/recipes/${id}/edit`);
  } catch (error) {
    // Ownership (403), not-found (404), and content/validation checks above all
    // surface their own responses; reaching here means the step update itself
    // failed (DB/infra fault). The real error was previously discarded behind
    // this generic 500 — capture it (fire-and-forget, no-op without PostHog).
    const postHogConfig = resolvePostHogServerConfig(context.cloudflare?.env ?? {});
    if (postHogConfig.enabled) {
      const capture = captureException(postHogConfig, {
        error,
        distinctId: userId,
        route: new URL(request.url).pathname,
        method: request.method,
        extras: { action: "update_step", recipe_id: id, step_id: stepId },
      });
      const waitUntil = context.cloudflare?.ctx?.waitUntil;
      if (waitUntil) {
        waitUntil.call(context.cloudflare!.ctx!, capture);
      } else {
        void capture;
      }
    }
    return data(
      { errors: { general: "Failed to update step. Please try again." } },
      { status: 500 }
    );
  }
}

export default function EditStep() {
  const { recipe, step, availableSteps } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const [initialActionData] = useState(actionData);
  const updateFetcher = useFetcher<ActionData>();
  const updateData = updateFetcher.data ?? initialActionData;
  const [showIngredientForm, setShowIngredientForm] = useState(false);
  const [ingredientToRemove, setIngredientToRemove] = useState<string | null>(null);
  const [ingredientInputMode, setIngredientInputMode] = useState<IngredientInputMode>('ai');
  const [parsedIngredients, setParsedIngredients] = useState<ParsedIngredient[]>([]);
  const submit = useSubmit();
  const addAllFetcher = useFetcher<ActionData>();
  const [searchParams, setSearchParams] = useSearchParams();

  const stepDeletionError = actionData?.errors?.stepDeletion;

  // Why an ingredient, or an Add All batch, could not be added (invalid field,
  // already in the recipe, nothing to add).
  const addAllErrors = addAllFetcher.data?.errors;
  const ingredientErrors = [
    // The initial progressive-post general message already has one display surface
    // in the primary baseline. Later route answers belong here, not to its fetcher.
    actionData === initialActionData ? undefined : actionData?.errors?.general,
    actionData?.errors?.quantity,
    actionData?.errors?.unitName,
    actionData?.errors?.ingredientName,
    addAllErrors?.general,
    addAllErrors?.quantity,
    addAllErrors?.unitName,
    addAllErrors?.ingredientName,
  ].filter((error): error is string => Boolean(error));
  const showUsesStepsPicker = step.stepNum !== 1 && availableSteps.length > 0;

  // The update's messages for the step form, by field name. Without the picker (step 1, or no
  // earlier steps) no field shows a usesSteps error, so it joins the message at the top of the
  // form; otherwise Update would fail silently.
  const errors = updateData?.errors;
  const formErrors = useMemo(() => {
    const formErrors: FormErrors = {};
    if (errors?.stepTitle) formErrors.stepTitle = errors.stepTitle;
    if (errors?.description) formErrors.description = errors.description;
    if (errors?.usesSteps && showUsesStepsPicker) formErrors.usesSteps = errors.usesSteps;
    const whole = [errors?.general, showUsesStepsPicker ? undefined : errors?.usesSteps].filter(
      (message): message is string => Boolean(message),
    );
    if (whole.length > 0) formErrors.form = whole;
    return bindFormErrors(updateFetcher.data, formErrors);
  }, [errors, showUsesStepsPicker, updateFetcher.data]);

  useEffect(() => {
    if (searchParams.get("created") === "1") {
      toast("Step created successfully.", { tone: "success" });
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("created");
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Ingredient input mode handlers
  const parsedListShown = showIngredientForm && ingredientInputMode !== "manual" && parsedIngredients.length > 0;

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
    // One request for the whole batch: separate submit() calls would each
    // cancel the navigation before them. Its own fetcher, so the parsed list
    // is cleared only once this request succeeds (below).
    const formData = new FormData();
    formData.set("intent", "addIngredients");
    formData.set("ingredientsJson", JSON.stringify(ingredients));
    addAllFetcher.submit(formData, { method: "post" });
  };

  // A rejected batch (say, one ingredient is already in the recipe) keeps the
  // parsed list so it can be fixed and added again.
  useEffect(() => {
    if (addAllFetcher.state === "idle" && addAllFetcher.data?.success) {
      setParsedIngredients([]);
    }
  }, [addAllFetcher.state, addAllFetcher.data]);

  return (
    <CookbookPage>
      <PageHeader
        eyebrow={`Step ${step.stepNum}`}
        title="Edit Step"
        actions={<Link href={`/recipes/${recipe.id}/edit`} className="inline-flex min-h-11 items-center">← Back to recipe</Link>}
        size="lg"
        divider
        description={`Keep the method for ${recipe.title} easy to follow in the kitchen.`}
      />

      <div className="mt-8 max-w-4xl">
        <Form method="post" errors={formErrors} render={<updateFetcher.Form />} className="sj-form-section gap-6">
          <TextField
            label="Step Title (optional)"
            name="stepTitle"
            maxLength={STEP_TITLE_MAX_LENGTH}
            defaultValue={step.stepTitle || ""}
          />

          {step.stepNum === 1 ? (
            <Fieldset legend="Uses output from">
              <Text tone="muted" className="italic">No previous steps available</Text>
            </Fieldset>
          ) : availableSteps.length > 0 && (
            <Select
              label="Uses output from (optional)"
              name="usesSteps"
              multiple
              defaultValue={step.usingSteps.map((u) => String(u.outputStepNum))}
              placeholder="Select previous steps (optional)"
              options={availableSteps.map((availableStep) => ({
                value: String(availableStep.stepNum),
                label: `Step ${availableStep.stepNum}${availableStep.stepTitle ? `: ${availableStep.stepTitle}` : ""}`,
              }))}
            />
          )}

          <TextArea
            label="Description"
            name="description"
            rows={6}
            required
            maxLength={STEP_DESCRIPTION_MAX_LENGTH}
            defaultValue={step.description}
          />

          <div className="flex flex-col-reverse gap-3 border-t border-[var(--sj-border)] pt-4 sm:flex-row sm:justify-end">
            <Button href={`/recipes/${recipe.id}/edit`} variant="outline" tone="secondary">
              Cancel
            </Button>
            <Button type="submit">
              Update
            </Button>
          </div>
        </Form>

        <div className="mt-4">
          {stepDeletionError ? <Alert tone="destructive" title={stepDeletionError} className="mb-4" /> : null}
        </div>

        <SettingsPanel
          title="Ingredients"
          action={
            <Button onClick={() => setShowIngredientForm(!showIngredientForm)}>
              {showIngredientForm ? "Cancel" : "+ Add ingredient"}
            </Button>
          }
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          </div>

          {ingredientErrors.length > 0 ? (
            <div className="mb-4 grid gap-2">
              {ingredientErrors.map((message) => (
                <Alert key={message} tone="destructive" title={message} />
              ))}
            </div>
          ) : null}

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
            </div>
          )}

          {step.ingredients.length === 0 ? (
            // Parsed ingredients waiting for "Add All" are not "none yet".
            !parsedListShown && <RuledEmptyState title="No ingredients added yet" />
          ) : (
            <ItemGroup aria-label="Ingredients" variant="divided">
              {step.ingredients.map((ingredient) => (
                <Item
                  key={ingredient.id}
                  size="sm"
                  title={ingredient.ingredientRef.name}
                  description={`${ingredient.quantity} ${ingredient.unit.name}`}
                  actions={
                    <Button
                      type="button"
                      variant="soft" tone="destructive"
                      onClick={() => setIngredientToRemove(ingredient.id)}
                      aria-label={`Remove ${ingredient.ingredientRef.name}`}
                    >
                      Remove
                    </Button>
                  }
                />
              ))}
            </ItemGroup>
          )}
        </SettingsPanel>

        {/* Remove ingredient confirmation dialog */}
        <ConfirmDialog
          open={!!ingredientToRemove}
          onOpenChange={() => setIngredientToRemove(null)}
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
          tone="destructive"
        />
      </div>
    </CookbookPage>
  );
}
