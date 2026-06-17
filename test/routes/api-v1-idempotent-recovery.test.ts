import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import type { ApiPrincipal } from "~/lib/api-auth.server";
import {
  hashIdempotencyRequest,
  idempotencyClientKey,
  reserveIdempotencyKey,
} from "~/lib/api-idempotency.server";
import { runIdempotentApiV1Mutation } from "~/lib/api-v1.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

type LocalDb = Awaited<ReturnType<typeof getLocalDb>>;
type JsonRecord = Record<string, unknown>;
type MutationPayload = {
  data: {
    mutation: {
      clientMutationId: string;
      replayed: boolean;
    };
  };
};

function routeArgs(request: Request, splat: string) {
  return {
    request,
    params: { "*": splat },
    context: { cloudflare: { env: null } },
  } as never;
}

async function readJson(response: Response) {
  return await response.json() as JsonRecord;
}

function mutationPayload(payload: JsonRecord): MutationPayload {
  return payload as unknown as MutationPayload;
}

function mutationRequest(requestId: string, body: unknown) {
  return new UndiciRequest("http://localhost/api/v1/recipes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": requestId,
    },
    body: JSON.stringify(body),
  }) as unknown as Request;
}

async function createPrincipal(db: LocalDb): Promise<ApiPrincipal> {
  const user = await db.user.create({ data: createTestUser() });
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    source: "session",
    scopes: ["kitchen:write"],
  };
}

describe("API v1 idempotent mutation recovery", () => {
  let db: LocalDb;

  beforeEach(async () => {
    await cleanupDatabase();
    db = await getLocalDb();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("recovers a committed incomplete mutation instead of replaying the write", async () => {
    const principal = await createPrincipal(db);
    const body = { clientMutationId: "recover-existing", title: "Recovered Recipe" };
    const path = "/api/v1/recipes";
    const requestHash = await hashIdempotencyRequest({ method: "POST", path, body });
    const clientKey = idempotencyClientKey(principal);
    const reserved = await reserveIdempotencyKey(db, {
      userId: principal.id,
      clientKey,
      key: body.clientMutationId,
      operation: "recipes.create",
      requestHash,
    });
    if (reserved.status !== "reserved") throw new Error("expected reservation");

    await db.recipe.create({
      data: {
        id: reserved.record.id,
        chefId: principal.id,
        title: body.title,
      },
    });

    let writeCalls = 0;
    const response = await runIdempotentApiV1Mutation(
      routeArgs(mutationRequest("req_recover_existing", body), "recipes"),
      "req_recover_existing",
      principal,
      body,
      body.clientMutationId,
      "recipes.create",
      async () => {
        writeCalls += 1;
        throw new Error("write must not run while recovering an incomplete committed mutation");
      },
      async (database, reservation) => {
        const recipe = await database.recipe.findUnique({ where: { id: reservation.id } });
        if (!recipe) return null;
        return {
          status: 201,
          data: {
            recipe: { id: recipe.id, title: recipe.title },
            mutation: { clientMutationId: body.clientMutationId, replayed: false },
          },
        };
      },
    );
    const payload = await readJson(response);

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(payload).toEqual({
      ok: true,
      requestId: "req_recover_existing",
      data: {
        recipe: { id: reserved.record.id, title: body.title },
        mutation: { clientMutationId: body.clientMutationId, replayed: true },
      },
    });
    expect(writeCalls).toBe(0);
    await expect(db.recipe.count({ where: { chefId: principal.id, title: body.title } })).resolves.toBe(1);
  });

  it("completes idempotency from recovery when a callback throws after committing", async () => {
    const principal = await createPrincipal(db);
    const body = { clientMutationId: "recover-after-throw", title: "Recovered Throw Recipe" };

    let writeCalls = 0;
    const first = await runIdempotentApiV1Mutation(
      routeArgs(mutationRequest("req_recover_throw_first", body), "recipes"),
      "req_recover_throw_first",
      principal,
      body,
      body.clientMutationId,
      "recipes.create",
      async (database, reservation) => {
        writeCalls += 1;
        await database.recipe.create({
          data: {
            id: reservation.id,
            chefId: principal.id,
            title: body.title,
          },
        });
        throw new Error("response serialization failed after commit");
      },
      async (database, reservation) => {
        const recipe = await database.recipe.findUnique({ where: { id: reservation.id } });
        if (!recipe) return null;
        return {
          status: 201,
          data: {
            recipe: { id: recipe.id, title: recipe.title },
            mutation: { clientMutationId: body.clientMutationId, replayed: false },
          },
        };
      },
    );
    const firstPayload = await readJson(first);

    expect(first.status).toBe(201);
    expect(mutationPayload(firstPayload).data.mutation).toEqual({ clientMutationId: body.clientMutationId, replayed: false });
    expect(writeCalls).toBe(1);

    const replay = await runIdempotentApiV1Mutation(
      routeArgs(mutationRequest("req_recover_throw_replay", body), "recipes"),
      "req_recover_throw_replay",
      principal,
      body,
      body.clientMutationId,
      "recipes.create",
      async () => {
        writeCalls += 1;
        throw new Error("replay must not run the write");
      },
    );
    const replayPayload = await readJson(replay);

    expect(replay.status).toBe(201);
    expect(replayPayload).toEqual({
      ...firstPayload,
      requestId: "req_recover_throw_replay",
      data: {
        ...mutationPayload(firstPayload).data,
        mutation: { clientMutationId: body.clientMutationId, replayed: true },
      },
    });
    expect(writeCalls).toBe(1);
    await expect(db.recipe.count({ where: { chefId: principal.id, title: body.title } })).resolves.toBe(1);
  });

  it("surfaces completion failures without recovery and tolerates them when recovery exists", async () => {
    const principal = await createPrincipal(db);
    const body = { clientMutationId: "completion-failure", title: "Completion Failure Recipe" };

    await expect(runIdempotentApiV1Mutation(
      routeArgs(mutationRequest("req_completion_failure_no_recovery", body), "recipes"),
      "req_completion_failure_no_recovery",
      principal,
      body,
      body.clientMutationId,
      "recipes.create",
      async (database, reservation) => {
        await database.apiIdempotencyKey.delete({ where: { id: reservation.id } });
        return {
          status: 201,
          data: { mutation: { clientMutationId: body.clientMutationId, replayed: false } },
        };
      },
    )).rejects.toThrow();

    const recoverableBody = { clientMutationId: "completion-failure-recoverable", title: "Recoverable Completion Failure" };
    const response = await runIdempotentApiV1Mutation(
      routeArgs(mutationRequest("req_completion_failure_recoverable", recoverableBody), "recipes"),
      "req_completion_failure_recoverable",
      principal,
      recoverableBody,
      recoverableBody.clientMutationId,
      "recipes.create",
      async (database, reservation) => {
        await database.apiIdempotencyKey.delete({ where: { id: reservation.id } });
        return {
          status: 201,
          data: { mutation: { clientMutationId: recoverableBody.clientMutationId, replayed: false } },
        };
      },
      async () => null,
    );
    const payload = await readJson(response);

    expect(response.status).toBe(201);
    expect(payload).toEqual({
      ok: true,
      requestId: "req_completion_failure_recoverable",
      data: { mutation: { clientMutationId: recoverableBody.clientMutationId, replayed: false } },
    });
  });

  it("keeps the original write error when cleanup also fails", async () => {
    const principal = await createPrincipal(db);
    const body = { clientMutationId: "cleanup-failure", title: "Cleanup Failure Recipe" };

    await expect(runIdempotentApiV1Mutation(
      routeArgs(mutationRequest("req_cleanup_failure", body), "recipes"),
      "req_cleanup_failure",
      principal,
      body,
      body.clientMutationId,
      "recipes.create",
      async (database, reservation) => {
        await database.apiIdempotencyKey.delete({ where: { id: reservation.id } });
        throw new Error("original write failure");
      },
    )).rejects.toThrow("original write failure");
  });
});
