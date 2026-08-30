import { describe, expect, it } from "vitest";
import DatabaseSync from "better-sqlite3";

import {
  buildOAuthGrantBackfillApplySql,
  buildOAuthGrantBackfillSnapshotQueries,
  digestOAuthGrantBackfillPlan,
  planOAuthGrantBackfill,
  projectOAuthGrantBackfillReport,
  validateOAuthGrantBackfillPostApply,
} from "../../scripts/oauth-grant-backfill-helpers.mjs";

const client = {
  id: "client-known",
  issuer: "https://spoonjoy.app",
  revokedAt: null,
};

const refresh = (overrides: Record<string, unknown> = {}) => ({
  id: "refresh-active",
  userId: "user-1",
  clientId: client.id,
  issuer: client.issuer,
  scope: "kitchen:read",
  resource: "https://spoonjoy.app/mcp",
  connectionKey: "connection-clean",
  revokedAt: null,
  grantId: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const access = (overrides: Record<string, unknown> = {}) => ({
  id: "access-active",
  userId: "user-1",
  oauthClientId: client.id,
  oauthIssuer: client.issuer,
  scopes: "kitchen:read",
  oauthResource: "https://spoonjoy.app/mcp",
  oauthConnectionKey: "connection-clean",
  oauthGrantId: null,
  revokedAt: null,
  expiresAt: null,
  createdAt: "2026-08-01T00:00:01.000Z",
  ...overrides,
});

const input = (overrides: Record<string, unknown> = {}) => ({
  clients: [client],
  users: [{ id: "user-1" }],
  refreshTokens: [refresh()],
  accessCredentials: [access()],
  existingGrants: [],
  ...overrides,
});

describe("OAuth grant backfill planning", () => {
  it("maps a clean connection deterministically without exposing its opaque key", () => {
    const first = planOAuthGrantBackfill(input());
    const second = planOAuthGrantBackfill(input());

    expect(first).toEqual(second);
    expect(first.issues).toEqual([]);
    expect(first.grants).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^ogb_[0-9a-f]{64}$/),
        connectionKey: "connection-clean",
        status: "active",
        resource: "https://spoonjoy.app/mcp",
      }),
    ]);
    expect(first.refreshLinks).toEqual([{ id: "refresh-active", grantId: first.grants[0].id }]);
    expect(first.accessLinks).toEqual([{ id: "access-active", grantId: first.grants[0].id }]);

    const report = JSON.stringify(projectOAuthGrantBackfillReport(first));
    expect(report).not.toContain("connection-clean");
    expect(report).not.toMatch(/(?:ort_|sj_|oac_)[A-Za-z0-9_-]+/);
  });

  it("maps revoked history plus one active generation into one grant", () => {
    const plan = planOAuthGrantBackfill(input({
      refreshTokens: [
        refresh({ id: "refresh-0", revokedAt: "2026-08-02T00:00:00.000Z" }),
        refresh({ id: "refresh-1", createdAt: "2026-08-02T00:00:00.000Z", revokedAt: "2026-08-03T00:00:00.000Z" }),
        refresh({ id: "refresh-2", createdAt: "2026-08-03T00:00:00.000Z" }),
      ],
      accessCredentials: [
        access({ id: "access-0", revokedAt: "2026-08-02T00:00:00.000Z" }),
        access({ id: "access-1", createdAt: "2026-08-02T00:00:01.000Z", revokedAt: "2026-08-03T00:00:00.000Z" }),
        access({ id: "access-2", createdAt: "2026-08-03T00:00:01.000Z" }),
      ],
    }));

    expect(plan.issues).toEqual([]);
    expect(plan.grants).toHaveLength(1);
    expect(plan.refreshLinks.map((row) => row.id)).toEqual(["refresh-0", "refresh-1", "refresh-2"]);
    expect(plan.accessLinks.map((row) => row.id)).toEqual(["access-0", "access-1", "access-2"]);
  });

  it("treats a consistently null legacy resource as a valid identity", () => {
    const plan = planOAuthGrantBackfill(input({
      refreshTokens: [refresh({ resource: null })],
      accessCredentials: [access({ oauthResource: null })],
    }));

    expect(plan.issues).toEqual([]);
    expect(plan.grants[0].resource).toBeNull();
  });

  it("compares scope sets semantically and stores their canonical order", () => {
    const plan = planOAuthGrantBackfill(input({
      refreshTokens: [refresh({ scope: "shopping_list:read kitchen:read" })],
      accessCredentials: [access({ scopes: "kitchen:read shopping_list:read" })],
    }));

    expect(plan.issues).toEqual([]);
    expect(plan.grants[0].scope).toBe("kitchen:read shopping_list:read");
  });

  it.each([
    ["orphan_access", input({ refreshTokens: [] })],
    ["duplicate_active_refresh", input({ refreshTokens: [refresh(), refresh({ id: "refresh-other" })] })],
    ["identity_mismatch", input({ accessCredentials: [access({ oauthResource: "https://other.example/mcp" })] })],
    ["unknown_client", input({ clients: [] })],
    ["unknown_user", input({ users: [] })],
    ["unknown_client", input({ clients: [{ ...client, revokedAt: "2026-08-01T00:00:00.000Z" }] })],
    ["missing_connection_key", input({
      refreshTokens: [refresh({ connectionKey: null })],
      accessCredentials: [access({ oauthConnectionKey: null })],
    })],
    ["no_active_refresh", input({ refreshTokens: [refresh({ revokedAt: "2026-08-02T00:00:00.000Z" })] })],
    ["existing_link_mismatch", input({ refreshTokens: [refresh({ grantId: "wrong-grant" })] })],
  ])("reports %s without planning any mutation", (reason, fixture) => {
    const plan = planOAuthGrantBackfill(fixture);

    expect(plan.grants).toEqual([]);
    expect(plan.refreshLinks).toEqual([]);
    expect(plan.accessLinks).toEqual([]);
    expect(plan.issues).toContainEqual(expect.objectContaining({ reason }));
  });

  it("rejects an existing grant whose identity disagrees with the legacy family", () => {
    const initial = planOAuthGrantBackfill(input());
    const plan = planOAuthGrantBackfill(input({
      existingGrants: [{ ...initial.grants[0], resource: "https://other.example/mcp" }],
    }));

    expect(plan).toMatchObject({
      grants: [],
      refreshLinks: [],
      accessLinks: [],
      issues: [expect.objectContaining({ reason: "existing_grant_mismatch" })],
    });
  });

  it("produces one canonical digest regardless of input order", () => {
    const first = planOAuthGrantBackfill(input({
      refreshTokens: [refresh({ id: "refresh-old", revokedAt: "2026-08-02T00:00:00.000Z" }), refresh()],
      accessCredentials: [access({ id: "access-old", revokedAt: "2026-08-02T00:00:00.000Z" }), access()],
    }));
    const second = planOAuthGrantBackfill(input({
      refreshTokens: [...input({
        refreshTokens: [refresh({ id: "refresh-old", revokedAt: "2026-08-02T00:00:00.000Z" }), refresh()],
      }).refreshTokens].reverse(),
      accessCredentials: [...input({
        accessCredentials: [access({ id: "access-old", revokedAt: "2026-08-02T00:00:00.000Z" }), access()],
      }).accessCredentials].reverse(),
    }));

    expect(digestOAuthGrantBackfillPlan(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(digestOAuthGrantBackfillPlan(first)).toBe(digestOAuthGrantBackfillPlan(second));
    expect(projectOAuthGrantBackfillReport(first)).toEqual(projectOAuthGrantBackfillReport(second));
  });

  it("is idempotent after an identical grant and links already exist", () => {
    const initial = planOAuthGrantBackfill(input());
    const grant = initial.grants[0];
    const afterApply = planOAuthGrantBackfill(input({
      refreshTokens: [refresh({ grantId: grant.id })],
      accessCredentials: [access({ oauthGrantId: grant.id })],
      existingGrants: [grant],
    }));

    expect(afterApply).toMatchObject({ grants: [], refreshLinks: [], accessLinks: [], issues: [] });
  });

  it("builds guarded D1 mutations and never embeds token hashes or prefixes", () => {
    const plan = planOAuthGrantBackfill(input());
    const sql = buildOAuthGrantBackfillApplySql(plan);

    expect(sql).toContain('INSERT INTO "OAuthGrant"');
    expect(sql).toContain('UPDATE "OAuthRefreshToken"');
    expect(sql).toContain('UPDATE "ApiCredential"');
    expect(sql).toContain('"grantId" IS NULL');
    expect(sql).toContain('"oauthGrantId" IS NULL');
    expect(sql).not.toMatch(/tokenHash|tokenPrefix|ort_|sj_|oac_/);
  });

  it("reads only non-secret fields required to classify the durable snapshot", () => {
    const queries = buildOAuthGrantBackfillSnapshotQueries();
    const sql = Object.values(queries).join("\n");

    expect(Object.keys(queries)).toEqual(["users", "clients", "refreshTokens", "accessCredentials", "existingGrants"]);
    expect(sql).toContain('FROM "OAuthRefreshToken"');
    expect(sql).toContain('FROM "ApiCredential"');
    expect(sql).not.toMatch(/tokenHash|tokenPrefix|codeHash|email|clientName|redirectUris/);
  });

  it("applies a clean plan to SQLite and converges to zero planned mutations", () => {
    const db = backfillDatabase();
    seedBackfillConnection(db);
    const before = planOAuthGrantBackfill(readBackfillSnapshot(db));

    db.exec(buildOAuthGrantBackfillApplySql(before));

    const after = planOAuthGrantBackfill(readBackfillSnapshot(db));
    expect(after).toMatchObject({ grants: [], refreshLinks: [], accessLinks: [], issues: [] });
    expect(db.prepare('SELECT "grantId" FROM "OAuthRefreshToken"').get()).toEqual({ grantId: before.grants[0].id });
    expect(db.prepare('SELECT "oauthGrantId" FROM "ApiCredential"').get()).toEqual({ oauthGrantId: before.grants[0].id });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(() => db.exec(buildOAuthGrantBackfillApplySql(after))).not.toThrow();
    db.close();
  });

  it("refuses every stale-plan mutation when a conflicting row appears before apply", () => {
    const db = backfillDatabase();
    seedBackfillConnection(db);
    const plan = planOAuthGrantBackfill(readBackfillSnapshot(db));
    db.prepare(`INSERT INTO "OAuthRefreshToken" VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`)
      .run("refresh-race", "user-1", client.id, client.issuer, "kitchen:read", "https://spoonjoy.app/mcp", "connection-clean", "2026-08-01T00:00:02.000Z");

    db.exec(buildOAuthGrantBackfillApplySql(plan));

    expect(db.prepare('SELECT COUNT(*) AS count FROM "OAuthGrant"').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM "OAuthRefreshToken" WHERE "grantId" IS NOT NULL').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM "ApiCredential" WHERE "oauthGrantId" IS NOT NULL').get()).toEqual({ count: 0 });
    db.close();
  });

  it("rejects post-apply ambiguity drift even when no further mutation is safe", () => {
    const before = planOAuthGrantBackfill(input());
    const drifted = planOAuthGrantBackfill(input({
      refreshTokens: [refresh(), refresh({ id: "refresh-raced" })],
    }));

    expect(validateOAuthGrantBackfillPostApply(before, drifted)).toEqual({
      ok: false,
      reason: "post_apply_issue_drift",
    });
    expect(validateOAuthGrantBackfillPostApply(before, planOAuthGrantBackfill(input({
      refreshTokens: [refresh({ grantId: before.grants[0].id })],
      accessCredentials: [access({ oauthGrantId: before.grants[0].id })],
      existingGrants: [before.grants[0]],
    })))).toEqual({ ok: true });
  });
});

function backfillDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE "User" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "OAuthClient" ("id" TEXT PRIMARY KEY, "issuer" TEXT, "revokedAt" DATETIME);
    CREATE TABLE "OAuthRefreshToken" (
      "id" TEXT PRIMARY KEY, "userId" TEXT, "clientId" TEXT, "issuer" TEXT, "scope" TEXT,
      "resource" TEXT, "connectionKey" TEXT, "revokedAt" DATETIME, "grantId" TEXT, "createdAt" DATETIME
    );
    CREATE TABLE "ApiCredential" (
      "id" TEXT PRIMARY KEY, "userId" TEXT, "oauthClientId" TEXT, "oauthIssuer" TEXT, "scopes" TEXT,
      "oauthResource" TEXT, "oauthConnectionKey" TEXT, "oauthGrantId" TEXT, "revokedAt" DATETIME,
      "expiresAt" DATETIME, "createdAt" DATETIME
    );
    CREATE TABLE "OAuthGrant" (
      "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id"),
      "clientId" TEXT NOT NULL REFERENCES "OAuthClient"("id"), "issuer" TEXT NOT NULL, "resource" TEXT,
      "scope" TEXT NOT NULL, "connectionKey" TEXT NOT NULL UNIQUE, "status" TEXT NOT NULL,
      "statusReason" TEXT, "statusChangedAt" DATETIME NOT NULL, "expiresAt" DATETIME,
      "createdAt" DATETIME NOT NULL, "updatedAt" DATETIME NOT NULL
    );
  `);
  return db;
}

function seedBackfillConnection(db: InstanceType<typeof DatabaseSync>) {
  db.prepare('INSERT INTO "User" VALUES (?)').run("user-1");
  db.prepare('INSERT INTO "OAuthClient" VALUES (?, ?, NULL)').run(client.id, client.issuer);
  db.prepare(`INSERT INTO "OAuthRefreshToken" VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`)
    .run("refresh-active", "user-1", client.id, client.issuer, "kitchen:read", "https://spoonjoy.app/mcp", "connection-clean", "2026-08-01T00:00:00.000Z");
  db.prepare(`INSERT INTO "ApiCredential" VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`)
    .run("access-active", "user-1", client.id, client.issuer, "kitchen:read", "https://spoonjoy.app/mcp", "connection-clean", "2026-08-01T00:00:01.000Z");
}

function readBackfillSnapshot(db: InstanceType<typeof DatabaseSync>) {
  const queries = buildOAuthGrantBackfillSnapshotQueries();
  return Object.fromEntries(Object.entries(queries).map(([name, sql]) => [name, db.prepare(sql).all()]));
}
