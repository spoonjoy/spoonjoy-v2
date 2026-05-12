// Register tsconfig-paths to resolve TypeScript path aliases in require() calls
import { register } from "tsconfig-paths";
import { fileURLToPath } from "url";
import path from "path";
import Module from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseUrl = path.resolve(__dirname, "..");

// Use tsconfig-paths' matchPath to resolve aliases
import { createMatchPath } from "tsconfig-paths";

const matchPath = createMatchPath(baseUrl, {
  "~/*": ["app/*"],
  "@/*": ["app/components/*"],
});

import fs from "fs";

// Patch Module._resolveFilename to handle aliases
const originalResolveFilename = (Module as any)._resolveFilename;
const extensions = [".ts", ".tsx", ".js", ".jsx", ".json"];

(Module as any)._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
  // Try to match the path using tsconfig-paths
  const matched = matchPath(request, undefined, undefined, extensions);
  if (matched) {
    // matchPath returns path without extension, try to find the actual file
    for (const ext of extensions) {
      const fullPath = matched + ext;
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    // If file exists without extension (e.g., index)
    if (fs.existsSync(matched)) {
      return matched;
    }
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

import "@testing-library/jest-dom";
import { vi, beforeAll, expect } from "vitest";
import React from "react";

// Mock framer-motion Reorder components to render children directly in tests
// This is needed because Reorder.Group and Reorder.Item have complex animation
// logic that doesn't work well with happy-dom
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual('framer-motion');
  return {
    ...actual as object,
    Reorder: {
      Group: ({ children, className }: { children: React.ReactNode; className?: string }) =>
        React.createElement('div', { className }, children),
      Item: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', null, children),
    },
  };
});

// Suppress React act() warnings that come from library internals (Headless UI, Framer Motion)
// These warnings occur because some libraries use internal state management that triggers
// during test execution but don't affect test results
const originalError = console.error;
console.error = (...args: unknown[]) => {
  const message = args[0];
  if (typeof message === 'string' && message.includes('not wrapped in act(')) {
    return; // Suppress act() warnings from library internals
  }
  originalError.apply(console, args);
};

// Suppress the Node.js ExperimentalWarning emitted when migration tests load
// node:sqlite to validate raw SQL. The feature is stable in Node 22 LTS for our use
// and the warning would otherwise count against the zero-warnings test policy.
process.removeAllListeners('warning');
process.on('warning', (warning) => {
  if (warning.name === 'ExperimentalWarning' && /SQLite/.test(warning.message)) {
    return;
  }
  // eslint-disable-next-line no-console
  console.warn(warning.stack ?? warning.message);
});

// Extend toBeDisabled to also check aria-disabled for better accessibility testing
// This allows buttons with aria-disabled="true" (but no native disabled) to pass toBeDisabled()
// which is important for buttons that should remain in tab order while appearing disabled
expect.extend({
  toBeDisabled(element: HTMLElement) {
    // First check native disabled
    const hasNativeDisabled = element.hasAttribute('disabled');
    // Also check aria-disabled="true"
    const hasAriaDisabled = element.getAttribute('aria-disabled') === 'true';
    // Check if parent fieldset is disabled
    const isInDisabledFieldset = element.closest('fieldset[disabled]') !== null;

    const isDisabled = hasNativeDisabled || hasAriaDisabled || isInDisabledFieldset;

    return {
      pass: isDisabled,
      message: () => {
        const is = isDisabled ? 'is' : 'is not';
        return `expected element to ${this.isNot ? 'not ' : ''}be disabled, but it ${is} disabled`;
      },
    };
  },
});
import { mockAnimationsApi } from "jsdom-testing-mocks";
import { getLocalDb } from "~/lib/db.server";

// Mock animations API for HeadlessUI components when a DOM is available.
if (typeof window !== "undefined") {
  mockAnimationsApi();
}

// Mock ResizeObserver for HeadlessUI virtual components
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver;

// Mock window.confirm for browser confirm dialogs in tests
// Returns true by default to allow forms to submit
global.confirm = vi.fn(() => true);

// Mock environment variables
process.env.DATABASE_URL = "file:./test.db?connection_limit=1&socket_timeout=60";
process.env.SESSION_SECRET = "test-secret";

// Mock Cloudflare context
global.cloudflare = {
  env: {},
  cf: {},
  ctx: {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  },
} as any;

// Clean database before all tests
beforeAll(async () => {
  const db = await getLocalDb();

  // Delete all data in the correct order to respect foreign key constraints.
  // Tables must exist before tests run — ensured by `prisma db push` in CI
  // and by running `pnpm prisma:push` locally (see README / DEPLOY.md).
  await db.notificationPreference.deleteMany({});
  await db.notificationEvent.deleteMany({});
  await db.pushSubscription.deleteMany({});
  await db.shoppingListItem.deleteMany({});
  await db.shoppingList.deleteMany({});
  await db.stepOutputUse.deleteMany({});
  await db.ingredient.deleteMany({});
  await db.recipeStep.deleteMany({});
  await db.recipeInCookbook.deleteMany({});
  await db.cookbook.deleteMany({});
  await db.recipe.deleteMany({});
  await db.ingredientRef.deleteMany({});
  await db.unit.deleteMany({});
  await db.apiCredential.deleteMany({});
  await db.userCredential.deleteMany({});
  await db.oAuth.deleteMany({});
  await db.user.deleteMany({});
});
