import type { Route } from "./+types/recipes.new";
import { redirect, data, useActionData, useNavigate, useNavigation, Form } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import { Heading } from "~/components/ui/heading";
import { Link } from "~/components/ui/link";
import { RecipeBuilder, type RecipeBuilderData } from "~/components/recipe/RecipeBuilder";
import {
  validateTitle,
  validateDescription,
  validateServings,
} from "~/lib/validation";
import { useRef } from "react";

interface ActionData {
  errors?: {
    title?: string;
    description?: string;
    servings?: string;
    image?: string;
    general?: string;
  };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireUserId(request);
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const formData = await request.formData();

  const title = formData.get("title")?.toString() || "";
  const description = formData.get("description")?.toString() || "";
  const servings = formData.get("servings")?.toString() || "";
  const imageFile = formData.get("image") as File | null;
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

  const database = await getRequestDb(context);

  try {
    // Parse steps data
    let steps: Array<{
      description: string;
      stepTitle?: string;
      duration?: number;
      ingredients: Array<{
        quantity: number;
        unit: string;
        ingredientName: string;
      }>;
    }> = [];
    try {
      steps = JSON.parse(stepsJson);
    } catch {
      // Invalid JSON, use empty array
    }

    // TODO: In production, upload imageFile to R2/storage and get URL
    // Create recipe with steps in a transaction
    const recipe = await database.recipe.create({
      data: {
        title: title.trim(),
        description: description.trim() || null,
        servings: servings.trim() || null,
        // Avoid schema default stock image when no image upload is provided.
        imageUrl: "",
        chefId: userId,
        steps: {
          create: steps.map((step, index) => ({
            stepNum: index + 1,
            description: step.description,
            stepTitle: step.stepTitle || null,
            duration: step.duration || null,
            // Note: Ingredients would need additional handling for ingredientRef lookup
          })),
        },
      },
    });

    return redirect(`/recipes/${recipe.id}`);
  } catch (error) {
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
  const isLoading = navigation.state === 'submitting';

  const handleCancel = () => {
    navigate("/recipes");
  };

  const handleSave = (recipeData: RecipeBuilderData) => {
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
    <div className="font-sans leading-relaxed p-8">
      <div className="max-w-[800px] mx-auto">
        <div className="mb-8">
          <Heading level={1}>Create New Recipe</Heading>
          <Link
            href="/recipes"
            className="text-blue-600 no-underline"
          >
            ← Back to recipes
          </Link>
        </div>

        {/* Hidden form for submitting data to the action */}
        <Form ref={formRef} method="post" encType="multipart/form-data" className="hidden">
          <input type="hidden" name="title" />
          <textarea name="description" className="hidden" />
          <input type="hidden" name="servings" />
          <input type="hidden" name="steps" />
          <input type="hidden" name="clearImage" />
          <input ref={fileInputRef} type="file" name="image" accept="image/*" />
        </Form>

        <RecipeBuilder
          onSave={handleSave}
          onCancel={handleCancel}
          errors={actionData?.errors}
          loading={isLoading}
        />
      </div>
    </div>
  );
}
