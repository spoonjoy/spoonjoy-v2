// Households use cases: create, list, open and rename a household, invite by link or email, join, leave, remove someone and
// change a role. Each checks the model's rules, then writes through the HouseholdStore port.
//
// Invite tokens are 32 random bytes in base64url, shown once in the link; only their SHA-256 is stored.

import {
  can,
  changeRole,
  leaveHousehold,
  parseHouseholdRole,
  removeMember,
  validateHouseholdName,
  type HouseholdRole,
  type Validated,
} from "../model/household";
import { inviteStatus, validateInviteInput, type HouseholdInvite, type InviteStatus } from "../model/invite";
import type { HouseholdMemberView, HouseholdStore, HouseholdSummary, StoredInvite } from "./household-store";

export type HouseholdView = {
  id: string;
  name: string;
  me: HouseholdMemberView;
  members: HouseholdMemberView[];
  /** Only an owner sees the household's invites; empty for everyone else. */
  invites: StoredInvite[];
};

const done: Validated<null> = { ok: true, value: null };

function fail<T>(error: string): Validated<T> {
  return { ok: false, error };
}

/** A refusal about who is asking, which the routes answer with 403. */
function forbid<T>(error: string): Validated<T> {
  return { ok: false, error, forbidden: true };
}

export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

export async function hashInviteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(digest).toString("hex");
}

export async function createHousehold(
  store: HouseholdStore,
  { userId, name, now }: { userId: string; name: unknown; now: Date },
): Promise<Validated<{ id: string; name: string }>> {
  const checked = validateHouseholdName(name);
  if (!checked.ok) return checked;
  const id = crypto.randomUUID();
  await store.insertHousehold({ id, name: checked.value, ownerId: userId, now });
  return { ok: true, value: { id, name: checked.value } };
}

export function listHouseholds(store: HouseholdStore, userId: string): Promise<HouseholdSummary[]> {
  return store.householdsFor(userId);
}

/** The household as `userId` sees it, or null when it doesn't exist or they aren't in it. */
export async function getHousehold(store: HouseholdStore, householdId: string, userId: string): Promise<HouseholdView | null> {
  const [household, members] = await Promise.all([store.household(householdId), store.members(householdId)]);
  const me = members.find((member) => member.userId === userId);
  if (!household || !me) return null;
  const invites = can(me, "invite") ? await store.invites(householdId) : [];
  return { id: household.id, name: household.name, me, members, invites };
}

/** Renames the household; only an owner may (can(me, "edit-settings")). */
export async function renameHousehold(
  store: HouseholdStore,
  { householdId, userId, name, now }: { householdId: string; userId: string; name: unknown; now: Date },
): Promise<Validated<{ id: string; name: string }>> {
  const me = (await store.members(householdId)).find((member) => member.userId === userId);
  if (!can(me, "edit-settings")) return forbid("Only an owner can rename the household.");
  const checked = validateHouseholdName(name);
  if (!checked.ok) return checked;
  await store.renameHousehold(householdId, checked.value, now);
  return { ok: true, value: { id: householdId, name: checked.value } };
}

export async function createInvite(
  store: HouseholdStore,
  { householdId, userId, input, now }: { householdId: string; userId: string; input: Record<string, unknown>; now: Date },
): Promise<Validated<{ invite: HouseholdInvite; token: string }>> {
  const me = (await store.members(householdId)).find((member) => member.userId === userId);
  if (!can(me, "invite")) return forbid("Only an owner can invite people.");
  const checked = validateInviteInput(input, now);
  if (!checked.ok) return checked;
  const token = generateInviteToken();
  const invite: HouseholdInvite = { id: crypto.randomUUID(), householdId, revokedAt: null, ...checked.value };
  await store.insertInvite(invite, { createdById: userId, tokenHash: await hashInviteToken(token), now });
  return { ok: true, value: { invite, token } };
}

/** What an invite link joins, for the page that offers to join; null when the token matches no invite. */
export async function previewInvite(
  store: HouseholdStore,
  token: string,
  now: Date,
): Promise<{ householdName: string; role: HouseholdRole; status: InviteStatus } | null> {
  const invite = await store.inviteByTokenHash(await hashInviteToken(token));
  return invite ? { householdName: invite.householdName, role: invite.role, status: inviteStatus(invite, now) } : null;
}

const REFUSAL: Record<Exclude<InviteStatus, "usable">, string> = {
  expired: "This invite has expired. Ask for a new one.",
  revoked: "This invite was turned off. Ask for a new one.",
  used: "This invite has already been used.",
};

/** Joins the household an invite is for. Someone already in it is let through without spending a use. */
export async function acceptInvite(
  store: HouseholdStore,
  { token, userId, userEmail, now }: { token: string; userId: string; userEmail: string | null; now: Date },
): Promise<Validated<{ householdId: string; joined: boolean }>> {
  const invite = await store.inviteByTokenHash(await hashInviteToken(token));
  if (!invite) return fail("This invite link doesn't work. Ask for a new one.");
  const members = await store.members(invite.householdId);
  if (members.some((member) => member.userId === userId)) {
    return { ok: true, value: { householdId: invite.householdId, joined: false } };
  }
  const status = inviteStatus(invite, now);
  if (status !== "usable") return fail(REFUSAL[status]);
  if (invite.email && invite.email !== userEmail?.trim().toLowerCase()) {
    return fail("This invite was sent to a different email address.");
  }
  const joined = await store.join({ inviteId: invite.id, householdId: invite.householdId, userId, role: invite.role, now });
  return joined ? { ok: true, value: { householdId: invite.householdId, joined: true } } : fail(REFUSAL.used);
}

export async function revokeInvite(
  store: HouseholdStore,
  { householdId, userId, inviteId, now }: { householdId: string; userId: string; inviteId: string; now: Date },
): Promise<Validated<null>> {
  const me = (await store.members(householdId)).find((member) => member.userId === userId);
  if (!can(me, "invite")) return forbid("Only an owner can turn off invites.");
  if (!(await store.invites(householdId)).some((invite) => invite.id === inviteId)) {
    return fail("That invite isn't in this household.");
  }
  await store.revokeInvite(householdId, inviteId, now);
  return done;
}

export async function changeMemberRole(
  store: HouseholdStore,
  { householdId, userId, targetId, role }: { householdId: string; userId: string; targetId: string; role: unknown },
): Promise<Validated<null>> {
  const parsed = parseHouseholdRole(role);
  if (!parsed) return fail("Choose owner, member or view-only.");
  const changed = changeRole(await store.members(householdId), userId, targetId, parsed);
  if (!changed.ok) return changed;
  await store.setRole(householdId, targetId, parsed);
  return done;
}

export async function removeFromHousehold(
  store: HouseholdStore,
  { householdId, userId, targetId }: { householdId: string; userId: string; targetId: string },
): Promise<Validated<null>> {
  const removed = removeMember(await store.members(householdId), userId, targetId);
  if (!removed.ok) return removed;
  await store.deleteMember(householdId, targetId);
  return done;
}

/** Leaves a household. The last person to leave deletes it (the migration's trigger). */
export async function leave(
  store: HouseholdStore,
  { householdId, userId }: { householdId: string; userId: string },
): Promise<Validated<null>> {
  const left = leaveHousehold(await store.members(householdId), userId);
  if (!left.ok) return left;
  await store.deleteMember(householdId, userId);
  return done;
}

/** The cooks who share a household with `userId`: Kitchen's canRead takes this as the viewer's householdChefIds. */
export async function householdChefIdsFor(store: HouseholdStore, userId: string): Promise<Set<string>> {
  return new Set(await store.chefIdsSharingWith(userId));
}
