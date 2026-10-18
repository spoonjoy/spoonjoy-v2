// The HX census: every page Spoonjoy renders, as the persona who sees it, and every state a person
// can open on it (dialogs, menus, sheets, popovers, disclosures), each with the exact multiset of
// visible controls it shows. hx-census.journey.ts visits every state on both device projects and
// compares the multiset with hx-census.baseline.json; scripts/hx-census.mjs owns identities, diffs
// and the ratchet. See AGENTS.md, "The HX census".
//
// A journey enrolled in the census must be 100% HX: every control it shows carries a
// data-ouro-control marker naming an installed HX item. Nothing is enrolled until Spoonjoy installs
// Ouro HX v1.1.0, the first release that marks its controls. An unenrolled journey is measured, and
// its unmarked count may only fall (`pnpm census:update` refuses a rise).
//
// Every state starts from a fresh load of the journey's path, so a state never depends on another.
// Actions only open things: they never submit, save or confirm, so the personas' data is never
// changed (scripts/check-journey-rules.mjs requires every page another journey visits to have a
// journey here).
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { KITCHEN } from "../../../scripts/seed-qa-kitchen.mjs";
import {
  checkCensusState,
  controlIdentity,
  EXPECTED_FILE,
  expectedFromJourneys,
  stringifyCensus,
  toMultiset,
  workerFileName,
  type RawControl,
} from "../../../scripts/hx-census.mjs";
import { axeSource } from "./axe";
import { expect } from "./journey";
import { personaStorageStatePath, type PersonaName } from "./personas";

/**
 * Every element a person can focus or operate. Must equal ouro-testing's `interactiveSelector`
 * (HX test/controls.ts) once Ouro HX v1.1.0 is installed; Task 12 adds a test that they match.
 */
export const interactiveSelector =
  'a[href], button, input:not([type="hidden"]), select, textarea, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"]';

/**
 * The `interactiveSelector` matches that are no control (Base UI's focus guards). Must equal
 * ouro-testing's `censusExclusions` once Ouro HX v1.1.0 is installed; Task 12 adds the test.
 */
export const censusExclusions: readonly string[] = ["[data-base-ui-focus-guard]"];

export type CensusPersona = "signed-out" | PersonaName;

export interface CensusState {
  id: string;
  /** Opens what this state measures, from a fresh load of the journey's path. Never submits. */
  action?: (page: Page) => Promise<void>;
}

export interface Journey {
  id: string;
  /** Enrolled journeys fail on any control without a data-ouro-control marker. */
  enrolled: boolean;
  persona: CensusPersona;
  /** Where the journey's page is, path and query; the page must not redirect anywhere else. */
  path: string;
  /** The document's HTTP status; 200 unless the page is a "not found" page. */
  status?: number;
  states: CensusState[];
}

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
  const mode = page.getByRole("button", { name, exact: true });
  await mode.click();
  await expect(mode).toHaveAttribute("aria-pressed", "true");
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
  { id: "home-signed-out", enrolled: false, persona: "signed-out", path: "/", states: [DEFAULT] },
  { id: "home-chef", enrolled: false, persona: "chef", path: "/", states: [DEFAULT] },
  { id: "home-newbie", enrolled: false, persona: "newbie", path: "/", states: [DEFAULT] },
  { id: "sign-in", enrolled: false, persona: "signed-out", path: "/login", states: [DEFAULT] },
  { id: "sign-up", enrolled: false, persona: "signed-out", path: "/signup", states: [DEFAULT] },
  { id: "log-out", enrolled: false, persona: "chef", path: "/logout", states: [DEFAULT] },
  { id: "privacy", enrolled: false, persona: "signed-out", path: "/privacy", states: [DEFAULT] },
  { id: "terms", enrolled: false, persona: "signed-out", path: "/terms", states: [DEFAULT] },
  { id: "account-deleted", enrolled: false, persona: "signed-out", path: "/account/deleted", states: [DEFAULT] },
  { id: "not-found", enrolled: false, persona: "signed-out", path: "/hx-census-page-that-does-not-exist", status: 404, states: [DEFAULT] },

  // Recipes.
  { id: "recipes", enrolled: false, persona: "signed-out", path: "/recipes", states: [DEFAULT] },
  {
    id: "recipe-signed-out",
    enrolled: false,
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
    enrolled: false,
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
    enrolled: false,
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
    enrolled: false,
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
    enrolled: false,
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
    enrolled: false,
    persona: "chef",
    path: `${LEMON_RICE}/steps/new`,
    states: [DEFAULT, { id: "uses-output-open", action: openUsesOutput }],
  },
  {
    id: "step-edit",
    enrolled: false,
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
    enrolled: false,
    persona: "chef",
    path: `${LEMON_RICE}/steps/${LEMON_RICE_STEP_3}/edit`,
    states: [DEFAULT, { id: "uses-output-open", action: openUsesOutput }],
  },
  { id: "my-recipes", enrolled: false, persona: "chef", path: "/my-recipes", states: [DEFAULT] },
  { id: "saved-recipes", enrolled: false, persona: "chef", path: "/saved-recipes", states: [DEFAULT] },

  // Cookbooks.
  { id: "cookbooks", enrolled: false, persona: "chef", path: "/cookbooks", states: [DEFAULT] },
  { id: "cookbooks-newbie", enrolled: false, persona: "newbie", path: "/cookbooks", states: [DEFAULT] },
  { id: "cookbook-new", enrolled: false, persona: "chef", path: "/cookbooks/new", states: [DEFAULT] },
  {
    id: "cookbook",
    enrolled: false,
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
    enrolled: false,
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
          await page.getByRole("button", { name: "Remove jasmine rice", exact: true }).press("Enter");
          await expect(page.getByRole("alertdialog", { name: 'Remove "jasmine rice"?', exact: true })).toBeVisible();
        },
      },
    ],
  },
  { id: "shopping-list-newbie", enrolled: false, persona: "newbie", path: "/shopping-list", states: [DEFAULT] },

  // Search and people.
  // An empty search browses the 30 most recent things, which include this run's scratch users
  // (codex_e2e_s_<run token>_<n>); a query that matches nothing measures the page without them.
  { id: "search-no-results", enrolled: false, persona: "chef", path: "/search?q=hxcensusnomatch", states: [DEFAULT] },
  { id: "search-results", enrolled: false, persona: "chef", path: "/search?q=lemon", states: [DEFAULT] },
  // /chefs is the signed-in chef's own page (signed out it redirects to sign-in).
  { id: "chefs", enrolled: false, persona: "chef", path: "/chefs", states: [DEFAULT] },
  { id: "chef-profile", enrolled: false, persona: "signed-out", path: CHEF_PROFILE, states: [DEFAULT] },
  { id: "chef-profile-own", enrolled: false, persona: "chef", path: CHEF_PROFILE, states: [DEFAULT] },
  { id: "fellow-chefs", enrolled: false, persona: "signed-out", path: `${CHEF_PROFILE}/fellow-chefs`, states: [DEFAULT] },
  { id: "kitchen-visitors", enrolled: false, persona: "signed-out", path: `${CHEF_PROFILE}/kitchen-visitors`, states: [DEFAULT] },

  // Account.
  {
    id: "account-settings",
    enrolled: false,
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
        // Choosing a photo opens the crop dialog; nothing is uploaded until "Save photo".
        id: "crop-photo-dialog",
        action: async (page) => {
          const chooser = page.waitForEvent("filechooser");
          await page.getByTestId("profile-photo-section").getByRole("button", { name: "Upload photo", exact: true }).click();
          await (await chooser).setFiles(PHOTO_FIXTURE);
          const cropDialog = page.getByRole("dialog", { name: "Crop your photo" });
          await expect(cropDialog).toBeVisible();
          await expect(cropDialog.getByRole("button", { name: "Save photo", exact: true })).toBeEnabled();
        },
      },
    ],
  },

  // Developers, agents and OAuth.
  { id: "developers", enrolled: false, persona: "signed-out", path: "/developers", states: [DEFAULT] },
  { id: "developers-playground", enrolled: false, persona: "signed-out", path: "/developers/playground", states: [DEFAULT] },
  { id: "mcp", enrolled: false, persona: "signed-out", path: "/mcp", states: [DEFAULT] },
  { id: "agent-connect", enrolled: false, persona: "chef", path: "/agent/connect", states: [DEFAULT] },
  // No pending request is seeded, so this is the page for a request that does not exist.
  { id: "agent-connect-request", enrolled: false, persona: "chef", path: "/agent/connect/hx-census-no-such-request", states: [DEFAULT] },
  // Without a client the page explains that the request is invalid.
  { id: "oauth-authorize", enrolled: false, persona: "chef", path: "/oauth/authorize", states: [DEFAULT] },
  { id: "oauth-callback", enrolled: false, persona: "signed-out", path: "/oauth/callback", states: [DEFAULT] },
];

/** The stored session for a census persona; signed-out journeys start with no cookies. */
export function censusStorageState(persona: CensusPersona): string | { cookies: []; origins: [] } {
  return persona === "signed-out" ? { cookies: [], origins: [] } : personaStorageStatePath(persona);
}

interface InPageControl extends RawControl {
  visible: boolean;
}

// Runs in the page (page.evaluate), so it must not close over anything. Role follows HX's
// controlRole (test/controls.ts); names come from axe-core's accessible-name computation.
function collectInPage({ selector, exclusions }: { selector: string; exclusions: readonly string[] }): InPageControl[] {
  type Axe = {
    setup(node: Document): unknown;
    teardown(): void;
    commons: { text: { accessibleText(element: Element): string } };
  };
  const axe = (window as unknown as { axe: Axe }).axe;
  const inputRoles: Record<string, string> = {
    button: "button",
    checkbox: "checkbox",
    file: "button",
    image: "button",
    number: "spinbutton",
    radio: "radio",
    range: "slider",
    reset: "button",
    submit: "button",
  };
  const controlRole = (element: Element): string => {
    const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0];
    if (explicit) return explicit;
    const tag = element.localName;
    if (tag === "a" || tag === "area") return element.hasAttribute("href") ? "link" : "generic";
    if (tag === "button") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return (element as HTMLSelectElement).multiple || (element as HTMLSelectElement).size > 1 ? "listbox" : "combobox";
    if (tag === "input") {
      const type = (element.getAttribute("type") ?? "text").toLowerCase();
      if (type === "search") return element.hasAttribute("list") ? "combobox" : "searchbox";
      if (["email", "tel", "text", "url"].includes(type) && element.hasAttribute("list")) return "combobox";
      return inputRoles[type] ?? "textbox";
    }
    if ((element as HTMLElement).isContentEditable) return "textbox";
    return "generic";
  };
  const sectioning = "article, aside, main, nav, section";
  const landmarkRoles = new Set(["banner", "navigation", "main", "complementary", "contentinfo", "search", "dialog", "alertdialog"]);
  const namedRoles = new Set(["form", "region", "group"]);
  const implicitRole = (element: Element): string | null => {
    switch (element.localName) {
      case "header":
        return element.parentElement?.closest(sectioning) ? null : "banner";
      case "footer":
        return element.parentElement?.closest(sectioning) ? null : "contentinfo";
      case "nav":
        return "navigation";
      case "main":
        return "main";
      case "aside":
        return "complementary";
      case "search":
        return "search";
      case "dialog":
        return "dialog";
      case "form":
        return "form";
      case "section":
        return "region";
      case "fieldset":
        return "group";
      default:
        return null;
    }
  };
  // A landmark, dialog or group is named only by its author (aria-labelledby, aria-label, a
  // fieldset's legend, title), never by its content, which would make the context change with it.
  const authoredName = (element: Element): string => {
    const labelledBy = element.getAttribute("aria-labelledby")?.trim();
    if (labelledBy) {
      return labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter((label): label is HTMLElement => label !== null)
        .map((label) => axe.commons.text.accessibleText(label))
        .join(" ");
    }
    const label = element.getAttribute("aria-label")?.trim();
    if (label) return label;
    if (element.localName === "fieldset") {
      const legend = [...element.children].find((child) => child.localName === "legend");
      if (legend?.textContent?.trim()) return legend.textContent;
    }
    return element.getAttribute("title") ?? "";
  };
  const landmarkOf = (element: Element): { role: string; name: string } | null => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      const role = node.getAttribute("role")?.trim().split(/\s+/)[0] || implicitRole(node);
      if (!role) continue;
      const name = authoredName(node);
      if (landmarkRoles.has(role) || (namedRoles.has(role) && name.trim())) return { role, name };
    }
    return null;
  };
  const isVisible = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility === "visible";
  };

  axe.teardown();
  axe.setup(document);
  try {
    return [...document.querySelectorAll(selector)]
      .filter((element) => !exclusions.some((exclusion) => element.matches(exclusion)))
      .map((element) => {
        const landmark = landmarkOf(element);
        return {
          visible: isVisible(element),
          role: controlRole(element),
          name: axe.commons.text.accessibleText(element),
          control: element.getAttribute("data-ouro-control"),
          part: element.getAttribute("data-ouro-part"),
          landmark,
          testId: landmark ? null : element.parentElement?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
        };
      });
  } finally {
    axe.teardown();
  }
}

/** Waits until no finite animation is running; infinite ones (spinners) never settle and are ignored. */
async function waitForAnimations(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      if (animation.playState !== "running" && !animation.pending) return true;
      const end = animation.effect?.getComputedTiming().endTime;
      return typeof end === "number" && !Number.isFinite(end);
    }),
  );
}

async function identitiesOnPage(page: Page): Promise<string[]> {
  await waitForAnimations(page);
  const controls = await page.evaluate(collectInPage, { selector: interactiveSelector, exclusions: censusExclusions });
  return controls.filter((control) => control.visible).map(({ visible: _visible, ...control }) => controlIdentity(control));
}

const SETTLE_ATTEMPTS = 20;
const SETTLE_INTERVAL_MS = 250;

/**
 * The state's multiset of visible control identities, once two readings a moment apart agree (late
 * data and lazy sections can still add controls after hydration and animations).
 */
export async function collectCensus(page: Page): Promise<Array<{ identity: string; count: number }>> {
  await page.evaluate(axeSource);
  let previous = JSON.stringify(toMultiset(await identitiesOnPage(page)));
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
    await page.waitForTimeout(SETTLE_INTERVAL_MS);
    const current = JSON.stringify(toMultiset(await identitiesOnPage(page)));
    if (current === previous) return JSON.parse(current);
    previous = current;
  }
  throw new Error(`HX census: the page's controls never settled (${SETTLE_ATTEMPTS} readings ${SETTLE_INTERVAL_MS} ms apart all differed).`);
}

const here = path.dirname(fileURLToPath(import.meta.url));
export const BASELINE_FILE = path.resolve(here, "../hx-census.baseline.json");
const OURO_COMPONENTS = path.resolve(here, "../../../app/components/ouro");

/** Where each worker writes its census; the Journeys workflow merges this directory. */
export function censusResultsDirectory(): string {
  return path.resolve(process.env.SPOONJOY_HX_CENSUS_DIR ?? "hx-census");
}

let baseline: Record<string, unknown> | undefined;
function readBaseline(): Record<string, unknown> {
  baseline ??= JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Record<string, unknown>;
  return baseline;
}

/** The installed HX items' names (app/components/ouro/<item>), the only valid markers. */
export function installedItems(): string[] {
  return readdirSync(OURO_COMPONENTS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/**
 * Writes the states this run must record (every state of every journey in `census`) to
 * hx-census-expected.json beside the worker files, so the merge fails when any is missing. Every
 * worker writes the same content; each writes a file of its own and renames it into place, so a
 * reader never sees half of one.
 */
export function recordExpectedCensus(worker: number): string {
  const directory = censusResultsDirectory();
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, EXPECTED_FILE);
  const partial = `${file}.${process.pid}.${worker}.partial`;
  writeFileSync(partial, stringifyCensus(expectedFromJourneys(census)));
  renameSync(partial, file);
  return file;
}

const recorded: Record<string, Record<string, Record<string, Array<{ identity: string; count: number }>>>> = {};

/**
 * Adds one state's multiset to this worker's census file (hx-census-actual.<project>.<worker>.json)
 * and returns the file's path. A worker restarted after a failure gets a new index, so its file is new.
 */
export function recordCensus(project: string, worker: number, journeyId: string, stateId: string, multiset: Array<{ identity: string; count: number }>): string {
  ((recorded[project] ??= {})[journeyId] ??= {})[stateId] = multiset;
  const directory = censusResultsDirectory();
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, workerFileName(project, worker));
  writeFileSync(file, `${JSON.stringify({ [project]: recorded[project] }, null, 2)}\n`);
  return file;
}

/** Fails with every problem checkCensusState finds: no baseline, any difference, or (enrolled) any unmarked control. */
export function expectCensusMatches(options: { project: string; journey: Journey; stateId: string; actual: Array<{ identity: string; count: number }>; actualPath: string }): void {
  const problems = checkCensusState({
    baseline: readBaseline(),
    project: options.project,
    journeyId: options.journey.id,
    stateId: options.stateId,
    actual: options.actual,
    enrolled: options.journey.enrolled,
    knownItems: installedItems(),
    actualPath: options.actualPath,
  });
  if (problems.length > 0) throw new Error(problems.join("\n\n"));
}
