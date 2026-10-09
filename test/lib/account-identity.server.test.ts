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
