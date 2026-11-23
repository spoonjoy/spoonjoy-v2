// Under an organizer's recipes: rename it, merge it into another of its kind, or delete it (after asking). The
// organizer page's action does the work; a refusal comes back as `{ error }`.
import { Form, useActionData, useSubmit } from "react-router";
import { Alert } from "~/components/ouro/alert/alert";
import { Button } from "~/components/ouro/button/button";
import { ConfirmDialog } from "~/components/ouro/dialog/confirm-dialog";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { NativeSelect } from "~/components/ouro/select/native-select";
import { TextField } from "~/components/ouro/text-field/text-field";
import type { OrganizerKind } from "~/domains/kitchen";
import { ORGANIZER_KIND_COPY } from "./organizer-kinds";

export function OrganizerManage({
  kind,
  organizer,
  others,
}: {
  kind: OrganizerKind;
  organizer: { name: string; slug: string };
  others: { name: string; slug: string }[];
}) {
  const word = ORGANIZER_KIND_COPY[kind].one.toLowerCase();
  const actionData = useActionData() as { error?: string } | undefined;
  const submit = useSubmit();

  return (
    <section aria-labelledby="organizer-manage" className="mt-10">
      <SectionHeader id="organizer-manage" title={`Change this ${word}`} />
      {actionData?.error ? <Alert tone="destructive" title={actionData.error} className="mt-4" /> : null}
      <div className="mt-4 flex flex-col gap-6">
        <Form method="post" aria-label={`Rename this ${word}`} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="intent" value="rename" />
          <TextField label="Name" name="name" defaultValue={organizer.name} className="flex-1" />
          <Button type="submit" variant="outline" tone="secondary">Rename</Button>
        </Form>
        {others.length > 0 ? (
          <Form method="post" aria-label={`Merge this ${word}`} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="intent" value="merge" />
            <NativeSelect
              label="Merge into"
              name="into"
              description={`Its recipes move to the ${word} you choose, and this one goes.`}
              options={others.map(({ name, slug }) => ({ value: slug, label: name }))}
              className="flex-1"
            />
            <Button type="submit" variant="outline" tone="secondary">Merge</Button>
          </Form>
        ) : null}
        <div>
          <ConfirmDialog
            trigger={<Button variant="outline" tone="destructive">{`Delete ${word}`}</Button>}
            title={`Delete ${organizer.name}?`}
            description={`Its recipes stay. They just won't have this ${word}.`}
            confirmLabel="Delete it"
            cancelLabel="Keep it"
            tone="destructive"
            onConfirm={() => submit({ intent: "delete" }, { method: "post" })}
          />
        </div>
      </div>
    </section>
  );
}
