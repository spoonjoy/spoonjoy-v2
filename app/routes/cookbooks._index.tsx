import type { Route } from "./+types/cookbooks._index";
import { useLoaderData } from "react-router";
import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, ObjectRow, RuledEmptyState } from "~/components/cookbook/page";
import { getRecipeCoverDisplay } from "~/lib/recipe-cover.server";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
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

export async function loader({ request, context }: Route.LoaderArgs) {
  const userId = await requireUserId(request, "/login", context.cloudflare?.env);
  const query = normalizedQuery(request);
  const database = await getRequestDb(context);
  const cookbooks = await database.cookbook.findMany({
    where: { authorId: userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: {
      _count: { select: { recipes: true } },
      recipes: {
        take: 4,
        orderBy: { createdAt: "desc" },
        where: {
          recipe: { deletedAt: null },
        },
        include: {
          recipe: {
            select: {
              id: true,
              title: true,
              activeCoverId: true,
              activeCoverVariant: true,
              coverMode: true,
              covers: {
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              },
            },
          },
        },
      },
    },
  });
  const titlesByCookbookId = new Map<string, string[]>();

  if (cookbooks.length > 0) {
    const recipeTitleRows = await database.recipeInCookbook.findMany({
      where: {
        cookbookId: { in: cookbooks.map((cookbook) => cookbook.id) },
        recipe: { deletedAt: null },
      },
      select: {
        cookbookId: true,
        recipe: {
          select: { title: true },
        },
      },
    });

    for (const row of recipeTitleRows) {
      const titles = titlesByCookbookId.get(row.cookbookId) ?? [];
      titles.push(row.recipe.title);
      titlesByCookbookId.set(row.cookbookId, titles);
    }
  }

  const cookbooksWithPreview = cookbooks.map(({ recipes, ...cookbook }) => ({
    ...cookbook,
    searchableRecipeTitles: titlesByCookbookId.get(cookbook.id) ?? [],
    recipes: recipes.map((item) => {
      const coverDisplay = getRecipeCoverDisplay(item.recipe, item.recipe.covers);
      return {
        ...item,
        recipe: {
          id: item.recipe.id,
          title: item.recipe.title,
          coverImageUrl: coverDisplay?.displayUrl ?? null,
          coverProvenanceLabel: coverDisplay?.provenanceLabel ?? null,
        },
      };
    }),
  }));

  return {
    query,
    cookbooks: cookbooksWithPreview.filter((cookbook) => matchesCookbookQuery(cookbook, query)),
  };
}

export default function CookbooksIndexRedirect() {
  const { query, cookbooks } = useLoaderData<typeof loader>();

  return (
    <CookbookPage>
      <CookbookHeader
        eyebrow="My Kitchen"
        title="Cookbooks"
        action={(
          <Button href="/cookbooks/new">
            <Plus data-slot="icon" className="size-4" />
            New Cookbook
          </Button>
        )}
      >
        Cookbooks you built and saved in your kitchen.
      </CookbookHeader>

      <DrawerSearch label="Search cookbooks" query={query} placeholder="weeknight, holidays, pasta" />

      {cookbooks.length > 0 ? (
        <section aria-label="Cookbooks" className="mt-6 divide-y divide-[var(--sj-border)]">
          {cookbooks.map((cookbook) => (
            <ObjectRow
              key={cookbook.id}
              href={`/cookbooks/${cookbook.id}`}
              title={cookbook.title}
              subtitle={`${cookbook._count.recipes} ${cookbook._count.recipes === 1 ? "recipe" : "recipes"}`}
              imageUrl={cookbook.recipes.find((item) => item.recipe.coverImageUrl)?.recipe.coverImageUrl ?? null}
            />
          ))}
        </section>
      ) : (
        <RuledEmptyState
          title={query ? "No matching cookbooks" : "No cookbooks yet"}
          action={<Button href="/cookbooks/new">Create Cookbook</Button>}
        >
          <Text>
            {query
              ? "Try another cookbook title or recipe title."
              : "Group recipes into a shelf you can find again."}
          </Text>
        </RuledEmptyState>
      )}
    </CookbookPage>
  );
}
