import type { Route } from "./+types/recipes.$id.edit";
import { Form, redirect, data, useActionData, useLoaderData, useNavigate, useNavigation, useSubmit } from "react-router";
import { getCloudflareEnv, getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { Link } from "~/components/ui/link";
import { ValidationError } from "~/components/ui/validation-error";
import { CookbookHeader, CookbookPage, CookbookSectionTitle, RuledEmptyState } from "~/components/cookbook/page";
import { RecipeBuilder, type RecipeBuilderData } from "~/components/recipe/RecipeBuilder";
import {
  validateTitle,
  validateDescription,
  validateServings,
} from "~/lib/validation";
import { validateStepReorderComplete } from "~/lib/step-reorder-validation.server";
import { validateStepDeletion } from "~/lib/step-deletion-validation.server";
import {
  deleteStoredImage,
  hasUploadedImageFile,
  RECIPE_IMAGE_TYPES,
  storeImage,
  validateImageFileForStorage,
} from "~/lib/image-storage.server";
import { FOOD_IMAGE_ACCEPT, RECIPE_IMAGE_SIZE_MESSAGE, RECIPE_IMAGE_TYPE_MESSAGE } from "~/lib/recipe-image";
import { validateActiveRecipeTitleUnique } from "~/lib/recipe-title-uniqueness.server";
import { createCover, getRecipeCoverImageUrl, setActiveRecipeCover } from "~/lib/recipe-cover.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";
import { Button } from "~/components/ui/button";
import { Dialog, DialogActions, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { useEffect, useRef, useState } from "react";

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
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const { id } = params;

  const database = await getRequestDb(context);

  const recipe = await database.recipe.findUnique({
    where: { id },
    include: {
      covers: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
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

  const coverImageUrl = getRecipeCoverImageUrl(recipe, recipe.covers);

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

  return { recipe, coverImageUrl, formattedSteps };
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
    },
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
  const imageEntry = formData.get("image");
  const imageFile = hasUploadedImageFile(imageEntry) ? imageEntry : null;
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
  if (imageFile) {
    const imageError = await validateImageFileForStorage(imageFile, {
      allowedTypes: RECIPE_IMAGE_TYPES,
      messages: {
        invalidType: RECIPE_IMAGE_TYPE_MESSAGE,
        fileTooLarge: RECIPE_IMAGE_SIZE_MESSAGE,
      },
    });

    if (imageError) {
      errors.image = imageError;
    }
  }

  if (Object.keys(errors).length > 0) {
    return data({ errors }, { status: 400 });
  }

  const titleUniquenessResult = await validateActiveRecipeTitleUnique(database, {
    chefId: userId,
    title,
    excludeRecipeId: id,
  });
  if (!titleUniquenessResult.valid) {
    return data({ errors: { title: titleUniquenessResult.error } }, { status: 400 });
  }

  const cloudflareEnv = getCloudflareEnv(context);
  const photosBucket = cloudflareEnv?.PHOTOS;
  const updateData: { title: string; description: string | null; servings: string | null } = {
    title: title.trim(),
    description: description.trim() || null,
    servings: servings.trim() || null,
  };
  let uploadedImageUrl: string | null = null;

  if (imageFile) {
    try {
      uploadedImageUrl = await storeImage({
        bucket: photosBucket,
        file: imageFile,
        namespace: `recipes/${userId}/${id}`,
      });
    } catch {
      return data(
        { errors: { image: "Failed to upload image. Please try again." } },
        { status: 500 }
      );
    }
  }

  try {
    await database.recipe.update({
      where: { id },
      data: updateData,
    });

    if (uploadedImageUrl) {
      const uploadedCover = await createCover(database, {
        recipeId: id,
        imageUrl: uploadedImageUrl,
        sourceType: "chef-upload",
        status: "ready",
        createdById: userId,
        sourceImageUrl: uploadedImageUrl,
        generationStatus: "none",
      });
      await setActiveRecipeCover(database, {
        recipeId: id,
        coverId: uploadedCover.id,
        variant: "image",
      });
      await scheduleSpoonCoverStylization({
        db: database,
        userId,
        recipeId: id,
        coverId: uploadedCover.id,
        rawPhotoUrl: uploadedImageUrl,
        recipeTitle: updateData.title,
        env: cloudflareEnv,
        bucket: photosBucket,
        sourceType: "chef-upload",
      });
    } else if (clearImage) {
      await database.recipe.update({
        where: { id },
        data: {
          activeCoverId: null,
          activeCoverVariant: null,
          coverMode: "none",
        },
      });
    }

    return redirect(`/recipes/${id}`);
  } catch (error) {
    if (uploadedImageUrl) {
      await deleteStoredImage({ bucket: photosBucket, imageUrl: uploadedImageUrl });
    }

    return data(
      { errors: { general: "Failed to update recipe. Please try again." } },
      { status: 500 }
    );
  }
}

export default function EditRecipe() {
  const { recipe, coverImageUrl, formattedSteps } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionData>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitInFlightRef = useRef(false);
  const [stepToDelete, setStepToDelete] = useState<{ id: string; stepNum: number } | null>(null);
  const [submitStarted, setSubmitStarted] = useState(false);
  const isLoading = navigation.state === 'submitting' || submitStarted;

  useEffect(() => {
    if (navigation.state === "idle") {
      submitInFlightRef.current = false;
      setSubmitStarted(false);
    }
  }, [navigation.state]);

  const handleCancel = () => {
    navigate(`/recipes/${recipe.id}`);
  };

  const handleSave = (recipeData: RecipeBuilderData) => {
    /* istanbul ignore next -- @preserve duplicate-submit latch is asserted through route action call counts */
    if (submitInFlightRef.current || navigation.state !== "idle") {
      return;
    }

    /* istanbul ignore next -- @preserve defensive null check for ref */
    if (!formRef.current) return;

    submitInFlightRef.current = true;
    setSubmitStarted(true);

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

  return (
    <CookbookPage>
      <CookbookHeader
        eyebrow="Edit recipe"
        title="Edit Recipe"
        action={<Link href={`/recipes/${recipe.id}`} className="sj-link inline-flex min-h-11 items-center">← Back to recipe</Link>}
      />

      <div className="mt-8 max-w-5xl">
        <Form ref={formRef} method="post" encType="multipart/form-data" className="hidden" aria-hidden="true">
          <input type="hidden" name="id" value={recipe.id} />
          <input type="hidden" name="title" />
          <textarea name="description" className="hidden" />
          <input type="hidden" name="servings" />
          <input type="hidden" name="steps" />
          <input type="hidden" name="clearImage" />
          <input ref={fileInputRef} type="file" name="image" accept={FOOD_IMAGE_ACCEPT} />
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
            coverImageUrl,
            steps: formattedSteps,
          }}
          onSave={handleSave}
          onCancel={handleCancel}
          errors={actionData?.errors}
          loading={isLoading}
          showSteps={false}
        />

        <section aria-label="Recipe Steps" className="mt-10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <CookbookSectionTitle className="my-0 flex-1">Recipe Steps</CookbookSectionTitle>
            <Link href={`/recipes/${recipe.id}/steps/new`} className="sj-link inline-flex min-h-11 items-center">+ Add Step</Link>
          </div>

          {recipe.steps.length === 0 ? (
            <RuledEmptyState title="No steps yet.">
              Add the first step when you are ready to turn the dish into a cooking path.
            </RuledEmptyState>
          ) : (
            <div className="sj-list-ruled mt-5">
              {recipe.steps.map((step, index) => {
                const title = step.stepTitle?.trim() || step.description;
                return (
                  <article
                    key={step.id}
                    className="grid gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
                    aria-label={`Step ${step.stepNum}`}
                  >
                    <div className="min-w-0">
                      <p className="font-sj-ui m-0 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">Step {step.stepNum}</p>
                      <h3 className="font-sj-display m-0 truncate text-xl/7 font-semibold text-[var(--sj-ink)]">{title}</h3>
                      <p className="m-0 mt-1 line-clamp-2 text-sm/6 text-[var(--sj-ink-soft)]">
                        {step.description}
                      </p>
                      <p className="m-0 mt-1 text-sm text-[var(--sj-ink-soft)]">
                        {step.ingredients.length} ingredient{step.ingredients.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <Form method="post" className="m-0">
                        <input type="hidden" name="intent" value="reorderStep" />
                        <input type="hidden" name="stepId" value={step.id} />
                        <input type="hidden" name="direction" value="up" />
                        <Button type="submit" plain disabled={index === 0}>Move Up</Button>
                      </Form>

                      <Form method="post" className="m-0">
                        <input type="hidden" name="intent" value="reorderStep" />
                        <input type="hidden" name="stepId" value={step.id} />
                        <input type="hidden" name="direction" value="down" />
                        <Button type="submit" plain disabled={index === recipe.steps.length - 1}>Move Down</Button>
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
    </CookbookPage>
  );
}
