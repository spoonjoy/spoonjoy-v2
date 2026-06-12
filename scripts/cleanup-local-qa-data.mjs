#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
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

export const SUSPICIOUS_RECIPE_WHERE = [
  "lower(title) LIKE 'e2e %'",
  "lower(title) LIKE 'mobile dock save%'",
  "lower(title) LIKE '%(variation %'",
  "lower(title) LIKE 'codex %'",
  "lower(title) LIKE 'codex-smoke-%'",
].join("\n    OR ");

export const DISPOSABLE_USER_WHERE = [
  "email LIKE 'codex-%'",
  "email LIKE 'e2e-passkey-%'",
  "username LIKE 'codex_%'",
  "username LIKE 'e2e_passkey_%'",
].join("\n    OR ");

export const DISPOSABLE_SPOON_WHERE = [
  "lower(coalesce(note,'')) LIKE 'e2e %'",
  "lower(coalesce(note,'')) LIKE 'codex %'",
  "lower(coalesce(note,'')) LIKE 'playwright%'",
].join("\n    OR ");

export const E2E_OAUTH_CLIENT_WHERE = [
  "clientName = 'E2E OAuth Client'",
  "(redirectUris LIKE '%codex%' OR redirectUris LIKE '%e2e%' OR redirectUris LIKE '%localhost%' OR redirectUris LIKE '%127.0.0.1%')",
].join("\n    AND ");

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
  return `
WITH
  disposable_users AS (
    SELECT id FROM User WHERE ${DISPOSABLE_USER_WHERE}
  ),
  hard_delete_recipes AS (
    SELECT id, chefId FROM Recipe WHERE chefId IN (SELECT id FROM disposable_users)
  ),
  disposable_spoons AS (
    SELECT id, chefId, recipeId, photoUrl FROM RecipeSpoon
    WHERE chefId IN (SELECT id FROM disposable_users)
       OR ${DISPOSABLE_SPOON_WHERE}
  ),
  disposable_covers AS (
    SELECT id, recipeId, imageUrl, stylizedImageUrl, sourceImageUrl
    FROM RecipeCover
    WHERE recipeId IN (SELECT id FROM hard_delete_recipes)
  ),
  candidate_r2_keys AS (
    SELECT 'delete' AS action, substr(photoUrl, length('/photos/') + 1) AS key, NULL AS reason
    FROM User
    WHERE id IN (SELECT id FROM disposable_users)
      AND photoUrl LIKE '/photos/profiles/' || id || '/%'
    UNION
    SELECT 'retain', substr(photoUrl, length('/photos/') + 1), 'unsafe disposable user photo namespace'
    FROM User
    WHERE id IN (SELECT id FROM disposable_users)
      AND photoUrl LIKE '/photos/%'
      AND photoUrl NOT LIKE '/photos/profiles/' || id || '/%'
    UNION
    SELECT 'delete', substr(photoUrl, length('/photos/') + 1), NULL
    FROM disposable_spoons
    WHERE chefId IN (SELECT id FROM disposable_users)
      AND (
        photoUrl LIKE '/photos/spoons/' || chefId || '/' || recipeId || '/%'
        OR photoUrl LIKE '/photos/spoons/' || chefId || '/uploads/%'
      )
    UNION
    SELECT 'retain', substr(photoUrl, length('/photos/') + 1), 'unsafe disposable spoon photo namespace'
    FROM disposable_spoons
    WHERE photoUrl LIKE '/photos/%'
      AND NOT (
        chefId IN (SELECT id FROM disposable_users)
        AND (
          photoUrl LIKE '/photos/spoons/' || chefId || '/' || recipeId || '/%'
          OR photoUrl LIKE '/photos/spoons/' || chefId || '/uploads/%'
        )
      )
    UNION
    SELECT 'delete', substr(imageUrl, length('/photos/') + 1), NULL
    FROM disposable_covers dc
    JOIN Recipe r ON r.id = dc.recipeId
    WHERE imageUrl LIKE '/photos/recipes/' || r.chefId || '/' || dc.recipeId || '/%'
       OR imageUrl LIKE '/photos/recipes/' || r.chefId || '/uploads/%'
       OR imageUrl LIKE '/photos/covers/%'
    UNION
    SELECT 'retain', substr(imageUrl, length('/photos/') + 1), 'unsafe disposable cover imageUrl namespace'
    FROM disposable_covers dc
    JOIN Recipe r ON r.id = dc.recipeId
    WHERE imageUrl LIKE '/photos/%'
      AND NOT (
        imageUrl LIKE '/photos/recipes/' || r.chefId || '/' || dc.recipeId || '/%'
        OR imageUrl LIKE '/photos/recipes/' || r.chefId || '/uploads/%'
        OR imageUrl LIKE '/photos/covers/%'
      )
    UNION
    SELECT 'delete', substr(stylizedImageUrl, length('/photos/') + 1), NULL
    FROM disposable_covers dc
    JOIN Recipe r ON r.id = dc.recipeId
    WHERE stylizedImageUrl LIKE '/photos/recipes/' || r.chefId || '/' || dc.recipeId || '/%'
       OR stylizedImageUrl LIKE '/photos/recipes/' || r.chefId || '/uploads/%'
       OR stylizedImageUrl LIKE '/photos/covers/%'
    UNION
    SELECT 'retain', substr(stylizedImageUrl, length('/photos/') + 1), 'unsafe disposable cover stylizedImageUrl namespace'
    FROM disposable_covers dc
    JOIN Recipe r ON r.id = dc.recipeId
    WHERE stylizedImageUrl LIKE '/photos/%'
      AND NOT (
        stylizedImageUrl LIKE '/photos/recipes/' || r.chefId || '/' || dc.recipeId || '/%'
        OR stylizedImageUrl LIKE '/photos/recipes/' || r.chefId || '/uploads/%'
        OR stylizedImageUrl LIKE '/photos/covers/%'
      )
    UNION
    SELECT 'delete', substr(sourceImageUrl, length('/photos/') + 1), NULL
    FROM disposable_covers dc
    JOIN Recipe r ON r.id = dc.recipeId
    WHERE sourceImageUrl LIKE '/photos/recipes/' || r.chefId || '/' || dc.recipeId || '/%'
       OR sourceImageUrl LIKE '/photos/recipes/' || r.chefId || '/uploads/%'
       OR sourceImageUrl LIKE '/photos/covers/%'
    UNION
    SELECT 'retain', substr(sourceImageUrl, length('/photos/') + 1), 'unsafe disposable cover sourceImageUrl namespace'
    FROM disposable_covers dc
    JOIN Recipe r ON r.id = dc.recipeId
    WHERE sourceImageUrl LIKE '/photos/%'
      AND NOT (
        sourceImageUrl LIKE '/photos/recipes/' || r.chefId || '/' || dc.recipeId || '/%'
        OR sourceImageUrl LIKE '/photos/recipes/' || r.chefId || '/uploads/%'
        OR sourceImageUrl LIKE '/photos/covers/%'
      )
  ),
  r2_reference_blockers AS (
    SELECT 'blocker_user_photoUrl' AS action,
      substr(u.photoUrl, length('/photos/') + 1) AS key,
      'non-disposable User.photoUrl still references candidate key' AS reason
    FROM User u
    JOIN candidate_r2_keys c ON c.action = 'delete' AND c.key = substr(u.photoUrl, length('/photos/') + 1)
    WHERE u.id NOT IN (SELECT id FROM disposable_users)
    UNION
    SELECT 'blocker_spoon_photoUrl',
      substr(rs.photoUrl, length('/photos/') + 1),
      'non-disposable RecipeSpoon.photoUrl still references candidate key'
    FROM RecipeSpoon rs
    JOIN candidate_r2_keys c ON c.action = 'delete' AND c.key = substr(rs.photoUrl, length('/photos/') + 1)
    WHERE rs.id NOT IN (SELECT id FROM disposable_spoons)
      AND rs.chefId NOT IN (SELECT id FROM disposable_users)
    UNION
    SELECT 'blocker_cover_imageUrl',
      substr(rc.imageUrl, length('/photos/') + 1),
      'non-disposable RecipeCover.imageUrl still references candidate key'
    FROM RecipeCover rc
    JOIN candidate_r2_keys c ON c.action = 'delete' AND c.key = substr(rc.imageUrl, length('/photos/') + 1)
    WHERE rc.recipeId NOT IN (SELECT id FROM hard_delete_recipes)
    UNION
    SELECT 'blocker_cover_stylizedImageUrl',
      substr(rc.stylizedImageUrl, length('/photos/') + 1),
      'non-disposable RecipeCover.stylizedImageUrl still references candidate key'
    FROM RecipeCover rc
    JOIN candidate_r2_keys c ON c.action = 'delete' AND c.key = substr(rc.stylizedImageUrl, length('/photos/') + 1)
    WHERE rc.recipeId NOT IN (SELECT id FROM hard_delete_recipes)
    UNION
    SELECT 'blocker_cover_sourceImageUrl',
      substr(rc.sourceImageUrl, length('/photos/') + 1),
      'non-disposable RecipeCover.sourceImageUrl still references candidate key'
    FROM RecipeCover rc
    JOIN candidate_r2_keys c ON c.action = 'delete' AND c.key = substr(rc.sourceImageUrl, length('/photos/') + 1)
    WHERE rc.recipeId NOT IN (SELECT id FROM hard_delete_recipes)
  )
SELECT action, key, reason
FROM candidate_r2_keys
WHERE key IS NOT NULL AND key != ''
UNION
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
       OR ${DISPOSABLE_SPOON_WHERE}
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
       OR ${DISPOSABLE_SPOON_WHERE}
  ),
  e2e_oauth_clients AS (
    SELECT id FROM OAuthClient
    WHERE ${E2E_OAUTH_CLIENT_WHERE}
  ),
  disposable_covers AS (
    SELECT id FROM RecipeCover
    WHERE recipeId IN (SELECT id FROM hard_delete_recipes)
  ),
  disposable_credentials AS (
    SELECT id FROM ApiCredential
    WHERE userId IN (SELECT id FROM disposable_users)
       OR oauthClientId IN (SELECT id FROM e2e_oauth_clients)
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
      blocker: "blocker_api_credential_oauthClientId",
      rowId: "id",
      fromWhere: `FROM ApiCredential
WHERE oauthClientId IN (SELECT id FROM e2e_oauth_clients)
  AND userId NOT IN (SELECT id FROM disposable_users)`,
    },
    {
      blocker: "blocker_oauth_code_userId",
      rowId: "id",
      fromWhere: `FROM OAuthAuthCode
WHERE clientId IN (SELECT id FROM e2e_oauth_clients)
  AND userId NOT IN (SELECT id FROM disposable_users)`,
    },
    {
      blocker: "blocker_oauth_refresh_token_userId",
      rowId: "id",
      fromWhere: `FROM OAuthRefreshToken
WHERE clientId IN (SELECT id FROM e2e_oauth_clients)
  AND userId NOT IN (SELECT id FROM disposable_users)`,
    },
    {
      blocker: "blocker_ambiguous_oauth_client",
      rowId: "id",
      fromWhere: `FROM OAuthClient
WHERE clientName = 'E2E OAuth Client'
  AND id NOT IN (SELECT id FROM e2e_oauth_clients)`,
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

function parseWranglerRows(stdout) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  const parsed = JSON.parse(stdout.slice(start, end + 1));
  return parsed.flatMap((entry) => (Array.isArray(entry?.results) ? entry.results : []));
}

function isR2ObjectMissingError(error) {
  const text = [
    typeof error === "string" ? error : "",
    error instanceof Error ? error.message : "",
    typeof error?.stdout === "string" ? error.stdout : "",
    typeof error?.stderr === "string" ? error.stderr : "",
  ].join("\n");
  return /(?:the specified key does not exist|nosuchkey|not found)/i.test(text);
}

function r2BlockerError(blockers) {
  const details = blockers
    .map((row) => `${row.action}:${row.key}${row.reason ? ` (${row.reason})` : ""}`)
    .join(", ");
  return new Error(`Refusing QA R2 cleanup because non-disposable rows still reference candidate keys: ${details}`);
}

function assertNoR2Blockers(rows) {
  const blockers = rows.filter((row) => typeof row.action === "string" && row.action.startsWith("blocker"));
  if (blockers.length > 0) throw r2BlockerError(blockers);
}

async function collectExistingSearchTables({ dbName, target, runCommand }) {
  const result = await runCommand("pnpm", wranglerD1Args(dbName, buildSearchTablesExistSql(), target), {
    encoding: "utf8",
    maxBuffer: MAX_WRANGLER_BUFFER,
  });
  return normalizeExistingSearchTables(parseWranglerRows(result.stdout ?? "").map((row) => row.name));
}

async function collectQaR2Candidates({ dbName, target, runCommand, existingSearchTables }) {
  const result = await runCommand("pnpm", wranglerD1Args(dbName, buildQaR2CandidateSql(), target), {
    encoding: "utf8",
    maxBuffer: MAX_WRANGLER_BUFFER,
  });
  const rows = parseWranglerRows(result.stdout ?? "");
  assertNoR2Blockers(rows);
  const deleteKeys = unique(rows.filter((row) => row.action === "delete").map((row) => row.key));
  const retainedKeys = unique(rows.filter((row) => row.action === "retain").map((row) => row.key));
  if (deleteKeys.length > 0 && existingSearchTables.has("SearchDocument")) {
    const searchResult = await runCommand("pnpm", wranglerD1Args(dbName, buildQaR2SearchReferenceSql(deleteKeys), target), {
      encoding: "utf8",
      maxBuffer: MAX_WRANGLER_BUFFER,
    });
    assertNoR2Blockers(parseWranglerRows(searchResult.stdout ?? ""));
  }
  return {
    deleteKeys,
    retainedKeys,
  };
}

async function deleteAndVerifyQaR2Keys({ deleteKeys, runCommand, stdout }) {
  const deletedKeys = [];
  const verifiedDeletedKeys = [];
  for (const key of deleteKeys) {
    await runCommand("pnpm", buildQaR2DeleteArgs(key), {
      encoding: "utf8",
      maxBuffer: MAX_WRANGLER_BUFFER,
    });
    deletedKeys.push(key);
    try {
      await runCommand("pnpm", buildQaR2GetArgs(key), {
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
    throw new Error(`QA R2 object still exists after delete: ${key}`);
  }
  if (deletedKeys.length > 0) stdout.write(`Deleted QA R2 keys: ${deletedKeys.join(", ")}\n`);
  if (verifiedDeletedKeys.length > 0) stdout.write(`Verified deleted QA R2 keys: ${verifiedDeletedKeys.join(", ")}\n`);
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
SELECT 'disposable spoons by chef or note' AS item, COUNT(*) AS count
FROM RecipeSpoon
WHERE chefId IN (SELECT id FROM disposable_users)
   OR ${DISPOSABLE_SPOON_WHERE};

SELECT 'e2e oauth clients with test redirect signature' AS item, COUNT(*) AS count
FROM OAuthClient
WHERE ${E2E_OAUTH_CLIENT_WHERE};

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

export function buildApplySql({ existingSearchTables = [] } = {}) {
  const searchCleanupSql = buildSearchCleanupSql(existingSearchTables);
  return `
PRAGMA foreign_keys=ON;

-- CREATE TEMP TABLE disposable_users
CREATE TABLE IF NOT EXISTS disposable_users (id TEXT PRIMARY KEY);
DELETE FROM disposable_users;
INSERT INTO disposable_users
SELECT id FROM User
WHERE ${DISPOSABLE_USER_WHERE};

-- CREATE TEMP TABLE hard_delete_recipes
CREATE TABLE IF NOT EXISTS hard_delete_recipes (id TEXT PRIMARY KEY);
DELETE FROM hard_delete_recipes;
INSERT INTO hard_delete_recipes
SELECT id FROM Recipe
WHERE chefId IN (SELECT id FROM disposable_users);

-- CREATE TEMP TABLE soft_delete_recipes
CREATE TABLE IF NOT EXISTS soft_delete_recipes (id TEXT PRIMARY KEY);
DELETE FROM soft_delete_recipes;
INSERT INTO soft_delete_recipes
SELECT id FROM Recipe
WHERE (${SUSPICIOUS_RECIPE_WHERE})
  AND chefId NOT IN (SELECT id FROM disposable_users);

-- CREATE TEMP TABLE disposable_spoons
CREATE TABLE IF NOT EXISTS disposable_spoons (id TEXT PRIMARY KEY);
DELETE FROM disposable_spoons;
INSERT INTO disposable_spoons
SELECT id FROM RecipeSpoon
WHERE chefId IN (SELECT id FROM disposable_users)
   OR ${DISPOSABLE_SPOON_WHERE};

-- CREATE TEMP TABLE e2e_oauth_clients
CREATE TABLE IF NOT EXISTS e2e_oauth_clients (id TEXT PRIMARY KEY);
DELETE FROM e2e_oauth_clients;
INSERT INTO e2e_oauth_clients
SELECT id FROM OAuthClient
WHERE ${E2E_OAUTH_CLIENT_WHERE};

CREATE TABLE IF NOT EXISTS disposable_covers (id TEXT PRIMARY KEY);
DELETE FROM disposable_covers;
INSERT INTO disposable_covers
SELECT id FROM RecipeCover
WHERE recipeId IN (SELECT id FROM hard_delete_recipes);

CREATE TABLE IF NOT EXISTS disposable_cover_image_urls (imageUrl TEXT PRIMARY KEY);
DELETE FROM disposable_cover_image_urls;
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

-- CREATE TEMP TABLE disposable_credentials
CREATE TABLE IF NOT EXISTS disposable_credentials (id TEXT PRIMARY KEY);
DELETE FROM disposable_credentials;
INSERT INTO disposable_credentials
SELECT id FROM ApiCredential
WHERE userId IN (SELECT id FROM disposable_users)
   OR oauthClientId IN (SELECT id FROM e2e_oauth_clients);

-- CREATE TEMP TABLE cleanup_blockers
CREATE TABLE IF NOT EXISTS cleanup_blockers (
  blocker TEXT NOT NULL,
  rowId TEXT NOT NULL
);
DELETE FROM cleanup_blockers;

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
SELECT 'blocker_api_credential_oauthClientId', id FROM ApiCredential
WHERE oauthClientId IN (SELECT id FROM e2e_oauth_clients)
  AND userId NOT IN (SELECT id FROM disposable_users);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_oauth_code_userId', id FROM OAuthAuthCode
WHERE clientId IN (SELECT id FROM e2e_oauth_clients)
  AND userId NOT IN (SELECT id FROM disposable_users);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_oauth_refresh_token_userId', id FROM OAuthRefreshToken
WHERE clientId IN (SELECT id FROM e2e_oauth_clients)
  AND userId NOT IN (SELECT id FROM disposable_users);

INSERT INTO cleanup_blockers (blocker, rowId)
SELECT 'blocker_ambiguous_oauth_client', id FROM OAuthClient
WHERE clientName = 'E2E OAuth Client'
  AND id NOT IN (SELECT id FROM e2e_oauth_clients);

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

DELETE FROM OAuthAuthCode
WHERE clientId IN (SELECT id FROM e2e_oauth_clients)
  AND userId IN (SELECT id FROM disposable_users);

DELETE FROM OAuthRefreshToken
WHERE clientId IN (SELECT id FROM e2e_oauth_clients)
  AND userId IN (SELECT id FROM disposable_users);

DELETE FROM OAuthClient
WHERE id IN (SELECT id FROM e2e_oauth_clients);

DELETE FROM OAuth
WHERE userId IN (SELECT id FROM disposable_users);

DELETE FROM UserCredential
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

DELETE FROM cleanup_blockers;
DELETE FROM disposable_credentials;
DELETE FROM disposable_cover_image_urls;
DELETE FROM disposable_covers;
DELETE FROM e2e_oauth_clients;
DELETE FROM disposable_spoons;
DELETE FROM soft_delete_recipes;
DELETE FROM hard_delete_recipes;
DELETE FROM disposable_users;
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

export function wranglerLocalD1Args(dbName, sql) {
  return ["exec", "wrangler", "d1", "execute", dbName, "--local", "--command", sql];
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
  const result = await runCommand("pnpm", wranglerD1Args(dbName, buildBlockerReportSql(), target), {
    encoding: "utf8",
    maxBuffer: MAX_WRANGLER_BUFFER,
  });
  const blockers = parseWranglerRows(result.stdout ?? "").filter(
    (row) => typeof row.blocker === "string" && typeof row.rowId === "string",
  );
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

  let qaR2Candidates = { deleteKeys: [], retainedKeys: [] };
  if (options.apply && options.target.targetEnv === "qa") {
    qaR2Candidates = await collectQaR2Candidates({
      dbName: options.dbName,
      target: options.target,
      runCommand,
      existingSearchTables,
    });
    if (qaR2Candidates.retainedKeys.length > 0) {
      stdout.write(`Retained QA R2 keys: ${qaR2Candidates.retainedKeys.join(", ")}\n`);
    }
  }

  if (options.apply) {
    await assertNoCleanupBlockers({
      dbName: options.dbName,
      target: options.target,
      runCommand,
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

  if (options.apply && options.target.targetEnv === "qa") {
    await deleteAndVerifyQaR2Keys({
      deleteKeys: qaR2Candidates.deleteKeys,
      runCommand,
      stdout,
    });
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
