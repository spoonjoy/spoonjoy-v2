import type { Route } from "./+types/recipes.$id.edit";
import { Form, redirect, data, useActionData, useLoaderData, useNavigate, useNavigation, useSubmit } from "react-router";
import { useRecipeEditActions } from "~/components/navigation";
import { getDb, db } from "~/lib/db.server";
import { requireUserId } from "~/lib/session.server";
import { Heading } from "~/components/ui/heading";
import { Link } from "~/components/ui/link";
import { ValidationError } from "~/components/ui/validation-error";
import { RecipeBuilder, type RecipeBuilderData } from "~/components/recipe/RecipeBuilder";
import {
  validateTitle,
  validateDescription,
  validateServings,
} from "~/lib/validation";
import { validateStepReorderComplete } from "~/lib/step-reorder-validation.server";
import { validateStepDeletion } from "~/lib/step-deletion-validation.server";
import { Button } from "~/components/ui/button";
import { Dialog, DialogActions, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { useRef, useState } from "react";

interface ActionData {
  errors?: {
    title?: string;
    description?: string;
    servings?: string;
    image?: string;
    general?: string;
    reorder?: string;
    stepDeletion?: string;
  };
  success?: boolean;
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const { id } = params;

  /* istanbul ignore next -- @preserve Cloudflare D1 production-only path */
  const database = context?.cloudflare?.env?.DB
    ? await getDb(context.cloudflare.env as { DB: D1Database })
    : db;

  const recipe = await database.recipe.findUnique({
    where: { id },
    include: {
      steps: {
        orderBy: {
          stepNum: "asc",
        },
        include: {
          ingredients: {
            include: {
              unit: true,
              ingredientRef: true,
            },
          },
        },
      },
    },
  });

  if (!recipe || recipe.deletedAt) {
    throw new Response("Recipe not found", { status: 404 });
  }

  if (recipe.chefId !== userId) {
    throw new Response("Unauthorized", { status: 403 });
  }

  // Transform steps data for RecipeBuilder
  const formattedSteps = recipe.steps.map((step) => ({
    id: step.id,
    stepNum: step.stepNum,
    stepTitle: step.stepTitle || undefined,
    description: step.description,
    duration: step.duration || undefined,
    ingredients: step.ingredients.map((ing) => ({
      quantity: ing.quantity,
      unit: ing.unit!.name,
      ingredientName: ing.ingredientRef!.name,
    })),
  }));

  return { recipe, formattedSteps };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const { id } = params;
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

  /* istanbul ignore next -- @preserve Cloudflare D1 production-only path */
  const database = context?.cloudflare?.env?.DB
    ? await getDb(context.cloudflare.env as { DB: D1Database })
    : db;

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

  // Handle reorder step intent
  if (intent === "reorderStep") {
    const stepId = formData.get("stepId")?.toString();
    const direction = formData.get("direction")?.toString();

    if (stepId && (direction === "up" || direction === "down")) {
      const step = await database.recipeStep.findUnique({
        where: { id: stepId },
        select: { stepNum: true, recipeId: true },
      });

      if (step && step.recipeId === id) {
        const targetStepNum = direction === "up" ? step.stepNum - 1 : step.stepNum + 1;

        const validationResult = await validateStepReorderComplete(database, id, step.stepNum, targetStepNum);
        if (!validationResult.valid) {
          return data({ errors: { reorder: validationResult.error } }, { status: 400 });
        }

        const targetStep = await database.recipeStep.findUnique({
          where: {
            recipeId_stepNum: {
              recipeId: id,
              stepNum: targetStepNum,
            },
          },
        });

        if (targetStep) {
          const tempStepNum = -1;

          await database.recipeStep.update({
            where: { id: stepId },
            data: { stepNum: tempStepNum },
          });

          await database.recipeStep.update({
            where: { id: targetStep.id },
            data: { stepNum: step.stepNum },
          });

          await database.recipeStep.update({
            where: { id: stepId },
            data: { stepNum: targetStepNum },
          });

          return data({ success: true });
        }
      }
    }
  }

  // Handle delete step intent
  if (intent === "deleteStep") {
    const stepId = formData.get("stepId")?.toString();

    if (!stepId) {
      return data({ errors: { stepDeletion: "Step not found" } }, { status: 400 });
    }

    const step = await database.recipeStep.findUnique({
      where: { id: stepId },
      select: { id: true, recipeId: true, stepNum: true },
    });

    if (!step || step.recipeId !== id) {
      return data({ errors: { stepDeletion: "Step not found" } }, { status: 404 });
    }

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

    return data({ success: true });
  }

  const title = formData.get("title")?.toString() || "";
  const description = formData.get("description")?.toString() || "";
  const servings = formData.get("servings")?.toString() || "";
  const imageFile = formData.get("image") as File | null;
  const clearImage = formData.get("clearImage")?.toString() === "true";

  const errors: ActionData["errors"] = {};

  // Validation
  const titleResult = validateTitle(title);
  if (!titleResult.valid) {
    errors.title = titleResult.error;
  }

  const descriptionResult = validateDescription(description || null);
  if (!descriptionResult.valid) {
    errors.description = descriptionResult.error;
  }

  const servingsResult = validateServings(servings || null);
  if (!servingsResult.valid) {
    errors.servings = servingsResult.error;
  }

  // Validate image file if provided
  if (imageFile && imageFile.size > 0) {
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(imageFile.type)) {
      errors.image = "Invalid image format";
    } else if (imageFile.size > 5 * 1024 * 1024) {
      errors.image = "Image must be less than 5MB";
    }
  }

  if (Object.keys(errors).length > 0) {
    return data({ errors }, { status: 400 });
  }

  try {
    const updateData: { title: string; description: string | null; servings: string | null; imageUrl?: string } = {
      title: title.trim(),
      description: description.trim() || null,
      servings: servings.trim() || null,
    };

    if (clearImage) {
      updateData.imageUrl = "";
    }

    await database.recipe.update({
      where: { id },
      data: updateData,
    });

    return redirect(`/recipes/${id}`);
  } catch (error) {
    return data(
      { errors: { general: "Failed to update recipe. Please try again." } },
      { status: 500 }
    );
  }
}

export default function EditRecipe() {
  const { recipe, formattedSteps } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [stepToDelete, setStepToDelete] = useState<{ id: string; stepNum: number } | null>(null);
  const isLoading = navigation.state === 'submitting';

  const handleCancel = () => {
    navigate(`/recipes/${recipe.id}`);
  };

  const handleSave = (recipeData: RecipeBuilderData) => {
    /* istanbul ignore next -- @preserve defensive null check for ref */
    if (!formRef.current) return;

    const form = formRef.current;
    const titleInput = form.querySelector('input[name="title"]') as HTMLInputElement;
    const descriptionInput = form.querySelector('textarea[name="description"]') as HTMLTextAreaElement;
    const servingsInput = form.querySelector('input[name="servings"]') as HTMLInputElement;
    const stepsInput = form.querySelector('input[name="steps"]') as HTMLInputElement;
    const clearImageInput = form.querySelector('input[name="clearImage"]') as HTMLInputElement;

    /* istanbul ignore else -- @preserve form elements always exist in rendered DOM */
    if (titleInput) titleInput.value = recipeData.title;
    /* istanbul ignore else -- @preserve */
    if (descriptionInput) descriptionInput.value = recipeData.description || "";
    /* istanbul ignore else -- @preserve */
    if (servingsInput) servingsInput.value = recipeData.servings || "";
    /* istanbul ignore else -- @preserve */
    if (stepsInput) stepsInput.value = JSON.stringify(recipeData.steps);
    /* istanbul ignore else -- @preserve */
    if (clearImageInput) clearImageInput.value = recipeData.clearImage ? "true" : "";

    if (recipeData.imageFile && fileInputRef.current) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(recipeData.imageFile);
      fileInputRef.current.files = dataTransfer.files;
    }

    form.requestSubmit();
  };

  const handleDeleteStep = () => {
    /* istanbul ignore if -- @preserve defensive guard for stale dialog callbacks */
    if (!stepToDelete) return;

    const formData = new FormData();
    formData.set("intent", "deleteStep");
    formData.set("stepId", stepToDelete.id);
    submit(formData, { method: "post" });
    setStepToDelete(null);
  };

  useRecipeEditActions({
    recipeId: recipe.id,
  });

  return (
    <div className="font-sans leading-relaxed p-8">
      <div className="max-w-[800px] mx-auto">
        <div className="mb-8">
          <Heading level={1}>Edit Recipe</Heading>
          <Link
            href={`/recipes/${recipe.id}`}
            className="text-blue-600 no-underline"
          >
            ← Back to recipe
          </Link>
        </div>

        <Form ref={formRef} method="post" encType="multipart/form-data" className="hidden" aria-hidden="true">
          <input type="hidden" name="id" value={recipe.id} />
          <input type="hidden" name="title" />
          <textarea name="description" className="hidden" />
          <input type="hidden" name="servings" />
          <input type="hidden" name="steps" />
          <input type="hidden" name="clearImage" />
          <input ref={fileInputRef} type="file" name="image" accept="image/*" />
          <button type="submit">Save Recipe</button>
        </Form>

        {actionData?.errors?.reorder && (
          <ValidationError error={actionData.errors.reorder} className="mb-4" />
        )}

        {actionData?.errors?.stepDeletion && (
          <ValidationError error={actionData.errors.stepDeletion} className="mb-4" />
        )}

        <RecipeBuilder
          recipe={{
            id: recipe.id,
            title: recipe.title,
            description: recipe.description,
            servings: recipe.servings,
            imageUrl: recipe.imageUrl,
            steps: formattedSteps,
          }}
          onSave={handleSave}
          onCancel={handleCancel}
          errors={actionData?.errors}
          loading={isLoading}
          showSteps={false}
        />

        <section aria-label="Recipe Steps" className="space-y-4 mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Recipe Steps</h2>
            <Link href={`/recipes/${recipe.id}/steps/new`}>+ Add Step</Link>
          </div>

          {recipe.steps.length === 0 ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
              No steps yet. Add your first step.
            </div>
          ) : (
            <div className="space-y-3">
              {recipe.steps.map((step, index) => {
                const title = step.stepTitle?.trim() || step.description;
                return (
                  <article
                    key={step.id}
                    className="rounded-lg border border-zinc-200 bg-white p-4"
                    aria-label={`Step ${step.stepNum}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="m-0 text-sm text-zinc-500">Step {step.stepNum}</p>
                        <h3 className="m-0 text-base font-semibold truncate">{title}</h3>
                        <p className="m-0 mt-1 text-sm text-zinc-600">
                          {step.description}
                        </p>
                        <p className="m-0 mt-1 text-sm text-zinc-500">
                          {step.ingredients.length} ingredient{step.ingredients.length === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 justify-end">
                        <Form method="post" className="m-0">
                          <input type="hidden" name="intent" value="reorderStep" />
                          <input type="hidden" name="stepId" value={step.id} />
                          <input type="hidden" name="direction" value="up" />
                          <Button type="submit" disabled={index === 0}>Move Up</Button>
                        </Form>

                        <Form method="post" className="m-0">
                          <input type="hidden" name="intent" value="reorderStep" />
                          <input type="hidden" name="stepId" value={step.id} />
                          <input type="hidden" name="direction" value="down" />
                          <Button type="submit" disabled={index === recipe.steps.length - 1}>Move Down</Button>
                        </Form>

                        <Button href={`/recipes/${recipe.id}/steps/${step.id}/edit`}>Edit</Button>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => setStepToDelete({ id: step.id, stepNum: step.stepNum })}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <Dialog open={stepToDelete !== null} onClose={() => setStepToDelete(null)} role="alertdialog">
          <DialogTitle>Delete Step</DialogTitle>
          <DialogDescription>
            Delete Step {stepToDelete?.stepNum}? This cannot be undone.
          </DialogDescription>
          <DialogActions>
            <Button plain onClick={() => setStepToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteStep}>
              Confirm
            </Button>
          </DialogActions>
        </Dialog>
      </div>
    </div>
  );
}
