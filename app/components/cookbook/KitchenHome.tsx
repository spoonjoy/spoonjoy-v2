import { BookOpen, ChefHat, Plus, Search as SearchIcon, Settings, Share2, Users } from "lucide-react";
import { chefDisplayName } from "~/lib/username";
import { Button } from "~/components/ui/button";
import { Link } from "~/components/ui/link";
import { Heading, Subheading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { Avatar } from "~/components/ui/avatar";
import { CookbookPage } from "~/components/cookbook/page";
import { CookbookCoverArt } from "~/components/cookbook/CookbookCoverArt";
import { listImageProps } from "~/lib/image-loading";
import { CoverProvenanceBadge } from "~/components/recipe/CoverProvenanceBadge";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";
import { formatServingsLabel } from "~/lib/quantity";
import { shareContent } from "~/components/navigation";

export function absoluteKitchenUrl(path: string) {
  if (typeof window === "undefined") {
    return path;
  }

  return `${window.location.origin}${path}`;
}

export function KitchenHome({
  kitchenUser,
  isOwner,
  recipes,
  cookbooks,
}: {
  kitchenUser: { id: string; username: string; photoUrl: string | null };
  isOwner: boolean;
  recipes: KitchenRecipe[];
  cookbooks: KitchenCookbook[];
}) {
  const displayRecipes = recipes;
  const heading = isOwner ? "My Kitchen" : `${chefDisplayName(kitchenUser.username)}'s Kitchen`;
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
      text: `${cookbook.title} has ${cookbook._count.recipes} ${cookbook._count.recipes === 1 ? "recipe" : "recipes"} on Spoonjoy.`,
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
            <div className="mt-5 lg:mt-0">
              <p className="font-sj-ui text-sm font-semibold tracking-[0.01em] text-[var(--sj-brass)]">@{kitchenUser.username}</p>
              <Heading level={1} className="mt-3 text-5xl/12 sm:text-6xl/14 lg:text-7xl/16">{heading}</Heading>
              <Text className="mt-2 text-sm">
                {displayRecipes.length} {displayRecipes.length === 1 ? "recipe" : "recipes"} and {cookbooks.length} {cookbooks.length === 1 ? "cookbook" : "cookbooks"}
              </Text>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {isOwner ? (
              <>
                {/* Desktop reaches Chefs from its top navigation; a phone reaches it here. */}
                <Button href="/chefs" plain className="lg:hidden">
                  <Users data-slot="icon" className="size-4" />
                  Chefs
                </Button>
                <Button href="/account/settings" plain aria-label="Kitchen settings">
                  <Settings data-slot="icon" className="size-4" />
                  Settings
                </Button>
                <Button href="/recipes/new">
                  <Plus data-slot="icon" className="size-4" />
                  Create recipe
                </Button>
              </>
            ) : (
              <Button href="/search" plain>
                <SearchIcon data-slot="icon" className="size-4" />
                Search recipes
              </Button>
            )}
          </div>
        </header>

        <div className="mt-10">
          <RecipeIndex recipes={displayRecipes} isOwner={isOwner} onShare={handleShareRecipe} />
        </div>

        <CookbookShelf cookbooks={cookbooks} isOwner={isOwner} onShare={handleShareCookbook} />
      </section>
    </CookbookPage>
  );
}

export type KitchenRecipe = {
  id: string;
  title: string;
  description: string | null;
  servings: string | null;
  coverImageUrl: string | null;
  coverProvenanceLabel: string | null;
};

export type KitchenCookbook = {
  id: string;
  title: string;
  _count: { recipes: number };
  recipes: Array<{
    recipe: {
      coverImageUrl: string | null;
      coverProvenanceLabel: string | null;
      title: string;
    };
  }>;
};

function RecipeIndex({
  recipes,
  isOwner,
  onShare,
}: {
  recipes: KitchenRecipe[];
  isOwner: boolean;
  onShare: (recipe: KitchenRecipe) => void;
}) {
  return (
    // The kitchen's table of contents: every recipe, newest update first, numbered like a
    // cookbook's contents page, with nothing held out as a lead. A <section aria-labelledby>,
    // not <aside>: root.tsx already wraps every route in a <main> landmark, so a complementary
    // landmark here would nest inside it and fail landmark-complementary-is-top-level.
    <section aria-labelledby="recipe-index-heading">
      <div className="flex items-end justify-between gap-4 border-b border-[var(--sj-border-strong)] pb-3">
        <div>
          <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.22em] text-[var(--sj-brass)]">Contents</p>
          <Subheading id="recipe-index-heading" level={2} className="mt-1 text-2xl/8">Recipe index</Subheading>
        </div>
        {isOwner && recipes.length > 0 ? <Link href="/recipes/new" className="font-sj-ui inline-flex min-h-11 items-center text-xs font-semibold uppercase tracking-[0.18em] text-[var(--sj-ink-soft)] no-underline hover:text-[var(--sj-ink)]">New +</Link> : null}
      </div>

      {recipes.length > 0 ? (
        // Columns, not grid rows, so the numbers run down the first column and on into the second.
        <div className="lg:columns-2 lg:gap-x-12">
          {recipes.map((recipe, index) => (
            <RecipeIndexRow key={recipe.id} recipe={recipe} ordinal={index + 1} onShare={onShare} />
          ))}
        </div>
      ) : (
        <div className="border-b border-dashed border-[var(--sj-border-strong)] py-10">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(18rem,0.55fr)] lg:items-center">
            <div className="flex aspect-[16/10] items-center justify-center bg-[color-mix(in_srgb,var(--sj-flour)_58%,transparent)]">
              <ChefHat className="size-10 text-[var(--sj-brass)]" aria-hidden="true" />
            </div>
            <div>
              <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.22em] text-[var(--sj-brass)]">Recipes</p>
              <Subheading level={2} className="mt-3 text-3xl/9 tracking-normal">Create your first recipe</Subheading>
              <Text className="mt-3 max-w-md">
                Capture the dish you make most often, the family classic everyone asks about, or the weeknight save you never want to lose.
              </Text>
              {isOwner ? (
                <div className="mt-6">
                  <Button href="/recipes/new">
                    <Plus data-slot="icon" className="size-4" />
                    Create first recipe
                  </Button>
                </div>
              ) : (
                <Text className="mt-6 text-sm">No public recipes yet.</Text>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
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
    <article className="relative break-inside-avoid border-b border-[var(--sj-border)]">
      <Link href={`/recipes/${recipe.id}`} className="group grid grid-cols-[2.25rem_4.75rem_minmax(0,1fr)] gap-3 py-4 pr-12 no-underline sm:grid-cols-[2.5rem_5.5rem_minmax(0,1fr)] sm:gap-4">
        <div className="font-sj-ui pt-1 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--sj-brass)]">
          {String(ordinal).padStart(2, "0")}
        </div>
        <span className="sj-photo-tile block aspect-[4/3] overflow-hidden bg-[color-mix(in_srgb,var(--sj-flour)_70%,var(--sj-panel-solid))] sm:aspect-square">
          {displayImageUrl ? (
            <img src={displayImageUrl} alt="" {...listImageProps(ordinal - 1)} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.025]" />
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
          <CoverProvenanceBadge label={recipe.coverProvenanceLabel} className="mt-2" />
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
    <section aria-label="Cookbooks" className="mt-12 border-t border-[var(--sj-border-strong)] pt-7">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="font-sj-ui text-xs font-semibold uppercase tracking-[0.22em] text-[var(--sj-brass)]">Cookbooks</p>
          <Subheading level={2} className="mt-1 text-2xl/8">Cookbooks</Subheading>
        </div>
        {isOwner ? <Button href="/cookbooks/new" plain>New cookbook</Button> : null}
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
          {isOwner ? <Button href="/cookbooks/new">Create first cookbook</Button> : null}
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
    coverProvenanceLabel: item.recipe.coverProvenanceLabel,
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
