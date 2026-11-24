import type { Route } from "./+types/join.$token";
import { Form as RouterForm, data, redirect, useActionData, useLoaderData } from "react-router";
import { Users } from "lucide-react";
import { Alert } from "~/components/ouro/alert/alert";
import { Button } from "~/components/ouro/button/button";
import { Empty } from "~/components/ouro/empty/empty";
import { Form } from "~/components/ouro/form/form";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { CookbookPage } from "~/components/cookbook/page";
// Only the loader and action use the households context: its index also exports server code.
import { acceptInvite, householdsRequest, previewInvite } from "~/domains/households-and-identity";

export function meta() {
  return [{ title: "Join a household - Spoonjoy" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { store } = await householdsRequest(request, context);
  return { invite: await previewInvite(store, params.token, new Date()) };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { userId, store } = await householdsRequest(request, context);
  const userEmail = await store.emailOf(userId);
  const joined = await acceptInvite(store, { token: params.token, userId, userEmail, now: new Date() });
  if (!joined.ok) return data({ error: joined.error }, { status: 400 });
  return redirect(`/households/${joined.value.householdId}`);
}

const NOT_USABLE = {
  expired: "This invite has expired. Ask for a new one.",
  revoked: "This invite was turned off. Ask for a new one.",
  used: "This invite has already been used.",
} as const;

export default function JoinPage() {
  const { invite } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  const refusal = !invite
    ? "This invite link doesn't work. Ask for a new one."
    : invite.status === "usable"
      ? null
      : NOT_USABLE[invite.status];

  if (!invite || refusal) {
    return (
      <CookbookPage>
        <div className="mx-auto max-w-3xl">
          <PageHeader eyebrow="Household invite" title="This invite can't be used" size="lg" divider />
          <Empty
            headingLevel={2}
            align="start"
            className="mt-6"
            icon={<Users aria-hidden="true" />}
            title="Ask for a new link"
            description={refusal}
            action={<Button href="/households" variant="outline" tone="secondary">Your households</Button>}
          />
        </div>
      </CookbookPage>
    );
  }

  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <PageHeader
          eyebrow="Household invite"
          title={`Join ${invite.householdName}`}
          size="lg"
          divider
          description={
            invite.role === "viewer"
              ? "You'll join view-only: you can see what it shares."
              : "You'll join as a member: you can add to the shared lists."
          }
        />
        <Form method="post" render={<RouterForm />} className="mt-6 gap-4">
          {actionData?.error ? <Alert tone="destructive" title={actionData.error} /> : null}
          <div className="flex">
            <Button type="submit">Join household</Button>
          </div>
        </Form>
      </div>
    </CookbookPage>
  );
}
