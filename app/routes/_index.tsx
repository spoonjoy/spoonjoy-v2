import type { Route } from "./+types/_index";
import { useLoaderData } from "react-router";
import { Search as SearchIcon } from "lucide-react";
import { getRequestDb } from "~/lib/route-platform.server";
import { requestD1 } from "~/lib/d1-read.server";
import {
  readKitchenHomeFromD1,
  readKitchenHomeWithPrisma,
  type KitchenUserWhere,
} from "~/lib/kitchen-home.server";
import { getUserId } from "~/lib/session.server";
import { hidesChef, withoutHidden } from "~/lib/moderation.server";
import { Button } from "~/components/ouro/button/button";
import { KitchenHome, absoluteKitchenUrl } from "~/components/cookbook/KitchenHome";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import { HERO_IMAGE_PROPS } from "~/lib/image-loading";
import { cookingNowEntry } from "~/lib/cooking-now-entries.server";
import type { CookingNowEntry } from "~/lib/cooking-now";
import { CookingNowStrip, LocalCookingNow } from "~/components/cooking-now/CookingNow";

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
const HOMEPAGE_TITLE = "Spoonjoy — The Recipe App";
const HOMEPAGE_DESCRIPTION = "The recipe app for the meals you actually cook. Collect recipes, shape them into cookbooks, and keep a personal kitchen.";
const HOMEPAGE_URL = "https://spoonjoy.app/";
const HOMEPAGE_SOCIAL_IMAGE_URL = "https://spoonjoy.app/og/spoonjoy-home.png";

function normalizeTab(value: string | null): KitchenTab {
  return value === "cookbooks" ? "cookbooks" : "recipes";
}

export { absoluteKitchenUrl };

export function meta({}: Route.MetaArgs) {
  return [
    { title: HOMEPAGE_TITLE },
    { name: "description", content: HOMEPAGE_DESCRIPTION },
    { property: "og:site_name", content: "Spoonjoy" },
    { property: "og:type", content: "website" },
    { property: "og:title", content: HOMEPAGE_TITLE },
    { property: "og:description", content: HOMEPAGE_DESCRIPTION },
    { property: "og:url", content: HOMEPAGE_URL },
    { property: "og:image", content: HOMEPAGE_SOCIAL_IMAGE_URL },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:type", content: "image/png" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: HOMEPAGE_TITLE },
    { name: "twitter:description", content: HOMEPAGE_DESCRIPTION },
    { name: "twitter:image", content: HOMEPAGE_SOCIAL_IMAGE_URL },
    { tagName: "link", rel: "canonical", href: HOMEPAGE_URL },
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
      cookingNow: [] as CookingNowEntry[],
      renderedAt: Date.now(),
    };
  }

  const kitchenUserWhere: KitchenUserWhere = requestedChefId
    ? { id: requestedChefId }
    : requestedChefUsername
      ? { username: requestedChefUsername }
      : { id: currentUserId as string };

  // On the Worker the page's reads go to D1 as one batch; Prisma is only the fallback
  // where there is no binding (unit tests, local scripts).
  const d1 = requestD1(context);
  const renderedAt = Date.now();
  const readInput = { viewerId: currentUserId, kitchenUserWhere, now: renderedAt };
  const { viewer, kitchenUser, recipes, cookbooks, cookingNow, hides } = d1
    ? await readKitchenHomeFromD1(d1, readInput)
    : await readKitchenHomeWithPrisma(await getRequestDb(context), readInput);

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
      cookingNow: [] as CookingNowEntry[],
      renderedAt: Date.now(),
    };
  }

  // Another chef's kitchen the viewer blocked or reported is hidden, as if there were none.
  if (hidesChef(hides, kitchenUser.id)) {
    throw new Response("Kitchen not found", { status: 404 });
  }

  const recipesWithCover = withoutHidden(hides, recipes, (recipe) => ({ type: "recipe", id: recipe.id, chefId: kitchenUser.id })).map(({ covers, ...rest }) => {
    const coverDisplay = getRecipeCoverDisplay(rest, covers);
    return {
      ...rest,
      coverImageUrl: coverDisplay?.displayUrl ?? null,
      coverProvenanceLabel: coverDisplay?.provenanceLabel ?? null,
    };
  });

  const cookbooksWithCover = withoutHidden(hides, cookbooks, (cookbook) => ({ type: "cookbook", id: cookbook.id, chefId: kitchenUser.id })).map(({ recipes: cookbookRecipes, ...cookbook }) => ({
    ...cookbook,
    recipes: cookbookRecipes.map((item) => ({
      ...item,
      recipe: {
        title: item.recipe.title,
        coverImageUrl: getRecipeCoverDisplay(item.recipe, item.recipe.covers)?.displayUrl ?? null,
        coverProvenanceLabel: getRecipeCoverDisplay(item.recipe, item.recipe.covers)?.provenanceLabel ?? null,
      },
    })),
  }));

  const isOwner = viewer?.id === kitchenUser.id;
  return {
    tab,
    viewer,
    kitchenUser,
    isOwner,
    recipes: recipesWithCover,
    cookbooks: cookbooksWithCover,
    // The cook's own recipes in progress; a visitor to another kitchen never sees them.
    cookingNow: cookingNow.map(cookingNowEntry),
    renderedAt,
  };
}

export default function Index() {
  const { kitchenUser, isOwner, recipes, cookbooks, cookingNow = [], renderedAt } = useLoaderData<typeof loader>();

  if (!kitchenUser) {
    return (
      <div className="sj-page">
        {/* Signed out, the recipes in progress live in this browser, so they appear after hydration. */}
        <LocalCookingNow />
        <section className="relative min-h-[clamp(24rem,56svh,42rem)] tall-phone:min-h-[clamp(24rem,70svh,42rem)] sm:min-h-[clamp(32rem,70svh,56rem)] overflow-hidden">
          <img
            src={LANDING_FOOD_PHOTOS[2].src}
            alt={LANDING_FOOD_PHOTOS[2].alt}
            {...HERO_IMAGE_PROPS}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="sj-landing-hero-shade absolute inset-0" />
          <div className="relative z-10 flex min-h-[clamp(24rem,56svh,42rem)] tall-phone:min-h-[clamp(24rem,70svh,42rem)] sm:min-h-[clamp(32rem,70svh,56rem)] flex-col justify-end px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-8 sm:pt-20 sm:px-8 sm:pb-20 lg:px-12 lg:pb-24">
            <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.2em] text-[var(--sj-on-photo)]">
              The Recipe App
            </p>
            <h1 className="font-sj-display mt-3 max-w-4xl text-[2rem]/[2.375rem] font-semibold tracking-normal text-[var(--sj-on-photo)] tall-phone:mt-5 tall-phone:text-4xl/10 sm:mt-5 sm:text-6xl/14 lg:text-7xl/16 xl:text-8xl/20">
              Your food should look as good as it tastes.
            </h1>
            {/* A short or narrow phone shows the first clause only, so the actions fit on the first screen above
                the tab bar (e2e/journeys/landing-first-screen.mobile.journey.ts). */}
            <p className="mt-3 max-w-2xl text-base/6 text-[var(--sj-on-photo)] tall-phone:mt-5 sm:mt-5 sm:text-lg/8">
              Spoonjoy is a photo-first kitchen for the recipes you actually cook
              <span className="hidden tall-phone:inline sm:inline">, the notes you learn by doing, and the cookbooks that grow out of real meals</span>.
            </p>
            {/* Photo-white labels, borders and focus rings for the outline buttons, and a light amber main
                action, so every button's edge shows on the shaded photo. */}
            {/* On a phone the main action takes the full width and the other two share a row. */}
            <div className="sj-on-charcoal sj-landing-hero-actions mt-6 grid grid-cols-2 gap-3 tall-phone:mt-8 sm:mt-8 sm:flex sm:flex-row">
              <Button href="/signup" className="col-span-2">Start Your Kitchen</Button>
              <Button href="/login" variant="outline" tone="secondary">Log in</Button>
              <Button href="/search" variant="outline" tone="secondary">
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

  return (
    <KitchenHome
      kitchenUser={kitchenUser}
      isOwner={isOwner}
      recipes={recipes}
      cookbooks={cookbooks}
      cookingNow={
        cookingNow.length > 0 ? <CookingNowStrip entries={cookingNow} now={renderedAt} /> : null
      }
    />
  );
}
