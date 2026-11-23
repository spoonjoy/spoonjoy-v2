import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";
import {
  INVITE_ONLY_MESSAGE,
  createServerInvite,
  gateAccountCreation,
  isServerAdmin,
  isSelfHosted,
  listServerInvites,
  revokeServerInvite,
  serverAdminId,
  serverInviteStatus,
  setSignupMode,
  signupDoor,
  signupMode,
} from "~/lib/server-access.server";

const selfHosted = { SPOONJOY_SELF_HOSTED: "true" };

/** Makes an account through the gate, as every account-creation path does. */
async function signUp(env: Record<string, string> | null, inviteToken?: string | null) {
  const gate = await gateAccountCreation(db, env, { inviteToken });
  if (!gate.allowed) return { refused: gate.message };
  const user = await db.user.create({ data: createTestUser() });
  await gate.created(user.id);
  return { user };
}

describe("server access", () => {
  beforeEach(cleanupDatabase);
  afterEach(cleanupDatabase);

  describe("on spoonjoy.app (SPOONJOY_SELF_HOSTED unset)", () => {
    it("lets everyone sign up without reading or writing the database", async () => {
      const untouchable = new Proxy({}, {
        get() {
          throw new Error("the gate touched the database");
        },
      }) as typeof db;
      for (const env of [null, {}, { SPOONJOY_SELF_HOSTED: "false" }, { SPOONJOY_SIGNUPS: "invite" }]) {
        const gate = await gateAccountCreation(untouchable, env, { inviteToken: null });
        expect(gate.allowed).toBe(true);
        if (gate.allowed) {
          await gate.created("someone");
          await gate.abandoned();
        }
      }
    });

    it("is what spoonjoy.app and QA deploy: neither sets SPOONJOY_SELF_HOSTED or SPOONJOY_SIGNUPS", () => {
      const wrangler = JSON.parse(readFileSync(resolve(__dirname, "../../wrangler.json"), "utf8"));
      for (const vars of [wrangler.vars, ...Object.values<{ vars?: object }>(wrangler.env ?? {}).map((env) => env.vars ?? {})]) {
        expect(vars).not.toHaveProperty("SPOONJOY_SELF_HOSTED");
        expect(vars).not.toHaveProperty("SPOONJOY_SIGNUPS");
      }
    });

    it("has no admin, and records nothing as accounts are made", async () => {
      const first = await signUp({});
      await signUp({});
      expect(isSelfHosted({})).toBe(false);
      expect(await serverAdminId(db, {})).toBeNull();
      expect(await isServerAdmin(db, {}, first.user!.id)).toBe(false);
      expect(await db.serverSetting.count()).toBe(0);
    });
  });

  describe("on a self-hosted server", () => {
    it("makes the first account its admin", async () => {
      const first = await signUp(selfHosted);
      expect(await serverAdminId(db, selfHosted)).toBe(first.user!.id);
      expect(await isServerAdmin(db, selfHosted, first.user!.id)).toBe(true);
    });

    it("keeps one admin, the oldest account, when the first sign-ups race", async () => {
      const gates = await Promise.all([1, 2, 3].map(() => gateAccountCreation(db, selfHosted, { inviteToken: null })));
      expect(gates.every((gate) => gate.allowed)).toBe(true);
      const users = [];
      for (const _ of gates) users.push(await db.user.create({ data: { ...createTestUser(), createdAt: new Date(Date.now() + users.length * 1000) } }));
      await Promise.all(gates.map((gate, i) => gate.allowed && gate.created(users[i].id)));
      expect(await db.serverSetting.findMany()).toEqual([{ key: "admin", value: users[0].id }]);
    });

    it("finds an admin for a server that had accounts before it had one: the oldest", async () => {
      const oldest = await db.user.create({ data: { ...createTestUser(), createdAt: new Date("2026-01-01") } });
      await db.user.create({ data: { ...createTestUser(), createdAt: new Date("2026-02-01") } });
      expect(await serverAdminId(db, selfHosted)).toBe(oldest.id);
    });

    it("hands admin to the oldest remaining account when the admin's account is deleted", async () => {
      const first = await signUp(selfHosted);
      await setSignupMode(db, selfHosted, "open");
      const second = await signUp(selfHosted);
      await db.user.delete({ where: { id: first.user!.id } });
      expect(await serverAdminId(db, selfHosted)).toBe(second.user!.id);
    });

    it("is invite-only once it has its first account", async () => {
      await signUp(selfHosted);
      expect(await signupMode(db, selfHosted)).toEqual({ mode: "invite", setBy: "default" });
      expect(await signUp(selfHosted)).toEqual({ refused: INVITE_ONLY_MESSAGE });
      expect(INVITE_ONLY_MESSAGE).toBe("This server is invite-only. Ask its owner for an invite link.");
    });

    it("lets anyone sign up while the admin has sign-ups open, and refuses them once closed again", async () => {
      await signUp(selfHosted);
      await setSignupMode(db, selfHosted, "open");
      expect(await signupMode(db, selfHosted)).toEqual({ mode: "open", setBy: "admin" });
      expect((await signUp(selfHosted)).user).toBeDefined();
      await setSignupMode(db, selfHosted, "invite");
      expect(await signUp(selfHosted)).toEqual({ refused: INVITE_ONLY_MESSAGE });
    });

    it("follows SPOONJOY_SIGNUPS over the admin's switch", async () => {
      await signUp(selfHosted);
      await setSignupMode(db, selfHosted, "invite");
      const open = { ...selfHosted, SPOONJOY_SIGNUPS: "open" };
      expect(await signupMode(db, open)).toEqual({ mode: "open", setBy: "env" });
      expect((await signUp(open)).user).toBeDefined();
      await setSignupMode(db, selfHosted, "open");
      const invite = { ...selfHosted, SPOONJOY_SIGNUPS: "invite" };
      expect(await signupMode(db, invite)).toEqual({ mode: "invite", setBy: "env" });
      expect(await signUp(invite)).toEqual({ refused: INVITE_ONLY_MESSAGE });
    });

    it("always lets the first account in, even when SPOONJOY_SIGNUPS is invite", async () => {
      const invite = { ...selfHosted, SPOONJOY_SIGNUPS: "invite" };
      expect((await signUp(invite)).user).toBeDefined();
    });
  });

  describe("invite links", () => {
    async function adminAndInvite(now = new Date()) {
      const admin = (await signUp(selfHosted)).user!;
      const { token, invite } = await createServerInvite(db, admin.id, now);
      return { admin, token, invite };
    }

    it("let one person sign up while the server is invite-only, once", async () => {
      const { token, invite } = await adminAndInvite();
      expect(await serverInviteStatus(db, token)).toBe("valid");
      const invitee = await signUp(selfHosted, token);
      expect(invitee.user).toBeDefined();
      expect(await serverInviteStatus(db, token)).toBe("used");
      expect(await signUp(selfHosted, token)).toEqual({ refused: INVITE_ONLY_MESSAGE });
      const stored = await db.serverInvite.findUniqueOrThrow({ where: { id: invite.id } });
      expect(stored.usedById).toBe(invitee.user!.id);
    });

    it("are stored as a hash, never as the token", async () => {
      const { token } = await adminAndInvite();
      const [stored] = await db.serverInvite.findMany();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(stored.tokenHash).not.toContain(token);
      expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("let only one of two people racing with the same invite in", async () => {
      const { token } = await adminAndInvite();
      const gates = await Promise.all([1, 2].map(() => gateAccountCreation(db, selfHosted, { inviteToken: token })));
      expect(gates.filter((gate) => gate.allowed)).toHaveLength(1);
    });

    it("go back to unused when the sign-up they let in fails", async () => {
      const { token } = await adminAndInvite();
      const gate = await gateAccountCreation(db, selfHosted, { inviteToken: token });
      expect(gate.allowed).toBe(true);
      if (gate.allowed) await gate.abandoned();
      expect(await serverInviteStatus(db, token)).toBe("valid");
    });

    it("stop working when they expire after seven days", async () => {
      const made = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const { token, invite } = await adminAndInvite(made);
      expect(invite.expiresAt.getTime() - made.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
      expect(await serverInviteStatus(db, token)).toBe("expired");
      expect(await signUp(selfHosted, token)).toEqual({ refused: INVITE_ONLY_MESSAGE });
    });

    it("stop working when the admin revokes them, and leave the list", async () => {
      const { token, invite } = await adminAndInvite();
      expect((await listServerInvites(db, new Date())).map((row) => row.id)).toEqual([invite.id]);
      await revokeServerInvite(db, invite.id, new Date());
      expect(await serverInviteStatus(db, token)).toBe("revoked");
      expect(await signUp(selfHosted, token)).toEqual({ refused: INVITE_ONLY_MESSAGE });
      expect(await listServerInvites(db, new Date())).toEqual([]);
    });

    it("answer unknown for a token that matches no invite", async () => {
      expect(await serverInviteStatus(db, "not-a-token")).toBe("unknown");
    });
  });
  describe("before anyone has signed up", () => {
    it("has no admin yet", async () => {
      expect(await serverAdminId(db, selfHosted)).toBeNull();
      expect(await isServerAdmin(db, selfHosted, "nobody")).toBe(false);
    });

    it("keeps the sign-up page open for the first account, even without an invite", async () => {
      expect(await signupDoor(db, selfHosted, null)).toEqual({ door: "open" });
    });

    it("lets a first sign-up that fails be abandoned, with nothing to put back", async () => {
      const gate = await gateAccountCreation(db, selfHosted);
      expect(gate.allowed).toBe(true);
      if (gate.allowed) await gate.abandoned();
      expect(await serverAdminId(db, selfHosted)).toBeNull();
    });
  });

  it("keeps spoonjoy.app's sign-up page open", async () => {
    expect(await signupDoor(db, {}, null)).toEqual({ door: "open" });
  });

  it("switches sign-ups only on a self-hosted server", async () => {
    await expect(setSignupMode(db, {}, "open")).rejects.toThrow("Sign-ups can only be switched on a self-hosted server.");
  });
});
