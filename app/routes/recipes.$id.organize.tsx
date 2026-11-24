import type { Route } from "./+types/recipes.$id.organize";
import { Form as RouterForm, useActionData, useLoaderData } from "react-router";
import { Alert } from "~/components/ouro/alert/alert";
import { Button } from "~/components/ouro/button/button";
import { Combobox } from "~/components/ouro/combobox/combobox";
import { Form } from "~/components/ouro/form/form";
import { Link } from "~/components/ouro/link/link";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { CookbookPage } from "~/components/cookbook/page";
import { ORGANIZER_KIND_COPY, ORGANIZER_KIND_ORDER, organizerAddLabel, organizerMeta } from "~/components/organizers/organizer-kinds";
import { ORGANIZE_MARKER } from "~/domains/kitchen";
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
          description="Sort this recipe your way. Pick one you already use, or type a new one and press Enter."
        />
        <Form method="post" render={<RouterForm />} className="mt-6 gap-4">
          {actionData && "error" in actionData ? <Alert tone="destructive" title={actionData.error} /> : null}
          {actionData && "saved" in actionData ? <Alert tone="success" title="Saved." /> : null}
          {ORGANIZER_KIND_ORDER.map((kind) => {
            const copy = ORGANIZER_KIND_COPY[kind];
            const current = loaded[copy.segment];
            return (
              <div key={`${kind}:${current.map((organizer) => organizer.slug).join(",")}`}>
                {/* Says the form shows this kind, so removing every chip clears it. */}
                <input type="hidden" name={ORGANIZE_MARKER} value={copy.segment} />
                <Combobox
                  label={copy.label}
                  name={copy.segment}
                  multiple
                  allowCustomValue
                  items={loaded.choices[copy.segment]}
                  defaultValue={current.map((organizer) => organizer.name)}
                  placeholder={copy.placeholder}
                  customValueLabel={organizerAddLabel}
                />
              </div>
            );
          })}
          <div className="flex sm:justify-end">
            <Button type="submit">Save</Button>
          </div>
        </Form>
      </div>
    </CookbookPage>
  );
}
