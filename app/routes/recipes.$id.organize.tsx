import type { Route } from "./+types/recipes.$id.organize";
import { Form as RouterForm, useActionData, useLoaderData } from "react-router";
import { Alert } from "~/components/ouro/alert/alert";
import { Badge } from "~/components/ouro/badge/badge";
import { Button } from "~/components/ouro/button/button";
import { Form } from "~/components/ouro/form/form";
import { Link } from "~/components/ouro/link/link";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { Text } from "~/components/ouro/text/text";
import { TextField } from "~/components/ouro/text-field/text-field";
import { CookbookPage } from "~/components/cookbook/page";
import { ORGANIZER_KIND_COPY, ORGANIZER_KIND_ORDER, organizerHref, organizerMeta } from "~/components/organizers/organizer-kinds";
import { recipeOrganizeAction, recipeOrganizeLoader } from "~/domains/kitchen/index.server";

export function meta({ data }: Route.MetaArgs) {
  return organizerMeta(data ? `Organize ${data.recipe.title}` : "Organize");
}

export function loader({ params, ...args }: Route.LoaderArgs) {
  return recipeOrganizeLoader({ ...args, recipeId: params.id });
}

export function action({ params, ...args }: Route.ActionArgs) {
  return recipeOrganizeAction({ ...args, recipeId: params.id });
}

export default function RecipeOrganize() {
  const loaded = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const { recipe } = loaded;
  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow={<Link href={`/recipes/${recipe.id}`}>{recipe.title}</Link>}
          title="Organize"
          size="lg"
          divider
          description="Sort this recipe your way. Separate names with commas."
        />
        <Form method="post" render={<RouterForm />} className="mt-6 gap-4">
          {actionData && "error" in actionData ? <Alert tone="destructive" title={actionData.error} /> : null}
          {actionData && "saved" in actionData ? <Alert tone="success" title="Saved." /> : null}
          {ORGANIZER_KIND_ORDER.map((kind) => {
            const copy = ORGANIZER_KIND_COPY[kind];
            const current = loaded[copy.segment];
            return (
              <TextField
                key={`${kind}:${current.map((organizer) => organizer.slug).join(",")}`}
                label={copy.label}
                name={copy.segment}
                defaultValue={current.map((organizer) => organizer.name).join(", ")}
                placeholder={copy.placeholder}
              />
            );
          })}
          <div className="flex sm:justify-end">
            <Button type="submit">Save</Button>
          </div>
        </Form>
        {ORGANIZER_KIND_ORDER.map((kind) => {
          const copy = ORGANIZER_KIND_COPY[kind];
          const current = loaded[copy.segment];
          return (
            <section key={kind} className="mt-8" aria-label={`${copy.label} on this recipe`}>
              {current.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {current.map((organizer) => (
                    <li key={organizer.slug}>
                      <Badge href={organizerHref(kind, organizer.slug)}>{organizer.name}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <Text tone="muted">{copy.emptyOnRecipe}</Text>
              )}
            </section>
          );
        })}
      </div>
    </CookbookPage>
  );
}
