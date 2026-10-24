// The HX census: every page Spoonjoy renders, as the persona who sees it, and every state a person
// can open on it (dialogs, menus, sheets, popovers, disclosures). hx-census.journey.ts hands this
// list to HX's census kit (ouro-census, installed under e2e/ouro-census/), which visits every state
// on both device projects and holds its exact multiset of visible controls to
// e2e/ouro-census/census.baseline.json. See AGENTS.md, "The HX census".
//
// A journey enrolled in the census must be 100% HX: every control it shows carries a
// data-ouro-control marker naming an installed HX component. An unenrolled journey is measured, and
// its unmarked count may only fall (`pnpm census:update` refuses a rise). Every journey below is
// enrolled, including MCP's document link rendered by HX Link.
//
// Every state starts from a fresh load of the journey's path, so a state never depends on another.
// Actions only open things: they never submit, save or confirm, so the personas' data is never
// changed (scripts/check-journey-rules.mjs requires every page another journey visits to have a
// journey here).
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import type { CensusState, Journey as OuroCensusJourney } from "../../ouro-census/census-page.mjs";
import { KITCHEN } from "../../../scripts/seed-qa-kitchen.mjs";
import { expect } from "./journey";
import { personaStorageStatePath, type PersonaName } from "./personas";

export type CensusPersona = "signed-out" | PersonaName;

/** A census journey as Spoonjoy writes it: the persona who sees the page, not a storage state. */
export interface Journey extends Omit<OuroCensusJourney, "storageState"> {
  persona: CensusPersona;
}

/** The Playwright projects the census runs in; the merge fails when one records nothing. */
export const CENSUS_PROJECTS = ["iphone-webkit", "desktop-chrome"] as const;

const LEMON_RICE = `/recipes/${KITCHEN.recipes.lemonRice.id}`;
const LEMON_RICE_TITLE = KITCHEN.recipes.lemonRice.title;
const WEEKNIGHT = `/cookbooks/${KITCHEN.cookbooks.weeknight.id}`;
const LEMON_RICE_STEP_1 = `${KITCHEN.recipes.lemonRice.id}-step-1`;
const LEMON_RICE_STEP_3 = `${KITCHEN.recipes.lemonRice.id}-step-3`;
const CHEF_PROFILE = `/users/${KITCHEN.chef.username}`;
const PHOTO_FIXTURE = path.resolve("e2e/fixtures/asymmetric-exif-orientation.jpg");

const DEFAULT: CensusState = { id: "default" };

async function openDialog(trigger: Locator, dialog: Locator) {
  await trigger.click();
  await expect(dialog).toBeVisible();
}

async function openRecipeMaintenance(page: Page) {
  const toggle = page.getByRole("button", { name: /^Manage recipe/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  return page.locator("#recipe-owner-maintenance");
}

async function enterCookMode(page: Page) {
  await page.getByRole("link", { name: "Cook mode", exact: true }).click();
  await expect(page.getByTestId("cook-mode-panel")).toBeVisible();
}

async function openCookbookOwnerTools(page: Page) {
  const toggle = page.getByRole("button", { name: /^Owner tools/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

async function openUsesOutput(page: Page) {
  await page.getByRole("combobox", { name: "Uses output from (optional)" }).click();
  await expect(page.getByRole("option", { name: "Step 1: Cook the rice", exact: true })).toBeVisible();
}

async function pressImportMode(page: Page, name: string) {
  const mode = page.getByRole("radio", { name, exact: true });
  await mode.click();
  await expect(mode).toHaveAttribute("aria-checked", "true");
}

function editStep(page: Page, stepNum: number) {
  return page.getByRole("region", { name: "Recipe steps" }).getByRole("article", { name: `Step ${stepNum}`, exact: true });
}

/**
 * The census: every route in app/routes.ts that renders a page on a GET, with each dynamic segment
 * resolved to QA kitchen data (scripts/seed-qa-kitchen.mjs). Routes whose GET renders nothing
 * (OAuth provider redirects and callbacks, the legacy Redwood OAuth path, the DevTools and release
 * readiness probes, images, feeds, APIs and layouts) are not pages and are not listed.
 */
export const census: Journey[] = [
  // Home, sign-in and the public pages.
  { id: "home-signed-out", enrolled: true, persona: "signed-out", path: "/", states: [DEFAULT] },
  { id: "home-chef", enrolled: true, persona: "chef", path: "/", states: [DEFAULT] },
  { id: "home-newbie", enrolled: true, persona: "newbie", path: "/", states: [DEFAULT] },
  { id: "sign-in", enrolled: true, persona: "signed-out", path: "/login", states: [DEFAULT] },
  { id: "sign-up", enrolled: true, persona: "signed-out", path: "/signup", states: [DEFAULT] },
  { id: "log-out", enrolled: true, persona: "chef", path: "/logout", states: [DEFAULT] },
  { id: "privacy", enrolled: true, persona: "signed-out", path: "/privacy", states: [DEFAULT] },
  { id: "terms", enrolled: true, persona: "signed-out", path: "/terms", states: [DEFAULT] },
  {
    id: "test-kitchen",
    enrolled: true,
    persona: "signed-out",
    path: "/test-kitchen",
    states: [
      DEFAULT,
      {
        id: "cook-mode",
        action: async (page) => {
          await page.getByRole("button", { name: "Start cooking", exact: true }).click();
          await expect(page.getByTestId("cook-mode-panel")).toBeVisible();
        },
      },
      {
        id: "xray",
        action: async (page) => {
          await page.getByRole("switch", { name: "X-ray", exact: true }).click();
          await expect(page.getByRole("group", { name: "X-ray", exact: true })).toBeVisible();
        },
      },
    ],
  },
  { id: "account-deleted", enrolled: true, persona: "signed-out", path: "/account/deleted", states: [DEFAULT] },
  { id: "not-found", enrolled: true, persona: "signed-out", path: "/hx-census-page-that-does-not-exist", status: 404, states: [DEFAULT] },

  // Recipes.
  { id: "recipes", enrolled: true, persona: "signed-out", path: "/recipes", states: [DEFAULT] },
  {
    id: "recipe-signed-out",
    enrolled: true,
    persona: "signed-out",
    path: LEMON_RICE,
    states: [
      DEFAULT,
      { id: "cook-mode", action: enterCookMode },
      {
        id: "cook-mode-next-step",
        action: async (page) => {
          await enterCookMode(page);
          await page.getByTestId("cook-mode-panel").getByRole("button", { name: "Next step" }).click();
          await expect(page.getByRole("region", { name: "Make the dressing", exact: true })).toBeVisible();
        },
      },
    ],
  },
  {
    id: "recipe-owner",
    enrolled: true,
    persona: "chef",
    path: LEMON_RICE,
    states: [
      DEFAULT,
      // Entering cook mode changes no progress (cooking.journey.ts's history tests do it as the chef).
      { id: "cook-mode", action: enterCookMode },
      { id: "manage-open", action: async (page) => void (await openRecipeMaintenance(page)) },
      {
        id: "delete-dialog",
        action: async (page) => {
          const maintenance = await openRecipeMaintenance(page);
          await openDialog(maintenance.getByRole("button", { name: "Delete", exact: true }), page.getByRole("alertdialog", { name: `Delete "${LEMON_RICE_TITLE}"?` }));
        },
      },
      {
        id: "variation-dialog",
        action: async (page) => {
          const maintenance = await openRecipeMaintenance(page);
          await openDialog(maintenance.getByRole("button", { name: "Make a variation", exact: true }), page.getByRole("dialog", { name: `Make a variation of "${LEMON_RICE_TITLE}"?` }));
        },
      },
      {
        id: "save-dialog",
        action: (page) => openDialog(page.getByTestId("recipe-header-save-action"), page.getByRole("dialog", { name: "Save to cookbook" })),
      },
      {
        id: "log-cook-dialog",
        action: (page) => openDialog(page.getByTestId("recipe-header-log-cook-action"), page.getByRole("dialog", { name: "Log a cook" })),
      },
    ],
  },
  {
    id: "recipe-friend",
    enrolled: true,
    persona: "friend",
    path: LEMON_RICE,
    states: [
      DEFAULT,
      {
        id: "fork-dialog",
        action: (page) => openDialog(page.getByTestId("recipe-header-fork-action"), page.getByRole("dialog", { name: `Fork "${LEMON_RICE_TITLE}"?` })),
      },
    ],
  },
  {
    id: "recipe-new",
    enrolled: true,
    persona: "chef",
    path: "/recipes/new",
    states: [
      DEFAULT,
      { id: "paste-text", action: (page) => pressImportMode(page, "Paste text") },
      { id: "from-photo", action: (page) => pressImportMode(page, "From a photo") },
    ],
  },
  {
    id: "recipe-edit",
    enrolled: true,
    persona: "chef",
    path: `${LEMON_RICE}/edit`,
    states: [
      DEFAULT,
      {
        id: "delete-step-dialog",
        action: (page) => openDialog(editStep(page, 3).getByRole("button", { name: "Delete", exact: true }), page.getByRole("alertdialog", { name: "Delete step" })),
      },
    ],
  },
  {
    id: "step-new",
    enrolled: true,
    persona: "chef",
    path: `${LEMON_RICE}/steps/new`,
    states: [DEFAULT, { id: "uses-output-open", action: openUsesOutput }],
  },
  {
    id: "step-edit",
    enrolled: true,
    persona: "chef",
    path: `${LEMON_RICE}/steps/${LEMON_RICE_STEP_1}/edit`,
    states: [
      DEFAULT,
      {
        id: "add-ingredient-open",
        action: async (page) => {
          // The form opens in AI mode (a fresh context has no stored mode preference): the "AI Parse"
          // switch is on and the ingredient text box shows. Manual mode's "Add ingredient" is not.
          await page.getByRole("button", { name: "+ Add ingredient", exact: true }).click();
          await expect(page.getByRole("switch", { name: "AI Parse" })).toBeChecked();
          await expect(page.getByRole("textbox", { name: "Ingredient text" })).toBeVisible();
        },
      },
      {
        id: "remove-ingredient-dialog",
        action: (page) => openDialog(page.getByRole("button", { name: "Remove jasmine rice", exact: true }), page.getByRole("alertdialog", { name: "Remove this ingredient?" })),
      },
    ],
  },
  {
    // Step 3 uses step 1's output, so its "Uses output from" select has steps to offer.
    id: "step-edit-uses-output",
    enrolled: true,
    persona: "chef",
    path: `${LEMON_RICE}/steps/${LEMON_RICE_STEP_3}/edit`,
    states: [DEFAULT, { id: "uses-output-open", action: openUsesOutput }],
  },
  { id: "my-recipes", enrolled: true, persona: "chef", path: "/my-recipes", states: [DEFAULT] },
  { id: "saved-recipes", enrolled: true, persona: "chef", path: "/saved-recipes", states: [DEFAULT] },

  // Cookbooks.
  { id: "cookbooks", enrolled: true, persona: "chef", path: "/cookbooks", states: [DEFAULT] },
  { id: "cookbooks-newbie", enrolled: true, persona: "newbie", path: "/cookbooks", states: [DEFAULT] },
  { id: "cookbook-new", enrolled: true, persona: "chef", path: "/cookbooks/new", states: [DEFAULT] },
  {
    id: "cookbook",
    enrolled: true,
    persona: "chef",
    path: WEEKNIGHT,
    states: [
      DEFAULT,
      { id: "owner-tools-open", action: openCookbookOwnerTools },
      {
        id: "delete-cookbook-dialog",
        action: async (page) => {
          await openCookbookOwnerTools(page);
          await openDialog(page.getByRole("button", { name: "Delete cookbook", exact: true }), page.getByRole("alertdialog", { name: "Delete this cookbook?" }));
        },
      },
      {
        id: "remove-recipe-dialog",
        action: async (page) => {
          await openCookbookOwnerTools(page);
          await openDialog(page.getByRole("button", { name: `Remove ${LEMON_RICE_TITLE} from cookbook`, exact: true }), page.getByRole("alertdialog", { name: "Remove from cookbook?" }));
        },
      },
    ],
  },

  // Shopping list (the chef's seeded list: jasmine rice, lemon, parsley).
  {
    id: "shopping-list",
    enrolled: true,
    persona: "chef",
    path: "/shopping-list",
    states: [
      DEFAULT,
      {
        id: "clear-all-dialog",
        action: (page) => openDialog(page.getByRole("button", { name: "Clear all", exact: true }), page.getByRole("alertdialog", { name: "Start fresh?" })),
      },
      {
        id: "item-actions-menu",
        action: async (page) => {
          await page.getByRole("button", { name: "Actions for jasmine rice", exact: true }).press("Enter");
          await expect(page.getByRole("menuitem", { name: "Delete jasmine rice", exact: true })).toBeVisible();
        },
      },
      {
        id: "remove-item-dialog",
        action: async (page) => {
          await page.getByRole("button", { name: "Actions for jasmine rice", exact: true }).press("Enter");
          await page.getByRole("menuitem", { name: "Delete jasmine rice", exact: true }).press("Enter");
          await expect(page.getByRole("alertdialog", { name: 'Remove "jasmine rice"?', exact: true })).toBeVisible();
        },
      },
    ],
  },
  { id: "shopping-list-newbie", enrolled: true, persona: "newbie", path: "/shopping-list", states: [DEFAULT] },

  // Search and people.
  // An empty search browses the 30 most recent things, which include this run's scratch users
  // (codex_e2e_s_<run token>_<n>); a query that matches nothing measures the page without them.
  { id: "search-no-results", enrolled: true, persona: "chef", path: "/search?q=hxcensusnomatch", states: [DEFAULT] },
  { id: "search-results", enrolled: true, persona: "chef", path: "/search?q=lemon", states: [DEFAULT] },
  // /chefs is the signed-in chef's own page (signed out it redirects to sign-in).
  { id: "chefs", enrolled: true, persona: "chef", path: "/chefs", states: [DEFAULT] },
  { id: "chef-profile", enrolled: true, persona: "signed-out", path: CHEF_PROFILE, states: [DEFAULT] },
  { id: "chef-profile-own", enrolled: true, persona: "chef", path: CHEF_PROFILE, states: [DEFAULT] },
  { id: "fellow-chefs", enrolled: true, persona: "signed-out", path: `${CHEF_PROFILE}/fellow-chefs`, states: [DEFAULT] },
  { id: "kitchen-visitors", enrolled: true, persona: "signed-out", path: `${CHEF_PROFILE}/kitchen-visitors`, states: [DEFAULT] },

  // Account.
  {
    id: "account-settings",
    enrolled: true,
    persona: "chef",
    path: "/account/settings",
    states: [
      DEFAULT,
      {
        id: "delete-account-open",
        action: async (page) => {
          await page.getByRole("button", { name: "Delete account…", exact: true }).click();
          await expect(page.getByRole("button", { name: "Delete my account", exact: true })).toBeVisible();
        },
      },
      {
        // Choosing a photo opens the crop dialog; nothing is uploaded until "Save".
        id: "crop-photo-dialog",
        action: async (page) => {
          const chooser = page.waitForEvent("filechooser");
          await page.getByTestId("profile-photo-section").getByRole("button", { name: "Upload photo", exact: true }).click();
          await (await chooser).setFiles(PHOTO_FIXTURE);
          const cropDialog = page.getByRole("dialog", { name: "Crop your photo" });
          await expect(cropDialog).toBeVisible();
          await expect(cropDialog.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
        },
      },
    ],
  },

  // Developers, agents and OAuth.
  { id: "developers", enrolled: true, persona: "signed-out", path: "/developers", states: [DEFAULT] },
  { id: "developers-playground", enrolled: true, persona: "signed-out", path: "/developers/playground", states: [DEFAULT] },
  { id: "mcp", enrolled: true, persona: "signed-out", path: "/mcp", states: [DEFAULT] },
  { id: "agent-connect", enrolled: true, persona: "chef", path: "/agent/connect", states: [DEFAULT] },
  // No pending request is seeded, so this is the page for a request that does not exist.
  { id: "agent-connect-request", enrolled: true, persona: "chef", path: "/agent/connect/hx-census-no-such-request", states: [DEFAULT] },
  // Without a client the page explains that the request is invalid.
  { id: "oauth-authorize", enrolled: true, persona: "chef", path: "/oauth/authorize", states: [DEFAULT] },
  { id: "oauth-callback", enrolled: true, persona: "signed-out", path: "/oauth/callback", states: [DEFAULT] },
];

/** The stored session for a census persona; signed-out journeys start with no cookies. */
export function censusStorageState(persona: CensusPersona): string | { cookies: []; origins: [] } {
  return persona === "signed-out" ? { cookies: [], origins: [] } : personaStorageStatePath(persona);
}

/** The census as HX's kit takes it: each journey visited with its persona's stored session. */
export function censusJourneys(): OuroCensusJourney[] {
  return census.map(({ persona, ...journey }) => ({ ...journey, storageState: censusStorageState(persona) }));
}
