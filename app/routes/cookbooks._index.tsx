import type { Route } from "./+types/cookbooks._index";
import { useLoaderData } from "react-router";
import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { CookbookHeader, CookbookPage, ObjectRow, RuledEmptyState } from "~/components/cookbook/page";
import { getRequestDb } from "~/lib/route-platform.server";
import { requestD1 } from "~/lib/d1-read.server";
import { readCookbookListFromD1, readCookbookListWithPrisma } from "~/lib/collection-reads.server";
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
