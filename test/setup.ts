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
import "./warning-policy";
import { vi, beforeAll, expect } from "vitest";
import React from "react";

// Mock Motion's Reorder components to render children directly in tests
// This is needed because Reorder.Group and Reorder.Item have complex animation
// logic that doesn't work well with happy-dom
//
// LazyMotion gets its features synchronously: the app loads them from a separate chunk after the
// first render, and in a test that load would land after the render's act() scope and fail the
// warning gate. test/components/motion/lazy-motion.test.tsx uses the real module to test the
// lazy load itself.
vi.mock('motion/react', async () => {
  const actual = await vi.importActual<typeof import('motion/react')>('motion/react');
  return {
    ...actual,
    LazyMotion: ({ features, ...props }: React.ComponentProps<typeof actual.LazyMotion>) =>
      React.createElement(actual.LazyMotion, { ...props, features: typeof features === 'function' ? actual.domMax : features }),
    Reorder: {
      Group: ({ children, className }: { children: React.ReactNode; className?: string }) =>
        React.createElement('div', { className }, children),
      Item: ({ children }: { children: React.ReactNode }) =>
        React.createElement('div', null, children),
    },
  };
});

// Prisma talks to the test database through better-sqlite3, the same SQLite library the D1 test
// binding (test/helpers/sqlite-d1.ts) uses, instead of through its own engine's SQLite. SQLite's
// POSIX locks are per process and per library: two libraries with one file open in one process
// do not see each other's locks, and one could delete a journal the other still needed
// ("disk I/O error", SQLITE_IOERR_DELETE_NOENT). One library keeps every connection in the
// process on one lock table. Timestamps keep the engine's integer-millisecond storage.
vi.mock('@prisma/client', async () => {
  const actual = await vi.importActual<typeof import('@prisma/client')>('@prisma/client');
  const { PrismaBetterSQLite3 } = await import('@prisma/adapter-better-sqlite3');
  type Options = NonNullable<ConstructorParameters<typeof actual.PrismaClient>[0]>;
  class TestPrismaClient extends actual.PrismaClient {
    constructor(options: Options = {}) {
      super(options.adapter ? options : { ...options, adapter: testDatabaseAdapter(PrismaBetterSQLite3) });
    }
  }
  return { ...actual, PrismaClient: TestPrismaClient };
});

function testDatabaseAdapter(Adapter: typeof import('@prisma/adapter-better-sqlite3').PrismaBetterSQLite3) {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.startsWith('file:')) throw new Error(`The test database URL is not a file URL: ${url}`);
  const path = url.slice('file:'.length).split('?')[0];
  // The engine waited up to 60 s for a lock (socket_timeout=60 in workerDatabaseUrl).
  return new Adapter({ url: path, timeout: 60_000 }, { timestampFormat: 'unixepoch-ms' });
}

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
import { prepareWorkerDb, workerDatabaseUrl } from "./support/worker-db";

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
// Anchored to this checkout's prisma/test.db, the file test/helpers/sqlite-d1.ts also opens
// (through workerDbPath). A relative "file:./test.db" resolves against the generated client's
// schema path, so worktrees sharing one node_modules would otherwise share one database and
// delete each other's rows. In a parallel run, each worker process gets its own copy of a
// snapshot of that file instead (test/support/worker-db.ts): per checkout, then per process.
process.env.DATABASE_URL = workerDatabaseUrl(prepareWorkerDb());
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
  await db.nativePushDevice.deleteMany({});
  await db.pushSubscription.deleteMany({});
  await db.shoppingListItem.deleteMany({});
  await db.shoppingList.deleteMany({});
  await db.stepOutputUse.deleteMany({});
  await db.ingredient.deleteMany({});
  await db.recipeStep.deleteMany({});
  await db.recipeInCookbook.deleteMany({});
  await db.cookbook.deleteMany({});
  await db.recipe.updateMany({ data: { activeCoverId: null, sourceRecipeId: null } });
  await db.recipeCover.deleteMany({});
  await db.recipeSpoon.deleteMany({});
  await db.recipe.deleteMany({});
  await db.ingredientRef.deleteMany({});
  await db.unit.deleteMany({});
  await db.agentConnectionRequest.deleteMany({});
  await db.nativeSyncTombstone.deleteMany({});
  await db.apiMutationTombstone.deleteMany({});
  await db.apiIdempotencyKey.deleteMany({});
  await db.oAuthRefreshLineage.deleteMany({});
  await db.oAuthTokenIssuance.deleteMany({});
  await db.oAuthGrant.deleteMany({});
  await db.apiCredential.deleteMany({});
  await db.imageGenLedger.deleteMany({});
  await db.imageGenDailyBudget.deleteMany({});
  await db.oAuthAuthCode.deleteMany({});
  await db.oAuthRefreshToken.deleteMany({});
  await db.oAuthClient.deleteMany({});
  await db.userCredential.deleteMany({});
  await db.oAuth.deleteMany({});
  await db.user.deleteMany({});
});
