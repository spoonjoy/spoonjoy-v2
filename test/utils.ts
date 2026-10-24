import { faker } from "@faker-js/faker";
import { fireEvent, waitFor } from "@testing-library/react";
import { expect } from "vitest";
import { createRoutesStub } from "react-router";
import { createElement, type ComponentProps } from "react";
import { OuroProvider } from "~/lib/ouro/ouro-provider";
import { OuroRouterLink } from "~/components/navigation/ouro-router-link";

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
  const RoutesStub = createRoutesStub(addHydrateFallback(routes), context);
  // Match root.tsx's real released-component Router boundary. Document-request buttons
  // opt out explicitly in the app adapter; ordinary buttons must exercise real SPA history.
  return function TestRoutesStub(props: ComponentProps<typeof RoutesStub>) {
    return createElement(OuroProvider, {
      linkComponent: OuroRouterLink,
      children: createElement(RoutesStub, props),
    });
  };
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
 * Required markers are CSS decoration in Ouro v0.8, not part of the label text.
 */
export function requiredLabel(label: string) {
  return label;
}

/**
 * The alerts that say something. An accepted form refusal and standalone alerts can
 * coexist; callers can scope this to the form or dialog they are checking.
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

// Picks a photo in an HX ImageField, as choosing a file does. user-event's upload() pins the
// input's files to a getter, and the field's own write (the input holds what the field shows)
// then throws; a change event with a writable list leaves that write working. The field opens the
// photo before it takes it, so this waits until the input holds it.
export async function chooseImage(input: HTMLElement, file: File): Promise<void> {
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect((input as HTMLInputElement).files?.[0]).toBe(file));
}
