import type { Route } from "./+types/households.$id";
import { useState } from "react";
import { Ellipsis } from "lucide-react";
import { Form as RouterForm, data, redirect, useActionData, useLoaderData, useSubmit } from "react-router";
import { Alert } from "~/components/ouro/alert/alert";
import { Avatar } from "~/components/ouro/avatar/avatar";
import { Badge } from "~/components/ouro/badge/badge";
import { Button } from "~/components/ouro/button/button";
import { CopyButton } from "~/components/ouro/copy-button/copy-button";
import { ConfirmDialog } from "~/components/ouro/dialog/confirm-dialog";
import { Form } from "~/components/ouro/form/form";
import { Item } from "~/components/ouro/item/item";
import { ItemGroup } from "~/components/ouro/item/item-group";
import { Link } from "~/components/ouro/link/link";
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem } from "~/components/ouro/menu/menu";
import { PageHeader } from "~/components/ouro/page-header/page-header";
import { SectionHeader } from "~/components/ouro/section-header/section-header";
import { NativeSelect } from "~/components/ouro/select/native-select";
import { Text } from "~/components/ouro/text/text";
import { TextField } from "~/components/ouro/text-field/text-field";
import { CookbookPage } from "~/components/cookbook/page";
// Only the loader and action use the households context: its index also exports server code, which the browser
// bundle must not reach, so the page reads labels from the loader.
import {
  DEFAULT_INVITE_DAYS,
  HOUSEHOLD_ROLES,
  HOUSEHOLD_ROLE_LABELS,
  can,
  changeMemberRole,
  createInvite,
  getHousehold,
  householdsRequest,
  leave,
  removeFromHousehold,
} from "~/domains/households-and-identity";

export function meta({ data: loaded }: Route.MetaArgs) {
  return [{ title: `${loaded?.household.name ?? "Household"} - Spoonjoy` }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { userId, store } = await householdsRequest(request, context);
  const household = await getHousehold(store, params.id, userId);
  if (!household) throw new Response("Household not found", { status: 404 });
  return {
    household: {
      id: household.id,
      name: household.name,
      myRole: household.me.role,
      canInvite: can(household.me, "invite"),
      canManage: can(household.me, "manage-members"),
      roleChoices: HOUSEHOLD_ROLES.map((role) => ({ value: role, label: HOUSEHOLD_ROLE_LABELS[role] })),
      members: household.members.map((member) => ({
        userId: member.userId,
        username: member.username,
        photoUrl: member.photoUrl,
        role: member.role,
        roleLabel: HOUSEHOLD_ROLE_LABELS[member.role],
        me: member.userId === userId,
      })),
    },
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const { userId, store } = await householdsRequest(request, context);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "invite") {
    const role = form.get("role");
    const made = await createInvite(store, { householdId: params.id, userId, input: { role }, now: new Date() });
    if (!made.ok) return data({ error: made.error }, { status: 400 });
    return {
      inviteUrl: new URL(`/join/${made.value.token}`, request.url).href,
      invitedAs: made.value.invite.role === "viewer" ? "view-only" : "as a member",
      inviteDays: DEFAULT_INVITE_DAYS,
    };
  }
  if (intent === "role") {
    const changed = await changeMemberRole(store, {
      householdId: params.id,
      userId,
      targetId: String(form.get("targetId") ?? ""),
      role: form.get("role"),
    });
    if (!changed.ok) return data({ error: changed.error }, { status: 400 });
    return { done: "role" as const };
  }
  if (intent === "remove") {
    const removed = await removeFromHousehold(store, { householdId: params.id, userId, targetId: String(form.get("targetId") ?? "") });
    if (!removed.ok) return data({ error: removed.error }, { status: 400 });
    return { done: "removed" as const };
  }
  if (intent === "leave") {
    const left = await leave(store, { householdId: params.id, userId });
    if (!left.ok) return data({ error: left.error }, { status: 400 });
    return redirect("/households");
  }
  return data({ error: "Unknown action." }, { status: 400 });
}

export default function HouseholdPage() {
  const { household } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const error = actionData && "error" in actionData ? actionData.error : null;
  const invite = actionData && "inviteUrl" in actionData && actionData.inviteUrl
    ? { inviteUrl: actionData.inviteUrl, invitedAs: actionData.invitedAs, inviteDays: actionData.inviteDays }
    : null;
  const submit = useSubmit();
  const [removing, setRemoving] = useState<{ userId: string; username: string } | null>(null);
  // Choosing a role keeps a menu open by default; this one closes once the role is sent.
  const [menuFor, setMenuFor] = useState<string | null>(null);

  return (
    <CookbookPage>
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow="Household" title={household.name} size="lg" divider>
          <Link href="/households" className="mt-4 inline-flex min-h-11 items-center">
            ← All households
          </Link>
        </PageHeader>

        {error ? <Alert tone="destructive" className="mt-6" title={error} /> : null}

        <section className="mt-8" aria-labelledby="household-people">
          <SectionHeader
            id="household-people"
            title="People"
            meta={household.members.length === 1 ? "1 person" : `${household.members.length} people`}
          />
          <ItemGroup aria-label="People" variant="divided" className="mt-2">
            {household.members.map((member) => (
              <Item
                key={member.userId}
                title={member.me ? `${member.username} (you)` : member.username}
                media={<Avatar name={member.username} src={member.photoUrl ?? undefined} alt="" />}
                actions={
                  <div className="flex items-center gap-2">
                    <Badge tone={member.role === "owner" ? "primary" : "secondary"} variant="soft">
                      {member.roleLabel}
                    </Badge>
                    {household.canManage && !member.me ? (
                      <Menu
                        open={menuFor === member.userId}
                        onOpenChange={(open) => setMenuFor(open ? member.userId : null)}
                        trigger={
                          <Button variant="outline" tone="secondary" aria-label={`Actions for ${member.username}`}>
                            <Ellipsis />
                          </Button>
                        }
                      >
                        <MenuRadioGroup
                          label="Role"
                          value={member.role}
                          onValueChange={(role) => {
                            setMenuFor(null);
                            submit({ intent: "role", targetId: member.userId, role }, { method: "post" });
                          }}
                        >
                          {household.roleChoices.map((choice) => (
                            <MenuRadioItem key={choice.value} value={choice.value}>
                              {choice.label}
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                        <MenuItem
                          tone="destructive"
                          onClick={() => setRemoving({ userId: member.userId, username: member.username })}
                        >
                          Remove from household
                        </MenuItem>
                      </Menu>
                    ) : null}
                  </div>
                }
              />
            ))}
          </ItemGroup>
        </section>

        {removing ? (
          <ConfirmDialog
            open
            onOpenChange={() => setRemoving(null)}
            onConfirm={() => submit({ intent: "remove", targetId: removing.userId }, { method: "post" })}
            title={`Remove ${removing.username}?`}
            description="They lose what the household shares. You can invite them again later."
            confirmLabel="Remove"
            tone="destructive"
          />
        ) : null}

        {household.canInvite ? (
          <section className="mt-10" aria-labelledby="household-invite">
            <SectionHeader id="household-invite" title="Invite someone" />
            <Form method="post" render={<RouterForm />} className="mt-4 gap-4">
              <input type="hidden" name="intent" value="invite" />
              <NativeSelect
                label="They join as"
                name="role"
                defaultValue="member"
                options={[
                  { value: "member", label: "Member: adds to the shared lists and plan" },
                  { value: "viewer", label: "View-only: sees what the household shares" },
                ]}
              />
              <div className="flex sm:justify-end">
                <Button type="submit">Make invite link</Button>
              </div>
            </Form>
            {invite ? (
              <div className="mt-6 flex flex-col gap-3">
                <div className="flex items-end gap-2">
                  <TextField label="Invite link" value={invite.inviteUrl} readOnly className="grow" />
                  <CopyButton value={invite.inviteUrl} label="Copy link" />
                </div>
                <Text tone="muted">
                  {`Anyone with this link joins ${invite.invitedAs}. It works once, for ${invite.inviteDays} days.`}
                </Text>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="mt-10" aria-labelledby="household-leave">
          <SectionHeader id="household-leave" title="Leave" />
          <Form method="post" render={<RouterForm />} className="mt-4">
            <input type="hidden" name="intent" value="leave" />
            <div className="flex">
              <Button type="submit" variant="outline" tone="destructive">
                Leave household
              </Button>
            </div>
          </Form>
        </section>
      </div>
    </CookbookPage>
  );
}
