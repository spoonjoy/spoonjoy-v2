import type { Route } from "./+types/cookbooks.$id";
import { redirect, useLoaderData, Form, data, useSubmit, type AppLoadContext } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { getRecipeCoverImageUrl } from "~/lib/recipe-cover.server";
import { getUserId, requireUserId } from "~/lib/session.server";
import { notifyCookbookSaveOfMine } from "~/lib/notification-triggers.server";
import { getVapidConfig, type VapidEnv } from "~/lib/env.server";
import { formatServingsLabel } from "~/lib/quantity";
import { useState, useRef } from "react";
import { absoluteUrlFromRequest, cookbookOgPath } from "~/lib/og-image.server";

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
import { CookbookPage, CookbookHeader, RuledEmptyState } from "~/components/cookbook/page";
import { CookbookCoverArt } from "~/components/cookbook/CookbookCoverArt";
import { shareContent } from "~/components/navigation";

export function meta({ data }: Route.MetaArgs) {
  if (!data) {
    return [
      { title: "Cookbook - Spoonjoy" },
      { name: "description", content: "Open this Spoonjoy cookbook." },
    ];
  }

  const recipeLabel = `${data.cookbook.recipes.length} ${data.cookbook.recipes.length === 1 ? "recipe" : "recipes"}`;
  const description = `${data.cookbook.title}, a Spoonjoy cookbook by ${data.cookbook.author.username} with ${recipeLabel}.`;

  return [
    { title: `${data.cookbook.title} - Spoonjoy` },
    { name: "description", content: description },
    { property: "og:site_name", content: "Spoonjoy" },
    { property: "og:type", content: "article" },
    { property: "og:title", content: data.cookbook.title },
    { property: "og:description", content: description },
    { property: "og:url", content: data.canonicalUrl },
    { property: "og:image", content: data.ogImageUrl },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:type", content: "image/png" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: data.cookbook.title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: data.ogImageUrl },
  ];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const userId = await getUserId(request, context.cloudflare?.env);
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
        where: {
          recipe: {
            deletedAt: null,
          },
        },
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
  const isOwner = userId !== null && cookbook.authorId === userId;

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

  return {
    cookbook: cookbookWithCovers,
    coverImageUrls: cookbookWithCovers.recipes.map((item) => item.recipe.coverImageUrl),
    canonicalUrl: absoluteUrlFromRequest(request.url, `/cookbooks/${id}`),
    ogImageUrl: absoluteUrlFromRequest(request.url, cookbookOgPath(id)),
    isOwner,
    availableRecipes,
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
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
      const recipe = await database.recipe.findFirst({
        where: { id: recipeId, deletedAt: null },
        select: { id: true },
      });
      if (!recipe) {
        throw new Response("Recipe not found", { status: 404 });
      }

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
  const { cookbook, isOwner, availableRecipes, canonicalUrl } = useLoaderData<typeof loader>();
  const recipeImages = cookbook.recipes.map((item) => ({
    coverImageUrl: item.recipe.coverImageUrl,
    title: item.recipe.title,
  }));
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showOwnerTools, setShowOwnerTools] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [recipeToRemove, setRecipeToRemove] = useState<string | null>(null);
  const submit = useSubmit();
  const deleteFormRef = useRef<HTMLFormElement>(null);
  const handleShare = async () => {
    await shareContent({
      title: cookbook.title,
      text: `Open this Spoonjoy cookbook by ${cookbook.author.username}.`,
      url: canonicalUrl,
    });
  };

  return (
    <CookbookPage>
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between gap-4 print:hidden">
          <Link
            href="/cookbooks"
            className="sj-link inline-flex min-h-11 items-center"
          >
            ← Back to cookbooks
          </Link>
          <Button type="button" plain onClick={handleShare}>
            Share
          </Button>
        </div>

        <div className="grid gap-8 border-b border-[var(--sj-border-strong)] pb-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-end">
          <CookbookHeader
            eyebrow="Cookbook"
            title={cookbook.title}
            ruled={false}
          >
            <Text className="m-0">
              By <Strong>{cookbook.author.username}</Strong> ·{" "}
              <span>
                {cookbook.recipes.length} {cookbook.recipes.length === 1 ? "recipe" : "recipes"}
              </span>
            </Text>
          </CookbookHeader>
          <CookbookCoverArt
            title={cookbook.title}
            recipeCount={cookbook.recipes.length}
            recipeImages={recipeImages}
            className="mx-auto w-full max-w-56 lg:max-w-none"
          />
        </div>

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

        {cookbook.recipes.length === 0 ? (
          <RuledEmptyState title="No recipes yet">
            <Text className="mb-6">
              {isOwner ? "Add recipes to your cookbook using the owner tools below." : "This cookbook is empty."}
            </Text>
          </RuledEmptyState>
        ) : (
          <section aria-labelledby="cookbook-recipes-heading" className="mt-10">
            <div className="max-w-3xl">
              <p className="sj-eyebrow">Contents</p>
              <h2 id="cookbook-recipes-heading" className="font-sj-display mt-2 text-4xl/10 font-semibold text-[var(--sj-ink)]">
                Recipes
              </h2>
            </div>

            <ol className="mt-6 border-y border-[var(--sj-border-strong)]">
              {cookbook.recipes.map((item, index) => {
                const servingsLabel = formatServingsLabel(item.recipe.servings);

                return (
                  <li key={item.id} className="border-b border-[var(--sj-border)] last:border-b-0">
                    <Link
                      href={`/recipes/${item.recipe.id}`}
                      className="group grid min-h-24 grid-cols-[2.25rem_4.75rem_minmax(0,1fr)] gap-4 py-5 no-underline sm:grid-cols-[3rem_6rem_minmax(0,1fr)_auto] sm:items-center sm:gap-5"
                      aria-label={item.recipe.title}
                    >
                      <span className="font-sj-ui pt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-brass)] sm:pt-0">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="block aspect-[4/3] overflow-hidden bg-[color-mix(in_srgb,var(--sj-flour)_70%,var(--sj-panel-solid))]">
                        {item.recipe.coverImageUrl ? (
                          <img src={item.recipe.coverImageUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]" />
                        ) : (
                          <span className="block h-full w-full bg-[linear-gradient(135deg,color-mix(in_srgb,var(--sj-flour)_82%,var(--sj-panel-solid)),var(--sj-panel-solid))]" />
                        )}
                      </span>
                      <span className="min-w-0 self-center">
                        <span className="font-sj-display block text-2xl/7 font-semibold text-[var(--sj-ink)] sm:text-3xl/8">
                          {item.recipe.title}
                        </span>
                        <span className="mt-1 block max-w-2xl text-base/6 text-[var(--sj-ink-soft)]">
                          {item.recipe.description ?? `By ${item.recipe.chef.username}`}
                        </span>
                      </span>
                      {servingsLabel ? (
                        <span className="font-sj-ui col-start-3 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)] sm:col-start-auto sm:justify-self-end">
                          {servingsLabel}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {isOwner ? (
          <div className="mt-12 print:hidden">
            <button
              type="button"
              className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-4 border-y border-[var(--sj-border)] bg-transparent py-3 text-left font-sj-ui text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)] hover:text-[var(--sj-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)]"
              aria-expanded={showOwnerTools}
              aria-controls="cookbook-owner-tools"
              onClick={() => setShowOwnerTools((visible) => !visible)}
            >
              <span>Owner tools</span>
              <span className="text-[var(--sj-ink)]">{showOwnerTools ? "Close" : "Open +"}</span>
            </button>

            {showOwnerTools ? (
              <div id="cookbook-owner-tools" className="border-b border-[var(--sj-border)] py-6">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div>
                    <h3 className="font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">Cookbook details</h3>
                    <p className="mt-1 max-w-2xl text-sm/6 text-[var(--sj-ink-soft)]">
                      Private controls for maintaining this collection. They stay out of the cookbook contents above.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
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
                  </div>
                </div>

                {isEditingTitle ? (
                  <Form method="post" className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
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
                ) : null}

                {availableRecipes.length > 0 ? (
                  <div className="mt-6 border-t border-[var(--sj-border)] pt-6">
                    <h3 className="font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">Add recipe to cookbook</h3>
                    <Form method="post" className="mt-3 flex flex-col gap-4 sm:flex-row">
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
                  </div>
                ) : null}

                {cookbook.recipes.length > 0 ? (
                  <div className="mt-6 border-t border-[var(--sj-border)] pt-6">
                    <h3 className="font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">Remove recipes</h3>
                    <div className="mt-3 divide-y divide-[var(--sj-border)] border-y border-[var(--sj-border)]">
                      {cookbook.recipes.map((item) => (
                        <div key={item.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <span className="font-sj-ui text-sm/5 font-semibold text-[var(--sj-ink)]">{item.recipe.title}</span>
                          <Button
                            type="button"
                            variant="destructive"
                            className="w-full text-sm sm:w-auto"
                            aria-label="Remove from cookbook"
                            onClick={() => setRecipeToRemove(item.id)}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
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
