import { BookOpen, ChefHat, Plus, Search as SearchIcon, Settings, Share2, Users } from "lucide-react";
import { chefDisplayName } from "~/lib/username";
import { Button } from "~/components/ouro/button/button";
import { Card } from "~/components/ouro/card/card";
import { Empty } from "~/components/ouro/empty/empty";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Heading } from "~/components/ouro/text/heading";
import { Text } from "~/components/ouro/text/text";
import { Avatar } from "~/components/ouro/avatar/avatar";
import { CookbookPage } from "~/components/cookbook/page";
import { CookbookCoverArt } from "~/components/cookbook/CookbookCoverArt";
import { listImageProps } from "~/lib/image-loading";
import { CoverProvenanceBadge } from "~/components/recipe/CoverProvenanceBadge";
import { resolveChefAvatarUrl } from "~/lib/chef-avatar";
import { formatServingsLabel } from "~/lib/quantity";
import { share } from "~/lib/ouro/share";

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
    await share({
      title: recipe.title,
      text: recipe.description ?? `Open this Spoonjoy recipe: ${recipe.title}`,
      url: absoluteKitchenUrl(`/recipes/${recipe.id}`),
    });
  };
  const handleShareCookbook = async (cookbook: KitchenCookbook) => {
    await share({
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
              name={kitchenUser.username}
              src={resolveChefAvatarUrl(kitchenUser.photoUrl)}
              alt={kitchenUser.username}
              size="2xl"
            />
            <div className="mt-5 lg:mt-0">
              <p className="font-sj-ui text-sm font-semibold tracking-[0.01em] text-[var(--sj-brass)]">@{kitchenUser.username}</p>
              <h1 className="font-sj-display text-2xl/8 font-semibold tracking-normal text-[var(--sj-ink)] mt-3 text-5xl/12 sm:text-6xl/14 lg:text-7xl/16">{heading}</h1>
              <Text tone="muted" size="sm" className="mt-2">
                {displayRecipes.length} {displayRecipes.length === 1 ? "recipe" : "recipes"} and {cookbooks.length} {cookbooks.length === 1 ? "cookbook" : "cookbooks"}
              </Text>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {isOwner ? (
              <>
                {/* Desktop reaches Chefs from its top navigation; a phone reaches it here. */}
                <Button href="/chefs" variant="outline" tone="secondary" startIcon={Users} className="lg:hidden">Chefs</Button>
                <Button href="/account/settings" variant="outline" tone="secondary" startIcon={Settings} aria-label="Kitchen settings">Settings</Button>
                <Button href="/recipes/new" startIcon={Plus}>Create recipe</Button>
              </>
            ) : (
              <Button href="/search" variant="outline" tone="secondary" startIcon={SearchIcon}>Search recipes</Button>
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
    // The kitchen's table of contents: every recipe, newest update first, as an ordered list. A
    // <section aria-labelledby>, not <aside>: root.tsx already wraps every route in a <main>
    // landmark, so a complementary landmark here would nest inside it.
    <section aria-labelledby="recipe-index-heading">
      <div className="mb-2 flex items-end justify-between gap-4">
        <Heading id="recipe-index-heading" level={2} size="xl">Recipe index</Heading>
        {isOwner && recipes.length > 0 ? <Button href="/recipes/new" variant="outline" tone="secondary" startIcon={Plus}>New recipe</Button> : null}
      </div>

      <ItemGroup
        aria-labelledby="recipe-index-heading"
        ordered
        variant="divided"
        empty={
          <Empty
            title="Create your first recipe"
            headingLevel={3}
            icon={<ChefHat />}
            description="Capture the dish you make most often, the family classic everyone asks about, or the weeknight save you never want to lose."
            action={isOwner
              ? <Button href="/recipes/new" startIcon={Plus}>Create first recipe</Button>
              : <Text tone="muted" size="sm">No public recipes yet.</Text>}
          />
        }
      >
        {recipes.map((recipe, index) => (
          <RecipeIndexRow key={recipe.id} recipe={recipe} index={index} onShare={onShare} />
        ))}
      </ItemGroup>
    </section>
  );
}

function RecipeIndexRow({
  recipe,
  index,
  onShare,
}: {
  recipe: KitchenRecipe;
  index: number;
  onShare: (recipe: KitchenRecipe) => void;
}) {
  const servingsLabel = formatServingsLabel(recipe.servings);

  return (
    <Item
      as="article"
      href={`/recipes/${recipe.id}`}
      title={recipe.title}
      description={recipe.description || servingsLabel ? (
        <>
          {recipe.description ? <Text lines={2}>{recipe.description}</Text> : null}
          {servingsLabel ? <Text size="sm">{servingsLabel}</Text> : null}
        </>
      ) : undefined}
      media={recipe.coverImageUrl ? (
        <img src={recipe.coverImageUrl} alt="" {...listImageProps(index)} />
      ) : (
        <span className="flex items-center justify-center bg-[var(--sj-photo-charcoal)] text-[var(--sj-on-photo-muted)]">
          <ChefHat className="size-5" aria-hidden="true" />
        </span>
      )}
      mediaSize="md"
      actions={
        <>
          <CoverProvenanceBadge label={recipe.coverProvenanceLabel} />
          <Button variant="outline" tone="secondary" aria-label={`Share ${recipe.title}`} onClick={() => onShare(recipe)}>
            <Share2 />
          </Button>
        </>
      }
    />
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
    <section aria-labelledby="cookbook-shelf-heading" className="mt-12">
      <div className="mb-5 flex items-end justify-between gap-4">
        <Heading id="cookbook-shelf-heading" level={2} size="xl">Cookbooks</Heading>
        {isOwner ? <Button href="/cookbooks/new" variant="outline" tone="secondary">New cookbook</Button> : null}
      </div>

      {cookbooks.length > 0 ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {cookbooks.map((cookbook) => (
            <CookbookCover key={cookbook.id} cookbook={cookbook} onShare={onShare} />
          ))}
        </div>
      ) : (
        <Empty
          title={isOwner ? "Build your first cookbook" : "No public cookbooks yet."}
          icon={<BookOpen />}
          description={isOwner
            ? "Group recipes into a holiday menu, a weeknight rotation, or a family collection that grows with every good meal."
            : "This kitchen has not published a cookbook yet."}
          action={isOwner ? <Button href="/cookbooks/new">Create first cookbook</Button> : undefined}
        />
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
  return (
    <Card
      as="article"
      href={`/cookbooks/${cookbook.id}`}
      title={cookbook.title}
      description={`${cookbook._count.recipes} ${cookbook._count.recipes === 1 ? "recipe" : "recipes"}`}
      size="sm"
      className="w-52 shrink-0"
      media={
        <CookbookCoverArt
          title={cookbook.title}
          recipeCount={cookbook._count.recipes}
          recipeImages={cookbook.recipes.map((item) => ({
            coverImageUrl: item.recipe.coverImageUrl,
            title: item.recipe.title,
            coverProvenanceLabel: item.recipe.coverProvenanceLabel,
          }))}
          titleAsHeading={false}
          className="w-full border-0 shadow-none"
        />
      }
      action={
        <Button variant="outline" tone="secondary" aria-label={`Share ${cookbook.title}`} onClick={() => onShare(cookbook)}>
          <Share2 />
        </Button>
      }
    />
  );
}
