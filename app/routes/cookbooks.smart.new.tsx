import type { Route } from "./+types/cookbooks.smart.new";
import { Form as RouterForm, useActionData, useLoaderData } from "react-router";
import { Alert } from "~/components/ouro/alert/alert";
import { Button } from "~/components/ouro/button/button";
import { Combobox } from "~/components/ouro/combobox/combobox";
import { Form } from "~/components/ouro/form/form";
import { Link } from "~/components/ouro/link/link";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { TextField } from "~/components/ouro/text-field/text-field";
import { CookbookPage } from "~/components/cookbook/page";
import { newSmartCookbookAction, newSmartCookbookLoader } from "~/domains/kitchen/index.server";

export function meta() {
  return [{ title: "New smart cookbook - Spoonjoy" }];
}

export function loader(args: Route.LoaderArgs) {
  return newSmartCookbookLoader(args);
}

export function action(args: Route.ActionArgs) {
  return newSmartCookbookAction(args);
}

export default function NewSmartCookbook() {
  const { choices, titleMaxLength } = useLoaderData<typeof loader>();
  const refused = useActionData<typeof action>();
  const values = refused?.values;
  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow={<Link href="/cookbooks">Cookbooks</Link>}
          title="New smart cookbook"
          size="lg"
          divider
          description="It fills itself with your recipes that have every tag, category and tool you pick, and none you leave out."
        />
        {/* Keyed by what was sent, so a refused form starts its fields from what the cook picked. */}
        <Form key={JSON.stringify(values ?? null)} method="post" render={<RouterForm />} className="mt-6 gap-4">
          {refused?.error ? <Alert tone="destructive" title={refused.error} /> : null}
          <TextField label="Title" name="title" required maxLength={titleMaxLength} defaultValue={values?.title} placeholder="Weeknight soups" />
          <Combobox
            label="With"
            name="with"
            multiple
            items={choices}
            defaultValue={values?.with}
            placeholder="Tags, categories or tools every recipe has"
          />
          <Combobox
            label="Without"
            name="without"
            multiple
            items={choices}
            defaultValue={values?.without}
            placeholder="Tags, categories or tools to leave out"
          />
          <div className="flex sm:justify-end">
            <Button type="submit">Create smart cookbook</Button>
          </div>
        </Form>
      </div>
    </CookbookPage>
  );
}
