import type { Route } from "./+types/households.$id.lists.$listId";
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Form as RouterForm, data, redirect, useActionData, useFetcher, useFetchers, useLoaderData, useSubmit } from "react-router";
import { Alert } from "~/components/ouro/alert/alert";
import { Button } from "~/components/ouro/button/button";
import { Checklist } from "~/components/ouro/checklist/checklist";
import { ConfirmDialog } from "~/components/ouro/dialog/confirm-dialog";
import { Form } from "~/components/ouro/form/form";
import { Link } from "~/components/ouro/link/link";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { TextField } from "~/components/ouro/text-field/text-field";
import { CookbookPage } from "~/components/cookbook/page";
import { chefDisplayName } from "~/lib/username";
// Only the loader and action use these contexts: their indexes also export server code, which the browser bundle
// must not reach.
import { householdsRequest } from "~/domains/households-and-identity";
import {
  addHouseholdListItem,
  d1HouseholdListStore,
  deleteHouseholdList,
  getHouseholdList,
  removeHouseholdListItem,
  setHouseholdListItemChecked,
} from "~/domains/pantry-and-shopping";
import { requestD1, type D1ReadDatabase } from "~/lib/d1-read.server";

export function meta({ data: loaded }: Route.MetaArgs) {
  return [{ title: loaded ? `${loaded.list.name} - Spoonjoy` : "Shopping list - Spoonjoy" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { userId, store } = await householdsRequest(request, context);
  const lists = d1HouseholdListStore(requestD1(context) as D1ReadDatabase);
  const [household, list] = await Promise.all([
    store.household(params.id),
    getHouseholdList(lists, { householdId: params.id, listId: params.listId, userId }),
  ]);
  if (!household || !list) throw new Response("List not found", { status: 404 });
  return { household, list };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { userId } = await householdsRequest(request, context);
  const lists = d1HouseholdListStore(requestD1(context) as D1ReadDatabase);
  const form = await request.formData();
  const on = { householdId: params.id, listId: params.listId, userId };
  const itemId = String(form.get("itemId") ?? "");
  const now = new Date();
  const intent = form.get("intent");
  const done =
    intent === "add"
      ? { result: await addHouseholdListItem(lists, { ...on, text: form.get("text"), now }), as: "added" as const }
      : intent === "check"
        ? { result: await setHouseholdListItemChecked(lists, { ...on, itemId, checked: form.get("checked") === "true", now }), as: "checked" as const }
        : intent === "remove"
          ? { result: await removeHouseholdListItem(lists, { ...on, itemId }), as: "removed" as const }
          : intent === "delete"
            ? { result: await deleteHouseholdList(lists, on), as: "deleted" as const }
            : null;
  if (!done) return data({ error: "Unknown action." }, { status: 400 });
  if (!done.result.ok) return data({ error: done.result.error }, { status: done.result.forbidden ? 403 : 400 });
  if (done.as === "deleted") return redirect(`/households/${params.id}/lists`);
  return { done: done.as };
}

const itemFetcherKey = (itemId: string) => `household-list-item-${itemId}`;

/** Why the server refused the last change to an item, from that item's fetcher. */
function Refusal({ itemId }: { itemId: string }) {
  const fetcher = useFetcher<typeof action>({ key: itemFetcherKey(itemId) });
  const refused = fetcher.state === "idle" && fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  return refused ? <Alert tone="destructive" className="mt-6" title={refused} /> : null;
}

export default function HouseholdListPage() {
  const { household, list } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const [deleting, setDeleting] = useState(false);
  // Each item's changes go through its own fetcher, so ticking several at once doesn't cancel any.
  const send = (fields: { intent: string; itemId: string; checked?: string }) =>
    submit(fields, { method: "post", navigate: false, fetcherKey: itemFetcherKey(fields.itemId) });
  const fetchers = useFetchers();
  // A tick shows at once, and the next load puts back what the server kept if it refused, with the reason.
  const ticking = useMemo(
    () =>
      new Map(
        fetchers
          .filter((fetcher) => fetcher.formData?.get("intent") === "check")
          .map((fetcher) => [String(fetcher.formData?.get("itemId")), fetcher.formData?.get("checked") === "true"]),
      ),
    [fetchers],
  );

  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow={household.name} title={list.name} size="lg" divider>
          <Link href={`/households/${household.id}/lists`} className="mt-4 inline-flex min-h-11 items-center">
            ← Shopping lists
          </Link>
        </PageHeader>

        {actionData && "error" in actionData ? <Alert tone="destructive" className="mt-6" title={actionData.error} /> : null}
        {list.items.map((item) => (
          <Refusal key={item.id} itemId={item.id} />
        ))}

        {list.canEdit ? (
          // Remounts once the new item is in, which clears the field for the next one.
          <Form key={list.items.length} method="post" render={<RouterForm />} className="mt-6 gap-4">
            <input type="hidden" name="intent" value="add" />
            <div className="flex items-end gap-2">
              <TextField label="Add an item" name="text" required maxLength={200} placeholder="e.g. 2 litres milk" className="grow" />
              <Button type="submit">Add</Button>
            </div>
          </Form>
        ) : null}

        <Checklist
          label={list.name}
          hideLabel
          // A view-only member's boxes are disabled; the reason is the list's description, which a screen reader reads with them.
          description={list.canEdit ? undefined : "You can see this list. An owner can let you add to it."}
          className="mt-6"
          items={list.items.map((item) => ({
            id: item.id,
            label: item.text,
            description: item.addedBy ? `Added by ${chefDisplayName(item.addedBy)}` : undefined,
            checked: ticking.get(item.id) ?? item.checked,
            disabled: !list.canEdit,
            action: list.canEdit ? (
              <Button variant="plain" tone="secondary" aria-label={`Remove ${item.text}`} onClick={() => send({ intent: "remove", itemId: item.id })}>
                <X />
              </Button>
            ) : undefined,
          }))}
          onCheckedChange={(itemId, checked) => send({ intent: "check", itemId, checked: String(checked) })}
          empty="Nothing on this list yet"
        />

        {list.canDelete ? (
          <section className="mt-10" aria-labelledby="list-delete">
            <SectionHeader id="list-delete" title="Delete" />
            <div className="mt-4 flex">
              <Button variant="outline" tone="destructive" onClick={() => setDeleting(true)}>
                Delete list
              </Button>
            </div>
            <ConfirmDialog
              open={deleting}
              onOpenChange={setDeleting}
              onConfirm={() => submit({ intent: "delete" }, { method: "post" })}
              title={`Delete ${list.name}?`}
              description="It goes for everyone in the household, with everything on it."
              confirmLabel="Delete"
              tone="destructive"
            />
          </section>
        ) : null}
      </div>
    </CookbookPage>
  );
}
