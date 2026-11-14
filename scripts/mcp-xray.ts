// Runs Ouro UI's AX X-ray against Spoonjoy's stdio MCP server, the way an agent would call it, and fails unless it
// conforms: every applicable must claim holds and the inventory covers every tool. It runs on the local SQLite test
// database (DATABASE_URL, default file:./test.db) as a synthetic chef it adds, never against Spoonjoy itself.
//
//   pnpm mcp:xray                 # text report; exit 1 unless it conforms
//   pnpm mcp:xray -- --json       # the X-ray's JSON report
//
// The inventory is the declared MCP tools (actions/generated/mcp.json), so a tool the server lists without a
// declaration, or a declared tool it doesn't list, fails the X-ray's inventory claim.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const XRAY_EMAIL = "xray@example.test";
const databaseUrl = process.env.DATABASE_URL ?? "file:./test.db";

const db = new PrismaClient({ datasourceUrl: databaseUrl });
try {
  await db.user.upsert({
    where: { email: XRAY_EMAIL },
    update: {},
    create: { id: "usr_xray_synthetic", email: XRAY_EMAIL, username: "xray-synthetic" },
  });
} finally {
  await db.$disconnect();
}

const declared = JSON.parse(readFileSync("actions/generated/mcp.json", "utf8")) as { tools: { name: string }[] };
const dir = mkdtempSync(join(tmpdir(), "spoonjoy-mcp-xray-"));
const inventory = join(dir, "inventory.json");
writeFileSync(inventory, `${JSON.stringify({ mcp: declared.tools.map((tool) => tool.name) }, null, 2)}\n`);

const server = [
  "env",
  `DATABASE_URL=${databaseUrl}`,
  "SPOONJOY_FORCE_SQLITE_LOCAL_DB=1",
  "SPOONJOY_NATIVE_DOGFOOD_API=1",
  `SPOONJOY_MCP_USER_EMAIL=${XRAY_EMAIL}`,
  "pnpm -s exec tsx scripts/spoonjoy-mcp-server.ts",
].join(" ");
const xray = spawnSync(
  process.execPath,
  ["app/lib/ouro/ax/xray.ts", "--mcp", server, "--inventory", inventory, "--conformance", "--timeout", "60000", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
rmSync(dir, { recursive: true, force: true });
process.exitCode = xray.status ?? 1;
