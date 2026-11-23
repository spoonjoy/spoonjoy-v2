import type { Route } from "./+types/recipes.$id.tags";
import { Form as RouterForm, data, useActionData, useLoaderData } from "react-router";
import { Alert } from "~/components/ouro/alert/alert";
import { Badge } from "~/components/ouro/badge/badge";
import { Button } from "~/components/ouro/button/button";
import { Form } from "~/components/ouro/form/form";
import { Link } from "~/components/ouro/link/link";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { Text } from "~/components/ouro/text/text";
import { TextField } from "~/components/ouro/text-field/text-field";
import { CookbookPage } from "~/components/cookbook/page";
import { organizersOnRecipe, organizersRequest, setRecipeOrganizers, tagNamesFromInput } from "~/domains/kitchen";
import { OBJECTIONABLE_CONTENT_MESSAGE, containsObjectionableContent } from "~/lib/objectionable-terms";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `Tags for ${data.recipe.title} - Spoonjoy` : "Tags - Spoonjoy" }, { name: "robots", content: "noindex" }];
}

function notFound(): never {
  throw new Response("Not Found", { status: 404 });
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { userId, store, db } = await organizersRequest(request, context);
  const recipe = await db.recipe.findFirst({
    where: { id: params.id, chefId: userId, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!recipe) notFound();
  const tags = await organizersOnRecipe(store, recipe.id, "tag");
  return { recipe, tags: tags.map((tag) => ({ name: tag.name, slug: tag.slug })) };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { userId, store } = await organizersRequest(request, context);
  const names = tagNamesFromInput((await request.formData()).get("tags"));
  if (names.some((name) => containsObjectionableContent(name))) {
    return data({ error: OBJECTIONABLE_CONTENT_MESSAGE }, { status: 400 });
  }
  const result = await setRecipeOrganizers(store, userId, params.id, "tag", names);
  if (!result.ok) notFound();
  return { saved: true };
}

export default function RecipeTags() {
  const { recipe, tags } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow={<Link href={`/recipes/${recipe.id}`}>{recipe.title}</Link>}
          title="Tags"
          size="lg"
          divider
          description="Sort this recipe your way. Separate tags with commas."
        />
        <Form method="post" render={<RouterForm />} className="mt-6 gap-4">
          {actionData && "error" in actionData ? <Alert tone="destructive" title={actionData.error} /> : null}
          {actionData && "saved" in actionData ? <Alert tone="success" title="Tags saved." /> : null}
          <TextField
            label="Tags"
            name="tags"
            defaultValue={tags.map((tag) => tag.name).join(", ")}
            placeholder="weeknight, vegetarian, spicy"
            key={tags.map((tag) => tag.slug).join(",")}
          />
          <div className="flex sm:justify-end">
            <Button type="submit">Save tags</Button>
          </div>
        </Form>
        <section className="mt-8" aria-label="Tags on this recipe">
          {tags.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <li key={tag.slug}>
                  <Badge href={`/tags/${encodeURIComponent(tag.slug)}`}>{tag.name}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <Text tone="muted">No tags on this recipe yet.</Text>
          )}
        </section>
      </div>
    </CookbookPage>
  );
}
