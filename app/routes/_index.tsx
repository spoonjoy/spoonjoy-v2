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
import { Button } from "~/components/ui/button";
import { Heading } from "~/components/ui/heading";
import { Text } from "~/components/ui/text";
import { KitchenHome, absoluteKitchenUrl } from "~/components/cookbook/KitchenHome";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import { HERO_IMAGE_PROPS } from "~/lib/image-loading";

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
  const readInput = { viewerId: currentUserId, kitchenUserWhere };
  const { viewer, kitchenUser, recipes, cookbooks } = d1
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
    };
  }

  const recipesWithCover = recipes.map(({ covers, ...rest }) => {
    const coverDisplay = getRecipeCoverDisplay(rest, covers);
    return {
      ...rest,
      coverImageUrl: coverDisplay?.displayUrl ?? null,
      coverProvenanceLabel: coverDisplay?.provenanceLabel ?? null,
    };
  });

  const cookbooksWithCover = cookbooks.map(({ recipes: cookbookRecipes, ...cookbook }) => ({
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
        <section className="relative min-h-[clamp(24rem,56svh,42rem)] sm:min-h-[clamp(32rem,70svh,42rem)] overflow-hidden">
          <img
            src={LANDING_FOOD_PHOTOS[2].src}
            alt={LANDING_FOOD_PHOTOS[2].alt}
            {...HERO_IMAGE_PROPS}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(34,32,28,0.82),rgba(34,32,28,0.34)_58%,rgba(34,32,28,0.10)),linear-gradient(0deg,rgba(34,32,28,0.56),transparent_42%)]" />
          <div className="relative z-10 flex min-h-[clamp(24rem,56svh,42rem)] sm:min-h-[clamp(32rem,70svh,42rem)] flex-col justify-end px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-12 sm:pt-20 sm:px-8 sm:pb-20 lg:px-12 lg:pb-24">
            <p className="font-sj-ui text-xs font-bold uppercase tracking-[0.2em] text-[var(--sj-on-photo-muted)]">
              The Recipe App
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

  return <KitchenHome kitchenUser={kitchenUser} isOwner={isOwner} recipes={recipes} cookbooks={cookbooks} />;
}
