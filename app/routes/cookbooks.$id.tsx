import type { Route } from "./+types/cookbooks.$id";
import { redirect, useLoaderData, Form, data, useSubmit, type AppLoadContext } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { getRecipeCoverImageUrl } from "~/lib/recipe-cover.server";
import { requireUserId } from "~/lib/session.server";
import { notifyCookbookSaveOfMine } from "~/lib/notification-triggers.server";
import { getVapidConfig, type VapidEnv } from "~/lib/env.server";
import { useState, useRef } from "react";

interface CloudflareContextLike {
  cloudflare?: {
    env?: VapidEnv | null;
    ctx?: { waitUntil?: (promise: Promise<unknown>) => void };
  };
}

function getNotificationCtx(context: AppLoadContext): {
  vapidEnv: VapidEnv;
  waitUntil?: (promise: Promise<unknown>) => void;
} {
  const cf = (context as unknown as CloudflareContextLike).cloudflare;
  const envSource = cf?.env ?? null;
  return {
    vapidEnv: {
      VAPID_PUBLIC_KEY: envSource?.VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: envSource?.VAPID_PRIVATE_KEY,
      VAPID_SUBJECT: envSource?.VAPID_SUBJECT,
    },
    waitUntil: cf?.ctx?.waitUntil ? cf.ctx.waitUntil.bind(cf.ctx) : undefined,
  };
}
import { ConfirmationDialog } from "~/components/confirmation-dialog";
import { Button } from "~/components/ui/button";
import { Text, Strong } from "~/components/ui/text";
import { Link } from "~/components/ui/link";
import { Input } from "~/components/ui/input";
import { Select } from "~/components/ui/select";
import { CookbookPage, CookbookHeader, CookbookSectionTitle, ObjectRow, RuledEmptyState, SettingsPanel } from "~/components/cookbook/page";

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

        // Fire-and-forget: notify the recipe owner when someone else saved their recipe.
        try {
          const { vapidEnv, waitUntil } = getNotificationCtx(context);
          const vapid = getVapidConfig(vapidEnv);
          const notifyTask = notifyCookbookSaveOfMine(
            database,
            { recipeId, actorId: userId },
            { vapid, waitUntil },
          );
          if (waitUntil) {
            waitUntil(notifyTask);
          } else {
            await notifyTask;
          }
        } catch {
          // VAPID not configured locally — skip silently.
        }

        return data({ success: true });
      } catch (error: any) {
        if (error.code === "P2002") {
          // Idempotent re-add — do NOT enqueue a second notification.
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
    <CookbookPage>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <Link
            href="/cookbooks"
            className="sj-link"
          >
            ← Back to cookbooks
          </Link>
        </div>

        <CookbookHeader
          eyebrow="Cookbook"
          title={cookbook.title}
          action={isOwner ? (
            <>
              <Button
                onClick={() => setIsEditingTitle(true)}
                plain
                className="text-sm"
              >
                Edit title
              </Button>
              <Form method="post" ref={deleteFormRef}>
                <input type="hidden" name="intent" value="delete" />
                <Button
                  type="button"
                  variant="destructive"
                  aria-label="Delete cookbook"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  Delete
                </Button>
              </Form>
            </>
          ) : null}
        >
          <Text className="m-0">
            By <Strong>{cookbook.author.username}</Strong> ·{" "}
            <span>
              {cookbook.recipes.length} {cookbook.recipes.length === 1 ? "recipe" : "recipes"}
            </span>
          </Text>
        </CookbookHeader>

        {isEditingTitle && isOwner ? (
          <SettingsPanel title="Rename cookbook">
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
          </SettingsPanel>
        ) : null}

        {isOwner && (
          <ConfirmationDialog
                open={showDeleteDialog}
                onClose={() => setShowDeleteDialog(false)}
                onConfirm={() => {
                  setShowDeleteDialog(false);
                  deleteFormRef.current?.submit();
                }}
                title="Delete this cookbook?"
                description="This will permanently delete the cookbook and remove all recipe associations. The recipes themselves will not be deleted."
                confirmLabel="Delete it"
                cancelLabel="Keep it"
                destructive
          />
        )}

        {isOwner && availableRecipes.length > 0 && (
          <SettingsPanel title="Add recipe to cookbook">
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
                Add recipe
              </Button>
            </Form>
          </SettingsPanel>
        )}

        {cookbook.recipes.length === 0 ? (
          <RuledEmptyState title="No recipes yet">
            <Text className="mb-6">
              {isOwner ? "Add recipes to your cookbook using the form above" : "This cookbook is empty"}
            </Text>
          </RuledEmptyState>
        ) : (
          <div>
            <CookbookSectionTitle>Recipes</CookbookSectionTitle>
            <div className="sj-list-ruled">
            {cookbook.recipes.map((item) => (
              <div key={item.id} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <ObjectRow
                  href={`/recipes/${item.recipe.id}`}
                  imageUrl={item.recipe.coverImageUrl}
                  title={item.recipe.title}
                  subtitle={item.recipe.description ?? `By ${item.recipe.chef.username}`}
                  stamp="cook"
                />
                {isOwner && (
                  <div className="pb-3 sm:pb-0">
                    <Button
                      type="button"
                      variant="destructive"
                      className="w-full text-sm"
                      aria-label="Remove from cookbook"
                      onClick={() => setRecipeToRemove(item.id)}
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            ))}
            </div>
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
        title="Remove from cookbook?"
        description="This recipe will be removed from this cookbook. The recipe itself won't be deleted."
        confirmLabel="Remove it"
        cancelLabel="Keep it"
        destructive
      />
    </CookbookPage>
  );
}
