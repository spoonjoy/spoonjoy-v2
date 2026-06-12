import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import * as cleanup from "../../scripts/cleanup-local-qa-data.mjs";

const { buildApplySql, buildDryRunSql, wranglerLocalD1Args } = cleanup;

const originalArgv = process.argv;
const originalExitCode = process.exitCode;

function writableBuffer() {
  let text = "";
  return {
    stream: {
      write(chunk: string) {
        text += String(chunk);
      },
    },
    text: () => text,
  };
}

function expectInOrder(text: string, fragments: string[]) {
  let cursor = -1;
  for (const fragment of fragments) {
    const next = text.indexOf(fragment, cursor + 1);
    expect(next, `Expected ${JSON.stringify(fragment)} after index ${cursor}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

function expectAll(text: string, fragments: string[]) {
  for (const fragment of fragments) {
    expect(text).toContain(fragment);
  }
}

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

describe("cleanup-local-qa-data", () => {
  it("dry-runs the disposable Spoonjoy QA data patterns", () => {
    const sql = buildDryRunSql();

    expect(sql).toContain("lower(title) LIKE 'e2e %'");
    expect(sql).toContain("lower(title) LIKE 'mobile dock save%'");
    expect(sql).toContain("lower(title) LIKE 'codex %'");
    expect(sql).toContain("email LIKE 'codex-%'");
    expect(sql).toContain("email LIKE 'e2e-passkey-%'");
    expect(sql).toContain("clientName = 'E2E OAuth Client'");
  });

  it("soft-deletes recipes and deletes only disposable local support rows on apply", () => {
    const sql = buildApplySql();

    expect(sql).toContain("UPDATE Recipe");
    expect(sql).toContain("SET deletedAt = CURRENT_TIMESTAMP");
    expect(sql).toContain("DELETE FROM OAuthAuthCode");
    expect(sql).toContain("DELETE FROM OAuthClient");
    expect(sql).toContain("DELETE FROM UserCredential");
    expect(sql).toContain("DELETE FROM User");
    expect(sql).not.toContain("DROP TABLE");
  });

  it("builds local-only Wrangler D1 args", () => {
    const args = wranglerLocalD1Args("DB", "SELECT 1;");

    expect(args).toEqual([
      "exec",
      "wrangler",
      "d1",
      "execute",
      "DB",
      "--local",
      "--command",
      "SELECT 1;",
    ]);
    expect(args).not.toContain("--remote");
  });

  it("parses explicit local, QA, and production target environments", () => {
    expect(cleanup.parseCleanupArgs(["--target-env", "local"])).toMatchObject({
      apply: false,
      dbName: "DB",
      target: {
        targetEnv: "local",
        baseUrl: "http://localhost:5173",
        d1Target: "local D1 (--local)",
        r2Target: "local photos binding",
        destructiveScope: "local disposable test data only",
      },
    });
    expect(cleanup.parseCleanupArgs(["--target-env", "qa", "--db", "QA_DB"])).toMatchObject({
      dbName: "QA_DB",
      target: {
        targetEnv: "qa",
        baseUrl: "https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
        d1Target: "QA D1 spoonjoy-qa (--remote --env qa)",
        r2Target: "QA R2 spoonjoy-photos-qa (--remote)",
        destructiveScope: "QA disposable test data only",
      },
    });
    expect(cleanup.parseCleanupArgs(["--target-env", "production"])).toMatchObject({
      target: {
        targetEnv: "production",
        baseUrl: "https://spoonjoy.app",
        d1Target: "production D1 spoonjoy (--remote)",
        r2Target: "production R2 spoonjoy-photos (--remote)",
        destructiveScope: "production read-only by default; exact smoke cleanup only",
      },
    });
  });

  it("keeps the backwards-compatible missing-target default as a local dry-run", () => {
    expect(cleanup.parseCleanupArgs([])).toMatchObject({
      apply: false,
      target: {
        targetEnv: "local",
        baseUrl: "http://localhost:5173",
      },
    });
  });

  it("can parse cleanup args from process argv by default", () => {
    process.argv = ["node", "scripts/cleanup-local-qa-data.mjs", "--target-env", "local"];

    expect(cleanup.parseCleanupArgs()).toMatchObject({
      apply: false,
      target: {
        targetEnv: "local",
      },
    });
  });

  it("rejects missing and invalid target env values", () => {
    expect(() => cleanup.parseCleanupArgs(["--target-env"])).toThrow(/Missing value for --target-env/);
    expect(() => cleanup.parseCleanupArgs(["--target-env", "staging"])).toThrow(/local, qa, or production/);
    expect(() => cleanup.parseCleanupArgs(["--remote"])).toThrow(/Use --target-env qa or --target-env production/);
    expect(() => cleanup.parseCleanupArgs(["--db"])).toThrow(/Missing value for --db/);
    expect(() =>
      cleanup.parseCleanupArgs(["--target-env", "qa", "--base-url", "https://spoonjoy.app"]),
    ).toThrow(/QA target mismatch/);
  });

  it("formats the target summary printed before cleanup commands", () => {
    const options = cleanup.parseCleanupArgs(["--target-env", "qa"]);

    expect(cleanup.formatCleanupTargetSummary(options.target)).toEqual([
      "Target environment: qa",
      "Base URL: https://spoonjoy-v2-qa.mendelow-studio.workers.dev",
      "D1 target: QA D1 spoonjoy-qa (--remote --env qa)",
      "R2 target: QA R2 spoonjoy-photos-qa (--remote)",
      "Destructive scope: QA disposable test data only",
    ]);
  });

  it("runs local dry-run and local apply with explicit target summaries and local Wrangler args", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async () => ({ stdout: "[]", stderr: "" }));

    await cleanup.runCleanupCli({
      argv: ["--target-env", "local"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stdout.text()).toContain("Target environment: local");
    expect(stdout.text()).toContain("Dry run only. Pass --apply to mutate local D1.");
    expect(runCommand).toHaveBeenLastCalledWith(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", "DB", "--local", "--command", buildDryRunSql()],
      expect.objectContaining({ encoding: "utf8" }),
    );

    await cleanup.runCleanupCli({
      argv: ["--target-env", "local", "--apply"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stdout.text()).toContain("Applied local QA cleanup.");
    expect(runCommand).toHaveBeenLastCalledWith(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", "DB", "--local", "--command", buildApplySql()],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("prints help without executing a cleanup command", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async () => ({ stdout: "[]", stderr: "" }));

    await cleanup.runCleanupCli({
      argv: ["--help"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stdout.text()).toContain("Usage: node scripts/cleanup-local-qa-data.mjs");
    expect(stdout.text()).toContain("--target-env local|qa|production");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("prints help from default process argv/stdout options", async () => {
    process.argv = ["node", "scripts/cleanup-local-qa-data.mjs", "--help"];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await cleanup.runCleanupCli();

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("--target-env local|qa|production"));
  });

  it("forwards Wrangler stderr from successful cleanup checks", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async () => ({ stdout: "[]", stderr: "wrangler note\n" }));

    await cleanup.runCleanupCli({
      argv: ["--target-env", "local"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stdout.text()).toContain("Dry run only");
    expect(stderr.text()).toBe("wrangler note\n");
  });

  it("does not write stderr when Wrangler returns no stderr field", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async () => ({ stdout: "[]" }));

    await cleanup.runCleanupCli({
      argv: ["--target-env", "local"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stdout.text()).toContain("Dry run only");
    expect(stderr.text()).toBe("");
  });

  it("does not write stdout or stderr when Wrangler returns no output fields", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async () => ({}));

    await cleanup.runCleanupCli({
      argv: ["--target-env", "local"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stdout.text()).toContain("Dry run only. Pass --apply to mutate local D1.");
    expect(stdout.text()).not.toContain("[]");
    expect(stderr.text()).toBe("");
  });

  it("runs QA remote dry-run and, on apply, cleans exact validated R2 keys after D1 succeeds", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("candidate_r2_keys")) {
        return {
          stdout: JSON.stringify([
            {
              results: [
                { action: "delete", key: "profiles/codex-user/avatar.jpg" },
                { action: "delete", key: "recipes/codex-user/recipe-1/source.jpg" },
                { action: "delete", key: "spoons/codex-user/recipe-1/spoon.jpg" },
                { action: "retain", key: "recipes/not-disposable/recipe-1/source.jpg", reason: "unsafe namespace" },
              ],
            },
          ]),
          stderr: "",
        };
      }
      if (command.includes("r2 object get")) {
        const error = new Error("NoSuchKey");
        Object.assign(error, { stderr: "The specified key does not exist." });
        throw error;
      }
      return { stdout: "[]", stderr: "" };
    });

    await cleanup.runCleanupCli({
      argv: ["--target-env", "qa"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stdout.text()).toContain("Target environment: qa");
    expect(stdout.text()).toContain("Pass --apply to mutate exact validated disposable QA D1/R2 data");
    expect(stdout.text()).not.toContain("mutate local D1");
    expect(runCommand).toHaveBeenLastCalledWith(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", "DB", "--remote", "--env", "qa", "--command", buildDryRunSql()],
      expect.objectContaining({ encoding: "utf8" }),
    );

    await cleanup.runCleanupCli({
      argv: ["--target-env", "qa", "--apply"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    const calls = runCommand.mock.calls.map((call) => call[1] as string[]);
    const joinedCalls = calls.map((args) => args.join(" "));
    expect(joinedCalls[1]).toContain("sqlite_master");
    expect(joinedCalls[1]).toContain("SearchDocument");
    expect(joinedCalls[1]).toContain("SearchIndexMetadata");
    expect(joinedCalls[2]).toContain("candidate_r2_keys");
    expect(joinedCalls[3]).toContain(cleanup.buildBlockerReportSql());
    expect(joinedCalls[4]).toContain(buildApplySql());
    expect(joinedCalls.slice(1, 4)).not.toEqual(expect.arrayContaining([expect.stringContaining("FROM SearchDocument")]));
    expect(calls.slice(5)).toEqual([
      cleanup.buildQaR2DeleteArgs("profiles/codex-user/avatar.jpg"),
      cleanup.buildQaR2GetArgs("profiles/codex-user/avatar.jpg"),
      cleanup.buildQaR2DeleteArgs("recipes/codex-user/recipe-1/source.jpg"),
      cleanup.buildQaR2GetArgs("recipes/codex-user/recipe-1/source.jpg"),
      cleanup.buildQaR2DeleteArgs("spoons/codex-user/recipe-1/spoon.jpg"),
      cleanup.buildQaR2GetArgs("spoons/codex-user/recipe-1/spoon.jpg"),
    ]);
    expect(stdout.text()).toContain("Retained QA R2 keys: recipes/not-disposable/recipe-1/source.jpg");
    expect(stdout.text()).toContain("Skipped SearchDocument cleanup: table absent.");
    expect(stdout.text()).toContain("Applied QA D1 cleanup.");
    expect(stdout.text()).toContain("Verified deleted QA R2 keys: profiles/codex-user/avatar.jpg");
  });

  it("runs production read-only dry-run and refuses broad production apply", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async () => ({ stdout: "[]", stderr: "" }));

    await cleanup.runCleanupCli({
      argv: ["--target-env", "production"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stdout.text()).toContain("Target environment: production");
    expect(stdout.text()).toContain("Production cleanup is read-only for broad disposable sweeps.");
    expect(stdout.text()).toContain("Production broad cleanup is read-only");
    expect(stdout.text()).not.toContain("mutate local D1");
    expect(runCommand).toHaveBeenLastCalledWith(
      "pnpm",
      ["exec", "wrangler", "d1", "execute", "DB", "--remote", "--command", buildDryRunSql()],
      expect.objectContaining({ encoding: "utf8" }),
    );

    await expect(
      cleanup.runCleanupCli({
        argv: ["--target-env", "production", "--apply"],
        runCommand,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).rejects.toThrow(/Refusing broad production cleanup/);
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it("detects CLI entrypoints and routes CLI errors", async () => {
    const onError = vi.fn();
    const runMain = vi.fn(async () => {
      throw new Error("boom");
    });

    expect(cleanup.isCliEntry("file:///tmp/cleanup-local-qa-data.mjs", "/tmp/cleanup-local-qa-data.mjs")).toBe(true);
    expect(cleanup.isCliEntry("file:///tmp/cleanup-local-qa-data.mjs", undefined)).toBe(false);
    expect(
      cleanup.runCliIfEntry({
        moduleUrl: "file:///tmp/other.mjs",
        argv1: "/tmp/cleanup-local-qa-data.mjs",
        runMain,
        onError,
      }),
    ).toBe(false);
    expect(runMain).not.toHaveBeenCalled();

    expect(
      cleanup.runCliIfEntry({
        moduleUrl: "file:///tmp/cleanup-local-qa-data.mjs",
        argv1: "/tmp/cleanup-local-qa-data.mjs",
        runMain,
        onError,
      }),
    ).toBe(true);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
  });

  it("prints default CLI error output for Error and non-Error failures", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    cleanup.defaultCliErrorHandler(new Error("cleanup failed"));
    expect(errorSpy).toHaveBeenLastCalledWith("cleanup failed");
    expect(process.exitCode).toBe(1);

    cleanup.defaultCliErrorHandler("string failure");
    expect(errorSpy).toHaveBeenLastCalledWith("string failure");
    expect(process.exitCode).toBe(1);
  });

  it("dry-runs the full D1 disposable target surface with hard/soft split and OAuth redirect signature", () => {
    const sql = buildDryRunSql();

    expectAll(sql, [
      "'hard-delete recipes owned by disposable users'",
      "'soft-delete suspicious recipes owned by non-disposable users'",
      "'disposable users'",
      "'disposable spoons by chef or note'",
      "'e2e oauth clients with test redirect signature'",
      "'cross-boundary cleanup blockers'",
      "clientName = 'E2E OAuth Client'",
      "redirectUris LIKE '%codex%'",
      "redirectUris LIKE '%e2e%'",
      "redirectUris LIKE '%localhost%'",
      "redirectUris LIKE '%127.0.0.1%'",
      "chefId IN (SELECT id FROM disposable_users)",
      "chefId NOT IN (SELECT id FROM disposable_users)",
    ]);
  });

  it("dry-run blocker count is computed from real cross-boundary blocker queries", () => {
    const sql = buildDryRunSql();

    expect(sql).toContain("SELECT 'cross-boundary cleanup blockers' AS item,");
    expect(sql).toContain("AS count");
    expect(sql).toContain("(SELECT COUNT(*) FROM Recipe");
    expect(sql).toContain("blocker_recipe_activeCoverId");
    expect(sql).toContain("blocker_notification_payload");
    expect(sql).not.toContain("SELECT 'cross-boundary cleanup blockers' AS item, 0 AS count");
  });

  it("applies cleanup from explicit disposable target snapshots before any mutation", () => {
    const sql = buildApplySql();

    expectInOrder(sql, [
      "CREATE TEMP TABLE disposable_users",
      "CREATE TEMP TABLE hard_delete_recipes",
      "CREATE TEMP TABLE soft_delete_recipes",
      "CREATE TEMP TABLE disposable_spoons",
      "CREATE TEMP TABLE e2e_oauth_clients",
      "CREATE TEMP TABLE disposable_credentials",
      "CREATE TEMP TABLE cleanup_blockers",
    ]);
    expectAll(sql, [
      "INSERT INTO disposable_credentials",
      "ApiCredential",
      "oauthClientId IN (SELECT id FROM e2e_oauth_clients)",
      "clientName = 'E2E OAuth Client'",
      "(redirectUris LIKE '%codex%' OR redirectUris LIKE '%e2e%' OR redirectUris LIKE '%localhost%' OR redirectUris LIKE '%127.0.0.1%')",
    ]);
  });

  it("blocker-reports every non-disposable cross-boundary D1 reference before mutation", () => {
    const sql = buildApplySql();

    expectAll(sql, [
      "blocker_recipe_sourceRecipeId",
      "blocker_recipe_activeCoverId",
      "blocker_spoon_recipeId",
      "blocker_recipe_in_non_disposable_cookbook",
      "blocker_recipe_in_cookbook_addedById",
      "blocker_cover_sourceSpoonId",
      "blocker_cover_createdById",
      "blocker_agent_connection_approvedById",
      "blocker_agent_connection_credentialId",
      "blocker_api_idempotency_credentialId",
      "blocker_api_credential_oauthClientId",
      "blocker_oauth_code_userId",
      "blocker_oauth_refresh_token_userId",
      "blocker_notification_payload",
      "blocker_ambiguous_oauth_client",
      "SELECT CASE WHEN EXISTS (SELECT 1 FROM cleanup_blockers)",
      "RAISE(ABORT, 'Refusing cleanup because non-disposable rows still reference disposable targets')",
    ]);
  });

  it("orders credential, OAuth, cookbook, cover, spoon, recipe, user, and cascade cleanup safely", () => {
    const sql = buildApplySql();

    expectInOrder(sql, [
      "INSERT INTO disposable_credentials",
      "DELETE FROM AgentConnectionRequest",
      "DELETE FROM ApiIdempotencyKey",
      "DELETE FROM ApiCredential",
      "DELETE FROM OAuthAuthCode",
      "DELETE FROM OAuthRefreshToken",
      "DELETE FROM OAuthClient",
      "DELETE FROM RecipeCover",
      "DELETE FROM RecipeSpoon",
      "DELETE FROM RecipeInCookbook",
      "DELETE FROM Cookbook",
      "UPDATE Recipe\nSET sourceRecipeId = NULL",
      "DELETE FROM Recipe\nWHERE id IN (SELECT id FROM hard_delete_recipes)",
      "UPDATE Recipe\nSET deletedAt = COALESCE(deletedAt, CURRENT_TIMESTAMP)\nWHERE id IN (SELECT id FROM soft_delete_recipes)",
      "DELETE FROM User\nWHERE id IN (SELECT id FROM disposable_users)",
    ]);
  });

  it("clears recipe forks only inside the disposable hard-delete target set", () => {
    const sql = buildApplySql();

    expect(sql).toContain("UPDATE Recipe\nSET sourceRecipeId = NULL");
    expect(sql).toContain("WHERE id IN (SELECT id FROM hard_delete_recipes)");
    expect(sql).toContain("sourceRecipeId IN (SELECT id FROM hard_delete_recipes)");
    expect(sql).not.toContain("SET sourceRecipeId = NULL\nWHERE sourceRecipeId IS NOT NULL;");
  });

  it("does not touch absent search tables in default apply SQL", () => {
    const sql = buildApplySql();

    expect(sql).toContain("DELETE FROM User");
    expect(sql).not.toContain("SearchDocument");
    expect(sql).not.toContain("SearchIndexMetadata");
    expect(sql).not.toContain("CREATE VIRTUAL TABLE");
  });

  it("cleans existing search tables without creating them", () => {
    const sql = buildApplySql({ existingSearchTables: ["SearchDocument", "SearchIndexMetadata"] });

    expectAll(sql, [
      "SearchDocument",
      "SearchIndexMetadata",
      "DELETE FROM SearchDocument",
      "ownerId IN (SELECT id FROM disposable_users)",
      "entityId IN (SELECT id FROM hard_delete_recipes)",
      "entityId IN (SELECT id FROM soft_delete_recipes)",
      "imageUrl",
      "DELETE FROM SearchIndexMetadata",
    ]);
    expect(sql).not.toContain("CREATE VIRTUAL TABLE");
    expect(sql).not.toContain("CREATE TABLE IF NOT EXISTS SearchIndexMetadata");
  });

  it("builds read-only search table existence SQL outside apply SQL", () => {
    const sql = cleanup.buildSearchTablesExistSql();

    expectAll(sql, [
      "sqlite_master",
      "SearchDocument",
      "SearchIndexMetadata",
    ]);
    expect(sql).not.toContain("CREATE");
    expect(sql).not.toContain("DELETE");

    expect(cleanup.buildQaR2SearchTableExistsSql()).toContain("name IN ('SearchDocument')");
    expect(cleanup.buildQaR2SearchTableExistsSql()).not.toContain("SearchIndexMetadata");
    expect(cleanup.buildSearchTablesExistSql([])).toContain("AND 0;");
  });

  it("distinguishes direct disposable NotificationEvent cleanup from non-disposable payload blockers", () => {
    const sql = buildApplySql();

    expectAll(sql, [
      "DELETE FROM NotificationEvent",
      "recipientId IN (SELECT id FROM disposable_users)",
      "EXISTS (SELECT 1 FROM disposable_users WHERE NotificationEvent.payload LIKE '%' || disposable_users.id || '%')",
      "EXISTS (SELECT 1 FROM hard_delete_recipes WHERE NotificationEvent.payload LIKE '%' || hard_delete_recipes.id || '%')",
      "EXISTS (SELECT 1 FROM disposable_spoons WHERE NotificationEvent.payload LIKE '%' || disposable_spoons.id || '%')",
      "EXISTS (SELECT 1 FROM disposable_covers WHERE NotificationEvent.payload LIKE '%' || disposable_covers.id || '%')",
      "blocker_notification_payload",
    ]);
  });

  it("extracts only Spoonjoy photo keys from /photos/ URLs", () => {
    expect(cleanup.photoKeyFromImageUrl("/photos/profiles/codex-user/avatar.jpg")).toBe(
      "profiles/codex-user/avatar.jpg",
    );
    expect(cleanup.photoKeyFromImageUrl("https://example.com/photo.jpg")).toBeNull();
    expect(cleanup.photoKeyFromImageUrl("/images/chef-rj.png")).toBeNull();
    expect(cleanup.photoKeyFromImageUrl("/photos/")).toBeNull();
    expect(cleanup.photoKeyFromImageUrl(null)).toBeNull();
  });

  it("plans QA R2 cleanup keys, retained keys, and non-disposable surviving-reference blockers", () => {
    const plan = cleanup.planQaR2Cleanup({
      disposableUserIds: ["codex-user"],
      hardDeleteRecipeIds: ["recipe-1"],
      disposableSpoonIds: ["spoon-1"],
      generatedCoverKeys: ["recipes/codex-user/recipe-1/generated-cover.jpg"],
      references: {
        users: [
          { id: "codex-user", photoUrl: "/photos/profiles/codex-user/avatar.jpg" },
          { id: "real-user", photoUrl: "/photos/profiles/codex-user/avatar.jpg" },
        ],
        spoons: [
          {
            id: "spoon-1",
            chefId: "codex-user",
            recipeId: "recipe-1",
            photoUrl: "/photos/spoons/codex-user/recipe-1/spoon.jpg",
          },
          {
            id: "spoon-2",
            chefId: "real-user",
            recipeId: "recipe-2",
            photoUrl: "/photos/spoons/codex-user/recipe-1/spoon.jpg",
          },
        ],
        covers: [
          {
            id: "cover-1",
            recipeId: "recipe-1",
            imageUrl: "/photos/recipes/codex-user/recipe-1/raw.jpg",
            stylizedImageUrl: "/photos/recipes/codex-user/uploads/stylized.jpg",
            sourceImageUrl: "/photos/recipes/codex-user/uploads/source.jpg",
          },
          {
            id: "cover-2",
            recipeId: "recipe-2",
            imageUrl: "/photos/recipes/codex-user/recipe-1/raw.jpg",
            stylizedImageUrl: null,
            sourceImageUrl: null,
          },
        ],
        searchDocuments: [
          {
            id: "search-1",
            ownerId: "real-user",
            imageUrl: "/photos/recipes/codex-user/uploads/source.jpg",
          },
        ],
      },
    });

    expect(plan.deleteKeys).toEqual([
      "profiles/codex-user/avatar.jpg",
      "spoons/codex-user/recipe-1/spoon.jpg",
      "recipes/codex-user/recipe-1/raw.jpg",
      "recipes/codex-user/uploads/stylized.jpg",
      "recipes/codex-user/uploads/source.jpg",
      "recipes/codex-user/recipe-1/generated-cover.jpg",
    ]);
    expect(plan.retainedKeys).toEqual([]);
    expect(plan.blockers).toEqual([
      {
        key: "profiles/codex-user/avatar.jpg",
        reason: "non-disposable User.photoUrl still references candidate key",
        rowId: "real-user",
      },
      {
        key: "spoons/codex-user/recipe-1/spoon.jpg",
        reason: "non-disposable RecipeSpoon.photoUrl still references candidate key",
        rowId: "spoon-2",
      },
      {
        key: "recipes/codex-user/recipe-1/raw.jpg",
        reason: "non-disposable RecipeCover image field still references candidate key",
        rowId: "cover-2",
      },
      {
        key: "recipes/codex-user/uploads/source.jpg",
        reason: "non-disposable SearchDocument.imageUrl still references candidate key",
        rowId: "search-1",
      },
    ]);
  });

  it("retains generated cover keys outside disposable namespaces", () => {
    const plan = cleanup.planQaR2Cleanup({
      disposableUserIds: ["codex-user"],
      hardDeleteRecipeIds: ["recipe-1"],
      generatedCoverKeys: ["recipes/real-user/recipe-9/generated-cover.jpg"],
    });

    expect(plan.deleteKeys).toEqual([]);
    expect(plan.retainedKeys).toEqual(["recipes/real-user/recipe-9/generated-cover.jpg"]);
    expect(plan.blockers).toEqual([]);
  });

  it("plans generated cover keys from the app covers namespace for deletion", () => {
    const plan = cleanup.planQaR2Cleanup({
      generatedCoverKeys: ["covers/1760000000000-generated.png"],
    });

    expect(plan.deleteKeys).toEqual(["covers/1760000000000-generated.png"]);
    expect(plan.retainedKeys).toEqual([]);
    expect(plan.blockers).toEqual([]);
  });

  it("handles default QA R2 planning args, null photo URLs, duplicates, and spoon upload keys", () => {
    expect(cleanup.planQaR2Cleanup()).toEqual({ deleteKeys: [], retainedKeys: [], blockers: [] });

    const plan = cleanup.planQaR2Cleanup({
      disposableUserIds: ["codex-user"],
      references: {
        users: [{ id: "codex-user", photoUrl: null }],
      },
      generatedCoverKeys: [
        "spoons/codex-user/uploads/spoon.jpg",
        "spoons/codex-user/uploads/spoon.jpg",
      ],
    });

    expect(plan.deleteKeys).toEqual(["spoons/codex-user/uploads/spoon.jpg"]);
    expect(plan.retainedKeys).toEqual([]);
    expect(plan.blockers).toEqual([]);
  });

  it("builds QA R2 candidate SQL with retained unsafe keys and surviving-reference blockers", () => {
    const sql = cleanup.buildQaR2CandidateSql();

    expectAll(sql, [
      "candidate_r2_keys",
      "unsafe disposable user photo namespace",
      "unsafe disposable spoon photo namespace",
      "unsafe disposable cover imageUrl namespace",
      "unsafe disposable cover stylizedImageUrl namespace",
      "unsafe disposable cover sourceImageUrl namespace",
      "r2_reference_blockers",
      "blocker_user_photoUrl",
      "blocker_spoon_photoUrl",
      "blocker_cover_imageUrl",
      "blocker_cover_stylizedImageUrl",
      "blocker_cover_sourceImageUrl",
      "WHERE key IS NOT NULL AND key != ''",
    ]);
    expect(sql).not.toContain("FROM SearchDocument");
  });

  it("does not delete spoon R2 keys for note-matched spoons owned by non-disposable users", () => {
    const sql = cleanup.buildQaR2CandidateSql();

    expect(sql).toMatch(/SELECT 'delete', substr\(photoUrl, length\('\/photos\/'\) \+ 1\), NULL\s+FROM disposable_spoons\s+WHERE chefId IN \(SELECT id FROM disposable_users\)/s);
    expect(sql).toContain("photoUrl LIKE '/photos/spoons/' || chefId || '/' || recipeId || '/%'");
    expect(sql).toContain("photoUrl LIKE '/photos/spoons/' || chefId || '/uploads/%'");
    expect(sql).toContain("'unsafe disposable spoon photo namespace'");
  });

  it("deletes generated cover R2 keys under the app's covers namespace for hard-delete recipes", () => {
    const sql = cleanup.buildQaR2CandidateSql();

    expectAll(sql, [
      "imageUrl LIKE '/photos/covers/%'",
      "stylizedImageUrl LIKE '/photos/covers/%'",
      "sourceImageUrl LIKE '/photos/covers/%'",
    ]);
  });

  it("builds the SearchDocument R2 blocker SQL separately from base candidate collection", () => {
    expect(typeof cleanup.buildQaR2SearchReferenceSql).toBe("function");
    const sql = cleanup.buildQaR2SearchReferenceSql([
      "profiles/codex-user/avatar.jpg",
      "recipes/codex-user/recipe-1/source.jpg",
    ]);

    expectAll(sql, [
      "FROM SearchDocument",
      "blocker_search_imageUrl",
      "SearchDocument.imageUrl still references candidate key",
      "profiles/codex-user/avatar.jpg",
      "recipes/codex-user/recipe-1/source.jpg",
      "sd.ownerId IS NULL OR sd.ownerId NOT IN (SELECT id FROM disposable_users)",
    ]);
  });

  it("builds an empty SearchDocument R2 blocker query safely", () => {
    const sql = cleanup.buildQaR2SearchReferenceSql();

    expect(sql).toContain("SELECT NULL AS key WHERE 0");
    expect(sql).toContain("FROM SearchDocument");
  });

  it("refuses QA apply before D1 mutation when R2 candidates have surviving non-disposable references", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("candidate_r2_keys")) {
        return {
          stdout: JSON.stringify([
            {
              results: [
                {
                  action: "blocker_user_photoUrl",
                  key: "profiles/codex-user/avatar.jpg",
                  reason: "non-disposable User.photoUrl still references candidate key",
                },
                {
                  action: "blocker_search_imageUrl",
                  key: "recipes/codex-user/recipe-1/source.jpg",
                },
              ],
            },
          ]),
          stderr: "",
        };
      }
      return { stdout: "[]", stderr: "" };
    });

    await expect(
      cleanup.runCleanupCli({
        argv: ["--target-env", "qa", "--apply"],
        runCommand,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).rejects.toThrow(/non-disposable rows still reference candidate keys/);

    expect(runCommand.mock.calls.map((call) => (call[1] as string[]).join(" "))).not.toEqual(
      expect.arrayContaining([expect.stringContaining(buildApplySql())]),
    );
  });

  it("refuses QA apply before D1 mutation when search documents reference candidate R2 keys", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("candidate_r2_keys")) {
        return { stdout: JSON.stringify([{ results: [{ action: "delete", key: "profiles/codex-user/avatar.jpg" }] }]), stderr: "" };
      }
      if (command.includes("sqlite_master") && command.includes("SearchDocument")) {
        return { stdout: JSON.stringify([{ results: [{ name: "SearchDocument" }] }]), stderr: "" };
      }
      if (command.includes("FROM SearchDocument")) {
        return {
          stdout: JSON.stringify([
            {
              results: [
                {
                  action: "blocker_search_imageUrl",
                  key: "profiles/codex-user/avatar.jpg",
                  reason: "SearchDocument.imageUrl still references candidate key",
                },
              ],
            },
          ]),
          stderr: "",
        };
      }
      return { stdout: "[]", stderr: "" };
    });

    await expect(
      cleanup.runCleanupCli({
        argv: ["--target-env", "qa", "--apply"],
        runCommand,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).rejects.toThrow(/blocker_search_imageUrl:profiles\/codex-user\/avatar\.jpg/);

    expect(runCommand.mock.calls.map((call) => (call[1] as string[]).join(" "))).not.toEqual(
      expect.arrayContaining([expect.stringContaining(buildApplySql())]),
    );
  });

  it("reports D1 cleanup blockers before running the apply mutation", async () => {
    expect(typeof cleanup.buildBlockerReportSql).toBe("function");
    const blockerSql = cleanup.buildBlockerReportSql();
    expect(blockerSql).toMatch(/WITH\s+disposable_users AS/s);
    expect(blockerSql).toContain("'blocker_recipe_activeCoverId' AS blocker");
    expect(blockerSql).toContain("id AS rowId");
    expect(blockerSql).not.toContain("CREATE TABLE");
    expect(blockerSql).not.toContain("CREATE VIRTUAL TABLE");
    expect(blockerSql).not.toContain("DELETE FROM");
    expect(blockerSql).not.toContain("SearchDocument");
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("'blocker_recipe_activeCoverId' AS blocker")) {
        return {
          stdout: JSON.stringify([
            { results: [{ blocker: "blocker_recipe_activeCoverId", rowId: "recipe-1" }] },
          ]),
          stderr: "",
        };
      }
      return { stdout: "[]", stderr: "" };
    });

    await expect(
      cleanup.runCleanupCli({
        argv: ["--target-env", "local", "--apply"],
        runCommand,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).rejects.toThrow(/blocker_recipe_activeCoverId:recipe-1/);

    expect(runCommand.mock.calls.map((call) => (call[1] as string[]).join(" "))).not.toEqual(
      expect.arrayContaining([expect.stringContaining(buildApplySql())]),
    );
  });

  it("runs QA apply with no R2 candidates and no R2 delete/get commands", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("candidate_r2_keys")) {
        return { stdout: "", stderr: "" };
      }
      return { stdout: "[]", stderr: "" };
    });

    await cleanup.runCleanupCli({
      argv: ["--target-env", "qa", "--apply"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    const joinedCalls = runCommand.mock.calls.map((call) => (call[1] as string[]).join(" "));
    expect(joinedCalls).toEqual(expect.arrayContaining([expect.stringContaining(buildApplySql())]));
    expect(joinedCalls).not.toEqual(expect.arrayContaining([expect.stringContaining("r2 object")]));
    expect(stdout.text()).not.toContain("Deleted QA R2 keys");
    expect(stdout.text()).not.toContain("Verified deleted QA R2 keys");
  });

  it("treats missing stdout from the search-table existence check as absent search", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("candidate_r2_keys")) {
        return { stdout: JSON.stringify([{ results: [{ action: "delete", key: "profiles/codex-user/avatar.jpg" }] }]), stderr: "" };
      }
      if (command.includes("sqlite_master") && command.includes("SearchDocument")) {
        return { stderr: "" };
      }
      if (command.includes("r2 object get")) {
        throw "NoSuchKey";
      }
      return { stdout: "[]", stderr: "" };
    });

    await cleanup.runCleanupCli({
      argv: ["--target-env", "qa", "--apply"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(runCommand.mock.calls.map((call) => (call[1] as string[]).join(" "))).not.toEqual(
      expect.arrayContaining([expect.stringContaining("blocker_search_imageUrl")]),
    );
    const applyCall = runCommand.mock.calls.map((call) => (call[1] as string[]).join(" ")).find(
      (command) => command.includes("DELETE FROM User"),
    );
    expect(applyCall).not.toContain("SearchDocument");
    expect(stdout.text()).toContain("Skipped SearchDocument cleanup: table absent.");
  });

  it("treats missing stdout from search blocker and D1 blocker preflights as empty", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("candidate_r2_keys")) {
        return { stdout: JSON.stringify([{ results: [{ action: "delete", key: "profiles/codex-user/avatar.jpg" }] }]), stderr: "" };
      }
      if (command.includes("sqlite_master") && command.includes("SearchDocument")) {
        return { stdout: JSON.stringify([{ results: [{ name: "SearchDocument" }] }]), stderr: "" };
      }
      if (command.includes("FROM SearchDocument")) {
        return { stderr: "" };
      }
      if (command.includes("'blocker_recipe_activeCoverId' AS blocker")) {
        return { stderr: "" };
      }
      if (command.includes("r2 object get")) {
        throw "NoSuchKey";
      }
      return { stdout: "[]", stderr: "" };
    });

    await cleanup.runCleanupCli({
      argv: ["--target-env", "qa", "--apply"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    const joinedCalls = runCommand.mock.calls.map((call) => (call[1] as string[]).join(" "));
    expect(joinedCalls).toEqual(expect.arrayContaining([
      expect.stringContaining("FROM SearchDocument"),
      expect.stringContaining(buildApplySql({ existingSearchTables: ["SearchDocument"] })),
    ]));
  });

  it("handles candidate rows without results and candidates command without stdout", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    let candidateCalls = 0;
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("candidate_r2_keys")) {
        candidateCalls += 1;
        return candidateCalls === 1 ? { stdout: JSON.stringify([{}]), stderr: "" } : { stderr: "" };
      }
      return { stdout: "[]", stderr: "" };
    });

    await cleanup.runCleanupCli({
      argv: ["--target-env", "qa", "--apply"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });
    await cleanup.runCleanupCli({
      argv: ["--target-env", "qa", "--apply"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(candidateCalls).toBe(2);
    expect(runCommand.mock.calls.map((call) => (call[1] as string[]).join(" "))).not.toEqual(
      expect.arrayContaining([expect.stringContaining("r2 object")]),
    );
  });

  it("verifies R2 deletion when missing errors are reported as strings or stdout", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    let getCalls = 0;
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("candidate_r2_keys")) {
        return {
          stdout: JSON.stringify([
            {
              results: [
                { action: "delete", key: "profiles/codex-user/avatar.jpg" },
                { action: "delete", key: "spoons/codex-user/uploads/spoon.jpg" },
              ],
            },
          ]),
          stderr: "",
        };
      }
      if (command.includes("r2 object get")) {
        getCalls += 1;
        if (getCalls === 1) throw "NoSuchKey";
        throw { stdout: "not found" };
      }
      return { stdout: "[]", stderr: "" };
    });

    await cleanup.runCleanupCli({
      argv: ["--target-env", "qa", "--apply"],
      runCommand,
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    expect(stdout.text()).toContain("Verified deleted QA R2 keys: profiles/codex-user/avatar.jpg, spoons/codex-user/uploads/spoon.jpg");
  });

  it("fails QA apply when R2 verification still fetches a deleted key", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("candidate_r2_keys")) {
        return { stdout: JSON.stringify([{ results: [{ action: "delete", key: "profiles/codex-user/avatar.jpg" }] }]), stderr: "" };
      }
      return { stdout: "[]", stderr: "" };
    });

    await expect(
      cleanup.runCleanupCli({
        argv: ["--target-env", "qa", "--apply"],
        runCommand,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).rejects.toThrow(/QA R2 object still exists after delete/);
  });

  it("surfaces unexpected R2 verification failures", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("candidate_r2_keys")) {
        return { stdout: JSON.stringify([{ results: [{ action: "delete", key: "profiles/codex-user/avatar.jpg" }] }]), stderr: "" };
      }
      if (command.includes("r2 object get")) {
        throw new Error("network timeout");
      }
      return { stdout: "[]", stderr: "" };
    });

    await expect(
      cleanup.runCleanupCli({
        argv: ["--target-env", "qa", "--apply"],
        runCommand,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).rejects.toThrow(/network timeout/);
  });

  it("skips every R2 delete/get command when QA D1 apply fails", async () => {
    const stdout = writableBuffer();
    const stderr = writableBuffer();
    const runCommand = vi.fn(async (_cmd: string, args: string[]) => {
      const command = args.join(" ");
      if (command.includes("candidate_r2_keys")) {
        return { stdout: JSON.stringify([{ results: [{ action: "delete", key: "profiles/codex-user/avatar.jpg" }] }]), stderr: "" };
      }
      if (command.includes(buildApplySql())) {
        throw new Error("D1 apply failed");
      }
      return { stdout: "", stderr: "" };
    });

    await expect(
      cleanup.runCleanupCli({
        argv: ["--target-env", "qa", "--apply"],
        runCommand,
        stdout: stdout.stream,
        stderr: stderr.stream,
      }),
    ).rejects.toThrow(/D1 apply failed/);

    expect(runCommand.mock.calls.map((call) => (call[1] as string[]).join(" "))).not.toEqual(
      expect.arrayContaining([expect.stringContaining("r2 object delete")]),
    );
  });
});
