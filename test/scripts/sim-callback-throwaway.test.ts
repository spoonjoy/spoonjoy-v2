import { describe, expect, it } from "vitest";

import {
  cleanupSql,
  main,
  parseWranglerJson,
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
    expect(renderStatement([`SELECT ? AS "a", ? AS "b", ? AS "c"`, "it's", 3, null])).toBe(`SELECT 'it''s' AS "a", 3 AS "b", NULL AS "c";`);
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

  it("scans every column of every table except FTS shadow tables, in a few queries", () => {
    const queries = scanQueries(
      [
        { table: "User", column: "email" },
        { table: "Counter", column: "n" },
        { table: "SearchDocument", column: "title" },
        { table: "SearchDocument_content", column: "c0" },
        { table: "sqlite_sequence", column: "name" },
      ],
      ["a"],
      2,
    );
    expect(queries).toHaveLength(2);
    expect(queries.join(" ")).toContain(`instr(CAST("n" AS TEXT), 'a') > 0`);
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
    await expect(main([""], env, run)).rejects.toThrow(/seed, cleanup or scan/);
  });

  it("reads wrangler's JSON after any banner", () => {
    expect(parseWranglerJson('banner\n[{"results":[{"n":1}],"success":true}]')).toEqual([{ n: 1 }]);
  });
});
