import type { Route } from "./+types/recipes.new";
import { redirect, data, useActionData, useNavigate, useNavigation, Form } from "react-router";
import { getCloudflareEnv, getIngredientParserEnv, getRequestDb } from "~/lib/route-platform.server";
import { revalidateUnlessIngredientParse } from "~/lib/ingredient-parse-revalidation";
import { requireUserId } from "~/lib/session.server";
import { Link } from "~/components/ui/link";
import { Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage } from "~/components/cookbook/page";
import { RecipeBuilder, type RecipeBuilderData } from "~/components/recipe/RecipeBuilder";
import {
  validateTitle,
  validateDescription,
  validateServings,
} from "~/lib/validation";
import { createRecipeDraft, parseRecipeStepsJson } from "~/lib/recipe-create.server";
import { requestD1 } from "~/lib/d1-read.server";
import {
  deleteStoredImageWithCapture,
  hasUploadedImageFile,
  imageUploadFormDataWithinLimit,
  RECIPE_IMAGE_TYPES,
  storeImage,
  validateImageFileForStorage,
} from "~/lib/image-storage.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
import { FOOD_IMAGE_ACCEPT, RECIPE_IMAGE_SIZE_MESSAGE, RECIPE_IMAGE_TYPE_MESSAGE } from "~/lib/recipe-image";
import { ActiveRecipeTitleConflictError, validateActiveRecipeTitleUnique } from "~/lib/recipe-title-uniqueness.server";
import { scheduleAiPlaceholderCover } from "~/lib/ai-placeholder-cover.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";
import { runAfterRecipeSave } from "~/lib/recipe-save-follow-up.server";
import {
  IngredientParseError,
  parseIngredients,
  type ParsedIngredient,
} from "~/lib/ingredient-parse.server";
import { useEffect, useRef, useState } from "react";
import { importRecipeForSession, parseSessionImportForm } from "~/lib/recipe-import-session.server";
import { RecipeImportPanel, type RecipeImportActionData } from "~/components/recipe/RecipeImportPanel";

interface ActionData {
  parsedIngredients?: ParsedIngredient[];
  importResult?: RecipeImportActionData;
  errors?: {
    title?: string;
    description?: string;
    servings?: string;
    image?: string;
    steps?: string;
    general?: string;
    parse?: string;
  };
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "New recipe - Spoonjoy" },
    { name: "description", content: "Create a new Spoonjoy recipe." },
  ];
}

// An ingredient parse changes no data; don't reload the page after one.
export const shouldRevalidate = revalidateUnlessIngredientParse;

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireUserId(request, "/login", context.cloudflare?.env);
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  // The recipe image is the only large field, so the body is read through the image upload
  // limit: an oversized upload is refused before it is buffered whole.
  const formData = await imageUploadFormDataWithinLimit(request);
  if (!formData) {
    return data({ errors: { image: RECIPE_IMAGE_SIZE_MESSAGE } }, { status: 413 });
  }
  const intent = formData.get("intent")?.toString();

  if (intent === "parseIngredients") {
    const ingredientText = formData.get("ingredientText")?.toString() || "";
    try {
      const parsedIngredients = await parseIngredients(
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

  if (intent === "import") {
    const parsed = parseSessionImportForm(formData);
    if (!parsed.ok) {
      return data({ importResult: { kind: parsed.kind, message: parsed.message } }, { status: 400 });
    }
    const outcome = await importRecipeForSession({
      db: await getRequestDb(context),
      userId,
      input: parsed.input,
      request,
      context,
    });
    if (outcome.ok) {
      return redirect(`/recipes/${outcome.recipeId}/edit?imported=1`);
    }
    return data({
      importResult: {
        kind: outcome.kind,
        message: outcome.message,
        existingRecipe: outcome.existingRecipe,
      },
    });
  }

  const title = formData.get("title")?.toString() || "";
  const description = formData.get("description")?.toString() || "";
  const servings = formData.get("servings")?.toString() || "";
  const imageEntry = formData.get("image");
  const imageFile = hasUploadedImageFile(imageEntry) ? imageEntry : null;
  const stepsJson = formData.get("steps")?.toString() || "[]";

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

  const stepsResult = parseRecipeStepsJson(stepsJson);
  const recipeSteps = stepsResult.valid ? stepsResult.steps : [];
  if (!stepsResult.valid) {
    errors.steps = stepsResult.error;
  }

  if (Object.keys(errors).length > 0) {
    return data({ errors }, { status: 400 });
  }

  const database = await getRequestDb(context);
  const titleUniquenessResult = await validateActiveRecipeTitleUnique(database, {
    chefId: userId,
    title,
  });
  if (!titleUniquenessResult.valid) {
    return data({ errors: { title: titleUniquenessResult.error } }, { status: 400 });
  }

  const cloudflareEnv = getCloudflareEnv(context);
  const photosBucket = cloudflareEnv?.PHOTOS;
  const recipeId = crypto.randomUUID();
  let uploadedImageUrl = "";

  if (imageFile) {
    try {
      uploadedImageUrl = await storeImage({
        bucket: photosBucket,
        file: imageFile,
        namespace: `recipes/${userId}/${recipeId}`,
      });
    } catch {
      return data(
        { errors: { image: "Failed to upload image. Please try again." } },
        { status: 500 }
      );
    }
  }

  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim() || null;
  const coverId = crypto.randomUUID();
  try {
    // The recipe, its steps and its cover (the upload, made active, or the placeholder that
    // generation fills in) are written together: on D1 as one atomic batch.
    await createRecipeDraft(database, {
      id: recipeId,
      title: trimmedTitle,
      description: trimmedDescription,
      servings: servings.trim() || null,
      chefId: userId,
      steps: recipeSteps,
      cover: uploadedImageUrl
        ? {
          id: coverId,
          imageUrl: uploadedImageUrl,
          sourceType: "chef-upload",
          status: "ready",
          createdById: userId,
          sourceImageUrl: uploadedImageUrl,
          generationStatus: "none",
          activeVariant: "image",
        }
        : {
          id: coverId,
          imageUrl: "",
          sourceType: "ai-placeholder",
          status: "processing",
          createdById: userId,
          generationStatus: "processing",
        },
    }, requestD1(context));
  } catch (error) {
    const postHogConfig = cloudflareEnv
      ? resolvePostHogServerConfig(cloudflareEnv)
      : ({ enabled: false, reason: "missing-key" } as const);
    const waitUntil = context.cloudflare?.ctx?.waitUntil
      ? context.cloudflare.ctx.waitUntil.bind(context.cloudflare.ctx)
      : undefined;
    // Nothing else would ever remove an upload whose recipe was not created, so it is deleted
    // best-effort, capturing if that delete also throws.
    const deleteUpload = async () => {
      if (!uploadedImageUrl) return;
      await deleteStoredImageWithCapture({
        bucket: photosBucket,
        imageUrl: uploadedImageUrl,
        event: "spoonjoy.storage.orphan_cleanup_failed",
        postHogConfig,
        waitUntil,
        distinctId: userId,
        extras: { surface: "recipe_create" },
      });
    };
    // Another recipe took the title between the check above and the write, so nothing was
    // written: answer as the check does. That is an expected outcome, so nothing is captured.
    if (error instanceof ActiveRecipeTitleConflictError) {
      await deleteUpload();
      return data({ errors: { title: error.message } }, { status: 400 });
    }
    // The recipe create threw after the image landed in R2. Record the real
    // failure first (it was previously discarded behind a generic 500), then
    // decide what to do with the upload.
    if (postHogConfig.enabled) {
      const capture = captureException(postHogConfig, {
        error,
        distinctId: userId,
        route: new URL(request.url).pathname,
        method: request.method,
      });
      if (waitUntil) {
        waitUntil(capture);
      } else {
        void capture;
      }
    }
    // A thrown save is not proof that nothing was written: an error can be reported after the
    // write committed. So look for the recipe before deleting the upload its cover may point at.
    // If it is there, the save landed and is answered as a success. If the lookup itself fails,
    // the upload is kept: an unreferenced image is harmless, a cover pointing at a deleted one is
    // not.
    const landed = await database.recipe
      .findUnique({ where: { id: recipeId }, select: { id: true } })
      .catch(() => undefined);
    if (!landed) {
      if (landed === null) await deleteUpload();
      return data(
        { errors: { general: "Failed to create recipe. Please try again." } },
        { status: 500 }
      );
    }
  }

  // The recipe and its cover are committed, and the cover may point at the upload. From here a
  // failure is captured, never answered as a failed save and never a reason to delete the upload.
  const createdId = recipeId;
  const followUpOptions = {
    env: cloudflareEnv,
    waitUntil: context.cloudflare?.ctx?.waitUntil
      ? context.cloudflare.ctx.waitUntil.bind(context.cloudflare.ctx)
      : undefined,
    distinctId: userId,
    request,
    surface: "recipe_create",
  } as const;
  await runAfterRecipeSave(async () => {
    if (uploadedImageUrl) {
      await scheduleSpoonCoverStylization({
        db: database,
        userId,
        recipeId: createdId,
        coverId,
        rawPhotoUrl: uploadedImageUrl,
        recipeTitle: trimmedTitle,
        env: cloudflareEnv,
        bucket: photosBucket,
        sourceType: "chef-upload",
      });
      return;
    }
    const task = scheduleAiPlaceholderCover({
      db: database,
      userId,
      recipeId: createdId,
      coverId,
      title: trimmedTitle,
      description: trimmedDescription,
      env: cloudflareEnv,
      bucket: photosBucket,
    });
    if (followUpOptions.waitUntil) {
      // The task outlives this follow-up, so a later rejection is routed through the same
      // logging and capture rather than lost.
      followUpOptions.waitUntil(task.catch((error: unknown) => runAfterRecipeSave(() => Promise.reject(error), followUpOptions)));
    } else {
      await task;
    }
  }, followUpOptions);

  return redirect(`/recipes/${createdId}`);
}

export default function NewRecipe() {
  const actionData = useActionData<ActionData>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const submitInFlightRef = useRef(false);
  const [submitStarted, setSubmitStarted] = useState(false);
  const isLoading = navigation.state === 'submitting' || submitStarted;

  useEffect(() => {
    if (navigation.state === "idle") {
      submitInFlightRef.current = false;
      setSubmitStarted(false);
    }
  }, [navigation.state]);

  const handleCancel = () => {
    navigate("/recipes");
  };

  const handleSave = (recipeData: RecipeBuilderData) => {
    /* istanbul ignore next -- @preserve duplicate-submit latch is asserted through route action call counts */
    if (submitInFlightRef.current || navigation.state !== "idle") {
      return;
    }

    submitInFlightRef.current = true;
    setSubmitStarted(true);

    // formRef.current is guaranteed to exist when this is called because
    // both the Form and RecipeBuilder are always rendered together
    const form = formRef.current!;
    const titleInput = form.querySelector('input[name="title"]') as HTMLInputElement;
    const descriptionInput = form.querySelector('textarea[name="description"]') as HTMLTextAreaElement;
    const servingsInput = form.querySelector('input[name="servings"]') as HTMLInputElement;
    const stepsInput = form.querySelector('input[name="steps"]') as HTMLInputElement;
    const clearImageInput = form.querySelector('input[name="clearImage"]') as HTMLInputElement;

    if (titleInput) titleInput.value = recipeData.title;
    if (descriptionInput) descriptionInput.value = recipeData.description || "";
    if (servingsInput) servingsInput.value = recipeData.servings || "";
    if (stepsInput) stepsInput.value = JSON.stringify(recipeData.steps);
    if (clearImageInput) clearImageInput.value = recipeData.clearImage ? "true" : "";

    // Handle image file
    if (recipeData.imageFile && fileInputRef.current) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(recipeData.imageFile);
      fileInputRef.current.files = dataTransfer.files;
    }

    // Submit the form
    form.requestSubmit();
  };

  return (
    <CookbookPage>
      <CookbookHeader
        eyebrow="New recipe"
        title="Write the version future-you can actually cook."
        action={<Link href="/recipes" className="sj-link inline-flex min-h-11 items-center">← Back to recipes</Link>}
      >
        <Text>
          Bring in a recipe you already have, or start with the story and the photo and shape the method into steps.
        </Text>
      </CookbookHeader>

      {/* Hidden form for submitting data to the action */}
      <Form ref={formRef} method="post" encType="multipart/form-data" className="hidden">
        <input type="hidden" name="title" />
        <textarea name="description" className="hidden" />
        <input type="hidden" name="servings" />
        <input type="hidden" name="steps" />
        <input type="hidden" name="clearImage" />
        <input ref={fileInputRef} type="file" name="image" accept={FOOD_IMAGE_ACCEPT} />
      </Form>

      <div className="mt-8 max-w-5xl">
        <RecipeImportPanel result={actionData?.importResult} />
      </div>

      <div className="max-w-5xl">
        <RecipeBuilder
          onSave={handleSave}
          onCancel={handleCancel}
          errors={actionData?.errors}
          loading={isLoading}
        />
      </div>
    </CookbookPage>
  );
}
