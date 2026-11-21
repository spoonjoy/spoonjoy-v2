import type { ReactNode } from "react";
import { BookOpen, Download, Ellipsis, Play, Plus, Search as SearchIcon, Settings, Users, Utensils } from "lucide-react";
import { chefDisplayName } from "~/lib/username";
import { Button } from "~/components/ouro/button/button";
import { Link } from "~/components/ouro/link/link";
import { Menu, MenuItem } from "~/components/ouro/menu/menu";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Text } from "~/components/ouro/text/text";
import { Avatar } from "~/components/ouro/avatar/avatar";
import { CookbookPage } from "~/components/cookbook/page";
import { HERO_IMAGE_PROPS, listImageProps } from "~/lib/image-loading";
import { CoverProvenanceBadge } from "~/components/recipe/CoverProvenanceBadge";
import { Card } from "~/components/ouro/card/card";
import { Cover } from "~/components/ouro/cover/cover";
import { cn } from "~/lib/ouro/cn";
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
  cookingNow,
}: {
  kitchenUser: { id: string; username: string; photoUrl: string | null };
  isOwner: boolean;
  recipes: KitchenRecipe[];
  cookbooks: KitchenCookbook[];
  /** The owner's recipes in progress, above everything else in their kitchen. */
  cookingNow?: ReactNode;
}) {
  const heading = isOwner ? "My Kitchen" : `${chefDisplayName(kitchenUser.username)}'s Kitchen`;
  const recipeCount = `${recipes.length} ${recipes.length === 1 ? "recipe" : "recipes"}`;
  const cookbookCount = `${cookbooks.length} ${cookbooks.length === 1 ? "cookbook" : "cookbooks"}`;
  // The kitchen lists recipes newest update first, so the first is the one on the counter.
  const counter = isOwner ? recipes[0] : undefined;
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
      {cookingNow}
      {/* The one-book kitchen (desk target.md, Kitchen): web's identity header, then the Apple
          app's On the counter, Your recipes and Cookbook shelf. On a foldable held like a book,
          the kitchen's name and its shelf sit on the left page and the recipes run down the right. */}
      <section data-fold-book="index">
        <header data-fold-page="left" className="grid gap-6 pb-2 lg:grid-cols-[4.5rem_minmax(0,1fr)_auto] lg:items-end">
          <div className="lg:contents">
            <Avatar
              name={kitchenUser.username}
              src={resolveChefAvatarUrl(kitchenUser.photoUrl)}
              alt={kitchenUser.username}
              size="2xl"
            />
            <div className="mt-5 lg:mt-0">
              <p className="font-sj-ui text-sm font-semibold tracking-[0.01em] text-[var(--sj-brass)]">@{kitchenUser.username}</p>
              <h1 className="font-sj-display mt-3 text-5xl/12 font-semibold tracking-normal text-[var(--sj-ink)] sm:text-6xl/14 lg:text-7xl/16">{heading}</h1>
              <Text tone="muted" size="sm" className="mt-2">
                {recipeCount} and {cookbookCount}
              </Text>
            </div>
          </div>

          {/* One row of capsules: Add a recipe first, then Chefs and Settings. */}
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {isOwner ? (
              <>
                <Button href="/recipes/new" startIcon={Plus}>Add a recipe</Button>
                <Button href="/chefs" variant="outline" tone="secondary" startIcon={Users}>Chefs</Button>
                <Button href="/account/settings" variant="outline" tone="secondary" startIcon={Settings} aria-label="Kitchen settings">Settings</Button>
              </>
            ) : (
              <Button href="/search" variant="outline" tone="secondary" startIcon={SearchIcon}>Search recipes</Button>
            )}
          </div>
        </header>

        {isOwner && recipes.length === 0 && cookbooks.length === 0 ? (
          <div className="mt-8" data-fold-page="right">
            <TableIsSet />
          </div>
        ) : (
          <>
            {counter ? (
              <div className="mt-8" data-fold-page="right">
                <OnTheCounter recipe={counter} />
              </div>
            ) : null}

            <div className="mt-10" data-fold-page="right">
              <RecipeIndex
                recipes={recipes}
                isOwner={isOwner}
                meta={`${recipeCount} · ${cookbookCount}`}
                onShare={handleShareRecipe}
              />
            </div>

            <div data-fold-page="left">
              <CookbookShelf cookbooks={cookbooks} isOwner={isOwner} onShare={handleShareCookbook} />
            </div>
          </>
        )}
      </section>
    </CookbookPage>
  );
}

/**
 * An empty kitchen, as the Apple app sets it: a fork and knife, "The table is set", one sentence,
 * and the two ways to bring in a first recipe.
 */
function TableIsSet() {
  return (
    <section aria-labelledby="table-is-set-heading" className="border-t border-[var(--sj-border-strong)] pt-8">
      <Utensils aria-hidden="true" className="size-10 text-[var(--sj-brass)]" strokeWidth={1.75} />
      <h2 id="table-is-set-heading" className="font-sj-display mt-6 text-4xl/11 font-semibold tracking-normal text-[var(--sj-ink)] sm:text-5xl/14">
        The table is set
      </h2>
      <p className="mt-4 max-w-xl text-base/7 text-[var(--sj-ink-soft)]">
        Bring in your first recipe with a link, or write it down. Everything you cook lives here.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button href="/recipes/new" startIcon={Plus}>Add a recipe</Button>
        <Button href="/recipes/new#import" variant="outline" tone="secondary" startIcon={Download}>Import</Button>
      </div>
    </section>
  );
}

/**
 * The recipe last worked on, as the Apple app's On the counter: one squircle card (radius 24, desk
 * target.md's 2026-11-18 amendment) with the eyebrow, title, meta line and the Start cooking and
 * Recipe capsules in the on-photo colours at its foot. It is Ouro UI's Card with a backdrop: a cover
 * photo fills the card under a dark shade, and Ouro clips only that picture to the card's squircle,
 * so the text and capsules over it never repaint through a clip. Without a photo the card itself is
 * charcoal, with no backdrop, and Ouro UI's Cover sits above the text: native lays its initial under the shade, but text
 * under a shade fails the page's contrast check, so here the letter stays clear of it.
 */
function OnTheCounter({ recipe }: { recipe: KitchenRecipe }) {
  const servingsLabel = formatServingsLabel(recipe.servings);
  const photo = recipe.coverImageUrl;
  return (
    <Card
      as="section"
      aria-label="On the counter"
      data-testid="kitchen-counter"
      backdrop={
        photo ? (
          <>
            <img src={photo} alt="" {...HERO_IMAGE_PROPS} />
            <div aria-hidden="true" className="sj-counter-shade" />
          </>
        ) : undefined
      }
      className={cn(
        "sj-on-charcoal sj-counter-card min-h-[22rem] justify-end sm:min-h-[26rem]",
        // Without a photo there is no picture to clip: the card is charcoal itself, so it draws its own squircle
        // and its text sits on a colour the contrast check reads directly.
        !photo && "[--card:var(--sj-photo-charcoal)]",
      )}
    >
      {photo ? null : <Cover title={recipe.title} size="fill" className="mb-6 h-40 aspect-auto sm:h-48" />}
      <div className="sm:px-2 sm:pb-2">
        <p className="sj-eyebrow">On the counter</p>
        <h2 className="font-sj-display mt-2 text-4xl/11 font-semibold tracking-normal text-balance text-[var(--sj-on-photo)] sm:text-5xl/14">
          {recipe.title}
        </h2>
        {servingsLabel ? <p className="mt-2 font-sj-ui text-sm font-semibold text-[var(--sj-on-photo-muted)]">{servingsLabel}</p> : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button href={`/recipes/${recipe.id}#cook`} startIcon={Play}>Start cooking</Button>
          <Button href={`/recipes/${recipe.id}`} variant="outline" tone="secondary" startIcon={BookOpen} aria-label={`Recipe: ${recipe.title}`}>Recipe</Button>
        </div>
      </div>
    </Card>
  );
}

function RecipeIndex({
  recipes,
  isOwner,
  meta,
  onShare,
}: {
  recipes: KitchenRecipe[];
  isOwner: boolean;
  meta: string;
  onShare: (recipe: KitchenRecipe) => void;
}) {
  const title = isOwner ? "Your recipes" : "Recipes";
  return (
    // The kitchen's table of contents: every recipe, newest update first, as an ordered list. A
    // <section aria-labelledby>, not <aside>: root.tsx already wraps every route in a <main>
    // landmark, so a complementary landmark here would nest inside it.
    <section aria-label={title}>
      <SectionHeader
        title={title}
        meta={meta}
        actions={isOwner && recipes.length > 0 ? <Link href="/recipes">See all</Link> : undefined}
      />

      <ItemGroup
        aria-label={title}
        ordered
        variant="divided"
        className="mt-2"
        empty={
          <Text tone="muted" className="py-6">
            {isOwner ? "No recipes yet. Add one above." : "No public recipes yet."}
          </Text>
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

  // A row is its cover, its title and "Serves 4" under it; Share lives in the row's menu, not on
  // the row (desk target.md, G6).
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
        // Ouro UI's Cover, square so the media slot's own corner rounds it as it does a photo.
        <Cover data-testid={`kitchen-recipe-cover-placeholder-${recipe.id}`} title={recipe.title} size="fill" shape="square" />
      )}
      mediaSize="md"
      actions={
        <>
          <CoverProvenanceBadge label={recipe.coverProvenanceLabel} />
          <Menu trigger={<Button variant="plain" tone="secondary" aria-label={`More for ${recipe.title}`}><Ellipsis /></Button>}>
            <MenuItem onClick={() => onShare(recipe)}>Share</MenuItem>
          </Menu>
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
    <section aria-label="Cookbook shelf" className="mt-12">
      <SectionHeader
        title="Cookbook shelf"
        meta={`${cookbooks.length} ${cookbooks.length === 1 ? "shelf" : "shelves"}`}
        actions={isOwner ? <Link href="/cookbooks/new">New cookbook</Link> : undefined}
      />

      <ItemGroup
        aria-label="Cookbook shelf"
        variant="divided"
        className="mt-2"
        empty={
          <Text tone="muted" className="py-6">
            {isOwner
              ? "Group recipes into a holiday menu, a weeknight rotation, or a family collection."
              : "No public cookbooks yet."}
          </Text>
        }
      >
        {cookbooks.map((cookbook) => {
          const photo = cookbook.recipes.find((item) => item.recipe.coverImageUrl)?.recipe.coverImageUrl;
          return (
            <Item
              key={cookbook.id}
              as="article"
              href={`/cookbooks/${cookbook.id}`}
              title={cookbook.title}
              description={`${cookbook._count.recipes} ${cookbook._count.recipes === 1 ? "recipe" : "recipes"}`}
              media={photo ? (
                <img src={photo} alt="" {...listImageProps(1)} />
              ) : (
                <Cover title={cookbook.title} size="fill" shape="square" />
              )}
              mediaSize="md"
              actions={
                <Menu trigger={<Button variant="plain" tone="secondary" aria-label={`More for ${cookbook.title}`}><Ellipsis /></Button>}>
                  <MenuItem onClick={() => onShare(cookbook)}>Share</MenuItem>
                </Menu>
              }
            />
          );
        })}
      </ItemGroup>
    </section>
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
