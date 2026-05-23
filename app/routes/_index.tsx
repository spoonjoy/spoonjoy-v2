import type { Route } from "./+types/_index";
import { Form, useLoaderData, useLocation } from "react-router";
import { BookOpen, ChefHat, Search as SearchIcon, Settings, Sparkles } from "lucide-react";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";
import { Button } from "~/components/ui/button";
import { Link } from "~/components/ui/link";
import { Heading, Subheading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { Avatar } from "~/components/ui/avatar";
import { CookbookCard } from "~/components/pantry/CookbookCard";
import { getRecipeCoverImageUrl } from "~/lib/recipe-cover.server";

const DEFAULT_CHEF_AVATAR = "/images/chef-rj.png";
const LANDING_FOOD_PHOTOS = [
  {
    src: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=1200&q=85",
    alt: "Margherita pizza with basil",
  },
  {
    src: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=1200&q=85",
    alt: "Cooked pasta with tomato sauce",
  },
  {
    src: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1200&q=85",
    alt: "Dinner table with shared dishes",
  },
];

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
        servings: true,
        covers: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        },
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
                title: true,
                covers: {
                  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const recipesWithCover = recipes.map(({ covers, ...rest }) => ({
    ...rest,
    coverImageUrl: getRecipeCoverImageUrl(rest, covers),
  }));

  const cookbooksWithCover = cookbooks.map(({ recipes: cookbookRecipes, ...cookbook }) => ({
    ...cookbook,
    recipes: cookbookRecipes.map((item) => ({
      ...item,
      recipe: {
        title: item.recipe.title,
        coverImageUrl: getRecipeCoverImageUrl({ id: item.recipeId, title: item.recipe.title }, item.recipe.covers),
      },
    })),
  }));

  return {
    tab,
    viewer,
    kitchenUser,
    isOwner: viewer?.id === kitchenUser.id,
    recipes: recipesWithCover,
    cookbooks: cookbooksWithCover,
  };
}

export default function Index() {
  const { tab, kitchenUser, isOwner, recipes, cookbooks } = useLoaderData<typeof loader>();
  const location = useLocation();

  if (!kitchenUser) {
    return (
      <div className="sj-page">
        <section className="mx-auto grid min-h-[calc(100svh-3.5rem)] max-w-[96rem] lg:grid-cols-[minmax(0,0.78fr)_minmax(38rem,1.22fr)]">
          <div className="flex flex-col justify-center px-5 pb-28 pt-12 sm:px-8 lg:px-12 lg:py-12">
            <div className="max-w-2xl">
              <div className="sj-eyebrow">
                <Sparkles className="size-3.5" aria-hidden="true" />
                Family recipe OS
              </div>
              <Heading level={1} className="mt-6 max-w-2xl text-5xl/13 tracking-[-0.04em] sm:text-7xl/18">
                Your food should look as good as it tastes.
              </Heading>
              <Text className="mt-6 max-w-xl text-lg/8">
                Spoonjoy is a photo-first kitchen for the recipes you actually cook, the notes you learn by doing, and the cookbooks that grow out of real meals.
              </Text>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/signup"
                  className="font-sj-ui inline-flex items-center justify-center rounded-[var(--sj-radius-control)] border border-[var(--sj-ink)] bg-[var(--sj-ink)] px-4 py-2.5 text-sm font-semibold text-[var(--sj-paper)] no-underline transition hover:-translate-y-0.5 hover:border-[var(--sj-tomato)] hover:bg-[var(--sj-tomato)]"
                >
                  Start Your Kitchen
                </Link>
                <Link
                  href="/login"
                  className="font-sj-ui inline-flex items-center justify-center rounded-[var(--sj-radius-control)] border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] px-4 py-2.5 text-sm font-semibold text-[var(--sj-ink)] no-underline transition hover:-translate-y-0.5 hover:bg-[var(--sj-flour)]"
                >
                  Log In
                </Link>
                <Link
                  href="/search"
                  className="font-sj-ui inline-flex items-center justify-center gap-2 rounded-[var(--sj-radius-control)] border border-[var(--sj-border-strong)] bg-transparent px-4 py-2.5 text-sm font-semibold text-[var(--sj-ink)] no-underline transition hover:-translate-y-0.5 hover:border-[var(--sj-herb)] hover:bg-[color-mix(in_srgb,var(--sj-herb)_10%,transparent)]"
                >
                  <SearchIcon className="size-4" aria-hidden="true" />
                  Search Recipes
                </Link>
              </div>
            </div>

            <dl className="mt-12 hidden gap-5 border-t border-[var(--sj-border)] pt-6 sm:grid sm:grid-cols-3">
              {[
                ["Collect", "Write recipes with the context future-you needs."],
                ["Cook", "Log the dishes you made and what changed."],
                ["Share", "Open a kitchen without turning dinner into social media."],
              ].map(([title, copy]) => (
                <div key={title} className="border-l border-[var(--sj-border)] pl-4">
                  <dt className="font-sj-ui text-sm font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink)]">{title}</dt>
                  <dd className="mt-2 text-sm/6 text-[var(--sj-ink-soft)]">{copy}</dd>
                </div>
              ))}
            </dl>
          </div>

          <aside className="sj-dark-canvas relative mt-36 min-h-[42rem] overflow-hidden lg:mt-0 lg:min-h-[calc(100svh-3.5rem)]">
            <div className="grid h-full min-h-[42rem] grid-cols-6 grid-rows-[1fr_0.72fr] gap-3 p-3 sm:gap-4 sm:p-5 lg:p-8">
              <figure className="sj-food-photo col-span-6 rounded-[var(--sj-radius-hero)]">
                <img src={LANDING_FOOD_PHOTOS[0].src} alt={LANDING_FOOD_PHOTOS[0].alt} />
                <figcaption className="absolute inset-x-0 bottom-0 z-10 p-5 sm:p-7">
                  <p className="sj-kicker-dark">Phone to editorial</p>
                  <h2 className="font-sj-display mt-4 max-w-xl text-4xl/10 font-semibold tracking-[-0.03em] text-[#fff7e8] sm:text-6xl/15">
                    Classic Margherita Pizza
                  </h2>
                  <p className="sj-dark-muted mt-3 max-w-lg text-base/7">
                    Same plate, same table, same dinner. Just lit like it deserves to be remembered.
                  </p>
                </figcaption>
              </figure>

              <figure className="sj-photo-tile col-span-3 rounded-[var(--sj-radius-photo)]">
                <img src={LANDING_FOOD_PHOTOS[1].src} alt={LANDING_FOOD_PHOTOS[1].alt} />
                <figcaption className="absolute inset-x-0 bottom-0 z-10 p-4">
                  <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.14em] text-[#fff7e8]">Cookbooks</p>
                  <p className="sj-dark-muted mt-1 text-sm/5">Collections with memory.</p>
                </figcaption>
              </figure>

              <figure className="sj-photo-tile col-span-3 rounded-[var(--sj-radius-photo)]">
                <img src={LANDING_FOOD_PHOTOS[2].src} alt={LANDING_FOOD_PHOTOS[2].alt} />
                <figcaption className="absolute inset-x-0 bottom-0 z-10 p-4">
                  <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.14em] text-[#fff7e8]">Personal kitchens</p>
                  <p className="sj-dark-muted mt-1 text-sm/5">A home for every chef.</p>
                </figcaption>
              </figure>
            </div>
          </aside>
        </section>
      </div>
    );
  }

  const heading = isOwner ? "My Kitchen" : `${kitchenUser.username}'s Kitchen`;

  return (
    <div className="sj-page px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <section className="mx-auto max-w-7xl">
        <header className="grid gap-5 border-b border-[var(--sj-border)] pb-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="flex items-center gap-3">
            <Avatar
              src={kitchenUser.photoUrl ?? DEFAULT_CHEF_AVATAR}
              alt={kitchenUser.username}
              className="size-16 border border-[var(--sj-border)] shadow-[var(--sj-shadow-soft)]"
            />
            <div>
              <p className="sj-eyebrow">Kitchen</p>
              <Heading level={1} className="mt-2 text-4xl/11 tracking-[-0.04em]">{heading}</Heading>
              <Text className="mt-1 text-sm">
                {recipes.length} {recipes.length === 1 ? "recipe" : "recipes"} and {cookbooks.length} {cookbooks.length === 1 ? "cookbook" : "cookbooks"}
              </Text>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button href="/search" plain>
              <SearchIcon data-slot="icon" className="size-4" />
              Search
            </Button>
            {isOwner ? (
              <>
                <Button href="/account/settings" plain aria-label="Open settings">
                  <Settings data-slot="icon" className="size-4" />
                  Settings
                </Button>
                <Form method="post" action="/logout">
                  <Button type="submit" variant="destructive">Logout</Button>
                </Form>
              </>
            ) : null}
          </div>
        </header>

        <div className="mt-6">
          <div role="tablist" aria-label="Kitchen sections" className="mb-7 flex items-center gap-2 border-b border-[var(--sj-border)] pb-3">
            <Link
              href={tabHref(location.search, "recipes")}
              role="tab"
              aria-selected={tab === "recipes"}
              className={[
                "font-sj-ui rounded-[var(--sj-radius-control)] border px-3 py-1.5 text-sm font-semibold no-underline transition",
                tab === "recipes"
                  ? "border-[var(--sj-ink)] bg-[var(--sj-ink)] text-[var(--sj-paper)]"
                  : "border-[var(--sj-border)] bg-[var(--sj-panel-solid)] text-[var(--sj-ink-soft)] hover:bg-[var(--sj-flour)]",
              ].join(" ")}
            >
              Recipes
            </Link>
            <Link
              href={tabHref(location.search, "cookbooks")}
              role="tab"
              aria-selected={tab === "cookbooks"}
              className={[
                "font-sj-ui rounded-[var(--sj-radius-control)] border px-3 py-1.5 text-sm font-semibold no-underline transition",
                tab === "cookbooks"
                  ? "border-[var(--sj-ink)] bg-[var(--sj-ink)] text-[var(--sj-paper)]"
                  : "border-[var(--sj-border)] bg-[var(--sj-panel-solid)] text-[var(--sj-ink-soft)] hover:bg-[var(--sj-flour)]",
              ].join(" ")}
            >
              Cookbooks
            </Link>
          </div>

          <section role="tabpanel" aria-label="Recipes" hidden={tab !== "recipes"}>
            <div className="mb-4 flex items-center justify-between">
              <Subheading level={2} className="text-2xl/8">Recipes</Subheading>
              {isOwner ? <Button href="/recipes/new">New Recipe</Button> : null}
            </div>

            {recipes.length === 0 ? (
              isOwner ? (
                <div className="rounded-[var(--sj-radius-hero)] border border-dashed border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-flour)_58%,transparent)] p-8 text-center">
                  <ChefHat className="mx-auto size-8 text-[var(--sj-brass)]" aria-hidden="true" />
                  <Subheading level={3} className="mt-3 text-2xl/8">Start your recipe box</Subheading>
                  <Text className="mx-auto mt-2 max-w-xl">
                    Capture the dish you make most often, the family classic everyone asks about, or the weeknight save you never want to lose.
                  </Text>
                  <div className="mt-5">
                    <Button href="/recipes/new">Create First Recipe</Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-[var(--sj-radius-hero)] border border-dashed border-[var(--sj-border-strong)] bg-[var(--sj-panel-solid)] p-8 text-center">
                  <Text>No public recipes yet.</Text>
                </div>
              )
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {recipes.map((recipe) => {
                  const displayImageUrl = recipe.coverImageUrl && recipe.coverImageUrl.length > 0 ? recipe.coverImageUrl : undefined;
                  return (
                    <Link
                      key={recipe.id}
                      href={`/recipes/${recipe.id}`}
                      className="group block no-underline"
                    >
                      <div className="sj-photo-tile flex aspect-[4/5] items-center justify-center rounded-[var(--sj-radius-photo)]">
                        {displayImageUrl ? (
                          <img src={displayImageUrl} alt={recipe.title} className="h-full w-full object-cover" />
                        ) : (
                          <ChefHat className="size-8 text-[#fff7e8]" aria-hidden="true" />
                        )}
                        <div className="absolute inset-x-0 bottom-0 z-10 p-4">
                          <h3 className="font-sj-display line-clamp-2 text-2xl/8 font-semibold tracking-[-0.02em] text-[#fff7e8] transition group-hover:text-[#ffe0b0]">{recipe.title}</h3>
                          {recipe.description ? (
                            <p className="mt-2 line-clamp-2 text-sm/5 text-white/72">{recipe.description}</p>
                          ) : null}
                          {recipe.servings ? <p className="font-sj-ui mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-white/70">Serves {recipe.servings}</p> : null}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          <section role="tabpanel" aria-label="Cookbooks" hidden={tab !== "cookbooks"}>
            <div className="mb-4 flex items-center justify-between">
              <Subheading level={2} className="text-2xl/8">Cookbooks</Subheading>
              {isOwner ? <Button href="/cookbooks/new">New Cookbook</Button> : null}
            </div>

            {cookbooks.length === 0 ? (
              isOwner ? (
                <div className="rounded-[var(--sj-radius-hero)] border border-dashed border-[var(--sj-herb)] bg-[color-mix(in_srgb,var(--sj-mint)_50%,transparent)] p-8 text-center">
                  <BookOpen className="mx-auto size-8 text-[var(--sj-herb)]" aria-hidden="true" />
                  <Subheading level={3} className="mt-3 text-2xl/8">Build your first cookbook</Subheading>
                  <Text className="mx-auto mt-2 max-w-xl">
                    Group recipes into a holiday menu, a weeknight rotation, or a family collection that grows with every good meal.
                  </Text>
                  <div className="mt-5">
                    <Button href="/cookbooks/new">Create First Cookbook</Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-[var(--sj-radius-hero)] border border-dashed border-[var(--sj-border-strong)] bg-[var(--sj-panel-solid)] p-8 text-center">
                  <Text>No public cookbooks yet.</Text>
                </div>
              )
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cookbooks.map((cookbook) => (
                  <CookbookCard
                    key={cookbook.id}
                    id={cookbook.id}
                    title={cookbook.title}
                    recipeCount={cookbook._count.recipes}
                    recipeImages={cookbook.recipes.map((item) => ({
                      coverImageUrl: item.recipe.coverImageUrl,
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
