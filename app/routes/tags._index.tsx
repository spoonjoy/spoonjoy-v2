import type { Route } from "./+types/tags._index";
import { useLoaderData } from "react-router";
import { Tag } from "lucide-react";
import { Empty } from "~/components/ouro/empty/empty";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { CookbookPage } from "~/components/cookbook/page";
import { listOrganizers, organizersRequest } from "~/domains/kitchen";

export function meta() {
  return [{ title: "Your tags - Spoonjoy" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { userId, store } = await organizersRequest(request, context);
  const tags = await listOrganizers(store, userId, "tag");
  return { tags: tags.map(({ organizer, recipeCount }) => ({ name: organizer.name, slug: organizer.slug, recipeCount })) };
}

function recipeCountLabel(count: number): string {
  return count === 1 ? "1 recipe" : `${count} recipes`;
}

export default function TagsIndex() {
  const { tags } = useLoaderData<typeof loader>();
  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow="My Kitchen" title="Your tags" size="lg" divider description="The tags you sort your recipes by." />
        {tags.length > 0 ? (
          <ItemGroup aria-label="Your tags" variant="divided" className="mt-6">
            {tags.map((tag) => (
              <Item
                key={tag.slug}
                href={`/tags/${encodeURIComponent(tag.slug)}`}
                title={tag.name}
                media={<Tag aria-hidden="true" />}
                mediaSize="icon"
                description={recipeCountLabel(tag.recipeCount)}
              />
            ))}
          </ItemGroup>
        ) : (
          <Empty
            headingLevel={2}
            align="start"
            className="mt-6"
            icon={<Tag aria-hidden="true" />}
            title="No tags yet"
            description="Open one of your recipes and choose Tags from its ⋯ menu."
          />
        )}
      </div>
    </CookbookPage>
  );
}
