import { describe, expect, it } from "vitest";
import {
  HOUSEHOLD_ROLES,
  can,
  changeRole,
  householdChefIds,
  inviteStatus,
  leaveHousehold,
  parseHouseholdRole,
  removeMember,
  validateHouseholdName,
  validateInviteInput,
  type HouseholdInvite,
  type HouseholdMember,
} from "~/domains/households-and-identity";
import { FLAG_NAMES, isFlagOn } from "~/domains/platform";

const owner: HouseholdMember = { householdId: "h1", userId: "ann", role: "owner" };
const member: HouseholdMember = { householdId: "h1", userId: "ben", role: "member" };
const viewer: HouseholdMember = { householdId: "h1", userId: "cal", role: "viewer" };
const kitchen = [owner, member, viewer];

describe("household roles", () => {
  it("has owner, member and view-only, and reads only those", () => {
    expect(HOUSEHOLD_ROLES).toEqual(["owner", "member", "viewer"]);
    expect(parseHouseholdRole(" Member ")).toBe("member");
    for (const bad of ["admin", "manager", "", null, undefined, 3]) expect(parseHouseholdRole(bad)).toBeNull();
  });

  it("lets owners manage, members cook together and view-only members only read", () => {
    expect(can(owner, "invite")).toBe(true);
    expect(can(owner, "manage-members")).toBe(true);
    expect(can(owner, "edit-settings")).toBe(true);
    expect(can(member, "edit-shared")).toBe(true);
    expect(can(member, "invite")).toBe(false);
    expect(can(member, "manage-members")).toBe(false);
    expect(can(viewer, "read")).toBe(true);
    expect(can(viewer, "edit-shared")).toBe(false);
    expect(can(null, "read")).toBe(false);
  });
});

describe("household name", () => {
  it("trims a name and refuses an empty or overlong one, saying why", () => {
    expect(validateHouseholdName("  The Lee kitchen ")).toEqual({ ok: true, value: "The Lee kitchen" });
    expect(validateHouseholdName("   ")).toEqual({ ok: false, error: "Give the household a name." });
    expect(validateHouseholdName("x".repeat(81))).toEqual({ ok: false, error: "Keep the name under 80 characters." });
    expect(validateHouseholdName(undefined)).toEqual({ ok: false, error: "Give the household a name." });
  });
});

describe("household membership changes", () => {
  it("lets an owner change another member's role", () => {
    expect(changeRole(kitchen, "ann", "cal", "member")).toEqual({ ok: true, value: { ...viewer, role: "member" } });
  });

  it("refuses a role change from a non-owner or on yourself", () => {
    expect(changeRole(kitchen, "ben", "cal", "member")).toEqual({ ok: false, error: "Only an owner can change roles." });
    expect(changeRole(kitchen, "ann", "ann", "member")).toEqual({
      ok: false,
      error: "Ask another owner to change your role.",
    });
    expect(changeRole(kitchen, "ann", "zed", "member")).toEqual({ ok: false, error: "That person isn't in this household." });
  });

  it("keeps at least one owner", () => {
    const twoOwners = [owner, { ...member, role: "owner" as const }];
    expect(changeRole(twoOwners, "ben", "ann", "member").ok).toBe(true);
    expect(leaveHousehold(kitchen, "ann")).toEqual({
      ok: false,
      error: "Make someone else an owner before you leave.",
    });
    expect(leaveHousehold(twoOwners, "ann")).toEqual({ ok: true, value: owner });
    expect(leaveHousehold([owner], "ann")).toEqual({ ok: true, value: owner });
    expect(leaveHousehold(kitchen, "ben")).toEqual({ ok: true, value: member });
    expect(leaveHousehold(kitchen, "zed")).toEqual({ ok: false, error: "You aren't in this household." });
  });

  it("lets an owner remove someone else, but not another owner", () => {
    const twoOwners = [owner, { ...member, role: "owner" as const }, viewer];
    expect(removeMember(kitchen, "ann", "cal")).toEqual({ ok: true, value: viewer });
    expect(removeMember(kitchen, "ben", "cal")).toEqual({ ok: false, error: "Only an owner can remove people." });
    expect(removeMember(twoOwners, "ann", "ben")).toEqual({
      ok: false,
      error: "Change their role before removing another owner.",
    });
    expect(removeMember(kitchen, "ann", "ann")).toEqual({ ok: false, error: "Leave the household instead." });
    expect(removeMember(kitchen, "ann", "zed")).toEqual({ ok: false, error: "That person isn't in this household." });
  });
});

describe("householdChefIds", () => {
  it("names the cooks who share any household with you, not yourself or strangers", () => {
    const memberships: HouseholdMember[] = [
      ...kitchen,
      { householdId: "h2", userId: "ben", role: "owner" },
      { householdId: "h2", userId: "dee", role: "member" },
      { householdId: "h3", userId: "eve", role: "owner" },
    ];
    expect([...householdChefIds(memberships, "ben")].sort()).toEqual(["ann", "cal", "dee"]);
    expect([...householdChefIds(memberships, "eve")]).toEqual([]);
    expect([...householdChefIds(memberships, null)]).toEqual([]);
  });
});

describe("household invites", () => {
  const now = new Date("2026-11-23T12:00:00Z");
  const invite: HouseholdInvite = {
    id: "i1",
    householdId: "h1",
    role: "member",
    usesLeft: 1,
    email: null,
    expiresAt: new Date("2026-12-07T12:00:00Z"),
    revokedAt: null,
  };

  it("is usable until it expires, is revoked or runs out of uses", () => {
    expect(inviteStatus(invite, now)).toBe("usable");
    expect(inviteStatus({ ...invite, expiresAt: now }, now)).toBe("expired");
    expect(inviteStatus({ ...invite, revokedAt: now }, now)).toBe("revoked");
    expect(inviteStatus({ ...invite, usesLeft: 0 }, now)).toBe("used");
  });

  it("reads a link or email invite from input, with defaults and a reason for each refusal", () => {
    expect(validateInviteInput({}, now)).toEqual({
      ok: true,
      value: { role: "member", usesLeft: 1, email: null, expiresAt: new Date("2026-12-07T12:00:00Z") },
    });
    expect(validateInviteInput({ role: "viewer", uses: 5, email: " Kim@Example.com ", days: 1 }, now)).toEqual({
      ok: true,
      value: { role: "viewer", usesLeft: 5, email: "kim@example.com", expiresAt: new Date("2026-11-24T12:00:00Z") },
    });
    expect(validateInviteInput({ role: "owner" }, now)).toEqual({
      ok: false,
      error: "Invite people as a member or view-only; make them an owner after they join.",
    });
    expect(validateInviteInput({ uses: "2" }, now)).toEqual({ ok: false, error: "An invite works 1 to 50 times." });
    expect(validateInviteInput({ uses: 0 }, now)).toEqual({ ok: false, error: "An invite works 1 to 50 times." });
    expect(validateInviteInput({ days: 31 }, now)).toEqual({ ok: false, error: "An invite lasts 1 to 30 days." });
    expect(validateInviteInput({ email: "not-an-email" }, now)).toEqual({
      ok: false,
      error: "That email address doesn't look right.",
    });
  });
});

describe("households flag", () => {
  it("hides households behind households, off in production and on in QA", () => {
    expect(FLAG_NAMES).toContain("households");
    expect(isFlagOn("households", {}, "ann")).toBe(false);
    expect(isFlagOn("households", { SPOONJOY_FLAGS: "all" }, "ann")).toBe(true);
  });
});
