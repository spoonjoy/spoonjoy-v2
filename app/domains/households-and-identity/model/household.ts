// A household: people who cook together, sharing recipes, shopping lists and a meal plan.
//
// - owner: everything a member can do, and invites people, changes roles, removes people and edits settings.
// - member: reads and changes what the household shares (lists, the plan, household recipes).
// - viewer ("view-only"): reads what the household shares and changes nothing.
//
// Rules: a household keeps at least one owner, nobody changes their own role, and an owner can't remove another owner
// without changing their role first. A person can belong to several households; their own kitchen stays theirs.

export const HOUSEHOLD_ROLES = ["owner", "member", "viewer"] as const;

export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

/** How a role reads on screen. */
export const HOUSEHOLD_ROLE_LABELS: Record<HouseholdRole, string> = { owner: "Owner", member: "Member", viewer: "View-only" };

export type HouseholdMember = { householdId: string; userId: string; role: HouseholdRole };

export type HouseholdAction = "read" | "edit-shared" | "invite" | "manage-members" | "edit-settings";

/**
 * A refusal with `forbidden` is about who is asking or who they're acting on (403), and one with `unavailable` about
 * something this server couldn't do just then, such as send mail (503); any other is about what they sent (400).
 */
export type Validated<T> = { ok: true; value: T } | { ok: false; error: string; forbidden?: true; unavailable?: true };

export const MAX_HOUSEHOLD_NAME_LENGTH = 80;

const ALLOWED: Record<HouseholdRole, readonly HouseholdAction[]> = {
  owner: ["read", "edit-shared", "invite", "manage-members", "edit-settings"],
  member: ["read", "edit-shared"],
  viewer: ["read"],
};

/** A role from user or API input, or null when it is not one. */
export function parseHouseholdRole(value: unknown): HouseholdRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (HOUSEHOLD_ROLES as readonly string[]).includes(normalized) ? (normalized as HouseholdRole) : null;
}

/** Whether this membership (null when the person isn't in the household) allows the action. */
export function can(membership: HouseholdMember | null | undefined, action: HouseholdAction): boolean {
  return membership ? ALLOWED[membership.role].includes(action) : false;
}

/** A household name from input, trimmed, or the reason it can't be used. */
export function validateHouseholdName(value: unknown): Validated<string> {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) return { ok: false, error: "Give the household a name." };
  if (name.length > MAX_HOUSEHOLD_NAME_LENGTH) return { ok: false, error: "Keep the name under 80 characters." };
  return { ok: true, value: name };
}

function find(members: readonly HouseholdMember[], userId: string): HouseholdMember | undefined {
  return members.find((candidate) => candidate.userId === userId);
}

function ownerCount(members: readonly HouseholdMember[]): number {
  return members.filter((candidate) => candidate.role === "owner").length;
}

/** The target's membership with its new role, or why `actorId` can't make the change. */
export function changeRole(
  members: readonly HouseholdMember[],
  actorId: string,
  targetId: string,
  role: HouseholdRole,
): Validated<HouseholdMember> {
  if (!can(find(members, actorId), "manage-members")) return { ok: false, error: "Only an owner can change roles.", forbidden: true };
  if (actorId === targetId) return { ok: false, error: "Ask another owner to change your role.", forbidden: true };
  const target = find(members, targetId);
  if (!target) return { ok: false, error: "That person isn't in this household." };
  return { ok: true, value: { ...target, role } };
}

/** The membership to end when `userId` leaves, or why they can't yet. The last person may always leave. */
export function leaveHousehold(members: readonly HouseholdMember[], userId: string): Validated<HouseholdMember> {
  const leaving = find(members, userId);
  if (!leaving) return { ok: false, error: "You aren't in this household.", forbidden: true };
  if (leaving.role === "owner" && members.length > 1 && ownerCount(members) === 1) {
    return { ok: false, error: "Make someone else an owner before you leave.", forbidden: true };
  }
  return { ok: true, value: leaving };
}

/** The membership to end when an owner removes someone, or why they can't. */
export function removeMember(
  members: readonly HouseholdMember[],
  actorId: string,
  targetId: string,
): Validated<HouseholdMember> {
  if (!can(find(members, actorId), "manage-members")) return { ok: false, error: "Only an owner can remove people.", forbidden: true };
  if (actorId === targetId) return { ok: false, error: "Leave the household instead.", forbidden: true };
  const target = find(members, targetId);
  if (!target) return { ok: false, error: "That person isn't in this household." };
  if (target.role === "owner") return { ok: false, error: "Change their role before removing another owner.", forbidden: true };
  return { ok: true, value: target };
}

/**
 * The cooks who share at least one household with `userId`, not counting them: the set Kitchen's canRead takes as a
 * viewer's householdChefIds for household-visible recipes.
 */
export function householdChefIds(memberships: readonly HouseholdMember[], userId: string | null | undefined): Set<string> {
  const mates = new Set<string>();
  if (!userId) return mates;
  const mine = new Set(memberships.filter((m) => m.userId === userId).map((m) => m.householdId));
  for (const m of memberships) if (mine.has(m.householdId) && m.userId !== userId) mates.add(m.userId);
  return mates;
}
