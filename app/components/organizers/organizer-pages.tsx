// The pages a cook browses their organizers on: the list of one kind (/tags, /categories, /tools) and one organizer's
// recipes (/tags/<slug> and the like). Each route file passes its kind and the loader data.
import { Empty } from "~/components/ouro/empty/empty";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Link } from "~/components/ouro/link/link";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { CookbookPage } from "~/components/cookbook/page";
import type { OrganizerKind } from "~/domains/kitchen";
import { ORGANIZER_KIND_COPY, organizerHref, recipeCountLabel } from "./organizer-kinds";
import { OrganizerManage } from "./organizer-manage";

export type OrganizerListData = { organizers: { name: string; slug: string; recipeCount: number }[] };

export type OrganizerPageData = {
  organizer: { name: string; slug: string };
  recipes: { id: string; title: string; description: string | null }[];
  /** The cook's other organizers of this kind, to merge into. */
  others: { name: string; slug: string }[];
};

export function OrganizerList({ kind, data }: { kind: OrganizerKind; data: OrganizerListData }) {
  const copy = ORGANIZER_KIND_COPY[kind];
  const icon = <copy.Icon aria-hidden="true" />;
  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow="My Kitchen" title={copy.listTitle} size="lg" divider description={copy.listDescription} />
        {data.organizers.length > 0 ? (
          <ItemGroup aria-label={copy.listTitle} variant="divided" className="mt-6">
            {data.organizers.map((organizer) => (
              <Item
                key={organizer.slug}
                href={organizerHref(kind, organizer.slug)}
                title={organizer.name}
                media={icon}
                mediaSize="icon"
                description={recipeCountLabel(organizer.recipeCount)}
              />
            ))}
          </ItemGroup>
        ) : (
          <Empty
            headingLevel={2}
            align="start"
            className="mt-6"
            icon={icon}
            title={copy.emptyList}
            description="Open one of your recipes and choose Organize from its ⋯ menu."
          />
        )}
      </div>
    </CookbookPage>
  );
}

export function OrganizerPage({ kind, data }: { kind: OrganizerKind; data: OrganizerPageData }) {
  const copy = ORGANIZER_KIND_COPY[kind];
  const icon = <copy.Icon aria-hidden="true" />;
  const { organizer, recipes, others } = data;
  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow={copy.one}
          title={organizer.name}
          size="lg"
          divider
          actions={<Link href={`/${copy.segment}`}>{copy.allLabel}</Link>}
        />
        {recipes.length > 0 ? (
          <ItemGroup aria-label={copy.recipesLabel(organizer.name)} variant="divided" className="mt-6">
            {recipes.map((recipe) => (
              <Item key={recipe.id} href={`/recipes/${recipe.id}`} title={recipe.title} description={recipe.description ?? undefined} />
            ))}
          </ItemGroup>
        ) : (
          <Empty
            headingLevel={2}
            align="start"
            className="mt-6"
            icon={icon}
            title={copy.emptyPage}
            description={copy.emptyPageDescription}
          />
        )}
        {/* Keyed by the organizer so its fields, which hold their own values, start over on another organizer's page. */}
        <OrganizerManage key={organizer.slug} kind={kind} organizer={organizer} others={others} />
      </div>
    </CookbookPage>
  );
}
