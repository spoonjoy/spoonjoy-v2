interface MigrationStatement {
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface MigrationDatabase {
  prepare(sql: string): MigrationStatement;
}

const migrations = import.meta.glob("../../../migrations/*.sql", {
  eager: true,
  import: "default",
  query: "?raw",
}) as Record<string, string>;

const MIGRATION_MARKER = "__TestRepositoryMigrationsApplied";

function splitMigrationStatements(sql: string): string[] {
  const statements: string[] = [];
  let buffer = "";
  let inTrigger = false;

  for (const sourceLine of sql.split(/\r?\n/)) {
    if (/^\s*--/.test(sourceLine) || !sourceLine.trim()) continue;
    buffer += `${sourceLine}\n`;
    if (/^\s*CREATE\s+TRIGGER\b/i.test(buffer)) inTrigger = true;

    const statementComplete = inTrigger
      ? /^\s*END;\s*$/i.test(sourceLine)
      : /;\s*$/.test(sourceLine);
    if (!statementComplete) continue;

    statements.push(buffer.trim());
    buffer = "";
    inTrigger = false;
  }

  if (buffer.trim()) throw new Error("Repository migration ended with incomplete SQL");
  return statements;
}

export async function applyRepositoryMigrations(database: MigrationDatabase) {
  const marker = await database.prepare(`
    SELECT "name" FROM "sqlite_master"
    WHERE "type" = 'table' AND "name" = '${MIGRATION_MARKER}'
  `).first<{ name: string }>();
  if (marker?.name === MIGRATION_MARKER) return;

  for (const [, sql] of Object.entries(migrations).sort(([left], [right]) => left.localeCompare(right))) {
    for (const statement of splitMigrationStatements(sql)) {
      await database.prepare(statement).run();
    }
  }
  await database.prepare(`CREATE TABLE "${MIGRATION_MARKER}" ("completed" INTEGER NOT NULL)`).run();
}
