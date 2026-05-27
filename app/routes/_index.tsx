import type { Route } from "./+types/_index";
import { useLoaderData } from "react-router";
import { ArrowRight, BookOpen, ChefHat, Plus, Search as SearchIcon, Share2 } from "lucide-react";
import { getRequestDb } from "~/lib/route-platform.server";
import { getUserId } from "~/lib/session.server";
import { Button } from "~/components/ui/button";
import { Link } from "~/components/ui/link";
import { Heading, Subheading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { Avatar } from "~/components/ui/avatar";
import { CookbookPage } from "~/components/cookbook/page";
import { CookbookCoverArt } from "~/components/cookbook/CookbookCoverArt";
import { getRecipeCoverImageUrl } from "~/lib/recipe-cover.server";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";
import { formatServingsLabel } from "~/lib/quantity";
import { shareContent } from "~/components/navigation";

const LANDING_FOOD_PHOTOS = [
  {
    src: "https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=2400&q=90",
    alt: "Margherita pizza with basil",
  },
  {
    src: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=2400&q=90",
    alt: "Cooked pasta with tomato sauce",
  },
  {
    src: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=2400&q=90",
    alt: "Dinner table with shared dishes",
  },
];

type KitchenTab = "recipes" | "cookbooks";
type KitchenUserWhere = { id: string } | { username: string };

function normalizeTab(value: string | null): KitchenTab {
  return value === "cookbooks" ? "cookbooks" : "recipes";
}

function isLocalQaRecipe(title: string) {
  return /^(e2e|mobile dock save)\b/i.test(title.trim()) || /\(variation \d+\)$/i.test(title.trim());
}

export function absoluteKitchenUrl(path: string) {
  if (typeof window === "undefined") {
    return path;
  }

  return `${window.location.origin}${path}`;
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Spoonjoy - Recipe Kitchens & Cookbooks" },
    { name: "description", content: "Collect family recipes, shape them into cookbooks, and share a personal kitchen." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const currentUserId = await getUserId(request, context.cloudflare?.env);
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
  const { kitchenUser, isOwner, recipes, cookbooks } = useLoaderData<typeof loader>();

  if (!kitchenUser) {
    return (
      <div className="sj-page">
        <section className="relative min-h-[92svh] overflow-hidden">
          <img
            src={LANDING_FOOD_PHOTOS[2].src}
            alt={LANDING_FOOD_PHOTOS[2].alt}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(34,32,28,0.82),rgba(34,32,28,0.34)_58%,rgba(34,32,28,0.10)),linear-gradient(0deg,rgba(34,32,28,0.56),transparent_42%)]" />
          <div className="relative z-10 flex min-h-[92svh] flex-col justify-end px-5 pb-[calc(9rem+env(safe-area-inset-bottom))] pt-20 sm:px-8 sm:pb-24 lg:px-12 lg:pb-28">
            <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.2em] text-[var(--sj-on-photo-muted)]">
              Family recipe OS
            </p>
            <Heading level={1} className="mt-5 max-w-4xl text-4xl/10 text-[var(--sj-on-photo)] sm:text-6xl/14 lg:text-7xl/16 xl:text-8xl/20">
              Your food should look as good as it tastes.
            </Heading>
            <Text className="mt-5 max-w-2xl text-lg/8 text-[var(--sj-on-photo-muted)]">
              Spoonjoy is a photo-first kitchen for the recipes you actually cook, the notes you learn by doing, and the cookbooks that grow out of real meals.
            </Text>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button href="/signup">Start Your Kitchen</Button>
              <Button href="/login" plain>Log In</Button>
              <Button href="/search" plain>
                <SearchIcon data-slot="icon" className="size-4" aria-hidden="true" />
                Search Recipes
              </Button>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-6xl gap-6 px-5 py-10 sm:grid-cols-3 sm:px-8 lg:px-12">
          {[
            ["Collect", "Write recipes with the context future-you needs."],
            ["Cook", "Log the dishes you made and what changed."],
            ["Share", "Open a kitchen without turning dinner into social media."],
          ].map(([title, copy]) => (
            <div key={title} className="border-t border-[var(--sj-border)] pt-5">
              <h2 className="font-sj-ui text-sm font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink)]">{title}</h2>
              <p className="mt-2 text-sm/6 text-[var(--sj-ink-soft)]">{copy}</p>
            </div>
          ))}
        </section>
      </div>
    );
  }

  const visibleRecipes = recipes.filter((recipe) => !isLocalQaRecipe(recipe.title));
  const displayRecipes = visibleRecipes.length > 0 ? visibleRecipes : recipes;
  const heading = isOwner ? "My Kitchen" : `${kitchenUser.username}'s Kitchen`;
  const featuredRecipe = displayRecipes.find((recipe) => recipe.coverImageUrl) ?? displayRecipes[0] ?? null;
  const indexedRecipes = featuredRecipe
    ? displayRecipes.filter((recipe) => recipe.id !== featuredRecipe.id)
    : displayRecipes;
  const handleShareRecipe = async (recipe: KitchenRecipe) => {
    await shareContent({
      title: recipe.title,
      text: recipe.description ?? `Open this Spoonjoy recipe: ${recipe.title}`,
      url: absoluteKitchenUrl(`/recipes/${recipe.id}`),
    });
  };
  const handleShareCookbook = async (cookbook: KitchenCookbook) => {
    await shareContent({
      title: cookbook.title,
      text: `Open this Spoonjoy cookbook with ${cookbook._count.recipes} ${cookbook._count.recipes === 1 ? "recipe" : "recipes"}.`,
      url: absoluteKitchenUrl(`/cookbooks/${cookbook.id}`),
    });
  };

  return (
    <CookbookPage>
      <section>
        <header className="grid gap-6 border-b border-[var(--sj-border-strong)] pb-7 lg:grid-cols-[4.5rem_minmax(0,1fr)_auto] lg:items-end">
          <div className="lg:contents">
            <Avatar
              src={resolveChefAvatarUrl(kitchenUser.photoUrl)}
              alt={kitchenUser.username}
              className="size-18 border border-[var(--sj-border-strong)] shadow-[var(--sj-shadow-soft)]"
            />
            <div>
              <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.22em] text-[var(--sj-brass)]">Kitchen</p>
              <Heading level={1} className="mt-1 text-5xl/12 sm:text-6xl/14 lg:text-7xl/16">{heading}</Heading>
              <Text className="mt-2 text-sm">
                {displayRecipes.length} {displayRecipes.length === 1 ? "recipe" : "recipes"} and {cookbooks.length} {cookbooks.length === 1 ? "cookbook" : "cookbooks"}
              </Text>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {isOwner ? (
              <Button href="/recipes/new">
                <Plus data-slot="icon" className="size-4" />
                Create Recipe
              </Button>
            ) : (
              <Button href="/search" plain>
                <SearchIcon data-slot="icon" className="size-4" />
                Search Recipes
              </Button>
            )}
          </div>
        </header>

        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,1.42fr)_minmax(18.75rem,0.62fr)] lg:items-start">
          <RecipeLead recipe={featuredRecipe} isOwner={isOwner} onShare={handleShareRecipe} />
          <RecipeIndex recipes={indexedRecipes} isOwner={isOwner} hasLead={Boolean(featuredRecipe)} onShare={handleShareRecipe} />
        </div>

        <CookbookShelf cookbooks={cookbooks} isOwner={isOwner} onShare={handleShareCookbook} />
      </section>
    </CookbookPage>
  );
}

type KitchenRecipe = {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  coverImageUrl: string | null;
};

type KitchenCookbook = {
  id: string;
  title: string;
  _count: { recipes: number };
  recipes: Array<{
    recipe: {
      coverImageUrl: string | null;
      title: string;
    };
  }>;
};

function RecipeLead({
  recipe,
  isOwner,
  onShare,
}: {
  recipe: KitchenRecipe | null;
  isOwner: boolean;
  onShare: (recipe: KitchenRecipe) => void;
}) {
  if (!recipe) {
    return (
      <section className="border-y border-dashed border-[var(--sj-border-strong)] py-10">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(18rem,0.55fr)] lg:items-center">
          <div className="flex aspect-[16/10] items-center justify-center bg-[color-mix(in_srgb,var(--sj-flour)_58%,transparent)]">
            <ChefHat className="size-10 text-[var(--sj-brass)]" aria-hidden="true" />
          </div>
          <div>
            <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.22em] text-[var(--sj-brass)]">Recipe box</p>
            <Subheading level={2} className="mt-3 text-3xl/9 tracking-normal">Start your recipe box</Subheading>
            <Text className="mt-3 max-w-md">
              Capture the dish you make most often, the family classic everyone asks about, or the weeknight save you never want to lose.
            </Text>
            {isOwner ? (
              <div className="mt-6">
                <Button href="/recipes/new">
                  <Plus data-slot="icon" className="size-4" />
                  Create First Recipe
                </Button>
              </div>
            ) : (
              <Text className="mt-6 text-sm">No public recipes yet.</Text>
            )}
          </div>
        </div>
      </section>
    );
  }

  const displayImageUrl = recipe.coverImageUrl && recipe.coverImageUrl.length > 0 ? recipe.coverImageUrl : undefined;
  const servingsLabel = formatServingsLabel(recipe.servings);

  return (
    <section aria-label="Latest from the kitchen" className="mb-16 border-b border-[var(--sj-border-strong)] pb-8 lg:mb-0">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.04fr)_minmax(15.625rem,0.46fr)] lg:items-end">
        <Link
          href={`/recipes/${recipe.id}`}
          className="sj-photo-tile group block overflow-hidden bg-[var(--sj-photo-charcoal)] no-underline"
          aria-label={recipe.title}
        >
          <div className="relative aspect-[16/10]">
            {displayImageUrl ? (
              <img src={displayImageUrl} alt={recipe.title} className="h-full w-full object-cover text-[0px] text-transparent transition duration-300 group-hover:scale-[1.015]" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[color-mix(in_srgb,var(--sj-flour)_62%,transparent)]">
                <ChefHat className="size-10 text-[var(--sj-brass)]" aria-hidden="true" />
              </div>
            )}
          </div>
        </Link>

        <div className="border-l border-[var(--sj-border)] pl-5">
          <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.22em] text-[var(--sj-brass)]">Latest from the kitchen</p>
          <Link href={`/recipes/${recipe.id}`} className="block min-h-11 no-underline">
            <Heading level={2} className="mt-3 text-4xl/10 hover:text-[var(--sj-tomato)] sm:mt-5 sm:text-6xl/14">{recipe.title}</Heading>
          </Link>
          {recipe.description ? <Text className="mt-4 hidden max-w-md text-base/7 sm:block">{recipe.description}</Text> : null}
          {servingsLabel ? (
            <p className="font-sj-ui mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-ink-soft)]">
              {servingsLabel}
            </p>
          ) : null}
          <div className="mt-7 flex flex-wrap gap-2">
            <Button href={`/recipes/${recipe.id}`}>
              Open Recipe
              <ArrowRight data-slot="icon" className="size-4" />
            </Button>
            <Button type="button" plain onClick={() => onShare(recipe)}>
              <Share2 data-slot="icon" className="size-4" aria-hidden="true" />
              Share
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function RecipeIndex({
  recipes,
  isOwner,
  hasLead,
  onShare,
}: {
  recipes: KitchenRecipe[];
  isOwner: boolean;
  hasLead: boolean;
  onShare: (recipe: KitchenRecipe) => void;
}) {
  return (
    <aside aria-label="Recipe index" className="lg:max-h-[44rem] lg:overflow-y-auto lg:border-l lg:border-[var(--sj-border)] lg:pl-6 lg:pr-1">
      <div className="flex items-end justify-between gap-4 border-b border-[var(--sj-border-strong)] pb-3">
        <div>
          <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.22em] text-[var(--sj-brass)]">Index</p>
          <Subheading level={2} className="mt-1 text-2xl/8">Recipe index</Subheading>
        </div>
        {isOwner ? <Link href="/recipes/new" className="font-sj-ui inline-flex min-h-11 items-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)] no-underline hover:text-[var(--sj-ink)]">New +</Link> : null}
      </div>

      {recipes.length > 0 ? (
        <div className="divide-y divide-[var(--sj-border)]">
          {recipes.map((recipe, index) => (
            <RecipeIndexRow key={recipe.id} recipe={recipe} ordinal={index + 1} onShare={onShare} />
          ))}
        </div>
      ) : (
        <div className="py-6">
          <Text className="text-sm">
            {hasLead ? "No older recipes yet." : isOwner ? "Your next recipe will appear here after the first one." : "No public recipes yet."}
          </Text>
        </div>
      )}
    </aside>
  );
}

function RecipeIndexRow({
  recipe,
  ordinal,
  onShare,
}: {
  recipe: KitchenRecipe;
  ordinal: number;
  onShare: (recipe: KitchenRecipe) => void;
}) {
  const servingsLabel = formatServingsLabel(recipe.servings);
  const displayImageUrl = recipe.coverImageUrl && recipe.coverImageUrl.length > 0 ? recipe.coverImageUrl : undefined;

  return (
    <article className="relative">
      <Link href={`/recipes/${recipe.id}`} className="group grid grid-cols-[2.25rem_4.75rem_minmax(0,1fr)] gap-3 py-4 pr-12 no-underline sm:grid-cols-[2.5rem_5.5rem_minmax(0,1fr)] sm:gap-4">
        <div className="font-sj-ui pt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-brass)]">
          {String(ordinal).padStart(2, "0")}
        </div>
        <span className="sj-photo-tile block aspect-[4/3] overflow-hidden bg-[color-mix(in_srgb,var(--sj-flour)_70%,var(--sj-panel-solid))] sm:aspect-square">
          {displayImageUrl ? (
            <img src={displayImageUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-[var(--sj-photo-charcoal)] text-[var(--sj-on-photo-muted)]">
              <ChefHat className="size-5" aria-hidden="true" />
            </span>
          )}
        </span>
        <div className="min-w-0 self-center">
          <h3 className="font-sj-display line-clamp-2 text-2xl/7 font-extrabold text-[var(--sj-ink)] group-hover:text-[var(--sj-tomato)]">
            {recipe.title}
          </h3>
          {recipe.description ? <p className="mt-1 line-clamp-2 text-sm/5 text-[var(--sj-ink-soft)]">{recipe.description}</p> : null}
          {servingsLabel ? (
            <p className="font-sj-ui mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sj-ink-soft)]">{servingsLabel}</p>
          ) : null}
        </div>
      </Link>
      <button
        type="button"
        aria-label={`Share ${recipe.title}`}
        onClick={() => onShare(recipe)}
        className="absolute right-0 top-1/2 grid size-11 -translate-y-1/2 place-items-center text-[var(--sj-ink-soft)] transition hover:text-[var(--sj-tomato)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)]"
      >
        <Share2 className="size-4" aria-hidden="true" />
      </button>
    </article>
  );
}

function CookbookShelf({
  cookbooks,
  isOwner,
  onShare,
}: {
  cookbooks: KitchenCookbook[];
  isOwner: boolean;
  onShare: (cookbook: KitchenCookbook) => void;
}) {
  return (
    <section aria-label="Cookbook shelf" className="mt-12 border-t border-[var(--sj-border-strong)] pt-7">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.22em] text-[var(--sj-brass)]">Shelf</p>
          <Subheading level={2} className="mt-1 text-2xl/8">Cookbooks</Subheading>
        </div>
        {isOwner ? <Button href="/cookbooks/new" plain>New Cookbook</Button> : null}
      </div>

      {cookbooks.length > 0 ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {cookbooks.map((cookbook) => (
            <CookbookCover key={cookbook.id} cookbook={cookbook} onShare={onShare} />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 border-y border-dashed border-[var(--sj-border-strong)] py-7 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
          <BookOpen className="size-8 text-[var(--sj-action)]" aria-hidden="true" />
          <div>
            <Subheading level={3} className="text-2xl/8">{isOwner ? "Build your first cookbook" : "No public cookbooks yet."}</Subheading>
            <Text className="mt-1 max-w-2xl">
              {isOwner
                ? "Group recipes into a holiday menu, a weeknight rotation, or a family collection that grows with every good meal."
                : "This kitchen has not published a cookbook yet."}
            </Text>
          </div>
          {isOwner ? <Button href="/cookbooks/new">Create First Cookbook</Button> : null}
        </div>
      )}
    </section>
  );
}

function CookbookCover({
  cookbook,
  onShare,
}: {
  cookbook: KitchenCookbook;
  onShare: (cookbook: KitchenCookbook) => void;
}) {
  const recipeImages = cookbook.recipes.map((item) => ({
    coverImageUrl: item.recipe.coverImageUrl,
    title: item.recipe.title,
  }));

  return (
    <article className="relative w-52 shrink-0">
      <Link href={`/cookbooks/${cookbook.id}`} className="group block no-underline">
        <CookbookCoverArt
          title={cookbook.title}
          recipeCount={cookbook._count.recipes}
          recipeImages={recipeImages}
          className="w-full transition group-hover:-translate-y-0.5 group-hover:border-[var(--sj-brass)]"
        />
      </Link>
      <button
        type="button"
        aria-label={`Share ${cookbook.title}`}
        onClick={() => onShare(cookbook)}
        className="absolute right-2 top-2 z-10 grid size-11 place-items-center bg-[color-mix(in_srgb,var(--sj-charcoal)_72%,transparent)] text-[var(--sj-paper)] transition hover:bg-[var(--sj-charcoal)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sj-brass)]"
      >
        <Share2 className="size-4" aria-hidden="true" />
      </button>
    </article>
  );
}
