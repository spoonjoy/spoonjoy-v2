import { faker } from "@faker-js/faker";
import { waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";

type StubRouteObject = Parameters<typeof createRoutesStub>[0][number];

/**
 * Add HydrateFallback to routes to suppress the warning:
 * "No `HydrateFallback` element provided to render during initial hydration"
 */
function addHydrateFallback(routes: StubRouteObject[]): StubRouteObject[] {
  return routes.map((route) => ({
    ...route,
    HydrateFallback: () => null,
    children: route.children ? addHydrateFallback(route.children) : undefined,
  }));
}

/**
 * Create a routes stub with HydrateFallback pre-configured to suppress hydration warnings.
 * Use this instead of createRoutesStub directly in tests.
 */
export function createTestRoutesStub(
  routes: StubRouteObject[],
  context?: Parameters<typeof createRoutesStub>[1]
) {
  return createRoutesStub(addHydrateFallback(routes), context);
}

/**
 * Generate unique test user data using Faker
 */
export function createTestUser() {
  return {
    email: faker.internet.email(),
    username: faker.internet.username() + "_" + faker.string.alphanumeric(8),
    hashedPassword: faker.string.alphanumeric(64),
    salt: faker.string.alphanumeric(32),
  };
}

/**
 * Generate unique test recipe data using Faker
 */
export function createTestRecipe(chefId: string) {
  return {
    title: faker.food.dish() + " " + faker.string.alphanumeric(6),
    description: faker.food.description(),
    servings: faker.number.int({ min: 1, max: 12 }).toString(),
    chefId,
  };
}

/**
 * Generate unique cookbook title using Faker
 */
export function createCookbookTitle() {
  return faker.word.adjective() + " " + faker.word.noun() + " Cookbook " + faker.string.alphanumeric(6);
}

/**
 * Generate unique unit name using Faker
 */
export function createUnitName() {
  return faker.science.unit().name + "_" + faker.string.alphanumeric(6);
}

/**
 * Generate unique ingredient name using Faker
 */
export function createIngredientName() {
  return faker.food.ingredient() + " " + faker.string.alphanumeric(6);
}

/**
 * Generate unique step description using Faker
 */
export function createStepDescription() {
  return faker.lorem.sentence() + " " + faker.string.alphanumeric(6);
}

/**
 * Generate unique step title using Faker
 */
export function createStepTitle() {
  return faker.word.verb() + " " + faker.word.noun() + " " + faker.string.alphanumeric(6);
}

/**
 * Get or create a unit by name to prevent unique constraint errors
 */
export async function getOrCreateUnit(db: any, name: string) {
  let unit = await db.unit.findUnique({
    where: { name },
  });

  if (!unit) {
    unit = await db.unit.create({
      data: { name },
    });
  }

  return unit;
}

/**
 * Get or create an ingredient ref by name to prevent unique constraint errors
 */
export async function getOrCreateIngredientRef(db: any, name: string) {
  let ingredientRef = await db.ingredientRef.findUnique({
    where: { name },
  });

  if (!ingredientRef) {
    ingredientRef = await db.ingredientRef.create({
      data: { name },
    });
  }

  return ingredientRef;
}

/**
 * The label text of a required field. Ouro UI marks a required field's label with an asterisk,
 * which screen readers skip but which is part of the label's text, so `getByLabelText("Email")`
 * no longer finds a required Email field: `getByLabelText(requiredLabel("Email"))` does.
 */
export function requiredLabel(label: string) {
  return `${label}*`;
}

/**
 * The alerts that say something. Ouro UI's Form keeps a `role="alert"` region at its top for its
 * own messages, empty until there is one, so `getByRole("alert")` on a page with a Form finds
 * that region as well as the alert a test means.
 */
export function shownAlerts(container: HTMLElement = document.body): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="alert"]')).filter(
    (alert) => alert.textContent !== "",
  );
}

/** The one alert that says something; throws when there is none or more than one. */
export function getShownAlert(container?: HTMLElement): HTMLElement {
  const alerts = shownAlerts(container);
  if (alerts.length !== 1) throw new Error(`Expected one alert with a message, found ${alerts.length}.`);
  return alerts[0];
}

/** Waits for the one alert that says something. */
export function findShownAlert(options: { container?: HTMLElement; timeout?: number } = {}): Promise<HTMLElement> {
  return waitFor(() => getShownAlert(options.container), { timeout: options.timeout });
}

/** The one alert that says something, or null when no alert does. */
export function queryShownAlert(container?: HTMLElement): HTMLElement | null {
  return shownAlerts(container)[0] ?? null;
}
