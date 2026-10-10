// Account settings on both devices (spec journey 11), as per-run scratch user 5: rename the
// account, and see the new username on the chef's recipe and profile while the old profile URL is
// gone; add a profile photo through the crop dialog, and see it on the kitchen, the recipe and the
// profile; change the password, sign out, and sign back in with the new one. Passkeys, OAuth
// unlinking, API token revocation and notifications are left to their own journeys.
//
// Each device signs in as its own account (scratch 5's base account on iPhone, its desktop twin on
// desktop Chrome), because the two run at the same time and this story renames the account and
// replaces its password. The new usernames keep the codex_ prefix and the email is never changed,
// so the run's cleanup (email codex-% and username codex_%) and --rotate (email codex-e2e-s%)
// still find the account afterwards.
//
// The password change bumps the account's session version, so after it the stored session this
// journey started from is dead (this browser gets a fresh cookie and stays signed in). Nothing may
// use scratch 5's stored sessions after this test; keep it the last test here. Signing back in is
// one sign-in attempt per device, two per run, against QA's 60/minute cap (see personas.setup.ts).
//
// The new password is made here at run time and typed with fillSecret, never fill(), so it stays
// out of the report's step titles and the trace's action log (see support/secret.ts).
import { randomBytes } from "node:crypto";
import path from "node:path";
import { test, expect } from "./support/journey";
import type { Locator, Page } from "@playwright/test";
import { pathUrl, waitForHydration } from "./support/navigation";
import { scratchForProject, scratchStorageStateForProject } from "./support/personas";
import { Secret, fillSecret } from "./support/secret";

const SCRATCH_INDEX = 5;
const SETTINGS = "/account/settings";
const SETTINGS_ACTION = "/account/settings.data";
const DEFAULT_AVATAR = "/images/chef-rj.png";
// storeImage's key for a profile photo; the cropper always uploads a JPEG.
const UPLOADED_AVATAR = /^\/photos\/profiles\/[^/]+\/\d+-[0-9a-f-]{36}\.jpg$/;
// A small real photo (120x80 JPEG) already committed for image tests.
const PHOTO_FIXTURE = path.resolve("e2e/fixtures/asymmetric-exif-orientation.jpg");
// A recipe page, not /recipes/new.
const RECIPE_URL = /\/recipes\/(?!new$)[^/?#]+$/;

function userInfo(page: Page) {
  return page.getByTestId("user-info-section");
}

function usernameField(page: Page) {
  return userInfo(page).getByLabel("Username", { exact: true });
}

function confirmation(page: Page, text: string) {
  return page.getByRole("status").filter({ hasText: text });
}

// An avatar's <img>: an Avatar can also draw an initials <svg> titled with the same name.
function avatarImage(scope: Locator, name: string) {
  return scope.locator("img").and(scope.getByRole("img", { name, exact: true }));
}

// The chef link in a recipe's header: named by the chef's username, and holding their avatar.
function chefLink(page: Page, username: string) {
  return page.getByRole("link", { name: username, exact: true }).filter({ has: page.getByTestId("chef-avatar") });
}

// The image was served and decoded, not just pointed at.
async function expectImageLoaded(image: Locator) {
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const img = element as HTMLImageElement;
        return img.complete ? img.naturalWidth : 0;
      }),
    )
    .toBeGreaterThan(0);
}

async function saveUsername(page: Page, typed: string, expected: string) {
  await userInfo(page).getByRole("button", { name: "Edit", exact: true }).click();
  await usernameField(page).fill(typed);
  await userInfo(page).getByRole("button", { name: "Save", exact: true }).click();
  // R-M3-3: the form closes and a short confirmation shows.
  await expect(confirmation(page, "Account details saved.")).toBeVisible();
  await expect(usernameField(page)).toBeHidden();
  await expect(userInfo(page).getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(userInfo(page)).toContainText(expected);
}

test.describe("Account settings", () => {
  test.use({ storageState: scratchStorageStateForProject(SCRATCH_INDEX) });

  test("a chef renames the account, adds a photo, and changes the password @mutates", async ({
    page,
    verifyAfterReload,
    expectAccessible,
    expectConsoleError,
  }, testInfo) => {
    // Many round trips to QA in one story; the default 60 s is too tight.
    test.setTimeout(240_000);
    const account = scratchForProject(SCRATCH_INDEX, testInfo.project.name);
    // Unique per run and per device ("i" or "d"), in the disposable codex_ namespace.
    const runId = `${randomBytes(4).toString("hex")}${testInfo.project.name.charAt(0)}`;
    const firstName = `codex_e2e_a_${runId}`;
    const newName = `codex_e2e_b_${runId}`;
    const recipeTitle = `Account Journey Stew ${runId}`;
    const newPassword = Secret.generate();

    // --- A recipe of the chef's own, for the chef link and the avatar on a recipe page.
    await page.goto("/recipes/new");
    await waitForHydration(page);
    await page.getByLabel("Title", { exact: true }).fill(recipeTitle);
    await page.getByRole("button", { name: "Create recipe", exact: true }).click();
    await expect(page).toHaveURL(RECIPE_URL);
    const recipePath = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1, name: recipeTitle, exact: true })).toBeVisible();

    // --- Rename, typing the username with spaces around it: they are trimmed (ui-map bug 18).
    await page.goto(SETTINGS);
    await waitForHydration(page);
    await userInfo(page).getByRole("button", { name: "Edit", exact: true }).click();
    await expect(usernameField(page)).toHaveValue(account.username);
    await expectAccessible();
    await userInfo(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await saveUsername(page, `  ${firstName}  `, firstName);

    await verifyAfterReload(async () => {
      await expect(userInfo(page)).toContainText(firstName);
      await expect(confirmation(page, "Account details saved.")).toBeHidden();
    });
    // Exact value, no spaces: the edit form starts from what was stored.
    await waitForHydration(page);
    await userInfo(page).getByRole("button", { name: "Edit", exact: true }).click();
    await expect(usernameField(page)).toHaveValue(firstName);
    await userInfo(page).getByRole("button", { name: "Cancel", exact: true }).click();

    // Rename again. The scratch user's id is its seeded username, and /users/<id> redirects to the
    // current username by design, so the old-URL check below uses a username that was never an id.
    await saveUsername(page, newName, newName);
    await expectAccessible();

    await verifyAfterReload(async () => {
      await expect(userInfo(page)).toContainText(newName);
      await expect(userInfo(page)).not.toContainText(firstName);
    });

    // The recipe's chef link carries the new username, and leads to the profile under it.
    await page.goto(recipePath);
    await waitForHydration(page);
    await expect(chefLink(page, newName)).toHaveAttribute("href", `/users/${newName}`);
    await chefLink(page, newName).click();
    await expect(page).toHaveURL(pathUrl(`/users/${newName}`));
    await expect(page.getByRole("heading", { level: 1, name: newName, exact: true })).toBeVisible();

    // The previous username's profile URL is gone. The browser logs the document's 404 as a console
    // error; that one is expected, and scoped to that URL only.
    expectConsoleError(/Failed to load resource: the server responded with a status of 404/, {
      url: new RegExp(`/users/${firstName}$`),
    });
    await page.goto(`/users/${firstName}`);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found." })).toBeVisible();

    // --- Profile photo: choose a file, crop it, save it.
    await page.goto(SETTINGS);
    await waitForHydration(page);
    const photoSection = page.getByTestId("profile-photo-section");
    const settingsAvatar = photoSection.getByRole("img", { name: "Profile photo", exact: true });
    await expect(settingsAvatar).toHaveAttribute("src", DEFAULT_AVATAR);
    const chooser = page.waitForEvent("filechooser");
    await photoSection.getByRole("button", { name: "Upload photo", exact: true }).click();
    await (await chooser).setFiles(PHOTO_FIXTURE);

    const cropDialog = page.getByRole("dialog", { name: "Crop your photo" });
    await expect(cropDialog).toBeVisible();
    await expect(cropDialog.getByRole("slider", { name: "Zoom" })).toBeVisible();
    const savePhoto = cropDialog.getByRole("button", { name: "Save photo", exact: true });
    // Enabled once the preview has loaded.
    await expect(savePhoto).toBeEnabled();
    await expectAccessible();
    const uploaded = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === SETTINGS_ACTION,
    );
    await savePhoto.click();
    expect((await uploaded).status()).toBe(200);
    await expect(cropDialog).toBeHidden();
    await expect(settingsAvatar).toHaveAttribute("src", UPLOADED_AVATAR);
    await expect(photoSection.getByRole("button", { name: "Change photo", exact: true })).toBeVisible();
    const photoUrl = (await settingsAvatar.getAttribute("src")) ?? "";
    expect(photoUrl).toMatch(UPLOADED_AVATAR);

    await verifyAfterReload(async () => {
      await expect(settingsAvatar).toHaveAttribute("src", photoUrl);
      await expect(photoSection.getByRole("button", { name: "Remove photo", exact: true })).toBeVisible();
      await expectImageLoaded(settingsAvatar);
    });

    // The photo is the chef's avatar on their kitchen...
    await page.goto("/");
    const kitchenHeader = page.locator("header").filter({ hasText: `@${newName}` });
    await expect(avatarImage(kitchenHeader, newName)).toHaveAttribute("src", photoUrl);
    await expectImageLoaded(avatarImage(kitchenHeader, newName));

    // ...on their recipe...
    await page.goto(recipePath);
    const recipeAvatar = chefLink(page, newName).getByTestId("chef-avatar").locator("img");
    await expect(recipeAvatar).toHaveAttribute("src", photoUrl);
    await expectImageLoaded(recipeAvatar);

    // ...and on their profile.
    await page.goto(`/users/${newName}`);
    const profileHeader = page.locator("header").filter({
      has: page.getByRole("heading", { level: 1, name: newName, exact: true }),
    });
    await expect(avatarImage(profileHeader, newName)).toHaveAttribute("src", photoUrl);

    // --- Change the password.
    await page.goto(SETTINGS);
    await waitForHydration(page);
    const passwordSection = page.getByTestId("password-section");
    await passwordSection.getByRole("button", { name: "Change password", exact: true }).click();
    const currentPasswordField = passwordSection.getByLabel("Current password", { exact: true });
    await expect(currentPasswordField).toBeVisible();
    await expectAccessible();
    await fillSecret(currentPasswordField, account.password);
    await fillSecret(passwordSection.getByLabel("New password", { exact: true }), newPassword);
    await fillSecret(passwordSection.getByLabel("Confirm password", { exact: true }), newPassword);
    await passwordSection.getByRole("button", { name: "Change password", exact: true }).click();
    await expect(confirmation(page, "Your password has been changed.")).toBeVisible();
    // The form closes, so the typed passwords don't stay on screen.
    await expect(currentPasswordField).toBeHidden();

    // This browser was given a fresh session and stays signed in.
    await verifyAfterReload(async () => {
      await expect(page).toHaveURL(pathUrl(SETTINGS));
      await expect(page.getByRole("heading", { level: 1, name: "Account settings", exact: true })).toBeVisible();
    });

    // --- Sign out from the profile page (the one sign-out button both devices have).
    await page.goto(`/users/${newName}`);
    await waitForHydration(page);
    await page.getByRole("main").getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(pathUrl("/login"));
    await page.goto(SETTINGS);
    await expect(page).toHaveURL(/\/login\?redirectTo=%2Faccount%2Fsettings$/);

    // --- Sign in with the new username and the new password; it goes back to the settings page.
    await waitForHydration(page);
    await page.getByLabel("Username or email", { exact: true }).fill(newName);
    await fillSecret(page.getByLabel("Password", { exact: true }), newPassword);
    await page.getByRole("main").getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(pathUrl(SETTINGS));
    await expect(userInfo(page)).toContainText(newName);

    await verifyAfterReload(async () => {
      await expect(page).toHaveURL(pathUrl(SETTINGS));
      await expect(userInfo(page)).toContainText(newName);
      await expect(settingsAvatar).toHaveAttribute("src", photoUrl);
    });
  });
});
