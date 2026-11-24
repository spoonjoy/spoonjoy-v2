// The port the households use cases store through. adapters/d1-household-store.server.ts is the D1 adapter.

import type { HouseholdMember, HouseholdRole } from "../model/household";
import type { HouseholdInvite } from "../model/invite";

export type HouseholdSummary = { id: string; name: string; role: HouseholdRole; memberCount: number };

export type HouseholdMemberView = HouseholdMember & { username: string; photoUrl: string | null; joinedAt: Date };

export type StoredInvite = HouseholdInvite & { createdAt: Date };

export interface HouseholdStore {
  insertHousehold(row: { id: string; name: string; ownerId: string; now: Date }): Promise<void>;
  householdsFor(userId: string): Promise<HouseholdSummary[]>;
  household(id: string): Promise<{ id: string; name: string } | null>;
  renameHousehold(id: string, name: string, now: Date): Promise<void>;
  /** Members in the order they joined. */
  members(householdId: string): Promise<HouseholdMemberView[]>;
  /** Newest first. */
  invites(householdId: string): Promise<StoredInvite[]>;
  inviteByTokenHash(tokenHash: string): Promise<(HouseholdInvite & { householdName: string }) | null>;
  insertInvite(invite: HouseholdInvite, row: { createdById: string; tokenHash: string; now: Date }): Promise<void>;
  /** Spends one use of the invite and adds the member, atomically; false when the invite stopped working meanwhile. */
  join(row: { inviteId: string; householdId: string; userId: string; role: HouseholdRole; now: Date }): Promise<boolean>;
  setRole(householdId: string, userId: string, role: HouseholdRole): Promise<void>;
  deleteMember(householdId: string, userId: string): Promise<void>;
  revokeInvite(householdId: string, inviteId: string, now: Date): Promise<void>;
  /** The account's email address, lowercased, or null when it has none. */
  emailOf(userId: string): Promise<string | null>;
  /** The other users who share at least one household with this one. */
  chefIdsSharingWith(userId: string): Promise<string[]>;
}
