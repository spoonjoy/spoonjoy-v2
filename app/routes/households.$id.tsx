import type { Route } from "./+types/households.$id";
import { useEffect, useState } from "react";
import { CalendarDays, Ellipsis, ListChecks } from "lucide-react";
import { Form as RouterForm, data, redirect, useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
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
import { Spinner } from "~/components/ouro/spinner/spinner";
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
  inviteStatus,
  MAX_HOUSEHOLD_NAME_LENGTH,
  can,
  changeMemberRole,
  createInvite,
  emailInvite,
  getHousehold,
  householdsRequest,
  leave,
  removeFromHousehold,
  renameHousehold,
  revokeInvite,
} from "~/domains/households-and-identity";
import { OBJECTIONABLE_CONTENT_MESSAGE, containsObjectionableContent } from "~/lib/objectionable-terms";
import { cloudflarePlatform, type CloudflarePlatformEnv } from "~/domains/platform/index.server";
import { canSendAccountEmail } from "~/lib/transactional-email.server";

const INVITE_ROLE_OPTIONS = [
  { value: "member", label: "Member: adds to the shared lists" },
  { value: "viewer", label: "View-only: sees what the household shares" },
];

export function meta({ data: loaded }: Route.MetaArgs) {
  return [{ title: `${loaded?.household.name ?? "Household"} - Spoonjoy` }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { userId, store } = await householdsRequest(request, context);
  const household = await getHousehold(store, params.id, userId);
  if (!household) throw new Response("Household not found", { status: 404 });
  const now = new Date();
  return {
    household: {
      id: household.id,
      name: household.name,
      myRole: household.me.role,
      canInvite: can(household.me, "invite"),
      canManage: can(household.me, "manage-members"),
      canRename: can(household.me, "edit-settings"),
      maxNameLength: MAX_HOUSEHOLD_NAME_LENGTH,
      // Inviting by email shows only where this server can send mail.
      canEmailInvites: can(household.me, "invite") && canSendAccountEmail(context.cloudflare?.env),
      // Email invites still waiting to be used; owners only, as getHousehold gives invites to owners alone.
      emailInvites: household.invites
        .filter((invite) => invite.email && inviteStatus(invite, now) === "usable")
        .map((invite) => ({ id: invite.id, email: invite.email!, roleLabel: HOUSEHOLD_ROLE_LABELS[invite.role] })),
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
    if (!made.ok) return data({ error: made.error }, { status: made.forbidden ? 403 : 400 });
    return {
      inviteUrl: new URL(`/join/${made.value.token}`, request.url).href,
      invitedAs: made.value.invite.role === "viewer" ? "view-only" : "as a member",
      inviteDays: DEFAULT_INVITE_DAYS,
    };
  }
  if (intent === "email-invite") {
    const env = context.cloudflare?.env as CloudflarePlatformEnv | undefined;
    if (!env || !canSendAccountEmail(env)) {
      return data({ error: "Email isn't set up on this Spoonjoy server. Make an invite link and send it to them yourself." }, { status: 503 });
    }
    const sent = await emailInvite(store, cloudflarePlatform(env).email, {
      householdId: params.id,
      userId,
      input: { email: form.get("email"), role: form.get("role") },
      now: new Date(),
      joinUrl: (token) => new URL(`/join/${token}`, request.url).href,
    });
    if (!sent.ok) return data({ error: sent.error }, { status: sent.forbidden ? 403 : sent.unavailable ? 503 : 400 });
    return { invitedEmail: sent.value.to };
  }
  if (intent === "rename") {
    const name = String(form.get("name") ?? "");
    if (containsObjectionableContent(name)) return data({ error: OBJECTIONABLE_CONTENT_MESSAGE }, { status: 400 });
    const renamed = await renameHousehold(store, { householdId: params.id, userId, name, now: new Date() });
    if (!renamed.ok) return data({ error: renamed.error }, { status: renamed.forbidden ? 403 : 400 });
    return { done: "renamed" as const };
  }
  if (intent === "revoke-invite") {
    const revoked = await revokeInvite(store, {
      householdId: params.id,
      userId,
      inviteId: String(form.get("inviteId") ?? ""),
      now: new Date(),
    });
    if (!revoked.ok) return data({ error: revoked.error }, { status: revoked.forbidden ? 403 : 400 });
    return { done: "revoked" as const };
  }
  if (intent === "role") {
    const changed = await changeMemberRole(store, {
      householdId: params.id,
      userId,
      targetId: String(form.get("targetId") ?? ""),
      role: form.get("role"),
    });
    if (!changed.ok) return data({ error: changed.error }, { status: changed.forbidden ? 403 : 400 });
    return { done: "role" as const };
  }
  if (intent === "remove") {
    const removed = await removeFromHousehold(store, { householdId: params.id, userId, targetId: String(form.get("targetId") ?? "") });
    if (!removed.ok) return data({ error: removed.error }, { status: removed.forbidden ? 403 : 400 });
    return { done: "removed" as const };
  }
  if (intent === "leave") {
    const left = await leave(store, { householdId: params.id, userId });
    // Every refusal to leave is about who is asking (not in it, or the last owner), so it is always 403.
    if (!left.ok) return data({ error: left.error }, { status: 403 });
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
  const invitedEmail = actionData && "invitedEmail" in actionData ? actionData.invitedEmail : null;
  // The address typed for an email invite: Send invite needs one, and a sent invite clears it.
  const [inviteEmail, setInviteEmail] = useState("");
  const [clearedFor, setClearedFor] = useState(invitedEmail);
  if (invitedEmail !== clearedFor) {
    setClearedFor(invitedEmail);
    if (invitedEmail) setInviteEmail("");
  }
  // A new invite link goes straight to the clipboard where the browser allows it; the field below shows it either way.
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  useEffect(() => {
    if (!invite?.inviteUrl) return;
    navigator.clipboard?.writeText(invite.inviteUrl).then(
      () => setCopiedLink(invite.inviteUrl),
      () => setCopiedLink(null),
    );
  }, [invite?.inviteUrl]);
  const submit = useSubmit();
  // The person whose role change or removal the server is still deciding. Their row keeps the role it has, with a
  // spinner, until the answer comes back: the new role, or the reason in the alert above and the old role kept.
  const navigation = useNavigation();
  const savingFor = navigation.state !== "idle" ? navigation.formData?.get("targetId") : null;
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
                    {savingFor === member.userId ? (
                      <Spinner size="sm" label="Saving" />
                    ) : household.canManage && !member.me ? (
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

        <section className="mt-10" aria-labelledby="household-shared">
          <SectionHeader id="household-shared" title="Shared" />
          <ItemGroup aria-label="Shared" variant="divided" className="mt-2">
            <Item
              href={`/households/${household.id}/lists`}
              title="Shopping lists"
              description="Lists everyone in the household shops from"
              media={<ListChecks aria-hidden="true" />}
              mediaSize="icon"
            />
            <Item
              href={`/households/${household.id}/plan`}
              title="Meal plan"
              description="The week's meals everyone in the household cooks from"
              media={<CalendarDays aria-hidden="true" />}
              mediaSize="icon"
            />
          </ItemGroup>
        </section>

        {household.canInvite ? (
          <section className="mt-10" aria-labelledby="household-invite">
            <SectionHeader id="household-invite" title="Invite someone" />
            <Form method="post" render={<RouterForm />} className="mt-4 gap-4" aria-labelledby="household-invite">
              <NativeSelect label="They join as" name="role" defaultValue="member" options={INVITE_ROLE_OPTIONS} />
              {household.canEmailInvites ? (
                <TextField
                  label="Email address"
                  name="email"
                  type="email"
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.currentTarget.value)}
                  description="We email them a link that works only for their account. Or copy a link to share yourself."
                />
              ) : null}
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Button
                  type="submit"
                  name="intent"
                  value="invite"
                  formNoValidate
                  variant={household.canEmailInvites ? "outline" : undefined}
                  tone={household.canEmailInvites ? "secondary" : undefined}
                >
                  Copy invite link
                </Button>
                {household.canEmailInvites ? (
                  <Button
                    type="submit"
                    name="intent"
                    value="email-invite"
                    disabledReason={inviteEmail.trim() ? undefined : "Enter their email address first."}
                  >
                    Send invite
                  </Button>
                ) : null}
              </div>
            </Form>
            {invite ? (
              <div className="mt-6 flex flex-col gap-3">
                <div className="flex items-end gap-2">
                  <TextField label="Invite link" value={invite.inviteUrl} readOnly className="grow" />
                  <CopyButton value={invite.inviteUrl} label="Copy link" />
                </div>
                <Text tone="muted" role="status">
                  {copiedLink === invite.inviteUrl
                    ? `Link copied. Anyone with it joins ${invite.invitedAs}. It works once, for ${invite.inviteDays} days.`
                    : `Anyone with this link joins ${invite.invitedAs}. It works once, for ${invite.inviteDays} days.`}
                </Text>
              </div>
            ) : null}
            {invitedEmail ? (
              <Text role="status" className="mt-4">{`Invite sent to ${invitedEmail}.`}</Text>
            ) : null}
            {household.emailInvites.length > 0 ? (
              <div className="mt-8">
                <SectionHeader
                  id="household-waiting"
                  title="Waiting to join"
                  level={3}
                  meta={household.emailInvites.length === 1 ? "1 invite" : `${household.emailInvites.length} invites`}
                />
                <ItemGroup aria-label="Waiting to join" variant="divided" className="mt-2">
                  {household.emailInvites.map((pending) => (
                    <Item
                      key={pending.id}
                      title={pending.email}
                      actions={
                        <div className="flex items-center gap-2">
                          <Badge tone="secondary" variant="soft">
                            {pending.roleLabel}
                          </Badge>
                          <RouterForm method="post">
                            <input type="hidden" name="intent" value="revoke-invite" />
                            <input type="hidden" name="inviteId" value={pending.id} />
                            <Button type="submit" variant="outline" tone="secondary" aria-label={`Cancel invite to ${pending.email}`}>
                              Cancel
                            </Button>
                          </RouterForm>
                        </div>
                      }
                    />
                  ))}
                </ItemGroup>
              </div>
            ) : null}
          </section>
        ) : null}

        {household.canRename ? (
          <section className="mt-10" aria-labelledby="household-name">
            <SectionHeader id="household-name" title="Name" />
            {/* Keyed by the name, so the field shows the saved name once the page reloads its data. */}
            <Form key={household.name} method="post" render={<RouterForm />} className="mt-4 gap-4">
              <input type="hidden" name="intent" value="rename" />
              <TextField
                label="Household name"
                name="name"
                required
                maxLength={household.maxNameLength}
                defaultValue={household.name}
              />
              <div className="flex sm:justify-end">
                <Button type="submit" variant="outline" tone="secondary">
                  Save name
                </Button>
              </div>
            </Form>
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
