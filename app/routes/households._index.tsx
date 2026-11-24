import type { Route } from "./+types/households._index";
import { Form as RouterForm, data, redirect, useActionData, useLoaderData } from "react-router";
import { Users } from "lucide-react";
import { Alert } from "~/components/ouro/alert/alert";
import { Button } from "~/components/ouro/button/button";
import { Empty } from "~/components/ouro/empty/empty";
import { Form } from "~/components/ouro/form/form";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { TextField } from "~/components/ouro/text-field/text-field";
import { CookbookPage } from "~/components/cookbook/page";
// Only the loader and action use the households context: its index also exports server code, which the browser
// bundle must not reach, so the page reads labels and limits from the loader.
import {
  HOUSEHOLD_ROLE_LABELS,
  MAX_HOUSEHOLD_NAME_LENGTH,
  createHousehold,
  householdsRequest,
  listHouseholds,
} from "~/domains/households-and-identity";
import { OBJECTIONABLE_CONTENT_MESSAGE, containsObjectionableContent } from "~/lib/objectionable-terms";

export function meta() {
  return [
    { title: "Households - Spoonjoy" },
    { name: "description", content: "Share shopping lists with the people you cook with." },
  ];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { userId, store } = await householdsRequest(request, context);
  const households = await listHouseholds(store, userId);
  return {
    households: households.map((household) => ({ ...household, roleLabel: HOUSEHOLD_ROLE_LABELS[household.role] })),
    maxNameLength: MAX_HOUSEHOLD_NAME_LENGTH,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { userId, store } = await householdsRequest(request, context);
  const form = await request.formData();
  if (form.get("intent") !== "create") return data({ error: "Unknown action." }, { status: 400 });
  const name = String(form.get("name") ?? "");
  if (containsObjectionableContent(name)) {
    return data({ error: OBJECTIONABLE_CONTENT_MESSAGE }, { status: 400 });
  }
  const made = await createHousehold(store, { userId, name, now: new Date() });
  if (!made.ok) return data({ error: made.error }, { status: 400 });
  return redirect(`/households/${made.value.id}`);
}

function people(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

export default function HouseholdsIndex() {
  const { households, maxNameLength } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Households"
          title="Cook together"
          size="lg"
          divider
          description="Share shopping lists with the people you cook with. Your own kitchen stays yours."
        />

        {households.length > 0 ? (
          <ItemGroup aria-label="Your households" variant="divided" className="mt-6">
            {households.map((household) => (
              <Item
                key={household.id}
                href={`/households/${household.id}`}
                title={household.name}
                description={`${household.roleLabel} · ${people(household.memberCount)}`}
                media={<Users aria-hidden="true" />}
                mediaSize="icon"
              />
            ))}
          </ItemGroup>
        ) : (
          <Empty
            headingLevel={2}
            align="start"
            className="mt-6"
            icon={<Users aria-hidden="true" />}
            title="No households yet"
            description="Make one for your home, then invite the people you cook with."
          />
        )}

        <section className="mt-10" aria-labelledby="new-household">
          <SectionHeader id="new-household" title="New household" />
          <Form method="post" render={<RouterForm />} className="mt-4 gap-4">
            <input type="hidden" name="intent" value="create" />
            {actionData?.error ? <Alert tone="destructive" title={actionData.error} /> : null}
            <TextField
              label="Household name"
              name="name"
              required
              maxLength={maxNameLength}
              placeholder="e.g. The Lee kitchen"
            />
            <div className="flex sm:justify-end">
              <Button type="submit">Create household</Button>
            </div>
          </Form>
        </section>
      </div>
    </CookbookPage>
  );
}
