import type { Route } from "./+types/_index";
import { Form, useLoaderData, useLocation } from "react-router";
import { BookOpen, ChefHat, Settings, Sparkles, Users } from "lucide-react";
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
    { title: "Spoonjoy - Recipe Kitchens & Cookbooks" },
    { name: "description", content: "Collect family recipes, shape them into cookbooks, and share a personal kitchen." },
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
      <div className="relative isolate overflow-hidden bg-[radial-gradient(circle_at_top_left,_#fef3c7,_transparent_36%),linear-gradient(135deg,_#fff7ed_0%,_#fafaf9_45%,_#ecfccb_100%)] px-4 py-10 dark:bg-[radial-gradient(circle_at_top_left,_rgba(120,53,15,0.36),_transparent_36%),linear-gradient(135deg,_#1c1917_0%,_#18181b_54%,_#102018_100%)] sm:py-16">
        <div className="pointer-events-none absolute left-1/2 top-8 -z-10 h-72 w-72 -translate-x-1/2 rounded-full border border-amber-300/50 bg-white/20 blur-3xl dark:border-amber-800/40 dark:bg-amber-950/20" aria-hidden="true" />
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <section className="rounded-sm border border-amber-200/80 bg-white/78 p-6 shadow-sm backdrop-blur dark:border-amber-900/40 dark:bg-zinc-950/72 sm:p-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-amber-900 dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-200">
              <Sparkles className="size-3.5" aria-hidden="true" />
              Family recipe OS
            </div>
            <Heading level={1} className="mt-5 max-w-3xl font-serif text-3xl/9 tracking-tight text-zinc-950 dark:text-zinc-50 sm:text-6xl/16">
              Recipes, cookbooks, and kitchen memory in one warm place.
            </Heading>
            <Text className="mt-5 max-w-2xl text-base/7 text-zinc-700 dark:text-zinc-300">
              Spoonjoy helps you collect the food you actually cook, organize it into living cookbooks, and share a kitchen that feels personal before it feels technical.
            </Text>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="inline-flex items-center justify-center rounded-sm border border-amber-950 bg-amber-950 px-4 py-2.5 text-sm font-semibold text-white no-underline transition hover:bg-amber-900 dark:border-amber-200 dark:bg-amber-200 dark:text-zinc-950 dark:hover:bg-amber-100"
              >
                Start Your Kitchen
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-sm border border-amber-300 bg-white/50 px-4 py-2.5 text-sm font-semibold text-amber-950 no-underline transition hover:bg-amber-100 dark:border-amber-800 dark:bg-zinc-950/40 dark:text-amber-100 dark:hover:bg-amber-950/50"
              >
                Log In
              </Link>
            </div>
            <dl className="mt-8 grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-sm border border-amber-200 bg-amber-50/80 p-2.5 dark:border-amber-900/50 dark:bg-amber-950/20 sm:p-3">
                <dt className="font-semibold text-zinc-950 dark:text-zinc-100">Collect</dt>
                <dd className="mt-0.5 text-xs/5 text-zinc-600 dark:text-zinc-300 sm:mt-1 sm:text-sm/6">Write recipes with the context future-you needs.</dd>
              </div>
              <div className="rounded-sm border border-lime-200 bg-lime-50/80 p-2.5 dark:border-lime-900/50 dark:bg-lime-950/20 sm:p-3">
                <dt className="font-semibold text-zinc-950 dark:text-zinc-100">Compose</dt>
                <dd className="mt-0.5 text-xs/5 text-zinc-600 dark:text-zinc-300 sm:mt-1 sm:text-sm/6">Turn weeknights, holidays, and experiments into cookbooks.</dd>
              </div>
              <div className="rounded-sm border border-stone-200 bg-stone-50/90 p-2.5 dark:border-zinc-800 dark:bg-zinc-900/70 sm:p-3">
                <dt className="font-semibold text-zinc-950 dark:text-zinc-100">Share</dt>
                <dd className="mt-0.5 text-xs/5 text-zinc-600 dark:text-zinc-300 sm:mt-1 sm:text-sm/6">Open a kitchen page without turning dinner into social media.</dd>
              </div>
            </dl>
          </section>

          <aside className="relative mt-28 rounded-sm border border-zinc-300 bg-zinc-950 p-4 text-stone-50 shadow-2xl dark:border-zinc-700 lg:mt-0">
            <div className="absolute -right-3 -top-3 rounded-sm border border-amber-200 bg-amber-100 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-950 shadow-sm dark:border-amber-700 dark:bg-amber-900 dark:text-amber-100">
              Tonight
            </div>
            <div className="rounded-sm border border-white/10 bg-[linear-gradient(160deg,_rgba(255,255,255,0.16),_rgba(255,255,255,0.04))] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">Recipe card</p>
              <h2 className="mt-3 font-serif text-3xl/9 font-semibold text-stone-50">Sunday Tomato Sauce</h2>
              <Text className="mt-3 text-sm/6 text-stone-300">
                Nonna's margin notes, simmer times, and the version that finally tasted like the story.
              </Text>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-sm bg-white/10 p-3">
                  <span className="block text-lg font-semibold text-white">6</span>
                  servings
                </div>
                <div className="rounded-sm bg-white/10 p-3">
                  <span className="block text-lg font-semibold text-white">2h</span>
                  simmer
                </div>
                <div className="rounded-sm bg-white/10 p-3">
                  <span className="block text-lg font-semibold text-white">3</span>
                  notes
                </div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                { icon: ChefHat, title: "Personal kitchens", copy: "A home for every chef." },
                { icon: BookOpen, title: "Cookbooks", copy: "Collections with memory." },
                { icon: Users, title: "Family-ready", copy: "Clear enough for everyone." },
              ].map((item) => (
                <div key={item.title} className="rounded-sm border border-white/10 bg-white/[0.06] p-3">
                  <item.icon className="size-4 text-amber-200" aria-hidden="true" />
                  <p className="mt-3 text-sm font-semibold text-white">{item.title}</p>
                  <p className="mt-1 text-xs/5 text-stone-300">{item.copy}</p>
                </div>
              ))}
            </div>
          </aside>
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
