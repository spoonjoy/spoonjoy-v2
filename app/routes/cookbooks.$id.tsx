import type { Route } from "./+types/cookbooks.$id";
import { redirect, useLoaderData, Form, data, useSubmit } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { getRecipeCoverImageUrl } from "~/lib/recipe-cover.server";
import { requireUserId } from "~/lib/session.server";
import { useState, useRef } from "react";
import { ConfirmationDialog } from "~/components/confirmation-dialog";
import { Button } from "~/components/ui/button";
import { Heading, Subheading } from "~/components/ui/heading";
import { Text, Strong } from "~/components/ui/text";
import { Link } from "~/components/ui/link";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  const { id } = params;

  const database = await getRequestDb(context);

  const cookbook = await database.cookbook.findUnique({
    where: { id },
    include: {
      author: {
        select: {
          id: true,
          username: true,
        },
      },
      recipes: {
        include: {
          recipe: {
            select: {
              id: true,
              title: true,
              description: true,
              servings: true,
              covers: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              },
              chef: {
                select: {
                  username: true,
                },
              },
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  if (!cookbook) {
    throw new Response("Cookbook not found", { status: 404 });
  }

  // Check if user owns this cookbook
  const isOwner = cookbook.authorId === userId;

  // Get user's recipes that aren't in this cookbook
  const availableRecipes = isOwner
    ? await database.recipe.findMany({
        where: {
          chefId: userId,
          deletedAt: null,
          NOT: {
            cookbooks: {
              some: {
                cookbookId: id,
              },
            },
          },
        },
        select: {
          id: true,
          title: true,
        },
        orderBy: {
          title: "asc",
        },
      })
    : [];

  const cookbookWithCovers = {
    ...cookbook,
    recipes: cookbook.recipes.map((item) => ({
      ...item,
      recipe: {
        id: item.recipe.id,
        title: item.recipe.title,
        description: item.recipe.description,
        servings: item.recipe.servings,
        chef: item.recipe.chef,
        coverImageUrl: getRecipeCoverImageUrl(
          { id: item.recipe.id, title: item.recipe.title },
          item.recipe.covers,
        ),
      },
    })),
  };

  return { cookbook: cookbookWithCovers, isOwner, availableRecipes };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const userId = await requireUserId(request);
  const { id } = params;
  const formData = await request.formData();
  const intent = formData.get("intent");

  const database = await getRequestDb(context);

  // Verify ownership
  const cookbook = await database.cookbook.findUnique({
    where: { id },
    select: { authorId: true },
  });

  if (!cookbook) {
    throw new Response("Cookbook not found", { status: 404 });
  }

  if (cookbook.authorId !== userId) {
    throw new Response("Unauthorized", { status: 403 });
  }

  if (intent === "updateTitle") {
    const title = formData.get("title")?.toString() || "";
    if (!title.trim()) {
      return data({ error: "Title is required" }, { status: 400 });
    }
    try {
      await database.cookbook.update({
        where: { id },
        data: { title: title.trim() },
      });
      return data({ success: true });
    } catch (error: any) {
      if (error.code === "P2002") {
        return data({ error: "You already have a cookbook with this title" }, { status: 400 });
      }
      throw error;
    }
  }

  if (intent === "delete") {
    await database.cookbook.delete({
      where: { id },
    });
    return redirect("/cookbooks");
  }

  if (intent === "addRecipe") {
    const recipeId = formData.get("recipeId")?.toString();
    if (recipeId) {
      try {
        await database.recipeInCookbook.create({
          data: {
            cookbookId: id,
            recipeId,
            addedById: userId,
          },
        });
        return data({ success: true });
      } catch (error: any) {
        if (error.code === "P2002") {
          return data({ success: true });
        }
        throw error;
      }
    }
  }

  if (intent === "removeRecipe") {
    const recipeInCookbookId = formData.get("recipeInCookbookId")?.toString();
    if (recipeInCookbookId) {
      await database.recipeInCookbook.deleteMany({
        where: {
          id: recipeInCookbookId,
          cookbookId: id,
        },
      });
      return data({ success: true });
    }
  }

  return null;
}

export default function CookbookDetail() {
  const { cookbook, isOwner, availableRecipes } = useLoaderData<typeof loader>();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [recipeToRemove, setRecipeToRemove] = useState<string | null>(null);
  const submit = useSubmit();
  const deleteFormRef = useRef<HTMLFormElement>(null);

  return (
    <div className="sj-page px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <Link
            href="/cookbooks"
            className="sj-link"
          >
            ← Back to cookbooks
          </Link>
        </div>

        <div className="sj-panel mb-8 flex flex-col gap-5 rounded-[2rem] p-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1">
            {isEditingTitle && isOwner ? (
              <Form method="post" className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center">
                <input type="hidden" name="intent" value="updateTitle" />
                <Input
                  type="text"
                  name="title"
                  defaultValue={cookbook.title}
                  required
                  autoFocus
                  className="[&_input]:text-2xl [&_input]:font-bold"
                />
                <Button type="submit">
                  Save
                </Button>
                <Button
                  type="button"
                  plain
                  onClick={() => setIsEditingTitle(false)}
                >
                  Cancel
                </Button>
              </Form>
            ) : (
              <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="sj-eyebrow">Cookbook</p>
                  <Heading level={1} className="m-0 mt-3 text-4xl/11 tracking-[-0.04em] sm:text-6xl/15">{cookbook.title}</Heading>
                </div>
                {isOwner && (
                  <Button
                    onClick={() => setIsEditingTitle(true)}
                    plain
                    className="text-sm"
                  >
                    Edit Title
                  </Button>
                )}
              </div>
            )}
            <Text className="m-0">
              By <Strong>{cookbook.author.username}</Strong>
            </Text>
            <Text className="mt-2 mb-0 text-sm">
              {cookbook.recipes.length} {cookbook.recipes.length === 1 ? "recipe" : "recipes"}
            </Text>
          </div>
          {isOwner && (
            <>
              <Form method="post" ref={deleteFormRef}>
                <input type="hidden" name="intent" value="delete" />
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  Delete Cookbook
                </Button>
              </Form>
              <ConfirmationDialog
                open={showDeleteDialog}
                onClose={() => setShowDeleteDialog(false)}
                onConfirm={() => {
                  setShowDeleteDialog(false);
                  deleteFormRef.current?.submit();
                }}
                title="Banish this cookbook? 📚"
                description="This will permanently delete the cookbook and remove all recipe associations. The recipes themselves will not be deleted."
                confirmLabel="Delete it"
                cancelLabel="Keep it"
                destructive
              />
            </>
          )}
        </div>

        {isOwner && availableRecipes.length > 0 && (
          <div className="sj-card mb-8 rounded-[2rem] p-6">
            <Subheading level={3} className="m-0 mb-4 text-2xl/8">Add Recipe to Cookbook</Subheading>
            <Form method="post" className="flex flex-col gap-4 sm:flex-row">
              <input type="hidden" name="intent" value="addRecipe" />
              <Select
                name="recipeId"
                required
                className="flex-1"
              >
                <option value="">Select a recipe...</option>
                {availableRecipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.title}
                  </option>
                ))}
              </Select>
              <Button type="submit">
                Add Recipe
              </Button>
            </Form>
          </div>
        )}

        {cookbook.recipes.length === 0 ? (
          <div className="sj-card rounded-[2rem] p-12 text-center">
            <Subheading level={2} className="text-2xl/8">No recipes yet</Subheading>
            <Text className="mb-6">
              {isOwner ? "Add recipes to your cookbook using the form above" : "This cookbook is empty"}
            </Text>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-6">
            {cookbook.recipes.map((item) => (
              <div
                key={item.id}
                className="sj-card sj-hover-lift overflow-hidden rounded-[1.6rem]"
              >
                <Link
                  href={`/recipes/${item.recipe.id}`}
                  className="block text-inherit no-underline"
                >
                  <div
                    className="h-[220px] w-full bg-[var(--sj-flour)] bg-cover bg-center"
                    style={{
                      backgroundImage: item.recipe.coverImageUrl ? `url(${item.recipe.coverImageUrl})` : undefined,
                    }}
                  />
                  <div className="p-4">
                    <Subheading level={3} className="m-0 mb-2 text-xl/7">{item.recipe.title}</Subheading>
                    {item.recipe.description && (
                      <Text className="text-sm m-0 mb-2 line-clamp-2">
                        {item.recipe.description}
                      </Text>
                    )}
                    <Text className="text-sm m-0">
                      By {item.recipe.chef.username}
                    </Text>
                  </div>
                </Link>
                {isOwner && (
                  <div className="px-4 pb-4">
                    <Button
                      type="button"
                      variant="destructive"
                      className="w-full text-sm"
                      onClick={() => setRecipeToRemove(item.id)}
                    >
                      Remove from Cookbook
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Remove recipe confirmation dialog */}
      <ConfirmationDialog
        open={!!recipeToRemove}
        onClose={() => setRecipeToRemove(null)}
        onConfirm={() => {
          /* istanbul ignore next -- @preserve defensive check: dialog is only open when recipeToRemove is set */
          if (recipeToRemove) {
            const formData = new FormData();
            formData.set("intent", "removeRecipe");
            formData.set("recipeInCookbookId", recipeToRemove);
            submit(formData, { method: "post" });
            setRecipeToRemove(null);
          }
        }}
        title="Remove from cookbook? 🍳"
        description="This recipe will be removed from this cookbook. The recipe itself won't be deleted."
        confirmLabel="Remove it"
        cancelLabel="Keep it"
        destructive
      />
    </div>
  );
}
