import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { faker } from "@faker-js/faker";
import { Request as UndiciRequest } from "undici";
import type { PrismaClient as PrismaClientType } from "@prisma/client";
import { createApiCredential } from "~/lib/api-auth.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

const mocked = vi.hoisted(() => ({
  db: null as PrismaClientType | null,
}));

vi.mock("~/lib/route-platform.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/route-platform.server")>();
  return {
    ...actual,
    getRequestDb: vi.fn(async () => {
      if (!mocked.db) throw new Error("test db was not configured");
      return mocked.db;
    }),
  };
});

const { action } = await import("~/routes/api.v1.$");

function routeArgs(request: Request, splat: string) {
  return { request, params: { "*": splat }, context: { cloudflare: { env: null } } } as any;
}

function withD1TransactionGuard(db: PrismaClientType): PrismaClientType {
  return new Proxy(db, {
    get(target, property, receiver) {
      if (property !== "$transaction") {
        return Reflect.get(target, property, receiver);
      }

      return (input: unknown, ...rest: unknown[]) => {
        if (typeof input === "function") {
          throw new Error("D1 interactive transactions are not supported");
        }

        const transaction = Reflect.get(target, property, receiver) as (...args: unknown[]) => unknown;
        return transaction.apply(target, [input, ...rest]);
      };
    },
  });
}

describe("API v1 shopping-list mutations on D1", () => {
  let db: PrismaClientType;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
    mocked.db = withD1TransactionGuard(db);
  });

  afterEach(async () => {
    mocked.db = null;
    await cleanupDatabase();
  });

  it("creates idempotent shopping-list items without interactive transactions", async () => {
    const user = await db.user.create({ data: createTestUser() });
    const credential = await createApiCredential(db, user.id, "D1 shopping writer", {
      scopes: ["shopping_list:write"],
    });
    await db.shoppingList.create({ data: { authorId: user.id } });

    const response = await action(routeArgs(
      new UndiciRequest("http://localhost/api/v1/shopping-list/items", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.token}`,
          "Content-Type": "application/json",
          "X-Request-Id": "req_d1_shopping",
        },
        body: JSON.stringify({
          clientMutationId: "d1-create-item",
          name: `D1 Eggs ${faker.string.alphanumeric(6)}`,
          quantity: 12,
        }),
      }) as unknown as Request,
      "shopping-list/items",
    ));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      requestId: "req_d1_shopping",
      data: {
        created: true,
        mutation: { clientMutationId: "d1-create-item", replayed: false },
      },
    });
  });
});
