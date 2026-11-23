// Invites into a household, by link (works a set number of times) or for one email address. The secret token is made,
// hashed and checked by the application layer; this model holds the rules for what an invite may be and when it works.

import type { HouseholdRole, Validated } from "./household";

export type HouseholdInvite = {
  id: string;
  householdId: string;
  /** The role a person joins with. Never owner: an owner promotes someone after they join. */
  role: Exclude<HouseholdRole, "owner">;
  usesLeft: number;
  /** Set for an invite sent to one address; null for a link anyone holding it can use. */
  email: string | null;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type InviteStatus = "usable" | "expired" | "revoked" | "used";

export type InviteInput = Pick<HouseholdInvite, "role" | "usesLeft" | "email" | "expiresAt">;

export const DEFAULT_INVITE_DAYS = 14;
export const MAX_INVITE_DAYS = 30;
export const MAX_INVITE_USES = 50;

const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Whether an invite can still be accepted at `now`. */
export function inviteStatus(invite: HouseholdInvite, now: Date): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.usesLeft <= 0) return "used";
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  return "usable";
}

/** A new invite from untrusted input (a form, the API or an agent), or the reason it can't be made. */
export function validateInviteInput(input: Record<string, unknown>, now: Date): Validated<InviteInput> {
  const role = input.role ?? "member";
  if (role !== "member" && role !== "viewer") {
    return { ok: false, error: "Invite people as a member or view-only; make them an owner after they join." };
  }
  const uses = input.uses ?? 1;
  if (typeof uses !== "number" || !Number.isInteger(uses) || uses < 1 || uses > MAX_INVITE_USES) {
    return { ok: false, error: "An invite works 1 to 50 times." };
  }
  const days = input.days ?? DEFAULT_INVITE_DAYS;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_INVITE_DAYS) {
    return { ok: false, error: "An invite lasts 1 to 30 days." };
  }
  const rawEmail = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (rawEmail && !EMAIL.test(rawEmail)) return { ok: false, error: "That email address doesn't look right." };
  return {
    ok: true,
    value: { role, usesLeft: uses, email: rawEmail || null, expiresAt: new Date(now.getTime() + days * DAY_MS) },
  };
}
