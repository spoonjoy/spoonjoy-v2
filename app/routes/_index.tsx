import type { Route } from "./+types/_index";
import { Form, useLoaderData, useLocation } from "react-router";
import { BookOpen, ChefHat, Search as SearchIcon, Settings, Sparkles, Users } from "lucide-react";
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
      <div className="sj-page px-4 py-10 sm:py-16">
        <div className="pointer-events-none absolute left-1/2 top-8 -z-10 h-72 w-72 -translate-x-1/2 rounded-full border border-amber-300/50 bg-white/20 blur-3xl dark:border-amber-800/40 dark:bg-amber-950/20" aria-hidden="true" />
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <section className="sj-panel rounded-[2rem] p-6 sm:p-8">
            <div className="sj-eyebrow">
              <Sparkles className="size-3.5" aria-hidden="true" />
              Family recipe OS
            </div>
            <Heading level={1} className="mt-5 max-w-3xl text-4xl/11 tracking-[-0.04em] sm:text-7xl/18">
              Recipes, cookbooks, and kitchen memory in one warm place.
            </Heading>
            <Text className="mt-5 max-w-2xl text-base/7">
              Spoonjoy helps you collect the food you actually cook, organize it into living cookbooks, and share a kitchen that feels personal before it feels technical.
            </Text>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/signup"
                className="font-sj-ui inline-flex items-center justify-center rounded-full border border-[var(--sj-ink)] bg-[var(--sj-ink)] px-4 py-2.5 text-sm font-semibold text-[var(--sj-paper)] no-underline transition hover:-translate-y-0.5 hover:border-[var(--sj-tomato)] hover:bg-[var(--sj-tomato)]"
              >
                Start Your Kitchen
              </Link>
              <Link
                href="/login"
                className="font-sj-ui inline-flex items-center justify-center rounded-full border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] px-4 py-2.5 text-sm font-semibold text-[var(--sj-ink)] no-underline transition hover:-translate-y-0.5 hover:bg-[var(--sj-flour)]"
              >
                Log In
              </Link>
              <Link
                href="/search"
                className="font-sj-ui inline-flex items-center justify-center gap-2 rounded-full border border-[var(--sj-herb)] bg-[color-mix(in_srgb,var(--sj-herb)_12%,var(--sj-panel-solid))] px-4 py-2.5 text-sm font-semibold text-[var(--sj-ink)] no-underline transition hover:-translate-y-0.5 hover:bg-[color-mix(in_srgb,var(--sj-herb)_20%,var(--sj-panel-solid))]"
              >
                <SearchIcon className="size-4" aria-hidden="true" />
                Search Recipes
              </Link>
            </div>
            <dl className="mt-8 grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-[1.25rem] border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-flour)_58%,transparent)] p-2.5 sm:p-3">
                <dt className="font-sj-ui font-semibold text-[var(--sj-ink)]">Collect</dt>
                <dd className="mt-0.5 text-xs/5 text-[var(--sj-ink-soft)] sm:mt-1 sm:text-sm/6">Write recipes with the context future-you needs.</dd>
              </div>
              <div className="rounded-[1.25rem] border border-[var(--sj-border)] bg-[color-mix(in_srgb,var(--sj-mint)_44%,transparent)] p-2.5 sm:p-3">
                <dt className="font-sj-ui font-semibold text-[var(--sj-ink)]">Compose</dt>
                <dd className="mt-0.5 text-xs/5 text-[var(--sj-ink-soft)] sm:mt-1 sm:text-sm/6">Turn weeknights, holidays, and experiments into cookbooks.</dd>
              </div>
              <div className="rounded-[1.25rem] border border-[var(--sj-border)] bg-[var(--sj-panel-solid)] p-2.5 sm:p-3">
                <dt className="font-sj-ui font-semibold text-[var(--sj-ink)]">Share</dt>
                <dd className="mt-0.5 text-xs/5 text-[var(--sj-ink-soft)] sm:mt-1 sm:text-sm/6">Open a kitchen page without turning dinner into social media.</dd>
              </div>
            </dl>
          </section>

          <aside className="relative mt-28 rounded-[2rem] border border-[var(--sj-border)] bg-[#1f1710] p-4 text-stone-50 shadow-2xl lg:mt-0">
            <div className="font-sj-ui absolute -right-3 -top-3 rounded-full border border-amber-200 bg-amber-100 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-950 shadow-sm">
              Tonight
            </div>
            <div className="rounded-[1.5rem] border border-white/10 bg-[linear-gradient(160deg,_rgba(255,255,255,0.16),_rgba(255,255,255,0.04))] p-5">
              <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.24em] text-amber-200">Recipe card</p>
              <h2 className="font-sj-display mt-3 text-4xl/10 font-semibold text-stone-50">Sunday Tomato Sauce</h2>
              <Text className="mt-3 text-sm/6 text-stone-300">
                Nonna's margin notes, simmer times, and the version that finally tasted like the story.
              </Text>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-[1rem] bg-white/10 p-3">
                  <span className="block text-lg font-semibold text-white">6</span>
                  servings
                </div>
                <div className="rounded-[1rem] bg-white/10 p-3">
                  <span className="block text-lg font-semibold text-white">2h</span>
                  simmer
                </div>
                <div className="rounded-[1rem] bg-white/10 p-3">
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
                <div key={item.title} className="rounded-[1rem] border border-white/10 bg-white/[0.06] p-3">
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
    <div className="sj-page px-4 py-8 sm:py-12">
      <section className="sj-panel mx-auto max-w-6xl rounded-[2rem] p-5 sm:p-7">
        <header className="flex flex-col gap-4 border-b border-[var(--sj-border)] pb-5 sm:flex-row sm:items-center sm:justify-between">
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

        <div className="mt-5">
          <div role="tablist" aria-label="Kitchen sections" className="mb-5 flex items-center gap-2 border-b border-[var(--sj-border)] pb-3">
            <Link
              href={tabHref(location.search, "recipes")}
              role="tab"
              aria-selected={tab === "recipes"}
              className={[
                "font-sj-ui rounded-full border px-3 py-1.5 text-sm font-semibold no-underline transition",
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
                "font-sj-ui rounded-full border px-3 py-1.5 text-sm font-semibold no-underline transition",
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
                <div className="rounded-[2rem] border border-dashed border-[var(--sj-brass)] bg-[color-mix(in_srgb,var(--sj-flour)_58%,transparent)] p-8 text-center">
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
                <div className="rounded-[2rem] border border-dashed border-[var(--sj-border-strong)] bg-[var(--sj-panel-solid)] p-8 text-center">
                  <Text>No public recipes yet.</Text>
                </div>
              )
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {recipes.map((recipe) => {
                  const displayImageUrl = recipe.coverImageUrl && recipe.coverImageUrl.length > 0 ? recipe.coverImageUrl : undefined;
                  return (
                    <Link
                      key={recipe.id}
                      href={`/recipes/${recipe.id}`}
                      className="sj-card sj-hover-lift block overflow-hidden rounded-[1.6rem] no-underline"
                    >
                      <div className="flex h-40 items-center justify-center border-b border-[var(--sj-border)] bg-[var(--sj-flour)]">
                        {displayImageUrl ? (
                          <img src={displayImageUrl} alt={recipe.title} className="h-full w-full object-cover" />
                        ) : (
                          <ChefHat className="size-8 text-[var(--sj-ink-soft)]" aria-hidden="true" />
                        )}
                      </div>
                      <div className="p-3">
                        <Subheading level={3} className="line-clamp-1 text-xl/7">{recipe.title}</Subheading>
                        {recipe.description ? (
                          <Text className="mt-1 line-clamp-2 text-sm">{recipe.description}</Text>
                        ) : null}
                        {recipe.servings ? <Text className="font-sj-ui mt-2 text-xs uppercase tracking-[0.14em]">Serves {recipe.servings}</Text> : null}
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
                <div className="rounded-[2rem] border border-dashed border-[var(--sj-herb)] bg-[color-mix(in_srgb,var(--sj-mint)_50%,transparent)] p-8 text-center">
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
                <div className="rounded-[2rem] border border-dashed border-[var(--sj-border-strong)] bg-[var(--sj-panel-solid)] p-8 text-center">
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
