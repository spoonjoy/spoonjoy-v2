import type { Route } from "./+types/recipes.new";
import { redirect, data, useActionData, useNavigate, useNavigation, Form } from "react-router";
import { getCloudflareEnv, getIngredientParserEnv, getRequestDb } from "~/lib/route-platform.server";
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
import {
  deleteStoredImage,
  hasUploadedImageFile,
  RECIPE_IMAGE_TYPES,
  storeImage,
  validateImageFileForStorage,
} from "~/lib/image-storage.server";
import { FOOD_IMAGE_ACCEPT, RECIPE_IMAGE_SIZE_MESSAGE, RECIPE_IMAGE_TYPE_MESSAGE } from "~/lib/recipe-image";
import { validateActiveRecipeTitleUnique } from "~/lib/recipe-title-uniqueness.server";
import { createCover } from "~/lib/recipe-cover.server";
import { scheduleAiPlaceholderCover } from "~/lib/ai-placeholder-cover.server";
import { scheduleSpoonCoverStylization } from "~/lib/spoon-cover-stylization.server";
import {
  IngredientParseError,
  parseIngredients,
  type ParsedIngredient,
} from "~/lib/ingredient-parse.server";
import { useEffect, useRef, useState } from "react";

interface ActionData {
  parsedIngredients?: ParsedIngredient[];
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

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireUserId(request, "/login", context.cloudflare?.env);
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const formData = await request.formData();
  const intent = formData.get("intent")?.toString();

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
        return data({ errors: { parse: error.message } }, { status: 400 });
      }

      return data(
        { errors: { parse: "An unexpected error occurred while parsing ingredients" } },
        { status: 500 }
      );
    }
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

  try {
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim() || null;
    const recipe = await createRecipeDraft(database, {
      id: recipeId,
      title: trimmedTitle,
      description: trimmedDescription,
      servings: servings.trim() || null,
      chefId: userId,
      steps: recipeSteps,
    });

    if (uploadedImageUrl) {
      const uploadedCover = await createCover(database, {
        recipeId: recipe.id,
        imageUrl: uploadedImageUrl,
        sourceType: "chef-upload",
      });
      await scheduleSpoonCoverStylization({
        db: database,
        userId,
        recipeId: recipe.id,
        coverId: uploadedCover.id,
        rawPhotoUrl: uploadedImageUrl,
        recipeTitle: trimmedTitle,
        env: cloudflareEnv,
        bucket: photosBucket,
        sourceType: "chef-upload",
      });
    } else {
      const placeholderCover = await createCover(database, {
        recipeId: recipe.id,
        imageUrl: "",
        sourceType: "ai-placeholder",
      });
      const waitUntil = context.cloudflare?.ctx?.waitUntil;
      const task = scheduleAiPlaceholderCover({
        db: database,
        userId,
        recipeId: recipe.id,
        coverId: placeholderCover.id,
        title: trimmedTitle,
        description: trimmedDescription,
        env: cloudflareEnv,
        bucket: photosBucket,
      });
      if (waitUntil) {
        waitUntil.call(context.cloudflare!.ctx!, task);
      } else {
        await task;
      }
    }

    return redirect(`/recipes/${recipe.id}`);
  } catch (error) {
    if (uploadedImageUrl) {
      await deleteStoredImage({ bucket: photosBucket, imageUrl: uploadedImageUrl });
    }

    return data(
      { errors: { general: "Failed to create recipe. Please try again." } },
      { status: 500 }
    );
  }
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
          Start with the story and the photo, then shape the method into steps when the dish is ready.
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
