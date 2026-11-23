import type { Route } from "./+types/households.$id.lists._index";
import { ListChecks } from "lucide-react";
import { Form as RouterForm, data, redirect, useActionData, useLoaderData } from "react-router";
import { Alert } from "~/components/ouro/alert/alert";
import { Button } from "~/components/ouro/button/button";
import { Empty } from "~/components/ouro/empty/empty";
import { Form } from "~/components/ouro/form/form";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Link } from "~/components/ouro/link/link";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { TextField } from "~/components/ouro/text-field/text-field";
import { CookbookPage } from "~/components/cookbook/page";
// Only the loader and action use these contexts: their indexes also export server code, which the browser bundle
// must not reach.
import { householdsRequest } from "~/domains/households-and-identity";
import { createHouseholdList, d1HouseholdListStore, listHouseholdLists } from "~/domains/pantry-and-shopping";
import { requestD1, type D1ReadDatabase } from "~/lib/d1-read.server";

export function meta({ data: loaded }: Route.MetaArgs) {
  return [{ title: loaded ? `Shopping lists - ${loaded.household.name} - Spoonjoy` : "Shopping lists - Spoonjoy" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { userId, store } = await householdsRequest(request, context);
  const lists = d1HouseholdListStore(requestD1(context) as D1ReadDatabase);
  const [household, seen] = await Promise.all([store.household(params.id), listHouseholdLists(lists, { householdId: params.id, userId })]);
  if (!household || !seen) throw new Response("Household not found", { status: 404 });
  return { household, canEdit: seen.canEdit, lists: seen.lists };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { userId } = await householdsRequest(request, context);
  const lists = d1HouseholdListStore(requestD1(context) as D1ReadDatabase);
  const form = await request.formData();
  if (form.get("intent") !== "create") return data({ error: "Unknown action." }, { status: 400 });
  const made = await createHouseholdList(lists, { householdId: params.id, userId, name: form.get("name"), now: new Date() });
  if (!made.ok) return data({ error: made.error }, { status: made.forbidden ? 403 : 400 });
  return redirect(`/households/${params.id}/lists/${made.value.id}`);
}

function counts(list: { itemCount: number; openCount: number }): string {
  const items = list.itemCount === 1 ? "1 item" : `${list.itemCount} items`;
  return `${list.openCount} to get · ${items}`;
}

export default function HouseholdListsPage() {
  const { household, canEdit, lists } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow={household.name} title="Shopping lists" size="lg" divider>
          <Link href={`/households/${household.id}`} className="mt-4 inline-flex min-h-11 items-center">
            {`← ${household.name}`}
          </Link>
        </PageHeader>

        {lists.length > 0 ? (
          <ItemGroup aria-label="Shopping lists" variant="divided" className="mt-6">
            {lists.map((list) => (
              <Item
                key={list.id}
                href={`/households/${household.id}/lists/${list.id}`}
                title={list.name}
                description={counts(list)}
                media={<ListChecks aria-hidden="true" />}
                mediaSize="icon"
              />
            ))}
          </ItemGroup>
        ) : (
          <Empty
            headingLevel={2}
            align="start"
            className="mt-6"
            icon={<ListChecks aria-hidden="true" />}
            title="No shared lists yet"
            description="Lists here are shared with everyone in the household. Your own shopping list stays yours."
          />
        )}

        {canEdit ? (
          <section className="mt-10" aria-labelledby="new-list">
            <SectionHeader id="new-list" title="New list" />
            <Form method="post" render={<RouterForm />} className="mt-4 gap-4">
              <input type="hidden" name="intent" value="create" />
              {actionData?.error ? <Alert tone="destructive" title={actionData.error} /> : null}
              <TextField label="List name" name="name" required maxLength={80} placeholder="e.g. Groceries" />
              <div className="flex sm:justify-end">
                <Button type="submit">Make list</Button>
              </div>
            </Form>
          </section>
        ) : null}
      </div>
    </CookbookPage>
  );
}
