import { describe, expect, it } from "vitest";

import {
  cleanupSql,
  parseWranglerJson,
  scan,
  seedSql,
  tableScanSql,
  throwawayAccount,
  tokenCountSql,
} from "../../scripts/sim-callback-throwaway.mjs";

const account = {
  id: "probecb0123456789abcdef01",
  email: "sim-callback-probe-20261112-0a1b2c3d@example.com",
  username: "simcallbackprobe0a1b2c3d",
};
const salt = "$2b$10$abcdefghijklmnopqrstuv";
const passwordHash = `${salt}ABCDEFGHIJKLMNOPQRSTUVWXYZ01234`;

describe("sim callback throwaway accounts", () => {
  it("accepts only the proof's own throwaway shape", () => {
    expect(throwawayAccount(account).tag).toBe("0a1b2c3d");
    expect(() => throwawayAccount({ ...account, id: "user123" })).toThrow(/probecb/);
    expect(() => throwawayAccount({ ...account, email: "perry@example.com" })).toThrow(/email/);
    expect(() => throwawayAccount({ ...account, email: "sim-callback-probe-20261112-0a1b2c3d@gmail.com" })).toThrow(/email/);
    expect(() => throwawayAccount({ ...account, username: "perry" })).toThrow(/username/);
    expect(() => throwawayAccount({ ...account, username: "simcallbackprobeffffffff" })).toThrow(/same tag/);
    expect(() => throwawayAccount({ ...account, id: "probecb0123456789abcdef01' OR '1'='1" })).toThrow();
  });

  it("seeds with a bcrypt hash and its own salt only", () => {
    const sql = seedSql(account, { passwordHash, salt, now: "2026-11-12T00:00:00.000Z" });
    expect(sql).toContain("'probecb0123456789abcdef01','sim-callback-probe-20261112-0a1b2c3d@example.com'");
    expect(() => seedSql(account, { passwordHash: "plain", salt, now: "x" })).toThrow(/bcrypt/);
    expect(() => seedSql(account, { passwordHash, salt: "$2b$10$zzzzzzzzzzzzzzzzzzzzzz", now: "x" })).toThrow(/salt/);
  });

  it("deletes only rows owned by the throwaway, search document before its key", () => {
    const sql = cleanupSql(account);
    for (const line of sql.split("\n")) {
      expect(line).toMatch(/probecb0123456789abcdef01/);
    }
    expect(sql).toContain("DELETE FROM User WHERE id='probecb0123456789abcdef01' AND email='sim-callback-probe-20261112-0a1b2c3d@example.com';");
    expect(sql.indexOf("FROM SearchDocument WHERE")).toBeLessThan(sql.indexOf("FROM SearchDocumentKey"));
    expect(tokenCountSql(account)).toContain("OAuthRefreshToken WHERE userId='probecb0123456789abcdef01'");
  });

  it("scans text columns only and reports tables that still match", async () => {
    expect(tableScanSql("Recipe", [{ name: "servings", type: "INTEGER" }], ["a"])).toBeNull();
    expect(tableScanSql("User", [{ name: "email", type: "TEXT" }], ["a", "b"])).toBe(
      `SELECT 'User' AS t, count(*) AS n FROM "User" WHERE instr("email",'a')>0 OR instr("email",'b')>0`,
    );
    const run = async (sql: string) => {
      if (sql.startsWith("SELECT name FROM sqlite_master")) return [{ name: "User" }, { name: "Counter" }];
      if (sql.includes("pragma_table_info('User')")) return [{ name: "email", type: "TEXT" }];
      if (sql.includes("pragma_table_info('Counter')")) return [{ name: "n", type: "INTEGER" }];
      return [{ t: "User", n: 1 }];
    };
    await expect(scan(account, run)).resolves.toEqual({ tables: 2, scanned: 1, hits: [{ table: "User", rows: 1 }] });
  });

  it("reads wrangler's JSON after any banner", () => {
    expect(parseWranglerJson('banner\n[{"results":[{"n":1}],"success":true}]')).toEqual([{ n: 1 }]);
  });
});
