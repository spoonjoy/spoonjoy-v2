import { createHash } from "node:crypto";

function text(value) {
  return value === undefined ? null : value;
}

function compareIds(left, right) {
  return String(left.id).localeCompare(String(right.id));
}

function connectionReference(connectionKey) {
  return createHash("sha256").update(connectionKey).digest("hex");
}

function deterministicGrantId(connectionKey) {
  return `ogb_${createHash("sha256").update(`spoonjoy-oauth-grant-backfill-v1\0${connectionKey}`).digest("hex")}`;
}

function canonicalScope(value) {
  return [...new Set(String(value).trim().split(/\s+/).filter(Boolean))].sort().join(" ");
}

function identityFromRefresh(row) {
  return {
    userId: row.userId,
    clientId: row.clientId,
    issuer: text(row.issuer),
    scope: canonicalScope(row.scope),
    resource: text(row.resource),
  };
}

function identityFromAccess(row) {
  return {
    userId: row.userId,
    clientId: row.oauthClientId,
    issuer: text(row.oauthIssuer),
    scope: canonicalScope(row.scopes),
    resource: text(row.oauthResource),
  };
}

function identityFromGrant(row) {
  return {
    userId: row.userId,
    clientId: row.clientId,
    issuer: text(row.issuer),
    scope: canonicalScope(row.scope),
    resource: text(row.resource),
  };
}

function sameIdentity(left, right) {
  return left.userId === right.userId
    && left.clientId === right.clientId
    && left.issuer === right.issuer
    && left.scope === right.scope
    && left.resource === right.resource;
}

function issue(connectionKey, reason, rows) {
  return {
    connectionRef: connectionReference(connectionKey).slice(0, 16),
    reason,
    refreshCount: rows.refreshTokens.length,
    accessCount: rows.accessCredentials.length,
  };
}

function linkedToAnotherGrant(rows, grantId) {
  return rows.refreshTokens.some((row) => row.grantId !== null && row.grantId !== grantId)
    || rows.accessCredentials.some((row) => row.oauthGrantId !== null && row.oauthGrantId !== grantId);
}

export function planOAuthGrantBackfill(input) {
  const clients = new Map(input.clients.map((row) => [row.id, row]));
  const users = new Set(input.users.map((row) => row.id));
  const existingByKey = new Map(input.existingGrants.map((row) => [row.connectionKey, row]));
  const groups = new Map();
  const missingKeyIssues = [];

  const groupFor = (connectionKey) => {
    let group = groups.get(connectionKey);
    if (!group) {
      group = { refreshTokens: [], accessCredentials: [] };
      groups.set(connectionKey, group);
    }
    return group;
  };

  for (const row of input.refreshTokens) {
    if (!row.connectionKey) {
      missingKeyIssues.push({ connectionRef: null, reason: "missing_connection_key", refreshCount: 1, accessCount: 0 });
    } else {
      groupFor(row.connectionKey).refreshTokens.push(row);
    }
  }
  for (const row of input.accessCredentials) {
    if (!row.oauthConnectionKey) {
      missingKeyIssues.push({ connectionRef: null, reason: "missing_connection_key", refreshCount: 0, accessCount: 1 });
    } else {
      groupFor(row.oauthConnectionKey).accessCredentials.push(row);
    }
  }

  const grants = [];
  const refreshLinks = [];
  const accessLinks = [];
  const issues = [...missingKeyIssues];

  for (const connectionKey of [...groups.keys()].sort()) {
    const rows = groups.get(connectionKey);
    rows.refreshTokens.sort(compareIds);
    rows.accessCredentials.sort(compareIds);
    if (rows.refreshTokens.length === 0) {
      issues.push(issue(connectionKey, "orphan_access", rows));
      continue;
    }
    if (rows.accessCredentials.length === 0) {
      issues.push(issue(connectionKey, "orphan_refresh", rows));
      continue;
    }

    const identities = [
      ...rows.refreshTokens.map(identityFromRefresh),
      ...rows.accessCredentials.map(identityFromAccess),
    ];
    const identity = identities[0];
    if (identities.some((candidate) => !sameIdentity(candidate, identity))) {
      issues.push(issue(connectionKey, "identity_mismatch", rows));
      continue;
    }
    const client = clients.get(identity.clientId);
    if (!client || client.revokedAt !== null || identity.issuer === null || client.issuer !== identity.issuer) {
      issues.push(issue(connectionKey, "unknown_client", rows));
      continue;
    }
    if (!users.has(identity.userId)) {
      issues.push(issue(connectionKey, "unknown_user", rows));
      continue;
    }
    if (rows.refreshTokens.filter((row) => row.revokedAt === null).length > 1) {
      issues.push(issue(connectionKey, "duplicate_active_refresh", rows));
      continue;
    }
    const activeRefresh = rows.refreshTokens.find((row) => row.revokedAt === null);
    if (!activeRefresh) {
      issues.push(issue(connectionKey, "no_active_refresh", rows));
      continue;
    }

    const existing = existingByKey.get(connectionKey);
    const grantId = existing?.id ?? deterministicGrantId(connectionKey);
    if (existing && (!sameIdentity(identityFromGrant(existing), identity) || existing.status !== "active")) {
      issues.push(issue(connectionKey, "existing_grant_mismatch", rows));
      continue;
    }
    if (linkedToAnotherGrant(rows, grantId)) {
      issues.push(issue(connectionKey, "existing_link_mismatch", rows));
      continue;
    }
    if (!existing && (
      rows.refreshTokens.some((row) => row.grantId !== null)
      || rows.accessCredentials.some((row) => row.oauthGrantId !== null)
    )) {
      issues.push(issue(connectionKey, "existing_link_mismatch", rows));
      continue;
    }

    if (!existing) {
      const createdAt = [...rows.refreshTokens, ...rows.accessCredentials]
        .map((row) => String(row.createdAt))
        .sort()[0];
      grants.push({
        id: grantId,
        ...identity,
        connectionKey,
        status: "active",
        statusReason: null,
        statusChangedAt: String(activeRefresh.createdAt),
        expiresAt: null,
        createdAt,
        updatedAt: String(activeRefresh.createdAt),
      });
    }
    for (const row of rows.refreshTokens) {
      if (row.grantId === null) refreshLinks.push({ id: row.id, grantId, row, grant: existing ?? grants.at(-1) });
    }
    for (const row of rows.accessCredentials) {
      if (row.oauthGrantId === null) accessLinks.push({ id: row.id, grantId, row, grant: existing ?? grants.at(-1) });
    }
  }

  for (const grant of input.existingGrants) {
    if (!groups.has(grant.connectionKey)) {
      issues.push({
        connectionRef: connectionReference(grant.connectionKey).slice(0, 16),
        reason: "orphan_grant",
        refreshCount: 0,
        accessCount: 0,
      });
    }
  }

  const stripSource = ({ row: _row, grant: _grant, ...link }) => link;
  return {
    grants,
    refreshLinks: refreshLinks.map(stripSource),
    accessLinks: accessLinks.map(stripSource),
    issues: issues.sort((left, right) => `${left.connectionRef}:${left.reason}`.localeCompare(`${right.connectionRef}:${right.reason}`)),
    _sourceLinks: { refreshLinks, accessLinks },
  };
}

export function projectOAuthGrantBackfillReport(plan) {
  return {
    schemaVersion: 1,
    summary: {
      grantsToCreate: plan.grants.length,
      refreshLinksToWrite: plan.refreshLinks.length,
      accessLinksToWrite: plan.accessLinks.length,
      ambiguousConnections: plan.issues.length,
    },
    grantRefs: plan.grants.map((grant) => ({
      id: grant.id,
      connectionRef: connectionReference(grant.connectionKey).slice(0, 16),
      refreshLinks: plan.refreshLinks.filter((row) => row.grantId === grant.id).length,
      accessLinks: plan.accessLinks.filter((row) => row.grantId === grant.id).length,
    })),
    issues: plan.issues,
  };
}

export function digestOAuthGrantBackfillPlan(plan) {
  const canonical = {
    grants: plan.grants,
    refreshLinks: plan.refreshLinks,
    accessLinks: plan.accessLinks,
    issues: plan.issues,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function buildOAuthGrantBackfillSnapshotQueries() {
  return {
    users: `SELECT "id" FROM "User" ORDER BY "id";`,
    clients: `SELECT "id", "issuer", "revokedAt" FROM "OAuthClient" ORDER BY "id";`,
    refreshTokens: [
      `SELECT "id", "userId", "clientId", "issuer", "scope", "resource",`,
      `"connectionKey", "revokedAt", "grantId", "createdAt"`,
      `FROM "OAuthRefreshToken" ORDER BY "connectionKey", "id";`,
    ].join(" "),
    accessCredentials: [
      `SELECT "id", "userId", "oauthClientId", "oauthIssuer", "scopes", "oauthResource",`,
      `"oauthConnectionKey", "oauthGrantId", "revokedAt", "expiresAt", "createdAt"`,
      `FROM "ApiCredential" WHERE "oauthClientId" IS NOT NULL ORDER BY "oauthConnectionKey", "id";`,
    ].join(" "),
    existingGrants: [
      `SELECT "id", "userId", "clientId", "issuer", "resource", "scope", "connectionKey",`,
      `"status", "statusReason", "statusChangedAt", "expiresAt", "createdAt", "updatedAt"`,
      `FROM "OAuthGrant" ORDER BY "connectionKey", "id";`,
    ].join(" "),
  };
}

export function validateOAuthGrantBackfillPostApply(before, after) {
  if (JSON.stringify(before.issues) !== JSON.stringify(after.issues)) {
    return { ok: false, reason: "post_apply_issue_drift" };
  }
  if (after.grants.length + after.refreshLinks.length + after.accessLinks.length !== 0) {
    return { ok: false, reason: "post_apply_mutations_remain" };
  }
  return { ok: true };
}

function sql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function nullableEquals(column, value) {
  return value === null || value === undefined ? `${column} IS NULL` : `${column} = ${sql(value)}`;
}

function exactGrantExists(grant) {
  return [
    `EXISTS (SELECT 1 FROM "OAuthGrant" WHERE "id" = ${sql(grant.id)}`,
    `AND "userId" = ${sql(grant.userId)} AND "clientId" = ${sql(grant.clientId)}`,
    `AND "issuer" = ${sql(grant.issuer)} AND ${nullableEquals('"resource"', grant.resource)}`,
    `AND "scope" = ${sql(grant.scope)} AND "connectionKey" = ${sql(grant.connectionKey)} AND "status" = 'active')`,
  ].join(" ");
}

function exactRefreshRowExists(row) {
  return [
    `EXISTS (SELECT 1 FROM "OAuthRefreshToken" WHERE "id" = ${sql(row.id)}`,
    `AND "userId" = ${sql(row.userId)} AND "clientId" = ${sql(row.clientId)}`,
    `AND ${nullableEquals('"issuer"', row.issuer)} AND "scope" = ${sql(row.scope)}`,
    `AND ${nullableEquals('"resource"', row.resource)} AND "connectionKey" = ${sql(row.connectionKey)}`,
    `AND "grantId" IS NULL)`,
  ].join(" ");
}

function exactAccessRowExists(row) {
  return [
    `EXISTS (SELECT 1 FROM "ApiCredential" WHERE "id" = ${sql(row.id)}`,
    `AND "userId" = ${sql(row.userId)} AND "oauthClientId" = ${sql(row.oauthClientId)}`,
    `AND ${nullableEquals('"oauthIssuer"', row.oauthIssuer)} AND "scopes" = ${sql(row.scopes)}`,
    `AND ${nullableEquals('"oauthResource"', row.oauthResource)} AND "oauthConnectionKey" = ${sql(row.oauthConnectionKey)}`,
    `AND "oauthGrantId" IS NULL)`,
  ].join(" ");
}

export function buildOAuthGrantBackfillApplySql(plan) {
  const statements = [];
  for (const grant of plan.grants) {
    const refreshRows = plan._sourceLinks.refreshLinks.filter((link) => link.grantId === grant.id).map((link) => link.row);
    const accessRows = plan._sourceLinks.accessLinks.filter((link) => link.grantId === grant.id).map((link) => link.row);
    statements.push([
      `INSERT INTO "OAuthGrant" ("id", "userId", "clientId", "issuer", "resource", "scope", "connectionKey", "status", "statusReason", "statusChangedAt", "expiresAt", "createdAt", "updatedAt")`,
      `SELECT ${sql(grant.id)}, ${sql(grant.userId)}, ${sql(grant.clientId)}, ${sql(grant.issuer)}, ${sql(grant.resource)}, ${sql(grant.scope)}, ${sql(grant.connectionKey)}, 'active', NULL, ${sql(grant.statusChangedAt)}, NULL, ${sql(grant.createdAt)}, ${sql(grant.updatedAt)}`,
      `WHERE EXISTS (SELECT 1 FROM "User" WHERE "id" = ${sql(grant.userId)})`,
      `AND EXISTS (SELECT 1 FROM "OAuthClient" WHERE "id" = ${sql(grant.clientId)} AND "issuer" = ${sql(grant.issuer)} AND "revokedAt" IS NULL)`,
      `AND (SELECT COUNT(*) FROM "OAuthRefreshToken" WHERE "connectionKey" = ${sql(grant.connectionKey)}) = ${refreshRows.length}`,
      `AND (SELECT COUNT(*) FROM "ApiCredential" WHERE "oauthConnectionKey" = ${sql(grant.connectionKey)}) = ${accessRows.length}`,
      ...refreshRows.map((row) => `AND ${exactRefreshRowExists(row)}`),
      ...accessRows.map((row) => `AND ${exactAccessRowExists(row)}`),
      `AND NOT EXISTS (SELECT 1 FROM "OAuthGrant" WHERE "connectionKey" = ${sql(grant.connectionKey)} OR "id" = ${sql(grant.id)});`,
    ].join(" "));
  }
  for (const link of plan._sourceLinks.refreshLinks) {
    const row = link.row;
    statements.push([
      `UPDATE "OAuthRefreshToken" SET "grantId" = ${sql(link.grantId)}`,
      `WHERE "id" = ${sql(row.id)} AND "grantId" IS NULL`,
      `AND "userId" = ${sql(row.userId)} AND "clientId" = ${sql(row.clientId)}`,
      `AND ${nullableEquals('"issuer"', row.issuer)} AND "scope" = ${sql(row.scope)}`,
      `AND ${nullableEquals('"resource"', row.resource)} AND "connectionKey" = ${sql(row.connectionKey)}`,
      `AND ${exactGrantExists(link.grant)};`,
    ].join(" "));
  }
  for (const link of plan._sourceLinks.accessLinks) {
    const row = link.row;
    statements.push([
      `UPDATE "ApiCredential" SET "oauthGrantId" = ${sql(link.grantId)}`,
      `WHERE "id" = ${sql(row.id)} AND "oauthGrantId" IS NULL`,
      `AND "userId" = ${sql(row.userId)} AND "oauthClientId" = ${sql(row.oauthClientId)}`,
      `AND ${nullableEquals('"oauthIssuer"', row.oauthIssuer)} AND "scopes" = ${sql(row.scopes)}`,
      `AND ${nullableEquals('"oauthResource"', row.oauthResource)} AND "oauthConnectionKey" = ${sql(row.oauthConnectionKey)}`,
      `AND ${exactGrantExists(link.grant)};`,
    ].join(" "));
  }
  return statements.join("\n");
}
