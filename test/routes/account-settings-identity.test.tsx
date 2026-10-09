// Account settings: username trimming and format (ui-map bug 18), the edit form closing with a
// confirmation after a successful Save (ruling R-M3-3), the password forms closing after a
// successful change, a replaced profile photo's old file being deleted, and photo errors showing
// only next to the photo.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { faker } from "@faker-js/faker";
import { createTestRoutesStub } from "../utils";
import { db } from "~/lib/db.server";
import { createUser } from "~/lib/auth.server";
import { createUserSessionCookie } from "~/lib/session.server";
import type { AccountSettingsActionResult, AccountSettingsLoaderData } from "~/lib/account-settings.server";
import AccountSettings, { action } from "~/routes/account.settings";
import { cleanupDatabase } from "../helpers/cleanup";

const PASSWORD = "testPassword123";
const FORMAT_ERROR = "Username can only use letters, numbers, periods, underscores and hyphens";

// JPEG magic bytes: photo uploads are checked by content, not by the declared type.
const JPEG_PHOTO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe("Account settings - identity", () => {
  let userId: string;
  let email: string;
  let username: string;
  let cookie: string;

  beforeEach(async () => {
    await cleanupDatabase();
    email = `identity-${faker.string.alphanumeric(10).toLowerCase()}@example.com`;
    username = `chef_${faker.string.alphanumeric(8)}`;
    const user = await createUser(db, email, username, PASSWORD);
    userId = user.id;
    cookie = (await createUserSessionCookie(userId)).split(";")[0];
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  async function postForm(fields: Record<string, string>) {
    const request = new UndiciRequest("http://localhost:3000/account/settings", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
    return action({ request, context: { cloudflare: { env: null } }, params: {} } as any);
  }

  async function saveUserInfo(fields: { email?: string; username: string }) {
    return (await postForm({
      intent: "updateUserInfo",
      email: fields.email ?? email,
      username: fields.username,
    })) as AccountSettingsActionResult;
  }

  async function storedUsername() {
    return (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { username: true } })).username;
  }

  describe("action - username", () => {
    it("saves a username typed with surrounding spaces without them, and confirms the save", async () => {
      const renamed = `renamed_${faker.string.alphanumeric(8)}`;

      const result = await saveUserInfo({ username: `  ${renamed}  ` });

      expect(result).toEqual({ success: true, intent: "updateUserInfo", message: "Account details saved." });
      expect(await storedUsername()).toBe(renamed);
    });

    it("treats a username of only spaces as missing", async () => {
      const result = await saveUserInfo({ username: "   " });

      expect(result).toEqual({
        success: false,
        intent: "updateUserInfo",
        error: "validation_error",
        fieldErrors: { username: "Username is required" },
      });
      expect(await storedUsername()).toBe(username);
    });

    it("checks the trimmed username against other accounts", async () => {
      const taken = `taken_${faker.string.alphanumeric(8)}`;
      await createUser(db, `other-${faker.string.alphanumeric(10).toLowerCase()}@example.com`, taken, PASSWORD);

      const result = await saveUserInfo({ username: ` ${taken} ` });

      expect(result).toMatchObject({ success: false, intent: "updateUserInfo", error: "username_taken" });
      expect(await storedUsername()).toBe(username);
    });

    it("treats the current username with surrounding spaces as unchanged", async () => {
      const newEmail = `moved-${faker.string.alphanumeric(10).toLowerCase()}@example.com`;

      const result = await saveUserInfo({ email: newEmail, username: `  ${username} ` });

      expect(result).toMatchObject({ success: true, intent: "updateUserInfo" });
      expect(await storedUsername()).toBe(username);
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe(newEmail);
    });

    it("rejects a new username with a space, a slash or an accented letter inside it", async () => {
      for (const invalid of ["chef rj", "chef/rj", "chéf_rj"]) {
        const result = await saveUserInfo({ username: invalid });
        expect(result).toEqual({
          success: false,
          intent: "updateUserInfo",
          error: "validation_error",
          fieldErrors: { username: FORMAT_ERROR },
        });
      }
      expect(await storedUsername()).toBe(username);
    });

    it("rejects a new username that is too short or too long", async () => {
      await expect(saveUserInfo({ username: "ab" })).resolves.toMatchObject({
        fieldErrors: { username: "Username must be at least 3 characters" },
      });
      await expect(saveUserInfo({ username: "a".repeat(51) })).resolves.toMatchObject({
        fieldErrors: { username: "Username must be at most 50 characters" },
      });
      expect(await storedUsername()).toBe(username);
    });

    it("refuses a username another account holds in a different letter case", async () => {
      await createUser(db, `case-${faker.string.alphanumeric(10).toLowerCase()}@example.com`, "Alice_Chef", PASSWORD);

      const result = await saveUserInfo({ username: "alice_chef" });

      expect(result).toMatchObject({ success: false, intent: "updateUserInfo", error: "username_taken" });
      expect(await storedUsername()).toBe(username);
    });

    it("refuses another account's ID as a username, and any username shaped like an ID", async () => {
      const other = await db.user.create({
        data: { email: `id-${faker.string.alphanumeric(10).toLowerCase()}@example.com`, username: "id_owner" },
      });

      await expect(saveUserInfo({ username: other.id })).resolves.toMatchObject({
        success: false,
        error: expect.stringMatching(/^(username_taken|validation_error)$/),
      });
      await expect(saveUserInfo({ username: "cmg1a2b3c0000d4e5f6g7h8i9" })).resolves.toEqual({
        success: false,
        intent: "updateUserInfo",
        error: "validation_error",
        fieldErrors: { username: "Username can't look like an account ID" },
      });
      const seededId = await db.user.create({
        data: { id: "qa-seeded-chef", email: `seeded-${faker.string.alphanumeric(10).toLowerCase()}@example.com`, username: "qa_seeded" },
      });
      await expect(saveUserInfo({ username: seededId.id })).resolves.toMatchObject({
        success: false,
        intent: "updateUserInfo",
        error: "username_taken",
        message: "This username is already taken",
      });
      expect(await storedUsername()).toBe(username);
    });

    it("trims the email before checking and saving it", async () => {
      const result = await saveUserInfo({ email: "  Trimmed.Chef@Example.com  ", username });

      expect(result).toMatchObject({ success: true, intent: "updateUserInfo" });
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe("trimmed.chef@example.com");
    });

    // Audit 2026-10-09 finding 2: a new address is unproven, so Google and GitHub must not link to
    // it by email until it is confirmed. A username-only save keeps the verification.
    it("marks the account unverified when the email changes, not when only the username does", async () => {
      await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
      const verifiedAt = async () =>
        (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } })).emailVerifiedAt;

      await expect(saveUserInfo({ username: `renamed_${faker.string.alphanumeric(8)}` }))
        .resolves.toMatchObject({ success: true });
      expect(await verifiedAt()).toBeInstanceOf(Date);

      await expect(saveUserInfo({ email: "moved.chef@example.com", username: await storedUsername() }))
        .resolves.toMatchObject({ success: true });
      expect(await verifiedAt()).toBeNull();
    });

    it("refuses an email another account holds, typed with spaces and capitals", async () => {
      const otherEmail = `taken-${faker.string.alphanumeric(10).toLowerCase()}@example.com`;
      await createUser(db, otherEmail, `other_${faker.string.alphanumeric(8)}`, PASSWORD);

      const result = await saveUserInfo({ email: `  ${otherEmail.toUpperCase()} `, username });

      expect(result).toMatchObject({ success: false, intent: "updateUserInfo", error: "email_taken" });
    });

    it("keeps an older username whose only difference is surrounding spaces", async () => {
      await db.user.update({ where: { id: userId }, data: { username: "  José " } });
      const newEmail = `jose-${faker.string.alphanumeric(10).toLowerCase()}@example.com`;

      const result = await saveUserInfo({ email: newEmail, username: "José" });

      expect(result).toMatchObject({ success: true, intent: "updateUserInfo" });
      expect(await storedUsername()).toBe("  José ");
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).email).toBe(newEmail);
    });

    it("still lets an account whose older username breaks the format change its email", async () => {
      const legacy = "legacy chef!";
      await db.user.update({ where: { id: userId }, data: { username: legacy } });
      const newEmail = `legacy-${faker.string.alphanumeric(10).toLowerCase()}@example.com`;

      const result = await saveUserInfo({ email: newEmail, username: legacy });

      expect(result).toMatchObject({ success: true, intent: "updateUserInfo" });
      expect(await storedUsername()).toBe(legacy);
    });
  });

  describe("action - password results name their form", () => {
    it("tags a successful set-password result", async () => {
      await db.user.update({ where: { id: userId }, data: { hashedPassword: null, salt: null } });

      const result = await postForm({
        intent: "setPassword",
        newPassword: "anotherPassword789!",
        confirmPassword: "anotherPassword789!",
      });

      expect(result).toEqual({
        success: true,
        intent: "setPassword",
        message: "Your password has been set successfully",
      });
    });
  });

  describe("action - profile photo", () => {
    function photoRequest(file: File | null) {
      const formData = new UndiciFormData();
      formData.append("intent", "uploadPhoto");
      if (file) formData.append("photo", file);
      return new UndiciRequest("http://localhost:3000/account/settings", {
        method: "POST",
        headers: { Cookie: cookie },
        body: formData,
        duplex: "half",
      });
    }

    it("deletes the replaced photo's stored file once the new one is saved", async () => {
      const previous = `/photos/profiles/${userId}/1-old.jpg`;
      await db.user.update({ where: { id: userId }, data: { photoUrl: previous } });
      const bucket = { put: vi.fn().mockResolvedValue(undefined), delete: vi.fn().mockResolvedValue(undefined) };

      const result = (await action({
        request: photoRequest(new File([JPEG_PHOTO_BYTES], "new.jpg", { type: "image/jpeg" })),
        context: { cloudflare: { env: { PHOTOS: bucket } } },
        params: {},
      } as any)) as AccountSettingsActionResult;

      expect(result).toMatchObject({ success: true, intent: "uploadPhoto" });
      expect(result.photoUrl).toMatch(new RegExp(`^/photos/profiles/${userId}/`));
      expect(bucket.delete).toHaveBeenCalledWith(`profiles/${userId}/1-old.jpg`);
      expect(bucket.delete).toHaveBeenCalledTimes(1);
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).photoUrl).toBe(result.photoUrl);
    });

    it("keeps the new photo when deleting the replaced file fails", async () => {
      await db.user.update({ where: { id: userId }, data: { photoUrl: `/photos/profiles/${userId}/1-old.jpg` } });
      const bucket = {
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockRejectedValue(new Error("R2 delete unavailable")),
      };

      const result = (await action({
        request: photoRequest(new File([JPEG_PHOTO_BYTES], "new.jpg", { type: "image/jpeg" })),
        context: { cloudflare: { env: { PHOTOS: bucket } } },
        params: {},
      } as any)) as AccountSettingsActionResult;

      expect(result).toMatchObject({ success: true, intent: "uploadPhoto" });
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).photoUrl).toBe(result.photoUrl);
    });

    it("tags every upload error so it shows next to the photo", async () => {
      const noFile = await action({
        request: photoRequest(null),
        context: { cloudflare: { env: null } },
        params: {},
      } as any);
      const wrongType = await action({
        request: photoRequest(new File(["text"], "notes.txt", { type: "text/plain" })),
        context: { cloudflare: { env: null } },
        params: {},
      } as any);
      const tooLarge = await action({
        request: photoRequest(new File([new Uint8Array(6 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" })),
        context: { cloudflare: { env: null } },
        params: {},
      } as any);

      expect(noFile).toMatchObject({ success: false, intent: "uploadPhoto", error: "no_file" });
      expect(wrongType).toMatchObject({ success: false, intent: "uploadPhoto", error: "invalid_file_type" });
      expect(tooLarge).toMatchObject({ success: false, intent: "uploadPhoto", error: "file_too_large" });
    });
  });

  describe("component", () => {
    function loaderData(overrides: Partial<AccountSettingsLoaderData["user"]> = {}) {
      return {
        user: {
          id: "user-1",
          email: "chef@example.com",
          username: "chef_rj",
          hasPassword: true,
          photoUrl: null,
          oauthAccounts: [],
          passkeys: [],
          ...overrides,
        },
        notifications: { pushSubscribed: false },
      };
    }

    function renderSettings(
      respond: (form: FormData) => AccountSettingsActionResult,
      user: () => Partial<AccountSettingsLoaderData["user"]> = () => ({}),
    ) {
      const Stub = createTestRoutesStub([
        {
          path: "/account/settings",
          Component: AccountSettings,
          loader: () => loaderData(user()),
          action: async ({ request }) => respond(await request.formData()),
        },
      ]);
      render(<Stub initialEntries={["/account/settings"]} />);
    }

    it("closes the edit form and confirms after a successful Save", async () => {
      const userEvents = userEvent.setup();
      let savedUsername = "chef_rj";
      renderSettings(
        (form) => {
          savedUsername = String(form.get("username")).trim();
          return { success: true, intent: "updateUserInfo", message: "Account details saved." };
        },
        () => ({ username: savedUsername }),
      );

      await userEvents.click(await screen.findByRole("button", { name: "Edit" }));
      const usernameField = screen.getByLabelText("Username");
      await userEvents.clear(usernameField);
      await userEvents.type(usernameField, "chef_renamed");
      await userEvents.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByRole("status")).toHaveTextContent("Account details saved.");
      await waitFor(() => expect(screen.queryByLabelText("Username")).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
      expect(within(screen.getByTestId("user-info-section")).getByText("chef_renamed")).toBeInTheDocument();
    });

    it("keeps the edit form open and shows the problem when Save fails", async () => {
      const userEvents = userEvent.setup();
      renderSettings(() => ({
        success: false,
        intent: "updateUserInfo",
        error: "username_taken",
        message: "This username is already taken",
      }));

      await userEvents.click(await screen.findByRole("button", { name: "Edit" }));
      await userEvents.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("This username is already taken");
      expect(screen.getByLabelText("Username")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      // It is not repeated under the profile photo.
      expect(within(screen.getByTestId("profile-photo-section")).queryByText("This username is already taken")).not.toBeInTheDocument();
    });

    it("closes the change-password form after a successful change", async () => {
      const userEvents = userEvent.setup();
      renderSettings(() => ({
        success: true,
        intent: "changePassword",
        message: "Your password has been changed successfully. Other browsers signed in to your account have been signed out.",
      }));

      await userEvents.click(await screen.findByRole("button", { name: "Change Password" }));
      expect(screen.getByLabelText("Current Password")).toBeInTheDocument();
      await userEvents.click(screen.getByRole("button", { name: "Change Password" }));

      expect(await screen.findByRole("status")).toHaveTextContent("Your password has been changed successfully.");
      await waitFor(() => expect(screen.queryByLabelText("Current Password")).not.toBeInTheDocument());
      expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Change Password" })).toBeInTheDocument();
    });

    it("closes the set-password form after a password is set", async () => {
      const userEvents = userEvent.setup();
      let hasPassword = false;
      renderSettings(
        () => {
          hasPassword = true;
          return { success: true, intent: "setPassword", message: "Your password has been set successfully" };
        },
        () => ({ hasPassword }),
      );

      await userEvents.click(await screen.findByRole("button", { name: "Set Password" }));
      await userEvents.click(screen.getByRole("button", { name: "Set Password" }));

      expect(await screen.findByRole("status")).toHaveTextContent("Your password has been set successfully");
      await waitFor(() => expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Change Password" })).toBeInTheDocument();
    });

    it("shows a photo upload error next to the photo only, not in the page banner", async () => {
      const userEvents = userEvent.setup();
      renderSettings(
        () => ({
          success: false,
          intent: "uploadPhoto",
          error: "invalid_file_type",
          message: "Please upload an image file",
        }),
        () => ({ photoUrl: "/photos/profiles/user-1/1-a.jpg" }),
      );

      // The upload itself goes through the cropper's canvas, which happy-dom can't draw; the
      // "Remove Photo" form posts to the same action, and the stub answers it as an upload.
      const photoSection = await screen.findByTestId("profile-photo-section");
      await userEvents.click(within(photoSection).getByRole("button", { name: "Remove Photo" }));

      expect(await within(photoSection).findByText("Please upload an image file")).toBeInTheDocument();
      expect(screen.getAllByText("Please upload an image file")).toHaveLength(1);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
