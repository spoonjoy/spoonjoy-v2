import { Empty } from "~/components/ouro/empty/empty";
import type { Route } from "./+types/cookbooks.$id";
import { chefDisplayName } from "~/lib/username";
import { redirect, useLoaderData, useActionData, Form as RouterForm, data, useSubmit, type AppLoadContext, type ShouldRevalidateFunctionArgs } from "react-router";
import { getRequestDb } from "~/lib/route-platform.server";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import { requestD1 } from "~/lib/d1-read.server";
import { readCookbookPageFromD1, readCookbookPageWithPrisma } from "~/lib/cookbook-page-reads.server";
import { getUserId, requireUserId } from "~/lib/session.server";
import { notifyCookbookSaveOfMine } from "~/lib/notification-triggers.server";
import { getVapidConfig, type VapidEnv } from "~/lib/env.server";
import {
  captureException,
  resolvePostHogServerConfig,
  type PostHogServerConfig,
  type PostHogServerEnv,
} from "~/lib/analytics-server";
import { formatServingsLabel } from "~/lib/quantity";
import { useEffect, useState } from "react";
import { absoluteUrlFromRequest, cookbookOgPath } from "~/lib/og-image.server";
import { resolveIssuerOrigin } from "~/lib/oauth-metadata.server";
import { listImageProps } from "~/lib/image-loading";

interface CloudflareContextLike {
  cloudflare?: {
    env?: (VapidEnv & PostHogServerEnv) | null;
    ctx?: { waitUntil?: (promise: Promise<unknown>) => void };
  };
}

function getNotificationCtx(context: AppLoadContext): {
  vapidEnv: VapidEnv;
  postHogConfig: PostHogServerConfig;
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
    postHogConfig: resolvePostHogServerConfig(envSource ?? {}),
    waitUntil: cf?.ctx?.waitUntil ? cf.ctx.waitUntil.bind(cf.ctx) : undefined,
  };
}

function captureCookbookActionFailure(
  request: Request,
  context: AppLoadContext,
  userId: string,
  intent: string,
  error: unknown,
): void {
  // P2002 (unique-title / idempotent re-add) is an expected client outcome
  // handled by the caller. Reaching here is an unexpected mutation fault
  // (DB/infra) that rethrows into the error boundary as an opaque 500 — capture
  // it (fire-and-forget, no-op without PostHog) before it goes silent.
  const { postHogConfig, waitUntil } = getNotificationCtx(context);
  if (!postHogConfig.enabled) return;
  const capture = captureException(postHogConfig, {
    error,
    distinctId: userId,
    route: new URL(request.url).pathname,
    method: request.method,
    extras: { action: "cookbook_detail", intent },
  });
  if (waitUntil) {
    waitUntil(capture);
  } else {
    void capture;
  }
}
import { ConfirmDialog } from "~/components/ouro/dialog/confirm-dialog";
import { Button } from "~/components/ouro/button/button";
import { Text } from "~/components/ouro/text/text";
import { BookOpen } from "lucide-react";
import { Collapsible } from "~/components/ouro/collapsible/collapsible";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Form } from "~/components/ouro/form/form";
import { useFormErrors } from "~/hooks/use-form-errors";
import { Link } from "~/components/ouro/link/link";
import { NativeSelect } from "~/components/ouro/select/native-select";
import { TextField } from "~/components/ouro/text-field/text-field";
import { toast } from "~/lib/ouro/toast";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { CookbookCoverArt } from "~/components/cookbook/CookbookCoverArt";
import { CoverProvenanceBadge } from "~/components/recipe/CoverProvenanceBadge";
import { useDockSuppressed } from "~/components/navigation";
import { ShareButton } from "~/components/ouro/share-button/share-button";
import {
  addRecipeToCookbook,
  asCompatibleCookbookD1Database,
  deleteCookbookWithTombstone,
  removeRecipeFromCookbook,
} from "~/lib/cookbook-membership-compat.server";
import { productActivationPendingWebResponse } from "~/lib/saved-recipe-cutover.server";
import { d1UnavailableWebResponse, retryD1Write } from "~/lib/d1-write-retry.server";
import { revalidateUnlessNetworkFailure, submitOrReportLostRequest } from "~/lib/network-failure";
import { useResendLostSubmission } from "~/hooks/use-resend-lost-submission";

export function meta({ data }: Route.MetaArgs) {
  if (!data) {
    return [
      { title: "Cookbook - Spoonjoy" },
      { name: "description", content: "Open this cookbook on Spoonjoy." },
    ];
  }

  const recipeLabel = `${data.cookbook.recipes.length} ${data.cookbook.recipes.length === 1 ? "recipe" : "recipes"}`;
  const description = `${data.cookbook.title} by ${data.cookbook.author.username} on Spoonjoy with ${recipeLabel}.`;

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
    { property: "og:image:type", content: "image/svg+xml" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: data.cookbook.title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: data.ogImageUrl },
    { tagName: "link", rel: "canonical", href: data.canonicalUrl },
  ];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const userId = await getUserId(request, context.cloudflare?.env);
  const { id } = params;

  const d1 = requestD1(context);
  const readInput = { cookbookId: id, viewerId: userId };
  const { cookbook, availableRecipes } = d1
    ? await readCookbookPageFromD1(d1, readInput)
    : await readCookbookPageWithPrisma(await getRequestDb(context), readInput);

  if (!cookbook) {
    throw new Response("Cookbook not found", { status: 404 });
  }

  // Check if user owns this cookbook
  const isOwner = userId !== null && cookbook.authorId === userId;

  const cookbookWithCovers = {
    ...cookbook,
    recipes: cookbook.recipes.map((item) => {
      const coverDisplay = getRecipeCoverDisplay(item.recipe, item.recipe.covers);
      return {
        ...item,
        recipe: {
          id: item.recipe.id,
          title: item.recipe.title,
          description: item.recipe.description,
          servings: item.recipe.servings,
          chef: item.recipe.chef,
          coverImageUrl: coverDisplay?.displayUrl ?? null,
          coverProvenanceLabel: coverDisplay?.provenanceLabel ?? null,
        },
      };
    }),
  };

  const publicOrigin = resolveIssuerOrigin(request.url, context.cloudflare?.env?.SPOONJOY_BASE_URL);
  return {
    cookbook: cookbookWithCovers,
    coverImageUrls: cookbookWithCovers.recipes.map((item) => item.recipe.coverImageUrl),
    canonicalUrl: absoluteUrlFromRequest(publicOrigin, `/cookbooks/${id}`),
    ogImageUrl: absoluteUrlFromRequest(publicOrigin, cookbookOgPath(id)),
    isOwner,
    availableRecipes,
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const formData = await request.formData();
  try {
    return await handleCookbookAction(request, params.id, context, userId, formData);
  } catch (error) {
    // The database was briefly unavailable: a retryable 503 with the intent, so the page shows it
    // where the cook acted (a rename keeps its editor open with the new title in it).
    const unavailable = d1UnavailableWebResponse(error, formData.get("intent"));
    if (unavailable) return unavailable;
    throw error;
  }
}

// The intents that leave the same result when applied twice: a rename sets a fixed title, and
// adding a recipe that is already in the cookbook keeps one copy. Only these are sent again when
// a submission got no answer (useResendLostSubmission); a delete or a removal is not.
const IDEMPOTENT_INTENTS = new Set(["updateTitle", "addRecipe"]);

export async function clientAction({ request, serverAction }: Route.ClientActionArgs) {
  const formData = await request.clone().formData();
  const intent = formData.get("intent");
  const name = typeof intent === "string" ? intent : null;
  // In the order they were sent, so the second request's body is the first one's.
  const resend = name !== null && IDEMPOTENT_INTENTS.has(name)
    ? Object.fromEntries([...formData].filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : null;
  return submitOrReportLostRequest(serverAction, { intent: name, resend });
}

export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return revalidateUnlessNetworkFailure(args, args.defaultShouldRevalidate);
}

async function handleCookbookAction(
  request: Request,
  id: string,
  context: AppLoadContext,
  userId: string,
  formData: FormData,
) {
  const intent = formData.get("intent");

  const database = await getRequestDb(context);

  // Verify ownership
  const cookbook = await database.cookbook.findUnique({
    where: { id },
    select: { authorId: true, title: true },
  });

  if (!cookbook) {
    throw new Response("Cookbook not found", { status: 404 });
  }

  if (cookbook.authorId !== userId) {
    throw new Response("Unauthorized", { status: 403 });
  }

  // Rename results carry their intent so the page can tell them from add/remove results: it
  // closes the title editor on success and shows the error in the editor on failure.
  if (intent === "updateTitle") {
    const title = formData.get("title")?.toString() || "";
    if (!title.trim()) {
      return data({ error: "Title is required", intent: "updateTitle" }, { status: 400 });
    }
    try {
      // Sets a fixed title, so it simply runs again after a transient D1 error.
      await retryD1Write({ scope: "cookbook.rename" }, () => database.cookbook.update({
        where: { id },
        data: { title: title.trim() },
      }));
      return data({ success: true, intent: "updateTitle" });
    } catch (error: any) {
      if (error.code === "P2002") {
        return data(
          { error: "You already have a cookbook with this title", intent: "updateTitle" },
          { status: 400 },
        );
      }
      const unavailable = d1UnavailableWebResponse(error, intent);
      if (unavailable) return unavailable;
      captureCookbookActionFailure(request, context, userId, "updateTitle", error);
      throw error;
    }
  }

  if (intent === "delete") {
    try {
      await deleteCookbookWithTombstone({
        database,
        nativeDatabase: asCompatibleCookbookD1Database(context.cloudflare?.env?.DB),
        accountId: userId,
        cookbookId: id,
        title: cookbook.title,
      });
    } catch (error) {
      const cutoverResponse = productActivationPendingWebResponse(error);
      if (cutoverResponse) {
        return cutoverResponse;
      }
      throw error;
    }
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
        const added = await addRecipeToCookbook({
          database,
          nativeDatabase: asCompatibleCookbookD1Database(context.cloudflare?.env?.DB),
          cookbookId: id,
          recipeId,
          userId,
        });

        // Fire-and-forget: notify the recipe owner when someone else saved their recipe.
        if (added) try {
          const { vapidEnv, postHogConfig, waitUntil } = getNotificationCtx(context);
          const vapid = getVapidConfig(vapidEnv);
          const notifyTask = notifyCookbookSaveOfMine(
            database,
            { recipeId, actorId: userId },
            { vapid, waitUntil, postHogConfig },
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
      } catch (error) {
        const cutoverResponse = productActivationPendingWebResponse(error);
        if (cutoverResponse) {
          return cutoverResponse;
        }
        const unavailable = d1UnavailableWebResponse(error, intent);
        if (unavailable) return unavailable;
        captureCookbookActionFailure(request, context, userId, "addRecipe", error);
        throw error;
      }
    }
  }

  if (intent === "removeRecipe") {
    const recipeInCookbookId = formData.get("recipeInCookbookId")?.toString();
    if (recipeInCookbookId) {
      try {
        await removeRecipeFromCookbook({
          database,
          nativeDatabase: asCompatibleCookbookD1Database(context.cloudflare?.env?.DB),
          cookbookId: id,
          membershipId: recipeInCookbookId,
        });
      } catch (error) {
        const cutoverResponse = productActivationPendingWebResponse(error);
        if (cutoverResponse) {
          return cutoverResponse;
        }
        throw error;
      }
      return data({ success: true });
    }
  }

  return null;
}

interface CookbookActionData {
  intent?: string;
  success?: boolean;
  error?: unknown;
  errorCode?: string;
  retryable?: boolean;
}

export default function CookbookDetail() {
  const { cookbook, isOwner, availableRecipes, canonicalUrl } = useLoaderData<typeof loader>();
  const actionData = useActionData() as CookbookActionData | null | undefined;
  const recipeImages = cookbook.recipes.map((item) => ({
    coverImageUrl: item.recipe.coverImageUrl,
    title: item.recipe.title,
    coverProvenanceLabel: item.recipe.coverProvenanceLabel,
  }));
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [showOwnerTools, setShowOwnerTools] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [recipeToRemove, setRecipeToRemove] = useState<string | null>(null);
  const [titleAnswer, setTitleAnswer] = useState<CookbookActionData>();
  const titleErrors = useFormErrors(
    typeof titleAnswer?.error === "string" ? { title: titleAnswer.error } : undefined,
    undefined,
    titleAnswer,
  );
  const submit = useSubmit();
  // A lost rename or add is sent once more before the page says Spoonjoy couldn't be reached.
  const resendingLostSubmission = useResendLostSubmission(actionData);
  // The title editor is a form, so it hides the dock like other edit forms (R-M3-2).
  useDockSuppressed(isEditingTitle);

  // A rename either closes the editor with a short confirmation (R-M3-3) or keeps it open with
  // the error. Each submission yields a new actionData object, so this runs once per result.
  useEffect(() => {
    if (resendingLostSubmission) return;
    // Saving, removing or deleting when the database was briefly unavailable: say so, so the cook
    // can try again.
    if (
      actionData?.intent !== "updateTitle" &&
      actionData?.retryable === true &&
      typeof actionData.error === "string"
    ) {
      toast(actionData.error, { tone: "destructive" });
      return;
    }
    if (actionData?.intent !== "updateTitle") return;
    if (typeof actionData.error === "string") {
      setTitleAnswer(actionData);
      return;
    }
    setTitleAnswer(undefined);
    setIsEditingTitle(false);
    toast("Cookbook renamed.", { tone: "success" });
  }, [actionData, resendingLostSubmission]);

  const openTitleEditor = () => {
    setTitleAnswer(undefined);
    setIsEditingTitle(true);
  };

  const closeTitleEditor = () => {
    setTitleAnswer(undefined);
    setIsEditingTitle(false);
  };

  return (
    <CookbookPage>
      {/* On a foldable held like a book, the cover sits on the left page and the contents on the right. */}
      <div className="mx-auto max-w-5xl" data-fold-book="">
        <div data-fold-page="left">
        <div className="mb-6 flex items-center justify-between gap-4 print:hidden">
          <Link href="/cookbooks" tone="secondary">
            ← Back to cookbooks
          </Link>
          <ShareButton
            variant="plain"
            url={canonicalUrl}
            title={cookbook.title}
            text={`${cookbook.title} by ${cookbook.author.username} on Spoonjoy.`}
          />
        </div>

        <div className="grid gap-8 border-b border-[var(--sj-border-strong)] pb-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-end">
          <PageHeader
            eyebrow="Cookbook"
            title={cookbook.title}
            size="lg"
            description={(
              <Text as="div" tone="muted" className="[overflow-wrap:anywhere]">
                By <strong className="font-medium text-[var(--sj-ink)]">{cookbook.author.username}</strong> ·{" "}
                <span>
                  {cookbook.recipes.length} {cookbook.recipes.length === 1 ? "recipe" : "recipes"}
                </span>
              </Text>
            )}
          />
          <CookbookCoverArt
            title={cookbook.title}
            recipeCount={cookbook.recipes.length}
            recipeImages={recipeImages}
            className="mx-auto w-full max-w-56 lg:max-w-none"
            priority
            // The page's own <h1> (in CookbookHeader, just above) already is this exact
            // title, and it renders before the "Recipes" <h2> below — a second <h3> here
            // would skip past that <h2> and trip heading-order.
            titleAsHeading={false}
          />
        </div>
        </div>

        {isOwner && (
          <ConfirmDialog
            open={showDeleteDialog}
            onOpenChange={() => setShowDeleteDialog(false)}
            onConfirm={() => {
              setShowDeleteDialog(false);
              // Through the router, like the page's other actions: it follows the action's redirect
              // to /cookbooks instead of relying on a native document submit.
              submit({ intent: "delete" }, { method: "post" });
            }}
            title="Delete this cookbook?"
            description="This will permanently delete the cookbook and remove all recipe associations. The recipes themselves will not be deleted."
            confirmLabel="Delete it"
            cancelLabel="Keep it"
            tone="destructive"
          />
        )}

        {cookbook.recipes.length === 0 ? (
          <Empty headingLevel={2} align="start" description={<>
            <Text tone="muted" className="mb-6">
              {isOwner ? "Add recipes to your cookbook using the owner tools below." : "This cookbook is empty."}
            </Text>
          </>} title="No recipes yet" />
        ) : (
          <section aria-labelledby="cookbook-recipes-heading" className="mt-10">
            <div className="max-w-3xl">
              <p className="sj-eyebrow">Contents</p>
              <h2 id="cookbook-recipes-heading" className="font-sj-display mt-2 text-4xl/10 font-semibold text-[var(--sj-ink)]">
                Recipes
              </h2>
            </div>

            <ItemGroup aria-labelledby="cookbook-recipes-heading" ordered variant="divided" className="@container mt-6 [overflow-wrap:anywhere]">
              {cookbook.recipes.map((item, index) => (
                <Item
                  key={item.id}
                  href={`/recipes/${item.recipe.id}`}
                  title={item.recipe.title}
                  description={
                    <>
                      <Text lines={2}>{item.recipe.description ?? `By ${chefDisplayName(item.recipe.chef.username)}`}</Text>
                      {formatServingsLabel(item.recipe.servings) ? <Text size="sm">{formatServingsLabel(item.recipe.servings)}</Text> : null}
                    </>
                  }
                  media={item.recipe.coverImageUrl ? <img src={item.recipe.coverImageUrl} alt="" {...listImageProps(index, { prioritizeFirst: false })} /> : <BookOpen />}
                  mediaSize={item.recipe.coverImageUrl ? "md" : "icon"}
                  actions={item.recipe.coverProvenanceLabel ? <CoverProvenanceBadge label={item.recipe.coverProvenanceLabel} /> : undefined}
                />
              ))}
            </ItemGroup>
          </section>
        )}

        {isOwner ? (
          <div className="mt-12 print:hidden">
            <Collapsible title="Owner tools" open={showOwnerTools} onOpenChange={setShowOwnerTools}>
              <div id="cookbook-owner-tools" className="py-6">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div>
                    <h3 className="font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">Cookbook details</h3>
                    <p className="mt-1 max-w-2xl text-sm/6 text-[var(--sj-ink-soft)]">
                      Private controls for maintaining this collection. They stay out of the cookbook contents above.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <Button
                      onClick={openTitleEditor}
                      variant="outline" tone="secondary"
                      size="sm"
                    >
                      Edit title
                    </Button>
                    <Button
                      type="button"
                      variant="soft" tone="destructive"
                      aria-label="Delete cookbook"
                      onClick={() => setShowDeleteDialog(true)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {isEditingTitle ? (
                  <div className="mt-5">
                    <Form
                      method="post"
                      errors={titleErrors}
                      render={<RouterForm />}
                      className="flex flex-col gap-3 sm:flex-row sm:items-end"
                    >
                      <input type="hidden" name="intent" value="updateTitle" />
                      <TextField
                        label="Cookbook title"
                        name="title"
                        defaultValue={cookbook.title}
                        required
                        autoFocus
                        className="min-w-0 flex-1"
                      />
                      <Button type="submit">
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="outline" tone="secondary"
                        onClick={closeTitleEditor}
                      >
                        Cancel
                      </Button>
                    </Form>
                  </div>
                ) : null}

                {availableRecipes.length > 0 ? (
                  <div className="mt-6 border-t border-[var(--sj-border)] pt-6">
                    <h3 className="font-sj-display text-2xl/7 font-semibold text-[var(--sj-ink)]">Add recipe to cookbook</h3>
                    <Form method="post" render={<RouterForm />} className="mt-3 flex flex-col gap-4 sm:flex-row">
                      <input type="hidden" name="intent" value="addRecipe" />
                      <NativeSelect
                        label="Recipe"
                        name="recipeId"
                        required
                        placeholder="Select a recipe..."
                        options={availableRecipes.map((recipe) => ({ value: recipe.id, label: recipe.title }))}
                        className="min-w-0 flex-1"
                      />
                      <Button type="submit" className="sm:self-end">
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
                            variant="soft" tone="destructive"
                            size="sm"
                            className="w-full sm:w-auto"
                            aria-label={`Remove ${item.recipe.title} from cookbook`}
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
            </Collapsible>
          </div>
        ) : null}
      </div>

      {/* Remove recipe confirmation dialog */}
      <ConfirmDialog
        open={!!recipeToRemove}
        onOpenChange={() => setRecipeToRemove(null)}
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
        tone="destructive"
      />
    </CookbookPage>
  );
}
