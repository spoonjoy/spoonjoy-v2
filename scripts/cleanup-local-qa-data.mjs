#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  PRODUCTION_R2_BUCKET,
  QA_BASE_URL,
  QA_R2_BUCKET,
  arg,
  resolveScriptTarget,
  scriptTargetSummary,
} from "./script-environment.mjs";

const execFileAsync = promisify(execFile);
const DEFAULT_LOCAL_BASE_URL = "http://localhost:5173";
const DEFAULT_PRODUCTION_CLEANUP_BASE_URL = "https://spoonjoy.app";
const MAX_WRANGLER_BUFFER = 1024 * 1024 * 8;
const CLEANUP_SCRATCH_TABLES = [
  "__e2e_exact_mutation_tombstones",
  "__e2e_exact_idempotency_keys",
  "__e2e_exact_connections",
  "__e2e_exact_credentials",
  "cleanup_blockers",
  "disposable_credentials",
  "e2e_oauth_credentials",
  "disposable_cover_image_urls",
  "disposable_covers",
  "e2e_oauth_clients",
  "disposable_spoons",
  "soft_delete_recipes",
  "hard_delete_recipes",
  "disposable_users",
];

export const SUSPICIOUS_RECIPE_WHERE = [
  "lower(title) LIKE 'e2e %'",
  "lower(title) LIKE 'mobile dock save%'",
  "lower(title) LIKE '%(variation %'",
  "lower(title) LIKE 'codex %'",
  "lower(title) LIKE 'codex-smoke-%'",
].join("\n    OR ");

export const DISPOSABLE_USER_WHERE = [
  "id IN ('demo_user_001', 'user_demo', 'user_julia', 'user_marco', 'user_sarah')",
  "(email LIKE 'codex-%' AND instr(username, 'codex_') = 1)",
  "(email LIKE 'e2e-passkey-%' AND instr(username, 'e2e_passkey_') = 1)",
].join("\n    OR ");

export function photoKeyFromImageUrl(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl.startsWith("/photos/")) return null;
  const key = imageUrl.slice("/photos/".length);
  return key === "" ? null : key;
}

export function buildQaR2DeleteArgs(key) {
  return ["exec", "wrangler", "r2", "object", "delete", `${QA_R2_BUCKET}/${key}`, "--remote", "--force"];
}

export function buildQaR2GetArgs(key) {
  return ["exec", "wrangler", "r2", "object", "get", `${QA_R2_BUCKET}/${key}`, "--remote", "--pipe"];
}

export function buildLocalR2DeleteArgs(key) {
  return ["exec", "wrangler", "r2", "object", "delete", `${PRODUCTION_R2_BUCKET}/${key}`, "--local", "--force"];
}

export function buildLocalR2GetArgs(key) {
  return ["exec", "wrangler", "r2", "object", "get", `${PRODUCTION_R2_BUCKET}/${key}`, "--local", "--pipe"];
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value !== ""))];
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function addKey(map, key, source) {
  if (!key) return;
  if (!map.has(key)) map.set(key, source);
}

function isAllowedDisposableKey(key, { disposableUserIds, hardDeleteRecipeIds }) {
  if (key.startsWith("covers/")) return true;
  for (const userId of disposableUserIds) {
    if (key.startsWith(`profiles/${userId}/`)) return true;
    if (key.startsWith(`recipes/${userId}/uploads/`)) return true;
    if (key.startsWith(`spoons/${userId}/uploads/`)) return true;
    for (const recipeId of hardDeleteRecipeIds) {
      if (key.startsWith(`recipes/${userId}/${recipeId}/`)) return true;
      if (key.startsWith(`spoons/${userId}/${recipeId}/`)) return true;
    }
  }
  return false;
}

export function planQaR2Cleanup({
  disposableUserIds = [],
  hardDeleteRecipeIds = [],
  disposableSpoonIds = [],
  generatedCoverKeys = [],
  references = {},
} = {}) {
  const disposableUsers = new Set(disposableUserIds);
  const hardDeleteRecipes = new Set(hardDeleteRecipeIds);
  const disposableSpoons = new Set(disposableSpoonIds);
  const candidateSources = new Map();
  const retainedKeys = [];

  for (const user of references.users ?? []) {
    if (!disposableUsers.has(user.id)) continue;
    addKey(candidateSources, photoKeyFromImageUrl(user.photoUrl), `User:${user.id}`);
  }
  for (const spoon of references.spoons ?? []) {
    if (!disposableSpoons.has(spoon.id) && !disposableUsers.has(spoon.chefId)) continue;
    addKey(candidateSources, photoKeyFromImageUrl(spoon.photoUrl), `RecipeSpoon:${spoon.id}`);
  }
  for (const cover of references.covers ?? []) {
    if (!hardDeleteRecipes.has(cover.recipeId)) continue;
    for (const field of ["imageUrl", "stylizedImageUrl", "sourceImageUrl"]) {
      addKey(candidateSources, photoKeyFromImageUrl(cover[field]), `RecipeCover:${cover.id}`);
    }
  }
  for (const key of generatedCoverKeys) {
    addKey(candidateSources, key, "generated-cover");
  }

  const deleteKeys = [];
  for (const key of candidateSources.keys()) {
    if (isAllowedDisposableKey(key, { disposableUserIds, hardDeleteRecipeIds })) {
      deleteKeys.push(key);
    } else {
      retainedKeys.push(key);
    }
  }

  const blockers = [];
  const deleteKeySet = new Set(deleteKeys);
  const addBlocker = (key, reason, rowId) => {
    if (!deleteKeySet.has(key)) return;
    blockers.push({ key, reason, rowId });
  };

  for (const user of references.users ?? []) {
    if (disposableUsers.has(user.id)) continue;
    addBlocker(photoKeyFromImageUrl(user.photoUrl), "non-disposable User.photoUrl still references candidate key", user.id);
  }
  for (const spoon of references.spoons ?? []) {
    if (disposableSpoons.has(spoon.id) || disposableUsers.has(spoon.chefId)) continue;
    addBlocker(
      photoKeyFromImageUrl(spoon.photoUrl),
      "non-disposable RecipeSpoon.photoUrl still references candidate key",
      spoon.id,
    );
  }
  for (const cover of references.covers ?? []) {
    if (hardDeleteRecipes.has(cover.recipeId)) continue;
    for (const field of ["imageUrl", "stylizedImageUrl", "sourceImageUrl"]) {
      addBlocker(photoKeyFromImageUrl(cover[field]), "non-disposable RecipeCover image field still references candidate key", cover.id);
    }
  }
  for (const document of references.searchDocuments ?? []) {
    addBlocker(
      photoKeyFromImageUrl(document.imageUrl),
      "non-disposable SearchDocument.imageUrl still references candidate key",
      document.id,
    );
  }

  return { deleteKeys, retainedKeys, blockers };
}

export function buildQaR2CandidateSql() {
  const userCandidates = `
WITH
  disposable_users AS (
    SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE}
  ),
  candidate_r2_keys AS (
    SELECT 'delete' AS action, substr(photoUrl, length('/photos/') + 1) AS key, NULL AS reason
    FROM User
    WHERE id IN (SELECT id FROM disposable_users)
      AND instr(photoUrl, '/photos/profiles/' || id || '/') = 1
    UNION
    SELECT 'retain', substr(photoUrl, length('/photos/') + 1), 'unsafe disposable user photo namespace'
    FROM User
    WHERE id IN (SELECT id FROM disposable_users)
      AND photoUrl LIKE '/photos/%'
      AND instr(photoUrl, '/photos/profiles/' || id || '/') != 1
  )
SELECT action, key, reason
FROM candidate_r2_keys
WHERE key IS NOT NULL AND key != '';
`.trim();

  const spoonCandidates = `
WITH
  disposable_users AS (
    SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE}
  ),
  disposable_spoons AS (
    SELECT id, chefId, recipeId, photoUrl FROM RecipeSpoon
    WHERE chefId IN (SELECT id FROM disposable_users)
  ),
  candidate_r2_keys AS (
    SELECT 'delete' AS action,
      substr(photoUrl, length('/photos/') + 1) AS key,
      NULL AS reason
    FROM disposable_spoons
    WHERE chefId IN (SELECT id FROM disposable_users)
      AND (
        instr(photoUrl, '/photos/spoons/' || chefId || '/' || recipeId || '/') = 1
        OR instr(photoUrl, '/photos/spoons/' || chefId || '/uploads/') = 1
      )
    UNION
    SELECT 'retain', substr(photoUrl, length('/photos/') + 1), 'unsafe disposable spoon photo namespace'
    FROM disposable_spoons
    WHERE photoUrl LIKE '/photos/%'
      AND NOT (
        chefId IN (SELECT id FROM disposable_users)
        AND (
          instr(photoUrl, '/photos/spoons/' || chefId || '/' || recipeId || '/') = 1
          OR instr(photoUrl, '/photos/spoons/' || chefId || '/uploads/') = 1
        )
      )
  )
SELECT action, key, reason
FROM candidate_r2_keys
WHERE key IS NOT NULL AND key != '';
`.trim();

  const coverCandidates = (field) => `
WITH
  disposable_users AS (
    SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE}
  ),
  hard_delete_recipes AS (
    SELECT id, chefId FROM Recipe WHERE chefId IN (SELECT id FROM disposable_users)
  ),
  disposable_covers AS (
    SELECT id, recipeId, ${field}
    FROM RecipeCover
    WHERE recipeId IN (SELECT id FROM hard_delete_recipes)
  ),
  candidate_r2_keys AS (
    SELECT 'delete' AS action, substr(${field}, length('/photos/') + 1) AS key, NULL AS reason
    FROM disposable_covers dc
    JOIN Recipe r ON r.id = dc.recipeId
    WHERE instr(${field}, '/photos/recipes/' || r.chefId || '/' || dc.recipeId || '/') = 1
       OR instr(${field}, '/photos/recipes/' || r.chefId || '/uploads/') = 1
       OR instr(${field}, '/photos/covers/') = 1
    UNION
    SELECT 'retain', substr(${field}, length('/photos/') + 1), 'unsafe disposable cover ${field} namespace'
    FROM disposable_covers dc
    JOIN Recipe r ON r.id = dc.recipeId
    WHERE ${field} LIKE '/photos/%'
      AND NOT (
        instr(${field}, '/photos/recipes/' || r.chefId || '/' || dc.recipeId || '/') = 1
        OR instr(${field}, '/photos/recipes/' || r.chefId || '/uploads/') = 1
        OR instr(${field}, '/photos/covers/') = 1
      )
  )
SELECT action, key, reason
FROM candidate_r2_keys
WHERE key IS NOT NULL AND key != '';
`.trim();

  return [
    userCandidates,
    spoonCandidates,
    coverCandidates("imageUrl"),
    coverCandidates("stylizedImageUrl"),
    coverCandidates("sourceImageUrl"),
  ].join("\n\n");
}

export function buildR2ReferenceSql(keys = []) {
  const values = unique(keys).map((key) => `(${sqlString(key)})`).join(", ");
  const referenceKeysCte = values === "" ? "SELECT NULL AS key WHERE 0" : `VALUES ${values}`;
  return `
WITH
  disposable_users AS (
    SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE}
  ),
  hard_delete_recipes AS (
    SELECT id FROM Recipe WHERE chefId IN (SELECT id FROM disposable_users)
  ),
  disposable_spoons AS (
    SELECT id FROM RecipeSpoon
    WHERE chefId IN (SELECT id FROM disposable_users)
  ),
  r2_reference_keys(key) AS (
    ${referenceKeysCte}
  ),
  r2_reference_blockers AS (
    SELECT 'blocker_user_photoUrl' AS action,
      substr(u.photoUrl, length('/photos/') + 1) AS key,
      'non-disposable User.photoUrl still references candidate key' AS reason
    FROM User u
    JOIN r2_reference_keys c ON c.key = substr(u.photoUrl, length('/photos/') + 1)
    WHERE u.id NOT IN (SELECT id FROM disposable_users)
    UNION
    SELECT 'blocker_spoon_photoUrl',
      substr(rs.photoUrl, length('/photos/') + 1),
      'non-disposable RecipeSpoon.photoUrl still references candidate key'
    FROM RecipeSpoon rs
    JOIN r2_reference_keys c ON c.key = substr(rs.photoUrl, length('/photos/') + 1)
    WHERE rs.id NOT IN (SELECT id FROM disposable_spoons)
      AND rs.chefId NOT IN (SELECT id FROM disposable_users)
    UNION
    SELECT 'blocker_cover_imageUrl',
      substr(rc.imageUrl, length('/photos/') + 1),
      'non-disposable RecipeCover.imageUrl still references candidate key'
    FROM RecipeCover rc
    JOIN r2_reference_keys c ON c.key = substr(rc.imageUrl, length('/photos/') + 1)
    WHERE rc.recipeId NOT IN (SELECT id FROM hard_delete_recipes)
    UNION
    SELECT 'blocker_cover_stylizedImageUrl',
      substr(rc.stylizedImageUrl, length('/photos/') + 1),
      'non-disposable RecipeCover.stylizedImageUrl still references candidate key'
    FROM RecipeCover rc
    JOIN r2_reference_keys c ON c.key = substr(rc.stylizedImageUrl, length('/photos/') + 1)
    WHERE rc.recipeId NOT IN (SELECT id FROM hard_delete_recipes)
    UNION
    SELECT 'blocker_cover_sourceImageUrl',
      substr(rc.sourceImageUrl, length('/photos/') + 1),
      'non-disposable RecipeCover.sourceImageUrl still references candidate key'
    FROM RecipeCover rc
    JOIN r2_reference_keys c ON c.key = substr(rc.sourceImageUrl, length('/photos/') + 1)
    WHERE rc.recipeId NOT IN (SELECT id FROM hard_delete_recipes)
  )
SELECT action, key, reason
FROM r2_reference_blockers
WHERE key IS NOT NULL AND key != '';
`.trim();
}

export function buildQaR2SearchTableExistsSql() {
  return buildSearchTablesExistSql(["SearchDocument"]);
}

export function buildSearchTablesExistSql(names = ["SearchDocument", "SearchIndexMetadata"]) {
  const searchTableNames = unique(names);
  const namePredicate = searchTableNames.length === 0
    ? "0"
    : `name IN (${searchTableNames.map(sqlString).join(", ")})`;
  return `
SELECT name
FROM sqlite_master
WHERE type IN ('table', 'virtual table')
  AND ${namePredicate};
`.trim();
}

export function buildQaR2SearchReferenceSql(keys = []) {
  const values = unique(keys).map((key) => `(${sqlString(key)})`).join(", ");
  const searchKeysCte = values === "" ? "SELECT NULL AS key WHERE 0" : `VALUES ${values}`;
  return `
WITH
  disposable_users AS (
    SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE}
  ),
  hard_delete_recipes AS (
    SELECT id FROM Recipe WHERE chefId IN (SELECT id FROM disposable_users)
  ),
  soft_delete_recipes AS (
    SELECT id FROM Recipe
    WHERE ${SUSPICIOUS_RECIPE_WHERE}
      AND chefId NOT IN (SELECT id FROM disposable_users)
  ),
  disposable_spoons AS (
    SELECT id FROM RecipeSpoon
    WHERE chefId IN (SELECT id FROM disposable_users)
  ),
  disposable_covers AS (
    SELECT id FROM RecipeCover
    WHERE recipeId IN (SELECT id FROM hard_delete_recipes)
  ),
  search_r2_keys(key) AS (
    ${searchKeysCte}
  ),
  r2_reference_blockers AS (
    SELECT 'blocker_search_imageUrl' AS action,
      substr(sd.imageUrl, length('/photos/') + 1) AS key,
      'SearchDocument.imageUrl still references candidate key' AS reason
    FROM SearchDocument sd
    JOIN search_r2_keys c ON c.key = substr(sd.imageUrl, length('/photos/') + 1)
    WHERE (sd.ownerId IS NULL OR sd.ownerId NOT IN (SELECT id FROM disposable_users))
      AND (sd.entityId IS NULL OR sd.entityId NOT IN (SELECT id FROM hard_delete_recipes))
      AND (sd.entityId IS NULL OR sd.entityId NOT IN (SELECT id FROM soft_delete_recipes))
      AND (sd.entityId IS NULL OR sd.entityId NOT IN (SELECT id FROM disposable_spoons))
      AND (sd.entityId IS NULL OR sd.entityId NOT IN (SELECT id FROM disposable_covers))
  )
SELECT action, key, reason
FROM r2_reference_blockers
WHERE key IS NOT NULL AND key != '';
  `.trim();
}

function cleanupTargetCtesSql() {
  return `
WITH
  disposable_users AS (
    SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE}
  ),
  hard_delete_recipes AS (
    SELECT id FROM Recipe WHERE chefId IN (SELECT id FROM disposable_users)
  ),
  soft_delete_recipes AS (
    SELECT id FROM Recipe
    WHERE (${SUSPICIOUS_RECIPE_WHERE})
      AND chefId NOT IN (SELECT id FROM disposable_users)
  ),
  disposable_spoons AS (
    SELECT id FROM RecipeSpoon
    WHERE chefId IN (SELECT id FROM disposable_users)
  ),
  disposable_covers AS (
    SELECT id FROM RecipeCover
    WHERE recipeId IN (SELECT id FROM hard_delete_recipes)
  ),
  disposable_credentials AS (
    SELECT id FROM ApiCredential
    WHERE userId IN (SELECT id FROM disposable_users)
  )
`.trim();
}

function cleanupBlockerQueries() {
  return [
    {
      blocker: "blocker_recipe_sourceRecipeId",
      rowId: "id",
      fromWhere: `FROM Recipe
WHERE sourceRecipeId IN (SELECT id FROM hard_delete_recipes)
  AND id NOT IN (SELECT id FROM hard_delete_recipes)`,
    },
    {
      blocker: "blocker_recipe_activeCoverId",
      rowId: "id",
      fromWhere: `FROM Recipe
WHERE activeCoverId IN (SELECT id FROM disposable_covers)
  AND id NOT IN (SELECT id FROM hard_delete_recipes)`,
    },
    {
      blocker: "blocker_spoon_recipeId",
      rowId: "id",
      fromWhere: `FROM RecipeSpoon
WHERE recipeId IN (SELECT id FROM hard_delete_recipes)
  AND id NOT IN (SELECT id FROM disposable_spoons)`,
    },
    {
      blocker: "blocker_recipe_in_non_disposable_cookbook",
      rowId: "ric.id",
      fromWhere: `FROM RecipeInCookbook ric
JOIN Cookbook c ON c.id = ric.cookbookId
WHERE ric.recipeId IN (SELECT id FROM hard_delete_recipes)
  AND c.authorId NOT IN (SELECT id FROM disposable_users)`,
    },
    {
      blocker: "blocker_recipe_in_cookbook_addedById",
      rowId: "ric.id",
      fromWhere: `FROM RecipeInCookbook ric
JOIN Cookbook c ON c.id = ric.cookbookId
WHERE ric.addedById IN (SELECT id FROM disposable_users)
  AND c.authorId NOT IN (SELECT id FROM disposable_users)`,
    },
    {
      blocker: "blocker_cover_sourceSpoonId",
      rowId: "id",
      fromWhere: `FROM RecipeCover
WHERE sourceSpoonId IN (SELECT id FROM disposable_spoons)
  AND recipeId NOT IN (SELECT id FROM hard_delete_recipes)`,
    },
    {
      blocker: "blocker_cover_createdById",
      rowId: "id",
      fromWhere: `FROM RecipeCover
WHERE createdById IN (SELECT id FROM disposable_users)
  AND recipeId NOT IN (SELECT id FROM hard_delete_recipes)`,
    },
    {
      blocker: "blocker_agent_connection_approvedById",
      rowId: "id",
      fromWhere: `FROM AgentConnectionRequest
WHERE approvedById NOT IN (SELECT id FROM disposable_users)
  AND credentialId IN (SELECT id FROM disposable_credentials)`,
    },
    {
      blocker: "blocker_agent_connection_credentialId",
      rowId: "id",
      fromWhere: `FROM AgentConnectionRequest
WHERE credentialId IN (SELECT id FROM disposable_credentials)
  AND approvedById NOT IN (SELECT id FROM disposable_users)`,
    },
    {
      blocker: "blocker_api_idempotency_credentialId",
      rowId: "id",
      fromWhere: `FROM ApiIdempotencyKey
WHERE credentialId IN (SELECT id FROM disposable_credentials)
  AND userId NOT IN (SELECT id FROM disposable_users)`,
    },
    {
      blocker: "blocker_notification_payload",
      rowId: "id",
      fromWhere: `FROM NotificationEvent
WHERE recipientId NOT IN (SELECT id FROM disposable_users)
  AND (
    EXISTS (SELECT 1 FROM disposable_users WHERE NotificationEvent.payload LIKE '%' || disposable_users.id || '%')
    OR EXISTS (SELECT 1 FROM hard_delete_recipes WHERE NotificationEvent.payload LIKE '%' || hard_delete_recipes.id || '%')
    OR EXISTS (SELECT 1 FROM disposable_spoons WHERE NotificationEvent.payload LIKE '%' || disposable_spoons.id || '%')
    OR EXISTS (SELECT 1 FROM disposable_covers WHERE NotificationEvent.payload LIKE '%' || disposable_covers.id || '%')
  )`,
    },
  ];
}

function parseWranglerRows(stdout, label) {
  if (typeof stdout !== "string" || stdout.trim() === "") {
    throw new Error(`Refusing cleanup because ${label} did not return valid Wrangler JSON.`);
  }
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Refusing cleanup because ${label} did not return valid Wrangler JSON.`);
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    throw new Error(`Refusing cleanup because ${label} did not return valid Wrangler JSON.`);
  }
  if (parsed.length !== 1) {
    throw new Error(`Refusing cleanup because ${label} did not return exactly one Wrangler result set.`);
  }
  if (!Array.isArray(parsed[0]?.results)) {
    throw new Error(`Refusing cleanup because ${label} did not return a results array.`);
  }
  if (parsed[0].success !== true) {
    throw new Error(`Refusing cleanup because ${label} did not report Wrangler success.`);
  }
  return parsed[0].results;
}

function requireWranglerRowShape(rows, label, isValid) {
  if (rows.some((row) => !isValid(row))) {
    throw new Error(`Refusing cleanup because ${label} returned an unexpected row shape.`);
  }
  return rows;
}

function isR2ObjectMissingError(error) {
  const text = [
    typeof error === "string" ? error : "",
    error instanceof Error ? error.message : "",
    typeof error?.stdout === "string" ? error.stdout : "",
    typeof error?.stderr === "string" ? error.stderr : "",
  ].join("\n");
  return /(?:the specified key does not exist|nosuchkey)/i.test(text);
}

function r2BlockerError(blockers, targetLabel) {
  const details = blockers
    .map((row) => `${row.action}:${row.key}${row.reason ? ` (${row.reason})` : ""}`)
    .join(", ");
  return new Error(`Refusing ${targetLabel} R2 cleanup because non-disposable rows still reference candidate keys: ${details}`);
}

function assertNoR2Blockers(rows, targetLabel) {
  const blockers = rows.filter((row) => typeof row.action === "string" && row.action.startsWith("blocker"));
  if (blockers.length > 0) throw r2BlockerError(blockers, targetLabel);
}

async function collectExistingSearchTables({ dbName, target, runCommand }) {
  const result = await runCommand("pnpm", wranglerD1Args(dbName, buildSearchTablesExistSql(), target), {
    encoding: "utf8",
    maxBuffer: MAX_WRANGLER_BUFFER,
  });
  const rows = requireWranglerRowShape(
    parseWranglerRows(result.stdout, "search-table existence preflight"),
    "search-table existence preflight",
    (row) => typeof row?.name === "string",
  );
  return normalizeExistingSearchTables(rows.map((row) => row.name));
}

async function collectR2Candidates({ dbName, target, runCommand, existingSearchTables }) {
  const targetLabel = target.targetEnv === "local" ? "local" : "QA";
  const rows = [];
  const candidateStatements = buildQaR2CandidateSql().split(/;\s*(?=WITH\b)/);
  for (const statement of candidateStatements) {
    const result = await runCommand("pnpm", wranglerD1Args(dbName, statement, target), {
      encoding: "utf8",
      maxBuffer: MAX_WRANGLER_BUFFER,
    });
    rows.push(...requireWranglerRowShape(
      parseWranglerRows(result.stdout, "R2 candidate preflight"),
      "R2 candidate preflight",
      (row) =>
        (row?.action === "delete" || row?.action === "retain") &&
        typeof row.key === "string" &&
        row.key !== "" &&
        (row.reason == null || typeof row.reason === "string"),
    ));
  }
  assertNoR2Blockers(rows, targetLabel);
  const deleteKeys = unique(rows.filter((row) => row.action === "delete").map((row) => row.key));
  const retainedKeys = unique(rows.filter((row) => row.action === "retain").map((row) => row.key));
  if (deleteKeys.length > 0) {
    const referenceResult = await runCommand("pnpm", wranglerD1Args(dbName, buildR2ReferenceSql(deleteKeys), target), {
      encoding: "utf8",
      maxBuffer: MAX_WRANGLER_BUFFER,
    });
    const referenceRows = requireWranglerRowShape(
      parseWranglerRows(referenceResult.stdout, "base R2 reference preflight"),
      "base R2 reference preflight",
      (row) =>
        typeof row?.action === "string" &&
        row.action.startsWith("blocker") &&
        typeof row.key === "string" &&
        row.key !== "" &&
        (row.reason == null || typeof row.reason === "string"),
    );
    assertNoR2Blockers(referenceRows, targetLabel);
  }
  if (deleteKeys.length > 0 && existingSearchTables.has("SearchDocument")) {
    const searchResult = await runCommand("pnpm", wranglerD1Args(dbName, buildQaR2SearchReferenceSql(deleteKeys), target), {
      encoding: "utf8",
      maxBuffer: MAX_WRANGLER_BUFFER,
    });
    const searchRows = requireWranglerRowShape(
      parseWranglerRows(searchResult.stdout, "SearchDocument R2 reference preflight"),
      "SearchDocument R2 reference preflight",
      (row) =>
        typeof row?.action === "string" &&
        row.action.startsWith("blocker") &&
        typeof row.key === "string" &&
        row.key !== "" &&
        (row.reason == null || typeof row.reason === "string"),
    );
    assertNoR2Blockers(searchRows, targetLabel);
  }
  return {
    deleteKeys,
    retainedKeys,
  };
}

async function deleteAndVerifyR2Keys({ deleteKeys, targetEnv, runCommand, stdout }) {
  const targetLabel = targetEnv === "local" ? "local" : "QA";
  const deleteArgs = targetEnv === "local" ? buildLocalR2DeleteArgs : buildQaR2DeleteArgs;
  const getArgs = targetEnv === "local" ? buildLocalR2GetArgs : buildQaR2GetArgs;
  const deletedKeys = [];
  const verifiedDeletedKeys = [];
  for (const key of deleteKeys) {
    try {
      await runCommand("pnpm", deleteArgs(key), {
        encoding: "utf8",
        maxBuffer: MAX_WRANGLER_BUFFER,
      });
      deletedKeys.push(key);
    } catch (error) {
      if (!isR2ObjectMissingError(error)) throw error;
    }
    try {
      await runCommand("pnpm", getArgs(key), {
        encoding: "buffer",
        maxBuffer: MAX_WRANGLER_BUFFER,
      });
    } catch (error) {
      if (isR2ObjectMissingError(error)) {
        verifiedDeletedKeys.push(key);
        continue;
      }
      throw error;
    }
    throw new Error(`${targetLabel} R2 object still exists after delete: ${key}`);
  }
  if (deletedKeys.length > 0) stdout.write(`Deleted ${targetLabel} R2 keys: ${deletedKeys.join(", ")}\n`);
  if (verifiedDeletedKeys.length > 0) stdout.write(`Verified deleted ${targetLabel} R2 keys: ${verifiedDeletedKeys.join(", ")}\n`);
  return { deletedKeys, verifiedDeletedKeys };
}

export function buildDryRunSql() {
  return `
WITH disposable_users AS (
  SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE}
)
SELECT 'hard-delete recipes owned by disposable users' AS item, COUNT(*) AS count
FROM Recipe
WHERE chefId IN (SELECT id FROM disposable_users);

WITH disposable_users AS (
  SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE}
)
SELECT 'soft-delete suspicious recipes owned by non-disposable users' AS item, COUNT(*) AS count
FROM Recipe
WHERE (${SUSPICIOUS_RECIPE_WHERE})
  AND chefId NOT IN (SELECT id FROM disposable_users);

SELECT 'active suspicious recipes' AS item, COUNT(*) AS count
FROM Recipe
WHERE deletedAt IS NULL AND (${SUSPICIOUS_RECIPE_WHERE});

SELECT 'already deleted suspicious recipes' AS item, COUNT(*) AS count
FROM Recipe
WHERE deletedAt IS NOT NULL AND (${SUSPICIOUS_RECIPE_WHERE});

SELECT 'disposable users' AS item, COUNT(*) AS count
FROM User
WHERE ${DISPOSABLE_USER_WHERE};

WITH disposable_users AS (
  SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE}
)
SELECT 'spoons owned by disposable users' AS item, COUNT(*) AS count
FROM RecipeSpoon
WHERE chefId IN (SELECT id FROM disposable_users);

${cleanupTargetCtesSql()}
SELECT 'cross-boundary cleanup blockers' AS item,
  ${cleanupBlockerQueries().map((query) => `/* ${query.blocker} */ (SELECT COUNT(*) ${query.fromWhere})`).join("\n  + ")} AS count;
`.trim();
}

function normalizeExistingSearchTables(existingSearchTables) {
  return new Set(Array.from(existingSearchTables).filter(
    (name) => name === "SearchDocument" || name === "SearchIndexMetadata",
  ));
}

function buildSearchCleanupSql(existingSearchTables) {
  const searchTables = normalizeExistingSearchTables(existingSearchTables);
  const statements = [];

  if (searchTables.has("SearchDocument")) {
    statements.push(`
DELETE FROM SearchDocument
WHERE ownerId IN (SELECT id FROM disposable_users)
   OR entityId IN (SELECT id FROM hard_delete_recipes)
   OR entityId IN (SELECT id FROM soft_delete_recipes)
   OR entityId IN (SELECT id FROM disposable_spoons)
   OR entityId IN (SELECT id FROM disposable_covers)
   OR imageUrl IN (SELECT imageUrl FROM disposable_cover_image_urls)
   OR EXISTS (SELECT 1 FROM disposable_users WHERE SearchDocument.href LIKE '%' || disposable_users.id || '%')
   OR EXISTS (SELECT 1 FROM hard_delete_recipes WHERE SearchDocument.href LIKE '%' || hard_delete_recipes.id || '%')
   OR EXISTS (SELECT 1 FROM disposable_spoons WHERE SearchDocument.href LIKE '%' || disposable_spoons.id || '%')
   OR EXISTS (SELECT 1 FROM disposable_covers WHERE SearchDocument.href LIKE '%' || disposable_covers.id || '%');
`.trim());
  }

  if (searchTables.has("SearchIndexMetadata")) {
    statements.push("DELETE FROM SearchIndexMetadata;");
  }

  return statements.join("\n\n");
}

export function buildScratchCleanupSql() {
  return CLEANUP_SCRATCH_TABLES
    .map((table) => `DROP TABLE IF EXISTS main.${table};`)
    .join("\n");
}

export function buildApplySql({ existingSearchTables = [] } = {}) {
  const searchCleanupSql = buildSearchCleanupSql(existingSearchTables);
  return `
PRAGMA foreign_keys=ON;

-- Remove scratch schema left by cleanup versions that accidentally used main tables.
${buildScratchCleanupSql()}

CREATE TABLE disposable_users (id TEXT PRIMARY KEY);
INSERT INTO disposable_users
SELECT id FROM User
WHERE ${DISPOSABLE_USER_WHERE};

CREATE TABLE hard_delete_recipes (id TEXT PRIMARY KEY);
INSERT INTO hard_delete_recipes
SELECT id FROM Recipe
WHERE chefId IN (SELECT id FROM disposable_users);

CREATE TABLE soft_delete_recipes (id TEXT PRIMARY KEY);
INSERT INTO soft_delete_recipes
SELECT id FROM Recipe
WHERE (${SUSPICIOUS_RECIPE_WHERE})
  AND chefId NOT IN (SELECT id FROM disposable_users);

CREATE TABLE disposable_spoons (id TEXT PRIMARY KEY);
INSERT INTO disposable_spoons
SELECT id FROM RecipeSpoon
WHERE chefId IN (SELECT id FROM disposable_users);

CREATE TABLE disposable_covers (id TEXT PRIMARY KEY);
INSERT INTO disposable_covers
SELECT id FROM RecipeCover
WHERE recipeId IN (SELECT id FROM hard_delete_recipes);

CREATE TABLE disposable_cover_image_urls (imageUrl TEXT PRIMARY KEY);
INSERT OR IGNORE INTO disposable_cover_image_urls
SELECT imageUrl FROM RecipeCover
WHERE id IN (SELECT id FROM disposable_covers)
  AND imageUrl LIKE '/photos/%';
INSERT OR IGNORE INTO disposable_cover_image_urls
SELECT stylizedImageUrl FROM RecipeCover
WHERE id IN (SELECT id FROM disposable_covers)
  AND stylizedImageUrl LIKE '/photos/%';
INSERT OR IGNORE INTO disposable_cover_image_urls
SELECT sourceImageUrl FROM RecipeCover
WHERE id IN (SELECT id FROM disposable_covers)
  AND sourceImageUrl LIKE '/photos/%';

CREATE TABLE disposable_credentials (id TEXT PRIMARY KEY);
INSERT INTO disposable_credentials
SELECT id FROM ApiCredential
WHERE userId IN (SELECT id FROM disposable_users);

CREATE TABLE cleanup_blockers (
  blocker TEXT NOT NULL,
  rowId TEXT NOT NULL
);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_recipe_sourceRecipeId', id FROM Recipe
WHERE sourceRecipeId IN (SELECT id FROM hard_delete_recipes)
  AND id NOT IN (SELECT id FROM hard_delete_recipes);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_recipe_activeCoverId', id FROM Recipe
WHERE activeCoverId IN (SELECT id FROM disposable_covers)
  AND id NOT IN (SELECT id FROM hard_delete_recipes);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_spoon_recipeId', id FROM RecipeSpoon
WHERE recipeId IN (SELECT id FROM hard_delete_recipes)
  AND id NOT IN (SELECT id FROM disposable_spoons);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_recipe_in_non_disposable_cookbook', ric.id
FROM RecipeInCookbook ric
JOIN Cookbook c ON c.id = ric.cookbookId
WHERE ric.recipeId IN (SELECT id FROM hard_delete_recipes)
  AND c.authorId NOT IN (SELECT id FROM disposable_users);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_recipe_in_cookbook_addedById', ric.id
FROM RecipeInCookbook ric
JOIN Cookbook c ON c.id = ric.cookbookId
WHERE ric.addedById IN (SELECT id FROM disposable_users)
  AND c.authorId NOT IN (SELECT id FROM disposable_users);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_cover_sourceSpoonId', id FROM RecipeCover
WHERE sourceSpoonId IN (SELECT id FROM disposable_spoons)
  AND recipeId NOT IN (SELECT id FROM hard_delete_recipes);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_cover_createdById', id FROM RecipeCover
WHERE createdById IN (SELECT id FROM disposable_users)
  AND recipeId NOT IN (SELECT id FROM hard_delete_recipes);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_agent_connection_approvedById', id FROM AgentConnectionRequest
WHERE approvedById NOT IN (SELECT id FROM disposable_users)
  AND credentialId IN (SELECT id FROM disposable_credentials);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_agent_connection_credentialId', id FROM AgentConnectionRequest
WHERE credentialId IN (SELECT id FROM disposable_credentials)
  AND approvedById NOT IN (SELECT id FROM disposable_users);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_api_idempotency_credentialId', id FROM ApiIdempotencyKey
WHERE credentialId IN (SELECT id FROM disposable_credentials)
  AND userId NOT IN (SELECT id FROM disposable_users);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_notification_payload', id FROM NotificationEvent
WHERE recipientId NOT IN (SELECT id FROM disposable_users)
  AND (
    EXISTS (SELECT 1 FROM disposable_users WHERE NotificationEvent.payload LIKE '%' || disposable_users.id || '%')
    OR EXISTS (SELECT 1 FROM hard_delete_recipes WHERE NotificationEvent.payload LIKE '%' || hard_delete_recipes.id || '%')
    OR EXISTS (SELECT 1 FROM disposable_spoons WHERE NotificationEvent.payload LIKE '%' || disposable_spoons.id || '%')
    OR EXISTS (SELECT 1 FROM disposable_covers WHERE NotificationEvent.payload LIKE '%' || disposable_covers.id || '%')
  );

-- The literal abort shape is kept here for reviewer/search visibility:
-- SELECT CASE WHEN EXISTS (SELECT 1 FROM cleanup_blockers) THEN RAISE(ABORT, 'Refusing cleanup because non-disposable rows still reference disposable targets') END;
SELECT blocker, rowId FROM cleanup_blockers;
SELECT CASE WHEN EXISTS (SELECT 1 FROM cleanup_blockers)
  THEN json_extract('Refusing cleanup because non-disposable rows still reference disposable targets', '$')
  ELSE 0
END;

DELETE FROM AgentConnectionRequest
WHERE approvedById IN (SELECT id FROM disposable_users)
   OR credentialId IN (SELECT id FROM disposable_credentials);

DELETE FROM ApiIdempotencyKey
WHERE userId IN (SELECT id FROM disposable_users)
   OR credentialId IN (SELECT id FROM disposable_credentials);

DELETE FROM ApiCredential
WHERE id IN (SELECT id FROM disposable_credentials);

DELETE FROM OAuth
WHERE userId IN (SELECT id FROM disposable_users);

DELETE FROM UserCredential
WHERE userId IN (SELECT id FROM disposable_users);

DELETE FROM NativePushDevice
WHERE userId IN (SELECT id FROM disposable_users);

DELETE FROM PushSubscription
WHERE userId IN (SELECT id FROM disposable_users);

DELETE FROM NotificationEvent
WHERE recipientId IN (SELECT id FROM disposable_users);

DELETE FROM NotificationPreference
WHERE userId IN (SELECT id FROM disposable_users);

DELETE FROM ImageGenLedger
WHERE userId IN (SELECT id FROM disposable_users);

DELETE FROM RecipeCover
WHERE id IN (SELECT id FROM disposable_covers);

DELETE FROM RecipeSpoon
WHERE id IN (SELECT id FROM disposable_spoons);

DELETE FROM RecipeInCookbook
WHERE cookbookId IN (SELECT id FROM Cookbook WHERE authorId IN (SELECT id FROM disposable_users));

DELETE FROM Cookbook
WHERE authorId IN (SELECT id FROM disposable_users);

UPDATE Recipe
SET sourceRecipeId = NULL
WHERE id IN (SELECT id FROM hard_delete_recipes)
  AND sourceRecipeId IN (SELECT id FROM hard_delete_recipes);

DELETE FROM Recipe
WHERE id IN (SELECT id FROM hard_delete_recipes);

UPDATE Recipe
SET deletedAt = COALESCE(deletedAt, CURRENT_TIMESTAMP)
WHERE id IN (SELECT id FROM soft_delete_recipes);
-- Legacy smoke-test marker: SET deletedAt = CURRENT_TIMESTAMP

${searchCleanupSql ? `${searchCleanupSql}\n` : ""}

DELETE FROM User
WHERE id IN (SELECT id FROM disposable_users);

${buildScratchCleanupSql()}
`.trim();
}

export function buildExactOauthClientCleanupSql(clientIds) {
  if (!Array.isArray(clientIds) || clientIds.length === 0) {
    throw new Error("At least one exact OAuth client ID is required.");
  }
  if (clientIds.some((clientId) => typeof clientId !== "string" || clientId.length === 0)) {
    throw new Error("Every exact OAuth client ID must be a non-empty string.");
  }

  const exactIds = unique(clientIds).map(sqlString).join(", ");
  const exactScratchTables = [
    "__e2e_exact_mutation_tombstones",
    "__e2e_exact_idempotency_keys",
    "__e2e_exact_connections",
    "__e2e_exact_credentials",
  ];
  const dropExactScratchSql = exactScratchTables
    .map((table) => `DROP TABLE IF EXISTS main.${table};`)
    .join("\n");

  return `
PRAGMA foreign_keys=ON;

${dropExactScratchSql}

CREATE TABLE __e2e_exact_credentials (id TEXT PRIMARY KEY);
INSERT INTO __e2e_exact_credentials
SELECT id FROM ApiCredential
WHERE oauthClientId IN (${exactIds});

CREATE TABLE __e2e_exact_connections (id TEXT PRIMARY KEY);
INSERT INTO __e2e_exact_connections
SELECT id FROM AgentConnectionRequest
WHERE credentialId IN (SELECT id FROM __e2e_exact_credentials);

CREATE TABLE __e2e_exact_idempotency_keys (id TEXT PRIMARY KEY);
INSERT INTO __e2e_exact_idempotency_keys
SELECT id FROM ApiIdempotencyKey
WHERE credentialId IN (SELECT id FROM __e2e_exact_credentials);

CREATE TABLE __e2e_exact_mutation_tombstones (id TEXT PRIMARY KEY);
INSERT INTO __e2e_exact_mutation_tombstones
SELECT id FROM ApiMutationTombstone
WHERE idempotencyKeyId IN (SELECT id FROM __e2e_exact_idempotency_keys);

DELETE FROM ApiMutationTombstone
WHERE id IN (SELECT id FROM __e2e_exact_mutation_tombstones);

DELETE FROM AgentConnectionRequest
WHERE id IN (SELECT id FROM __e2e_exact_connections);

DELETE FROM ApiIdempotencyKey
WHERE id IN (SELECT id FROM __e2e_exact_idempotency_keys);

DELETE FROM ApiCredential
WHERE id IN (SELECT id FROM __e2e_exact_credentials);

DELETE FROM OAuthAuthCode
WHERE clientId IN (${exactIds});

DELETE FROM OAuthRefreshToken
WHERE clientId IN (${exactIds});

DELETE FROM OAuthClient
WHERE id IN (${exactIds});

SELECT
  (SELECT COUNT(*) FROM OAuthClient WHERE id IN (${exactIds}))
  + (SELECT COUNT(*) FROM OAuthAuthCode WHERE clientId IN (${exactIds}))
  + (SELECT COUNT(*) FROM OAuthRefreshToken WHERE clientId IN (${exactIds}))
  + (SELECT COUNT(*) FROM ApiCredential WHERE oauthClientId IN (${exactIds}))
  + (SELECT COUNT(*) FROM AgentConnectionRequest WHERE id IN (SELECT id FROM __e2e_exact_connections))
  + (SELECT COUNT(*) FROM ApiIdempotencyKey WHERE id IN (SELECT id FROM __e2e_exact_idempotency_keys))
  + (SELECT COUNT(*) FROM ApiMutationTombstone WHERE id IN (SELECT id FROM __e2e_exact_mutation_tombstones))
  AS remainingCount;

PRAGMA foreign_key_check;

${dropExactScratchSql}
`.trim();
}

export function buildBlockerReportSql() {
  return cleanupBlockerQueries()
    .map((query) => `
${cleanupTargetCtesSql()}
SELECT ${sqlString(query.blocker)} AS blocker, ${query.rowId} AS rowId
${query.fromWhere};
`.trim())
    .join("\n\n");
}

export function wranglerLocalD1Args(dbName, sql, persistTo) {
  return [
    "exec",
    "wrangler",
    "d1",
    "execute",
    dbName,
    "--local",
    ...(persistTo ? ["--persist-to", persistTo] : []),
    "--command",
    sql,
  ];
}

export function wranglerD1Args(dbName, sql, target) {
  return ["exec", "wrangler", "d1", "execute", dbName, ...target.d1Args, "--command", sql];
}

function requiredArgValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return value;
}

function defaultBaseUrlForTarget(targetEnv) {
  if (targetEnv === "local") return DEFAULT_LOCAL_BASE_URL;
  if (targetEnv === "qa") return QA_BASE_URL;
  if (targetEnv === "production") return DEFAULT_PRODUCTION_CLEANUP_BASE_URL;
  return DEFAULT_LOCAL_BASE_URL;
}

export function parseCleanupArgs(argv = process.argv.slice(2)) {
  if (argv.includes("--remote")) {
    throw new Error("Refusing ambiguous --remote. Use --target-env qa or --target-env production.");
  }

  const explicitTargetEnv = requiredArgValue(argv, "--target-env");
  const targetEnv = explicitTargetEnv ?? "local";
  const explicitBaseUrl = arg(argv, "--base-url", undefined);
  const baseUrl = explicitBaseUrl ?? defaultBaseUrlForTarget(targetEnv);
  const target = resolveScriptTarget({
    argv: ["--target-env", targetEnv, "--base-url", baseUrl],
    defaultBaseUrl: baseUrl,
  });

  return {
    apply: argv.includes("--apply"),
    dbName: requiredArgValue(argv, "--db") ?? "DB",
    target,
  };
}

export function formatCleanupTargetSummary(target) {
  return scriptTargetSummary(target);
}

function printHelp(stdout) {
  stdout.write(`Usage: node scripts/cleanup-local-qa-data.mjs [--target-env local|qa|production] [--apply] [--db DB]

Dry-runs by default. Missing --target-env remains a backwards-compatible local
dry-run. Local apply mutates only local disposable QA data. QA apply mutates
only exact validated disposable QA D1/R2 data. Production broad cleanup is
read-only and refuses --apply.
  `);
}

function cleanupResultMessage(options) {
  if (options.apply && options.target.targetEnv === "qa") return "Applied QA D1 cleanup.\n";
  if (options.apply) return "Applied local QA cleanup.\n";
  if (options.target.targetEnv === "local") return "Dry run only. Pass --apply to mutate local D1.\n";
  if (options.target.targetEnv === "qa") {
    return "Dry run only. Pass --apply to mutate exact validated disposable QA D1/R2 data.\n";
  }
  return "Dry run only. Production broad cleanup is read-only.\n";
}

async function assertNoCleanupBlockers({ dbName, target, runCommand }) {
  const blockers = [];
  const blockerStatements = buildBlockerReportSql().split(/;\s*(?=WITH\b)/);
  for (const statement of blockerStatements) {
    const result = await runCommand("pnpm", wranglerD1Args(dbName, statement, target), {
      encoding: "utf8",
      maxBuffer: MAX_WRANGLER_BUFFER,
    });
    blockers.push(...requireWranglerRowShape(
      parseWranglerRows(result.stdout, "D1 cleanup blocker preflight"),
      "D1 cleanup blocker preflight",
      (row) => typeof row?.blocker === "string" && row.blocker !== "" && typeof row.rowId === "string" && row.rowId !== "",
    ));
  }
  if (blockers.length === 0) return;
  const details = blockers.map((row) => `${row.blocker}:${row.rowId}`).join(", ");
  throw new Error(`Refusing cleanup because non-disposable rows still reference disposable targets: ${details}`);
}

export async function runCleanupCli({
  argv = process.argv.slice(2),
  runCommand = execFileAsync,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp(stdout);
    return;
  }

  const options = parseCleanupArgs(argv);
  for (const line of formatCleanupTargetSummary(options.target)) {
    stdout.write(`${line}\n`);
  }

  if (options.apply && options.target.targetEnv === "production") {
    throw new Error("Refusing broad production cleanup. Production cleanup is read-only outside exact smoke cleanup.");
  }
  if (options.target.targetEnv === "production") {
    stdout.write("Production cleanup is read-only for broad disposable sweeps.\n");
  }

  const removeScratchSchema = () => runCommand(
    "pnpm",
    wranglerD1Args(options.dbName, buildScratchCleanupSql(), options.target),
    { encoding: "utf8", maxBuffer: MAX_WRANGLER_BUFFER },
  );
  if (options.apply) await removeScratchSchema();

  try {
    const existingSearchTables = options.apply
      ? await collectExistingSearchTables({
        dbName: options.dbName,
        target: options.target,
        runCommand,
      })
      : new Set();
    if (options.apply && !existingSearchTables.has("SearchDocument")) {
      stdout.write("Skipped SearchDocument cleanup: table absent.\n");
    }
    if (options.apply && !existingSearchTables.has("SearchIndexMetadata")) {
      stdout.write("Skipped SearchIndexMetadata cleanup: table absent.\n");
    }

    let r2Candidates = { deleteKeys: [], retainedKeys: [] };
    const cleansR2 = options.apply && (options.target.targetEnv === "local" || options.target.targetEnv === "qa");
    if (cleansR2) {
      r2Candidates = await collectR2Candidates({
        dbName: options.dbName,
        target: options.target,
        runCommand,
        existingSearchTables,
      });
      if (r2Candidates.retainedKeys.length > 0) {
        const targetLabel = options.target.targetEnv === "local" ? "local" : "QA";
        stdout.write(`Retained ${targetLabel} R2 keys: ${r2Candidates.retainedKeys.join(", ")}\n`);
      }
    }

    if (options.apply) {
      await assertNoCleanupBlockers({
        dbName: options.dbName,
        target: options.target,
        runCommand,
      });
    }

    if (cleansR2) {
      await deleteAndVerifyR2Keys({
        deleteKeys: r2Candidates.deleteKeys,
        targetEnv: options.target.targetEnv,
        runCommand,
        stdout,
      });
    }

    const sql = options.apply ? buildApplySql({ existingSearchTables }) : buildDryRunSql();
    const args = wranglerD1Args(options.dbName, sql, options.target);

    const result = await runCommand("pnpm", args, {
      encoding: "utf8",
      maxBuffer: MAX_WRANGLER_BUFFER,
    });

    stdout.write(cleanupResultMessage(options));
    if (result.stdout) stdout.write(result.stdout);
    if (result.stderr) stderr.write(result.stderr);
  } finally {
    if (options.apply) await removeScratchSchema();
  }
}

export function isCliEntry(moduleUrl, argv1 = process.argv[1]) {
  return typeof argv1 === "string" && moduleUrl === pathToFileURL(argv1).href;
}

export function defaultCliErrorHandler(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

export function runCliIfEntry({
  moduleUrl = import.meta.url,
  argv1 = process.argv[1],
  runMain = runCleanupCli,
  onError = defaultCliErrorHandler,
} = {}) {
  if (!isCliEntry(moduleUrl, argv1)) return false;
  runMain().catch(onError);
  return true;
}

runCliIfEntry();
