import type { Route } from "./+types/recipes.new";
import { redirect, data, useActionData, useNavigate, useNavigation, useFetcher } from "react-router";
import { getCloudflareEnv, getIngredientParserEnv, getRequestDb } from "~/lib/route-platform.server";
import { revalidateUnlessIngredientParse } from "~/lib/ingredient-parse-revalidation";
import { requireUserId } from "~/lib/session.server";
import { Link } from "~/components/ouro/link/link";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { RecipeBuilder, type RecipeBuilderData } from "~/components/recipe/RecipeBuilder";
import {
  validateTitle,
  validateDescription,
  validateServings,
} from "~/lib/validation";
import { createRecipeDraft, parseRecipeStepsJson } from "~/lib/recipe-create.server";
import { requestD1 } from "~/lib/d1-read.server";
import {
  D1_WRITE_UNAVAILABLE_CODE,
  D1_WRITE_UNAVAILABLE_MESSAGE,
  d1UnavailableHeaders,
  formWriteToken,
  idForWriteToken,
  isD1Unavailable,
} from "~/lib/d1-write-retry.server";
import { useWriteToken } from "~/hooks/use-write-token";
import {
  deleteStoredImageWithCapture,
  hasUploadedImageFile,
  imageUploadFormDataWithinLimit,
  RECIPE_IMAGE_TYPES,
  storeImage,
  validateImageFileForStorage,
} from "~/lib/image-storage.server";
import { captureException, resolvePostHogServerConfig } from "~/lib/analytics-server";
import { RECIPE_IMAGE_SIZE_MESSAGE, RECIPE_IMAGE_TYPE_MESSAGE } from "~/lib/recipe-image";
import { ActiveRecipeTitleConflictError, validateActiveRecipeTitleUnique } from "~/lib/recipe-title-uniqueness.server";
import { scheduleAiPlaceholderCover } from "~/lib/ai-placeholder-cover.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";
import { runAfterRecipeSave } from "~/lib/recipe-save-follow-up.server";
import {
  IngredientParseError,
  type ParsedIngredient,
} from "~/lib/ingredient-parse.server";
import { parseIngredientsWithRulesFallback } from "~/lib/ingredient-parse-fallback.server";
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
  // The recipe's id comes from the form's token, made when the page opened, so a resubmit (after
  // a 503, or a double tap) finds the recipe the first submit wrote and goes to it, instead of
  // answering that its own title is taken.
  const recipeToken = formWriteToken(formData.get("recipeToken"));
  const recipeId = recipeToken ? await idForWriteToken("recipe", userId, recipeToken) : crypto.randomUUID();
  if (recipeToken) {
    const written = await database.recipe.findFirst({ where: { id: recipeId, chefId: userId }, select: { id: true } });
    if (written) return redirect(`/recipes/${recipeId}`);
  }

  const titleUniquenessResult = await validateActiveRecipeTitleUnique(database, {
    chefId: userId,
    title,
  });
  if (!titleUniquenessResult.valid) {
    return data({ errors: { title: titleUniquenessResult.error } }, { status: 400 });
  }

  const cloudflareEnv = getCloudflareEnv(context);
  const photosBucket = cloudflareEnv?.PHOTOS;
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
    // The title was taken by an earlier submit of this same form, landing late: the recipe is
    // this form's, so the save is done, and this submit's own upload is not needed.
    if (error instanceof ActiveRecipeTitleConflictError && recipeToken) {
      const earlier = await database.recipe.findFirst({ where: { id: recipeId, chefId: userId }, select: { id: true } });
      if (earlier) {
        await deleteUpload();
        return redirect(`/recipes/${recipeId}`);
      }
    }
    // Another recipe took the title between the check above and the write, so nothing was
    // written: answer as the check does. That is an expected outcome, so nothing is captured.
    if (error instanceof ActiveRecipeTitleConflictError) {
      await deleteUpload();
      return data({ errors: { title: error.message } }, { status: 400 });
    }
    // The database was briefly unavailable and every try failed: a retryable 503 the form shows,
    // keeping what the cook entered, with the same token, so saving again writes the recipe once.
    // The upload is kept: the last try may still commit, with a cover pointing at it.
    if (isD1Unavailable(error)) {
      return data(
        { errors: { general: D1_WRITE_UNAVAILABLE_MESSAGE }, errorCode: D1_WRITE_UNAVAILABLE_CODE, retryable: true as const },
        { status: 503, headers: d1UnavailableHeaders() },
      );
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
  // A progressive-post response is an initial display baseline, never a client arrival.
  const [initialActionData] = useState(actionData);
  const saveFetcher = useFetcher<ActionData>();
  const [saveAnswer, setSaveAnswer] = useState<ActionData>();
  const saveData = saveAnswer ?? initialActionData;
  const navigate = useNavigate();
  const navigation = useNavigation();
  const submitInFlightRef = useRef(false);
  const [submitStarted, setSubmitStarted] = useState(false);
  // One recipe per opening of the page: a save after a 503, or a double tap, writes it once.
  const [recipeToken] = useWriteToken();
  const isLoading = saveFetcher.state === "submitting" || navigation.state === 'submitting' ||
    (submitStarted && saveFetcher.state === "idle");

  useEffect(() => {
    if (navigation.state === "idle" && saveFetcher.state !== "submitting") {
      submitInFlightRef.current = false;
      setSubmitStarted(false);
    }
    // Present the actual completed save after its fields are enabled again. While
    // revalidating, retain the previous accepted response rather than stale projections.
    if (saveFetcher.state === "idle") setSaveAnswer(saveFetcher.data);
  }, [navigation.state, saveFetcher.state, saveFetcher.data]);

  const handleCancel = () => {
    navigate("/recipes");
  };

  const handleSave = (recipeData: RecipeBuilderData) => {
    /* istanbul ignore next -- @preserve duplicate-submit latch is asserted through route action call counts */
    if (submitInFlightRef.current || navigation.state !== "idle" || saveFetcher.state !== "idle") {
      return;
    }

    submitInFlightRef.current = true;
    setSubmitStarted(true);

    const formData = new FormData();
    formData.set("recipeToken", recipeToken);
    formData.set("title", recipeData.title);
    formData.set("description", recipeData.description || "");
    formData.set("servings", recipeData.servings || "");
    formData.set("steps", JSON.stringify(recipeData.steps));
    if (recipeData.imageFile) formData.set("image", recipeData.imageFile);
    saveFetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
  };

  return (
    <CookbookPage>
      <PageHeader
        eyebrow="New recipe"
        title="Write the version future-you can actually cook."
        actions={<Link href="/recipes" className="inline-flex min-h-11 items-center">← Back to recipes</Link>}
        size="lg"
        divider
        description="Bring in a recipe you already have, or start with the story and the photo and shape the method into steps."
      />

      <div className="mt-8 max-w-5xl">
        <RecipeImportPanel result={actionData?.importResult} />
      </div>

      <div className="max-w-5xl">
        <RecipeBuilder
          onSave={handleSave}
          onCancel={handleCancel}
          errors={saveData?.errors}
          answer={saveAnswer}
          loading={isLoading}
        />
      </div>
    </CookbookPage>
  );
}
