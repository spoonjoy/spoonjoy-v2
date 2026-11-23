import type { Route } from "./+types/tags.$slug";
import { useLoaderData } from "react-router";
import { Tag } from "lucide-react";
import { Empty } from "~/components/ouro/empty/empty";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Link } from "~/components/ouro/link/link";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { CookbookPage } from "~/components/cookbook/page";
import { organizerPage, organizersRequest } from "~/domains/kitchen";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.tag.name} - Spoonjoy` : "Tag - Spoonjoy" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { userId, store, db } = await organizersRequest(request, context);
  const page = await organizerPage(store, userId, "tag", params.slug);
  if (!page) throw new Response("Not Found", { status: 404 });
  const rows = await db.recipe.findMany({
    where: { id: { in: page.recipeIds } },
    select: { id: true, title: true, description: true },
  });
  // Keep the page's order: most recently changed first.
  const order = new Map(page.recipeIds.map((id, index) => [id, index]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  return { tag: { name: page.organizer.name, slug: page.organizer.slug }, recipes: rows };
}

export default function TagPage() {
  const { tag, recipes } = useLoaderData<typeof loader>();
  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Tag"
          title={tag.name}
          size="lg"
          divider
          actions={<Link href="/tags">All tags</Link>}
        />
        {recipes.length > 0 ? (
          <ItemGroup aria-label={`Recipes tagged ${tag.name}`} variant="divided" className="mt-6">
            {recipes.map((recipe) => (
              <Item key={recipe.id} href={`/recipes/${recipe.id}`} title={recipe.title} description={recipe.description ?? undefined} />
            ))}
          </ItemGroup>
        ) : (
          <Empty
            headingLevel={2}
            align="start"
            className="mt-6"
            icon={<Tag aria-hidden="true" />}
            title="No recipes with this tag"
            description="Recipes you tag with it show up here."
          />
        )}
      </div>
    </CookbookPage>
  );
}
