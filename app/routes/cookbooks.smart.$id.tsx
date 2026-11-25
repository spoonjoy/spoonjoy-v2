import type { Route } from "./+types/cookbooks.smart.$id";
import { useLoaderData, useLocation } from "react-router";
import { Badge } from "~/components/ouro/badge/badge";
import { DescriptionList } from "~/components/ouro/description-list/description-list";
import { Empty } from "~/components/ouro/empty/empty";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Link } from "~/components/ouro/link/link";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { Pagination } from "~/components/ouro/pagination/pagination";
import { Text } from "~/components/ouro/text/text";
import { CookbookPage } from "~/components/cookbook/page";
import { smartCookbookPageLoader, type SmartCookbookRuleView } from "~/domains/kitchen/index.server";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `${data ? data.cookbook.title : "Smart cookbook"} - Spoonjoy` }];
}

export function loader({ params, ...args }: Route.LoaderArgs) {
  return smartCookbookPageLoader({ ...args, cookbookId: params.id });
}

/** One side's rules as badges that link to each organizer's page; a deleted one says so. */
function RuleBadges({ rules }: { rules: SmartCookbookRuleView[] }) {
  if (rules.length === 0) return <Text tone="muted">Nothing</Text>;
  return (
    <span className="flex flex-wrap gap-2">
      {rules.map((rule, index) =>
        "gone" in rule ? (
          <Badge key={`gone-${index}`} tone="destructive" variant="soft">Deleted</Badge>
        ) : (
          <Link key={rule.href} href={rule.href} aria-label={`${rule.kind}: ${rule.name}`}>
            <Badge variant="soft">{rule.name}</Badge>
          </Link>
        ),
      )}
    </span>
  );
}

export default function SmartCookbookPage() {
  const { cookbook, rules, missing, recipes, page, hasPreviousPage, hasNextPage } = useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  return (
    <CookbookPage>
      <PageHeader
        eyebrow={<Link href="/cookbooks">Smart cookbook</Link>}
        title={cookbook.title}
        size="lg"
        divider
        description="Fills itself with your recipes that match these rules."
      />
      <DescriptionList
        aria-label="Rules"
        className="mt-6"
        items={[
          { term: "With", details: <RuleBadges rules={rules.filter((rule) => rule.side === "with")} /> },
          { term: "Without", details: <RuleBadges rules={rules.filter((rule) => rule.side === "without")} /> },
        ]}
      />
      {recipes.length > 0 ? (
        <ItemGroup aria-label={`Recipes in ${cookbook.title}`} variant="divided" className="mt-6">
          {recipes.map((recipe) => (
            <Item
              key={recipe.id}
              href={`/recipes/${recipe.id}`}
              title={recipe.title}
              description={recipe.description ?? undefined}
              actions={recipe.servings ? <Text size="sm" tone="muted">{recipe.servings}</Text> : undefined}
            />
          ))}
        </ItemGroup>
      ) : (
        <Empty
          headingLevel={2}
          align="start"
          title="No matching recipes yet"
          description={missing
            ? "A tag, category or tool this cookbook needs was deleted, so nothing can match."
            : "Recipes you organize to match these rules show up here."}
        />
      )}
      {(hasPreviousPage || hasNextPage) ? (
        <Pagination
          className="mt-6"
          label={`${cookbook.title} pagination`}
          page={page}
          hasNextPage={hasNextPage}
          href={(target) => `${pathname}?page=${target}`}
          previousLabel="Previous page"
          nextLabel="Next page"
        />
      ) : null}
    </CookbookPage>
  );
}
