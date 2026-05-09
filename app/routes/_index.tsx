import type { Route } from "./+types/_index";
import { Form, useLoaderData, useLocation } from "react-router";
import { Settings, ChefHat } from "lucide-react";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";
import { Button } from "~/components/ui/button";
import { Link } from "~/components/ui/link";
import { Heading, Subheading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { Avatar } from "~/components/ui/avatar";
import { CookbookCard } from "~/components/pantry/CookbookCard";
import { getDisplayRecipeImageUrl } from "~/lib/recipe-image";

const DEFAULT_CHEF_AVATAR = "/images/chef-rj.png";

type KitchenTab = "recipes" | "cookbooks";
type KitchenUserWhere = { id: string } | { username: string };

function normalizeTab(value: string | null): KitchenTab {
  return value === "cookbooks" ? "cookbooks" : "recipes";
}

function tabHref(currentSearch: string, tab: KitchenTab): string {
  const params = new URLSearchParams(currentSearch);
  params.set("tab", tab);
  return `/?${params.toString()}`;
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Spoonjoy - Kitchen" },
    { name: "description", content: "Open your personal kitchen and cookbook collection" },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const currentUserId = await getUserId(request);
  const url = new URL(request.url);
  const tab = normalizeTab(url.searchParams.get("tab"));
  const requestedChefId = url.searchParams.get("chefId");
  const requestedChefUsername = url.searchParams.get("chef");
  const hasExplicitChefRequest = Boolean(requestedChefId || requestedChefUsername);

  if (!currentUserId && !hasExplicitChefRequest) {
    return {
      tab,
      isOwner: false,
      viewer: null,
      kitchenUser: null,
      recipes: [],
      cookbooks: [],
    };
  }

  const database = await getRequestDb(context);

  const viewer = currentUserId
    ? await database.user.findUnique({
        where: { id: currentUserId },
        select: {
          id: true,
          username: true,
          email: true,
          photoUrl: true,
        },
      })
    : null;

  const kitchenUserWhere: KitchenUserWhere = requestedChefId
    ? { id: requestedChefId }
    : requestedChefUsername
      ? { username: requestedChefUsername }
      : { id: currentUserId as string };

  const kitchenUser = await database.user.findUnique({
    where: kitchenUserWhere,
    select: {
      id: true,
      username: true,
      photoUrl: true,
    },
  });

  if (!kitchenUser && hasExplicitChefRequest) {
    throw new Response("Kitchen not found", { status: 404 });
  }

  if (!kitchenUser) {
    return {
      tab,
      isOwner: false,
      viewer,
      kitchenUser: null,
      recipes: [],
      cookbooks: [],
    };
  }

  const [recipes, cookbooks] = await Promise.all([
    database.recipe.findMany({
      where: {
        chefId: kitchenUser.id,
        deletedAt: null,
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
        title: true,
        description: true,
        imageUrl: true,
        servings: true,
      },
    }),
    database.cookbook.findMany({
      where: {
        authorId: kitchenUser.id,
      },
      orderBy: {
        updatedAt: "desc",
      },
      include: {
        _count: {
          select: { recipes: true },
        },
        recipes: {
          take: 4,
          orderBy: { createdAt: "desc" },
          include: {
            recipe: {
              select: {
                imageUrl: true,
                title: true,
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    tab,
    viewer,
    kitchenUser,
    isOwner: viewer?.id === kitchenUser.id,
    recipes,
    cookbooks,
  };
}

export default function Index() {
  const { tab, kitchenUser, isOwner, recipes, cookbooks } = useLoaderData<typeof loader>();
  const location = useLocation();

  if (!kitchenUser) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 sm:py-20">
        <div className="rounded-sm border border-zinc-300 bg-stone-50 p-8 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <Heading level={1} className="font-serif tracking-tight">Spoonjoy Kitchen</Heading>
          <Text className="mt-3 text-zinc-600 dark:text-zinc-300">
            Open your personal kitchen to collect recipes and compose cookbooks.
          </Text>
          <div className="mt-6 flex gap-3">
            <Button href="/signup">Sign Up</Button>
            <Button href="/login" plain>Log In</Button>
          </div>
        </div>
      </div>
    );
  }

  const heading = isOwner ? "My Kitchen" : `${kitchenUser.username}'s Kitchen`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <section className="rounded-sm border border-zinc-300 bg-stone-50/70 p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/70 sm:p-6">
        <header className="flex flex-col gap-4 border-b border-zinc-300 pb-4 dark:border-zinc-700 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Avatar
              src={kitchenUser.photoUrl ?? DEFAULT_CHEF_AVATAR}
              alt={kitchenUser.username}
              className="size-14 border border-zinc-300 dark:border-zinc-700"
            />
            <div>
              <Heading level={1} className="font-serif text-3xl/9 tracking-tight">{heading}</Heading>
              <Text className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"} and {cookbooks.length} {cookbooks.length === 1 ? "cookbook" : "cookbooks"}
              </Text>
            </div>
          </div>

          {isOwner ? (
            <div className="flex items-center gap-2">
              <Button href="/account/settings" plain aria-label="Open settings">
                <Settings data-slot="icon" className="size-4" />
                Settings
              </Button>
              <Form method="post" action="/logout">
                <Button type="submit" variant="destructive">Logout</Button>
              </Form>
            </div>
          ) : null}
        </header>

        <div className="mt-5">
          <div role="tablist" aria-label="Kitchen sections" className="mb-4 flex items-center gap-2 border-b border-zinc-300 pb-2 dark:border-zinc-700">
            <Link
              href={tabHref(location.search, "recipes")}
              role="tab"
              aria-selected={tab === "recipes"}
              className={[
                "rounded-sm border px-3 py-1.5 text-sm font-medium no-underline",
                tab === "recipes"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900"
                  : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
              ].join(" ")}
            >
              Recipes
            </Link>
            <Link
              href={tabHref(location.search, "cookbooks")}
              role="tab"
              aria-selected={tab === "cookbooks"}
              className={[
                "rounded-sm border px-3 py-1.5 text-sm font-medium no-underline",
                tab === "cookbooks"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900"
                  : "border-zinc-300 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
              ].join(" ")}
            >
              Cookbooks
            </Link>
          </div>

          <section role="tabpanel" aria-label="Recipes" hidden={tab !== "recipes"}>
            <div className="mb-4 flex items-center justify-between">
              <Subheading level={2} className="font-serif text-xl/7">Recipes</Subheading>
              {isOwner ? <Button href="/recipes/new">New Recipe</Button> : null}
            </div>

            {recipes.length === 0 ? (
              <div className="rounded-sm border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
                <Text className="text-zinc-600 dark:text-zinc-300">
                  {isOwner ? "No recipes yet. Add your first recipe to start your kitchen." : "No public recipes yet."}
                </Text>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {recipes.map((recipe) => {
                  const displayImageUrl = getDisplayRecipeImageUrl(recipe.imageUrl);
                  return (
                    <Link
                      key={recipe.id}
                      href={`/recipes/${recipe.id}`}
                      className="block overflow-hidden rounded-sm border border-zinc-300 bg-white no-underline transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                    >
                      <div className="flex h-36 items-center justify-center border-b border-zinc-300 bg-stone-100 dark:border-zinc-700 dark:bg-zinc-800">
                        {displayImageUrl ? (
                          <img src={displayImageUrl} alt={recipe.title} className="h-full w-full object-cover" />
                        ) : (
                          <ChefHat className="size-8 text-zinc-400" aria-hidden="true" />
                        )}
                      </div>
                      <div className="p-3">
                        <Subheading level={3} className="line-clamp-1">{recipe.title}</Subheading>
                        {recipe.description ? (
                          <Text className="mt-1 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">{recipe.description}</Text>
                        ) : null}
                        {recipe.servings ? <Text className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Serves {recipe.servings}</Text> : null}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section role="tabpanel" aria-label="Cookbooks" hidden={tab !== "cookbooks"}>
            <div className="mb-4 flex items-center justify-between">
              <Subheading level={2} className="font-serif text-xl/7">Cookbooks</Subheading>
              {isOwner ? <Button href="/cookbooks/new">New Cookbook</Button> : null}
            </div>

            {cookbooks.length === 0 ? (
              <div className="rounded-sm border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-700 dark:bg-zinc-900">
                <Text className="text-zinc-600 dark:text-zinc-300">
                  {isOwner ? "No cookbooks yet. Create one to organize your recipes." : "No public cookbooks yet."}
                </Text>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cookbooks.map((cookbook) => (
                  <CookbookCard
                    key={cookbook.id}
                    id={cookbook.id}
                    title={cookbook.title}
                    recipeCount={cookbook._count.recipes}
                    recipeImages={cookbook.recipes.map((item) => ({
                      imageUrl: item.recipe.imageUrl,
                      title: item.recipe.title,
                    }))}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
