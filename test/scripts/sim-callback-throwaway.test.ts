import { describe, expect, it } from "vitest";

import {
  cleanupSql,
  appleLinkReadSql,
  main,
  makePendingLinkToken,
  parseWranglerJson,
  pendingAppleLinkProof,
  pendingLinkCleanupSql,
  pendingLinkLeftoverSql,
  pendingLinkSeedSql,
  probePendingLink,
  summarizeNativeSignIn,
  renderStatement,
  scan,
  scanQueries,
  seedSql,
  throwawayAccount,
  tokenCountSql,
} from "../../scripts/sim-callback-throwaway";

const account = {
  id: "probecb0123456789abcdef01",
  email: "sim-callback-probe-20261112-0a1b2c3d@example.com",
  username: "simcallbackprobe0a1b2c3d",
};
const passwordHash = "$2b$10$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ01234";
const env = { ACCOUNT_ID: account.id, ACCOUNT_EMAIL: account.email, ACCOUNT_USERNAME: account.username };

describe("sim callback throwaway accounts", () => {
  it("accepts only the proof's own throwaway shape", () => {
    expect(throwawayAccount(account)).toEqual(account);
    expect(() => throwawayAccount({ ...account, id: "user123" })).toThrow(/probecb/);
    expect(() => throwawayAccount({ ...account, email: "perry@example.com" })).toThrow(/email/);
    expect(() => throwawayAccount({ ...account, email: "sim-callback-probe-20261112-0a1b2c3d@gmail.com" })).toThrow(/email/);
    expect(() => throwawayAccount({ ...account, username: "perry" })).toThrow(/username/);
    expect(() => throwawayAccount({ ...account, username: "simcallbackprobeffffffff" })).toThrow(/same tag/);
    expect(() => throwawayAccount({ ...account, id: `${account.id}' OR '1'='1` })).toThrow();
    expect(() => throwawayAccount({ ...account, id: `${account.id}\n` })).toThrow();
  });

  it("renders bound statements as quoted SQL", () => {
    expect(renderStatement([`SELECT ? AS "a", ? AS "b", ? AS "c", ? AS "d"`, "it's", 3, null, true])).toBe(
      `SELECT 'it''s' AS "a", 3 AS "b", NULL AS "c", 1 AS "d";`,
    );
    expect(() => renderStatement([`SELECT ?`, {}])).toThrow(/Cannot write/);
    expect(() => renderStatement([`SELECT ?`, "a", "b"])).toThrow(/placeholders/);
  });

  it("seeds from a bcrypt hash only, with the salt taken from the hash", () => {
    const sql = seedSql(account, passwordHash, new Date("2026-11-12T00:00:00.000Z"));
    expect(sql).toContain(`'${account.id}', '${account.email}', '${account.username}', '${passwordHash}', '${passwordHash.slice(0, 29)}'`);
    expect(() => seedSql(account, "plain", new Date())).toThrow(/bcrypt/);
  });

  it("runs the app's account deletion behind an exact-email guard, then removes the chef search document before its key", () => {
    const sql = cleanupSql(account, new Date("2026-11-12T00:00:00.000Z"));
    const lines = sql.split(/;\n/);
    expect(lines[0]).toContain(`EXISTS (SELECT 1 FROM "User" WHERE "id" = '${account.id}' AND "email" = '${account.email}')`);
    expect(sql.indexOf(`DELETE FROM "OAuthTokenIssuance"`)).toBeLessThan(sql.indexOf(`DELETE FROM "ApiCredential"`));
    expect(sql.indexOf(`DELETE FROM "OAuthRefreshLineage"`)).toBeLessThan(sql.indexOf(`DELETE FROM "OAuthRefreshToken"`));
    expect(sql).toContain(`DELETE FROM "User" WHERE "id" = '${account.id}';`);
    expect(sql.indexOf(`DELETE FROM "SearchDocument" WHERE`)).toBeLessThan(sql.indexOf(`DELETE FROM "SearchDocumentKey" WHERE "docKey" = 'chef:${account.id}'`));
    expect(tokenCountSql(account)).toContain(`"OAuthRefreshToken" WHERE "userId" = '${account.id}'`);
  });

  it("scans every column of every table except FTS shadow tables, one query per table", () => {
    const queries = scanQueries(
      [
        { table: "User", column: "email" },
        { table: "User", column: "createdAt" },
        { table: "Counter", column: "n" },
        { table: "SearchDocument", column: "title" },
        { table: "SearchDocument_content", column: "c0" },
        { table: "sqlite_sequence", column: "name" },
      ],
      ["a", "b"],
    );
    expect(queries).toHaveLength(3);
    expect(queries[0]).toBe(
      `SELECT 'User' AS "t", count(*) AS "n" FROM "User" WHERE ` +
        `instr(coalesce(CAST("email" AS TEXT), '') || char(31) || coalesce(CAST("createdAt" AS TEXT), ''), 'a') > 0 OR ` +
        `instr(coalesce(CAST("email" AS TEXT), '') || char(31) || coalesce(CAST("createdAt" AS TEXT), ''), 'b') > 0`,
    );
    expect(queries.join(" ")).not.toContain("SearchDocument_content");
    expect(queries.join(" ")).not.toContain("sqlite_sequence");
  });

  it("reports tables that still mention the throwaway", async () => {
    const run = async (sql: string) =>
      sql.startsWith(`SELECT m."name"`) ? [{ table: "User", column: "email" }] : [{ t: "User", n: 1 }];
    await expect(scan(account, run)).resolves.toEqual({ tables: 1, queries: 1, hits: [{ table: "User", rows: 1 }] });
  });

  it("fails cleanup when the user row survives, and refuses unknown actions", async () => {
    const run = async (sql: string) => (sql.includes(`count(*) AS "n" FROM "User"`) ? [{ n: 1 }] : [{}]);
    let batched = "";
    await expect(main(["cleanup"], env, run, async (sql) => ((batched = sql), []))).rejects.toThrow(/still there/);
    expect(batched).toContain(`DELETE FROM "User"`);
    await expect(main([""], env, run)).rejects.toThrow(/seed, cleanup, search-pending, scan or pending-apple-link-proof/);
  });

  it("reads wrangler's JSON after any banner, and says so when there is none", () => {
    expect(parseWranglerJson('banner [x]\n[{"results":[{"n":1}],"success":true}]')).toEqual([{ n: 1 }]);
    expect(parseWranglerJson('[{"results":[],"success":true}]')).toEqual([]);
    expect(() => parseWranglerJson("Not logged in.")).toThrow(/no JSON/);
  });

  it("seeds, then checks the row is there", async () => {
    const statements: string[] = [];
    const run = async (sql: string) => (statements.push(sql), sql.includes(`count(*) AS "n" FROM "User"`) ? [{ n: 1 }] : []);
    await main(["seed"], { ...env, PASSWORD_HASH: passwordHash }, run);
    expect(statements[0]).toContain(`INSERT INTO "User"`);
  });

  it("fails the search check while search still holds the account", async () => {
    await expect(main(["search-pending"], env, async () => [{ n: 2 }])).rejects.toThrow(/Search still has rows/);
    await expect(main(["search-pending"], env, async () => [{ n: 0 }])).resolves.toBeUndefined();
  });

  describe("pending Apple link proof", () => {
    const link = {
      id: "probepal0123456789abcdef01",
      tokenHash: "a".repeat(64),
      appleSub: "probe-apple-sub-0123456789abcdef",
    };

    it("accepts only a synthetic probe sub, a probe id and a SHA-256 hash", () => {
      expect(probePendingLink(link)).toEqual(link);
      expect(() => probePendingLink({ ...link, appleSub: "001234.0123456789abcdef0123456789abcdef.0123" })).toThrow(/probe-apple-sub/);
      expect(() => probePendingLink({ ...link, appleSub: `${link.appleSub}' OR '1'='1` })).toThrow(/probe-apple-sub/);
      expect(() => probePendingLink({ ...link, id: "cmwd7lpl30001y5qz8za6z3nz" })).toThrow(/probepal/);
      expect(() => probePendingLink({ ...link, tokenHash: "pal_raw-token" })).toThrow(/hash/);
      expect(() => appleLinkReadSql({ ...account, id: "user123" }, link)).toThrow(/probecb/);
    });

    it("makes a token the way the server does and keeps only its SHA-256", () => {
      const { token, tokenHash } = makePendingLinkToken(() => Buffer.alloc(32, 1));
      expect(token).toBe(`pal_${Buffer.alloc(32, 1).toString("base64url")}`);
      expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
      const sql = pendingLinkSeedSql({ ...link, tokenHash }, new Date("2026-11-12T00:00:00.000Z"));
      expect(sql).toContain(`'${tokenHash}', '${link.appleSub}', NULL, '2026-11-12T00:30:00.000Z', NULL, '2026-11-12T00:00:00.000Z'`);
      expect(sql).not.toContain(token);
      expect(pendingLinkCleanupSql(link)).toBe(
        `DELETE FROM "PendingAppleLink" WHERE "tokenHash" = '${link.tokenHash}' AND "appleSub" = '${link.appleSub}';`,
      );
      expect(pendingLinkLeftoverSql(link)).toContain(`"OAuth" WHERE "providerUserId" = '${link.appleSub}'`);
    });

    it("summarizes a sign-in without any token", () => {
      const summary = summarizeNativeSignIn(201, {
        requestId: "req_1",
        data: { action: "user_logged_in", userId: account.id, appleLink: "linked", access_token: "secret-a", refresh_token: "secret-r" },
      });
      expect(summary).toEqual({
        status: 201,
        requestId: "req_1",
        action: "user_logged_in",
        userId: account.id,
        appleLink: "linked",
        errorCode: null,
        dataKeys: ["access_token", "action", "appleLink", "refresh_token", "userId"],
      });
      expect(JSON.stringify(summary)).not.toContain("secret");
    });

    function fakeProduction(answers: string[]) {
      const state = { user: 0, pending: 0, consumed: false, oauth: 0 };
      const statements: string[] = [];
      const run = async (sql: string): Promise<Record<string, unknown>[]> => {
        statements.push(sql);
        if (sql.startsWith(`INSERT INTO "User"`)) state.user = 1;
        else if (sql.startsWith(`INSERT INTO "PendingAppleLink"`)) state.pending = 1;
        else if (sql.startsWith(`DELETE FROM "PendingAppleLink"`)) state.pending = 0;
        else if (sql.includes(`count(*) AS "n" FROM "User"`)) return [{ n: state.user }];
        else if (sql.startsWith(`SELECT "appleSub"`)) return state.pending ? [{ consumedAt: state.consumed ? "2026-11-12T00:00:01.000Z" : null }] : [];
        else if (sql.includes(`AS "accountAppleLinks"`)) return [{ accountLinksToSub: state.oauth, allLinksToSub: state.oauth }];
        else if (sql.includes(`"OAuth" WHERE "providerUserId"`)) return [{ n: state.pending + state.oauth }];
        else if (sql.startsWith(`SELECT m."name"`)) return [{ table: "OAuth", column: "providerUserId" }];
        else if (sql.startsWith(`SELECT 'OAuth'`)) return [{ t: "OAuth", n: state.oauth }];
        return [];
      };
      const bodies: string[] = [];
      const fetch = (async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        const appleLink = answers.shift();
        if (appleLink === "linked") { state.consumed = true; state.oauth = 1; }
        return new Response(JSON.stringify({ requestId: "req", data: { action: "user_logged_in", appleLink, access_token: "fake-access-value" } }), { status: 201 });
      }) as typeof globalThis.fetch;
      const runBatch = async (sql: string) => {
        statements.push(sql);
        state.user = 0;
        state.oauth = 0;
        return [];
      };
      return { state, statements, run, runBatch, fetch, bodies };
    }
    const quiet = { hashPassword: async () => passwordHash, log: () => undefined };

    it("links on the first sign-in, finds the link spent on the second, and cleans up everything", async () => {
      const prod = fakeProduction(["linked", "consumed"]);
      const lines: string[] = [];
      const result = await pendingAppleLinkProof(account, { ...prod, ...quiet, log: (line) => lines.push(line) });
      expect(result.first).toMatchObject({ status: 201, appleLink: "linked" });
      expect(result.second).toMatchObject({ status: 201, appleLink: "consumed" });
      expect(prod.state).toMatchObject({ user: 0, pending: 0, oauth: 0 });
      const body = JSON.parse(prod.bodies[0]!) as { emailOrUsername: string; password: string; pendingAppleLinkToken: string };
      expect(body.emailOrUsername).toBe(account.email);
      expect(body.pendingAppleLinkToken).toMatch(/^pal_/);
      expect(prod.bodies[1]).toBe(prod.bodies[0]);
      const printed = lines.join("\n");
      expect(printed).not.toContain(body.password);
      expect(printed).not.toContain(body.pendingAppleLinkToken);
      expect(printed).not.toContain("fake-access-value");
      expect(prod.statements.join("\n")).not.toContain(body.password);
      expect(prod.statements.join("\n")).not.toContain(body.pendingAppleLinkToken);
    });

    it("still cleans up, then fails, when the link is not made", async () => {
      const prod = fakeProduction(["invalid", "invalid"]);
      await expect(pendingAppleLinkProof(account, { ...prod, ...quiet })).rejects.toThrow(/appleLink linked/);
      expect(prod.state).toMatchObject({ user: 0, pending: 0, oauth: 0 });
    });

    it("keeps cleaning up after a cleanup step fails, and reports every failure", async () => {
      const prod = fakeProduction(["linked", "consumed"]);
      const run = async (sql: string) => {
        if (sql.startsWith(`DELETE FROM "PendingAppleLink"`)) throw new Error("D1 hiccup");
        return prod.run(sql);
      };
      await expect(pendingAppleLinkProof(account, { ...prod, run, ...quiet })).rejects.toThrow(/pending link cleanup: D1 hiccup.*leftover check/);
      expect(prod.state.user).toBe(0);
    });

    it("never deletes an account it did not seed", async () => {
      const prod = fakeProduction(["linked", "consumed"]);
      prod.state.user = 1;
      const run = async (sql: string) => {
        if (sql.startsWith(`INSERT INTO "User"`)) throw new Error("UNIQUE constraint failed: User.id");
        return prod.run(sql);
      };
      await expect(pendingAppleLinkProof(account, { ...prod, run, ...quiet })).rejects.toThrow(/UNIQUE/);
      expect(prod.state.user).toBe(1);
      expect(prod.bodies).toHaveLength(0);
    });

    it("runs from main with the throwaway's identity", async () => {
      const prod = fakeProduction(["linked", "consumed"]);
      await main(["pending-apple-link-proof"], env, prod.run, prod.runBatch, { fetch: prod.fetch, ...quiet });
      expect(prod.bodies).toHaveLength(2);
    });
  });
});
