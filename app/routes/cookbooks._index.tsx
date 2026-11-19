import { Empty } from "~/components/ouro/empty/empty";
import type { Route } from "./+types/cookbooks._index";
import { useLoaderData } from "react-router";
import { Plus } from "lucide-react";
import { Button } from "~/components/ouro/button/button";
import { Card } from "~/components/ouro/card/card";
import { Text } from "~/components/ouro/text/text";
import { CookbookPage } from "~/components/cookbook/page";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { getRequestDb } from "~/lib/route-platform.server";
import { requestD1 } from "~/lib/d1-read.server";
import { readCookbookListFromD1, readCookbookListWithPrisma } from "~/lib/collection-reads.server";
import { requireUserId } from "~/lib/session.server";
import { CookbookCoverArt } from "~/components/cookbook/CookbookCoverArt";
import { DrawerSearch } from "./my-recipes";

function normalizedQuery(request: Request) {
  return (new URL(request.url).searchParams.get("q") ?? "").trim();
}

function matchesCookbookQuery(
  cookbook: {
    title: string;
    searchableRecipeTitles: string[];
  },
  query: string,
) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [
    cookbook.title,
    ...cookbook.searchableRecipeTitles,
  ].some((value) => value.toLowerCase().includes(needle));
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Cookbooks - Spoonjoy" },
    { name: "description", content: "Your Spoonjoy cookbooks." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const query = normalizedQuery(request);
  // On the Worker the page reads from D1 in one batch; Prisma is only the fallback where
  // there is no binding.
  const d1 = requestD1(context);
  const cookbooks = d1
    ? await readCookbookListFromD1(d1, userId)
    : await readCookbookListWithPrisma(await getRequestDb(context), userId);

  return {
    query,
    cookbooks: cookbooks.filter((cookbook) => matchesCookbookQuery(cookbook, query)),
  };
}

export default function CookbooksIndexRedirect() {
  const { query, cookbooks } = useLoaderData<typeof loader>();

  return (
    <CookbookPage>
      <PageHeader
        eyebrow="My Kitchen"
        title="Cookbooks"
        actions={(
          <Button href="/cookbooks/new">
            <Plus data-slot="icon" className="size-4" />
            New cookbook
          </Button>
        )}
        size="lg"
        divider
        description={`${cookbooks.length} ${cookbooks.length === 1 ? "cookbook" : "cookbooks"}`}
      />

      <DrawerSearch label="Search cookbooks" query={query} placeholder="weeknight, holidays, pasta" />

      {cookbooks.length > 0 ? (
        // The one-book shelf (desk target.md, Cookbooks): each cookbook as its cover, with its
        // name and recipe count under it, as the Apple app's grid draws them.
        <ul aria-label="Cookbooks" className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {cookbooks.map((cookbook) => (
            <Card
              key={cookbook.id}
              as="li"
              headingLevel={2}
              variant="plain"
              size="sm"
              href={`/cookbooks/${cookbook.id}`}
              title={cookbook.title}
              description={`${cookbook._count.recipes} ${cookbook._count.recipes === 1 ? "recipe" : "recipes"}`}
              media={(
                <CookbookCoverArt
                  title={cookbook.title}
                  recipeCount={cookbook._count.recipes}
                  recipeImages={cookbook.recipes.map((item) => ({
                    coverImageUrl: item.recipe.coverImageUrl,
                    title: "",
                    coverProvenanceLabel: item.recipe.coverProvenanceLabel,
                  }))}
                  titleAsHeading={false}
                  caption={false}
                  className="w-full rounded-ouro-md border-0"
                />
              )}
            />
          ))}
        </ul>
      ) : (
        <Empty headingLevel={2} align="start" description={<>
          <Text tone="muted">
            {query
              ? "Try another cookbook title or recipe title."
              : "Group recipes into a shelf you can find again."}
          </Text>
        </>}
          title={query ? "No matching cookbooks" : "No cookbooks yet"}
          action={<Button href="/cookbooks/new">Create cookbook</Button>} />
      )}
    </CookbookPage>
  );
}
