import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { faker } from "@faker-js/faker";
import { db } from "~/lib/db.server";
import { findUsernameConflict, saveAccountIdentity } from "~/lib/account-identity.server";
import { cleanupDatabase } from "../helpers/cleanup";

async function makeUser(username: string, id?: string) {
  return db.user.create({
    data: {
      ...(id ? { id } : {}),
      email: `${faker.string.alphanumeric(12).toLowerCase()}@example.com`,
      username,
    },
  });
}

describe("findUsernameConflict", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("finds a username taken in any letter case", async () => {
    await makeUser("Alice_Chef");

    await expect(findUsernameConflict(db, "alice_chef")).resolves.toBe(true);
    await expect(findUsernameConflict(db, "ALICE_CHEF")).resolves.toBe(true);
    await expect(findUsernameConflict(db, "alice_chefs")).resolves.toBe(false);
  });

  it("treats another account's ID as taken, so /users/<id> can't be claimed", async () => {
    const other = await makeUser("someone_else");

    await expect(findUsernameConflict(db, other.id)).resolves.toBe(true);
  });

  it("ignores the account that is asking", async () => {
    const self = await makeUser("Self_Chef", "self_chef");

    await expect(findUsernameConflict(db, "self_chef", self.id)).resolves.toBe(false);
    await expect(findUsernameConflict(db, "SELF_CHEF", self.id)).resolves.toBe(false);
    await expect(findUsernameConflict(db, "self_chef")).resolves.toBe(true);
  });
});

describe("saveAccountIdentity", () => {
  let userId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const user = await makeUser("original_chef");
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  async function stored() {
    return db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, username: true, updatedAt: true } });
  }

  it("saves a new email and username together and moves updatedAt", async () => {
    const before = await stored();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const result = await saveAccountIdentity(db, {
      userId,
      email: "moved@example.com",
      username: "renamed_chef",
      emailChanged: true,
      usernameChanged: true,
    });

    expect(result).toBe("saved");
    const after = await stored();
    expect(after).toMatchObject({ email: "moved@example.com", username: "renamed_chef" });
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("refuses a username another account holds in a different case, and writes nothing", async () => {
    await makeUser("Taken_Chef");
    const before = await stored();

    const result = await saveAccountIdentity(db, {
      userId,
      email: "moved@example.com",
      username: "taken_chef",
      emailChanged: true,
      usernameChanged: true,
    });

    expect(result).toBe("username_taken");
    expect(await stored()).toMatchObject({ email: before.email, username: "original_chef" });
  });

  it("refuses a username equal to another account's ID", async () => {
    const other = await makeUser("other_chef");

    await expect(saveAccountIdentity(db, {
      userId,
      email: (await stored()).email,
      username: other.id,
      emailChanged: false,
      usernameChanged: true,
    })).resolves.toBe("username_taken");
  });

  it("marks a changed email unverified and leaves a username-only change's verification alone", async () => {
    await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });

    await expect(saveAccountIdentity(db, {
      userId,
      email: (await stored()).email,
      username: "renamed_chef",
      emailChanged: false,
      usernameChanged: true,
    })).resolves.toBe("saved");
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt).toBeInstanceOf(Date);

    await expect(saveAccountIdentity(db, {
      userId,
      email: "brand-new-address@example.com",
      username: "renamed_chef",
      emailChanged: true,
      usernameChanged: false,
    })).resolves.toBe("saved");
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt).toBeNull();
  });

  // Review of audit finding 2: clearing the verification in a second write left the old
  // verification on the new address if that write failed (a D1 error, the Worker cut off).
  it("clears the verification in the same write that changes the email", async () => {
    await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    const failingSecondWrite = {
      $queryRaw: db.$queryRaw.bind(db),
      $executeRaw: db.$executeRaw.bind(db),
      user: { update: () => Promise.reject(new Error("D1 went away")) },
    } as unknown as Parameters<typeof saveAccountIdentity>[0];

    await expect(saveAccountIdentity(failingSecondWrite, {
      userId,
      email: "moved-address@example.com",
      username: (await stored()).username,
      emailChanged: true,
      usernameChanged: false,
    })).rejects.toThrow("D1 went away");
    await expect(db.user.findUniqueOrThrow({ where: { id: userId } }))
      .resolves.toMatchObject({ email: "moved-address@example.com", emailVerifiedAt: null });
  });

  // Re-review: a username-only save passed an email read earlier in the request, so an email change
  // landing in between was quietly undone. A username-only save never writes the email.
  it("leaves the email alone on a username-only save, even when given a stale one", async () => {
    const current = await stored();
    await db.user.update({ where: { id: userId }, data: { email: "changed-on-web@example.com" } });

    await expect(saveAccountIdentity(db, {
      userId,
      email: current.email,
      username: "renamed_after_race",
      emailChanged: false,
      usernameChanged: true,
    })).resolves.toBe("saved");
    await expect(db.user.findUniqueOrThrow({ where: { id: userId } }))
      .resolves.toMatchObject({ email: "changed-on-web@example.com", username: "renamed_after_race" });
  });

  it("keeps the verification when only the letter case of the email changes", async () => {
    await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    const current = await stored();

    await expect(saveAccountIdentity(db, {
      userId,
      email: current.email.toUpperCase(),
      username: current.username,
      emailChanged: true,
      usernameChanged: false,
    })).resolves.toBe("saved");
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("refuses an email another account holds, in any case, before looking at the username", async () => {
    const other = await makeUser("Taken_Chef");

    const result = await saveAccountIdentity(db, {
      userId,
      email: other.email.toUpperCase(),
      username: "taken_chef",
      emailChanged: true,
      usernameChanged: true,
    });

    expect(result).toBe("email_taken");
    expect((await stored()).username).toBe("original_chef");
  });

  it("does not hold an unchanged username against existing case-duplicates", async () => {
    // Accounts created before usernames were unique regardless of case.
    await makeUser("ORIGINAL_CHEF");

    const result = await saveAccountIdentity(db, {
      userId,
      email: "only-email@example.com",
      username: "original_chef",
      emailChanged: true,
      usernameChanged: false,
    });

    expect(result).toBe("saved");
    expect(await stored()).toMatchObject({ email: "only-email@example.com", username: "original_chef" });
  });

  it("lets an account change the case of its own username", async () => {
    await expect(saveAccountIdentity(db, {
      userId,
      email: (await stored()).email,
      username: "Original_Chef",
      emailChanged: false,
      usernameChanged: true,
    })).resolves.toBe("saved");
    expect((await stored()).username).toBe("Original_Chef");
  });
});
