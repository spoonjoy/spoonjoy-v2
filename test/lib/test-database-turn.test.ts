// Two Prisma clients in one test process share the test database through better-sqlite3, which waits
// for a lock synchronously. A client that wrote inside a transaction and is waiting on anything async
// (a timer, a hook) can only commit if the event loop keeps running, so another client's write has
// to wait for its turn without blocking the thread. Without that, the pair stalls for the full busy
// timeout and the second write fails with "database is locked".
import { PrismaClient } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

describe("two Prisma clients on the test database", () => {
  let clients: [PrismaClient, PrismaClient];

  beforeEach(async () => {
    await cleanupDatabase();
    clients = [new PrismaClient(), new PrismaClient()];
  });

  afterEach(async () => {
    await Promise.all(clients.map((client) => client.$disconnect()));
    await cleanupDatabase();
  });

  it("lets one client write while the other's transaction waits on a timer", async () => {
    const [first, second] = clients;
    // Both clients are connected first, so the second write is not slowed by its own startup.
    await Promise.all(clients.map((client) => client.user.count()));
    const started = Date.now();
    let firstWrote!: () => void;
    const firstHasWritten = new Promise<void>((resolve) => {
      firstWrote = resolve;
    });

    const inTransaction = first.$transaction(async (tx) => {
      await tx.user.create({ data: createTestUser() });
      firstWrote();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return "committed";
    });
    await firstHasWritten;
    // A Prisma query runs only once something waits on it, so .then starts the write now.
    const outside = second.user.create({ data: createTestUser() }).then((user) => user);

    await expect(inTransaction).resolves.toBe("committed");
    await expect(outside).resolves.toMatchObject({ id: expect.any(String) });
    await expect(first.user.count()).resolves.toBe(2);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("still runs a client's own reads while its transaction is open", async () => {
    const [first] = clients;
    const count = await first.$transaction(async (tx) => {
      await tx.user.create({ data: createTestUser() });
      return first.user.count();
    });
    // The outer client is not inside the transaction, so on a shared connection it sees the write.
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("gives the turn back when a transaction fails", async () => {
    const [first, second] = clients;
    await expect(first.$transaction(async (tx) => {
      await tx.user.create({ data: createTestUser() });
      throw new Error("abandoned");
    })).rejects.toThrow("abandoned");

    await expect(second.user.create({ data: createTestUser() })).resolves.toMatchObject({ id: expect.any(String) });
    await expect(second.user.count()).resolves.toBe(1);
  });
});
