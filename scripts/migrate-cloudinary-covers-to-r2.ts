#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  PRODUCTION_R2_BUCKET,
  QA_ENV_NAME,
  QA_R2_BUCKET,
  arg,
} from "./script-environment.mjs";

const execFileAsync = promisify(execFile);
const MAX_WRANGLER_BUFFER = 1024 * 1024 * 16;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_DATABASE = "DB";
const DEFAULT_REPORT_DIR = "cloudinary-r2-migration-artifacts";
const CLOUDINARY_NEEDLE = "res.cloudinary.com/";
const WRANGLER_RETRY_ATTEMPTS = 4;

type TargetEnv = "qa" | "production";
type CloudinaryTable = "RecipeCover" | "SearchDocument" | "User" | "RecipeSpoon";
type CloudinaryField = "imageUrl" | "sourceImageUrl" | "stylizedImageUrl" | "photoUrl";

export interface CloudinaryReference {
  tableName: CloudinaryTable;
  fieldName: CloudinaryField;
  rowId: string;
  entityId: string | null;
  imageUrl: string;
}

export interface CloudinaryAssetPlan {
  url: string;
  key: string;
  migratedUrl: string;
  referenceCount: number;
}

export interface CloudinaryMigrationPlan {
  references: CloudinaryReference[];
  assets: CloudinaryAssetPlan[];
  countsByField: Record<string, number>;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface MigrationCliIO {
  log: (message: string) => void;
  error: (message: string) => void;
  exit: (code: number) => void;
}

export interface MigrationDeps {
  runCommand?: (file: string, args: string[]) => Promise<CommandResult>;
  fetchImpl?: typeof fetch;
  io?: MigrationCliIO;
  now?: () => Date;
}

interface TargetConfig {
  env: TargetEnv;
  database: string;
  r2Bucket: string;
  d1Args: string[];
  r2Args: string[];
}

interface MigrationOptions {
  apply: boolean;
  targetEnv: TargetEnv;
  database: string;
  limit: number | null;
  reportPath: string;
  backupDir: string;
  resumeExistingR2: boolean;
}

interface DownloadedImage {
  bytes: Buffer;
  contentType: string;
}

interface UploadedAsset extends CloudinaryAssetPlan {
  contentType: string;
  sizeBytes: number;
}

interface MissingAsset extends CloudinaryAssetPlan {
  missingReason: string;
}

interface BackupInfo {
  kind: "d1-export" | "targeted-rollback";
  createdAt: string;
  timeTravelBookmark: string | null;
  timeTravelBookmarkPath: string | null;
  exportPath: string | null;
  targetedRowsPath: string;
  rollbackSqlPath: string | null;
  exportError: string | null;
}

class ImageDownloadError extends Error {
  status: number;

  constructor(status: number, url: string) {
    super(`Could not download Cloudinary image (${status}) for ${url}`);
    this.status = status;
  }
}

const SOURCE_FIELDS: Array<{
  tableName: CloudinaryTable;
  fieldName: CloudinaryField;
  rowIdSql: string;
  entityIdSql: string;
}> = [
  { tableName: "RecipeCover", fieldName: "imageUrl", rowIdSql: "id", entityIdSql: "recipeId" },
  { tableName: "RecipeCover", fieldName: "sourceImageUrl", rowIdSql: "id", entityIdSql: "recipeId" },
  { tableName: "RecipeCover", fieldName: "stylizedImageUrl", rowIdSql: "id", entityIdSql: "recipeId" },
  { tableName: "SearchDocument", fieldName: "imageUrl", rowIdSql: "CAST(rowid AS TEXT)", entityIdSql: "entityId" },
  { tableName: "User", fieldName: "photoUrl", rowIdSql: "id", entityIdSql: "id" },
  { tableName: "RecipeSpoon", fieldName: "photoUrl", rowIdSql: "id", entityIdSql: "recipeId" },
];

function isTargetEnv(value: string | undefined): value is TargetEnv {
  return value === "qa" || value === "production";
}

function parseLimit(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--limit must be a positive integer.");
  }
  return parsed;
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function parseOptions(argv: string[], now: Date = new Date()): MigrationOptions {
  const targetEnvValue = arg(argv, "--target-env", "production");
  if (!isTargetEnv(targetEnvValue)) {
    throw new Error("--target-env must be qa or production.");
  }

  const apply = argv.includes("--apply");
  const explicitDryRun = argv.includes("--dry-run");
  if (apply && explicitDryRun) {
    throw new Error("Use either --apply or --dry-run, not both.");
  }

  const defaultReportPath = path.join(
    DEFAULT_REPORT_DIR,
    `cloudinary-r2-migration-${targetEnvValue}-${timestamp(now)}.json`,
  );

  return {
    apply,
    targetEnv: targetEnvValue,
    database: arg(argv, "--database", DEFAULT_DATABASE),
    limit: parseLimit(arg(argv, "--limit", undefined)),
    reportPath: arg(argv, "--out", defaultReportPath),
    backupDir: arg(argv, "--backup-dir", "/tmp/spoonjoy-d1-backups"),
    resumeExistingR2: argv.includes("--resume-existing-r2"),
  };
}

export function targetConfig(options: Pick<MigrationOptions, "targetEnv" | "database">): TargetConfig {
  if (options.targetEnv === "qa") {
    return {
      env: "qa",
      database: options.database,
      r2Bucket: QA_R2_BUCKET,
      d1Args: ["--remote", "--env", QA_ENV_NAME],
      r2Args: ["--remote", "--env", QA_ENV_NAME],
    };
  }

  return {
    env: "production",
    database: options.database,
    r2Bucket: PRODUCTION_R2_BUCKET,
    d1Args: ["--remote"],
    r2Args: ["--remote"],
  };
}

export function isCloudinaryUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "res.cloudinary.com";
  } catch {
    return false;
  }
}

export function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlIdentifier(value: CloudinaryTable | CloudinaryField): string {
  return `"${value}"`;
}

export function buildReferenceQuery(definition: (typeof SOURCE_FIELDS)[number], limit: number | null = null): string {
  const limitSql = limit === null ? "" : ` LIMIT ${limit}`;
  return [
    `SELECT ${sqlString(definition.tableName)} AS tableName,`,
    `  ${sqlString(definition.fieldName)} AS fieldName,`,
    `  ${definition.rowIdSql} AS rowId,`,
    `  ${definition.entityIdSql} AS entityId,`,
    `  ${sqlIdentifier(definition.fieldName)} AS imageUrl`,
    `FROM ${sqlIdentifier(definition.tableName)}`,
    `WHERE ${sqlIdentifier(definition.fieldName)} LIKE ${sqlString(`%${CLOUDINARY_NEEDLE}%`)}`,
    `  AND ${sqlIdentifier(definition.fieldName)} IS NOT NULL`,
    `  AND ${sqlIdentifier(definition.fieldName)} != ''${limitSql}`,
  ].join("\n");
}

export function buildReferenceQueries(limit: number | null = null): string[] {
  return SOURCE_FIELDS.map((definition) => buildReferenceQuery(definition, limit));
}

export function parseWranglerD1Results<T>(stdout: string): T[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("Wrangler D1 JSON output was not an array.");
  }

  return parsed.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || !("results" in entry)) {
      throw new Error("Wrangler D1 JSON entry did not include results.");
    }
    const results = (entry as { results: unknown }).results;
    if (!Array.isArray(results)) {
      throw new Error("Wrangler D1 results value was not an array.");
    }
    return results as T[];
  });
}

export function sanitizeKeySegment(value: string): string {
  const sanitized = value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-\./g, ".")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .toLowerCase();
  return sanitized.slice(0, 80) || "image";
}

function extensionFromPathname(pathname: string): string | null {
  const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
  if (!match) return null;
  const ext = `.${match[1].toLowerCase()}`;
  if (ext === ".jpeg") return ".jpg";
  return [".jpg", ".png", ".webp", ".gif"].includes(ext) ? ext : null;
}

export function extensionForContentType(contentType: string | null | undefined): string | null {
  const normalized = contentType?.split(";")[0]?.trim().toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "image/gif") return ".gif";
  return null;
}

export function contentTypeForExtension(extension: string): string {
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "application/octet-stream";
}

export function detectImageContentType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  return null;
}

export function keyForCloudinaryUrl(url: string, contentType?: string | null): string {
  const parsed = new URL(url);
  const filename = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).at(-1) ?? "image");
  const pathExtension = extensionFromPathname(parsed.pathname);
  const extension = pathExtension ?? extensionForContentType(contentType) ?? ".jpg";
  const basename = sanitizeKeySegment(filename.replace(/\.[^.]+$/, ""));
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return `legacy-cloudinary/${basename}-${hash}${extension}`;
}

export function planCloudinaryMigration(references: CloudinaryReference[]): CloudinaryMigrationPlan {
  const normalizedReferences = references.filter((reference) => isCloudinaryUrl(reference.imageUrl));
  const byUrl = new Map<string, CloudinaryReference[]>();
  const countsByField: Record<string, number> = {};

  for (const reference of normalizedReferences) {
    const key = `${reference.tableName}.${reference.fieldName}`;
    countsByField[key] = (countsByField[key] ?? 0) + 1;
    const existing = byUrl.get(reference.imageUrl) ?? [];
    existing.push(reference);
    byUrl.set(reference.imageUrl, existing);
  }

  const assets = [...byUrl.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([url, refs]) => {
      const key = keyForCloudinaryUrl(url);
      return {
        url,
        key,
        migratedUrl: `/photos/${key}`,
        referenceCount: refs.length,
      };
    });

  return {
    references: normalizedReferences,
    assets,
    countsByField,
  };
}

function buildGuardedUpdateStatement(reference: CloudinaryReference, fromUrl: string, toUrl: string): string {
  const table = sqlIdentifier(reference.tableName);
  const field = sqlIdentifier(reference.fieldName);
  if (reference.tableName === "SearchDocument") {
    const rowid = Number(reference.rowId);
    if (!Number.isSafeInteger(rowid) || rowid < 1) {
      throw new Error(`Invalid SearchDocument rowid: ${reference.rowId}`);
    }
    return `UPDATE ${table} SET ${field} = ${sqlString(toUrl)} WHERE rowid = ${rowid} AND ${field} = ${sqlString(fromUrl)};`;
  }

  return `UPDATE ${table} SET ${field} = ${sqlString(toUrl)} WHERE "id" = ${sqlString(reference.rowId)} AND ${field} = ${sqlString(fromUrl)};`;
}

export function buildMigrationSql(references: CloudinaryReference[], migratedUrlsByOldUrl: Map<string, string>): string {
  const statements = references.map((reference) => {
    const migratedUrl = migratedUrlsByOldUrl.get(reference.imageUrl);
    if (migratedUrl === undefined) {
      throw new Error(`Missing migrated URL for ${reference.imageUrl}`);
    }
    return buildGuardedUpdateStatement(reference, reference.imageUrl, migratedUrl);
  });

  return [...statements, ""].join("\n");
}

export function buildRollbackSql(references: CloudinaryReference[], migratedUrlsByOldUrl: Map<string, string>): string {
  const statements = references.map((reference) => {
    const migratedUrl = migratedUrlsByOldUrl.get(reference.imageUrl);
    if (migratedUrl === undefined) {
      throw new Error(`Missing migrated URL for ${reference.imageUrl}`);
    }
    return buildGuardedUpdateStatement(reference, migratedUrl, reference.imageUrl);
  });

  return [...statements, ""].join("\n");
}

export function buildR2PutArgs(target: TargetConfig, key: string, filePath: string, contentType: string): string[] {
  return [
    "exec",
    "wrangler",
    "r2",
    "object",
    "put",
    `${target.r2Bucket}/${key}`,
    ...target.r2Args,
    "--file",
    filePath,
    "--content-type",
    contentType,
    "--cache-control",
    "public, max-age=31536000, immutable",
  ];
}

export function buildR2GetArgs(target: TargetConfig, key: string, filePath: string): string[] {
  return [
    "exec",
    "wrangler",
    "r2",
    "object",
    "get",
    `${target.r2Bucket}/${key}`,
    ...target.r2Args,
    "--file",
    filePath,
  ];
}

function buildD1ExecuteArgs(target: TargetConfig, command: string): string[] {
  return ["exec", "wrangler", "d1", "execute", target.database, ...target.d1Args, "--json", "--command", command];
}

function buildD1FileArgs(target: TargetConfig, filePath: string): string[] {
  return ["exec", "wrangler", "d1", "execute", target.database, ...target.d1Args, "--json", "--file", filePath];
}

function buildD1ExportArgs(target: TargetConfig, outputPath: string): string[] {
  return ["exec", "wrangler", "d1", "export", target.database, ...target.d1Args, "--output", outputPath];
}

function buildD1TimeTravelInfoArgs(target: TargetConfig): string[] {
  const envArgs = target.env === "qa" ? ["--env", QA_ENV_NAME] : [];
  return ["exec", "wrangler", "d1", "time-travel", "info", target.database, ...envArgs, "--json"];
}

async function defaultRunCommand(file: string, args: string[]): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { maxBuffer: MAX_WRANGLER_BUFFER });
    return { stdout, stderr };
  } catch (error) {
    const details = commandErrorDetails(error);
    throw new Error(`Command failed: ${file} ${args.join(" ")}\n${details}`);
  }
}

function commandErrorDetails(error: unknown): string {
  const maybeChildError = error as { stdout?: unknown; stderr?: unknown; message?: unknown };
  const stdout = typeof maybeChildError.stdout === "string" ? maybeChildError.stdout.trim() : "";
  const stderr = typeof maybeChildError.stderr === "string" ? maybeChildError.stderr.trim() : "";
  const message = typeof maybeChildError.message === "string" ? maybeChildError.message.trim() : String(error);
  return [stderr, stdout, message].filter(Boolean).join("\n");
}

function isTransientWranglerFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(520|521|522|523|524|525|526)\b/.test(message) || /malformed response from the API/i.test(message);
}

function isVirtualTableExportFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cannot export databases with Virtual Tables/i.test(message);
}

function isMissingR2Object(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /specified key does not exist/i.test(message);
}

async function runPnpm(runCommand: NonNullable<MigrationDeps["runCommand"]>, args: string[]): Promise<CommandResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= WRANGLER_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await runCommand("pnpm", args);
    } catch (error) {
      lastError = error;
      if (!isTransientWranglerFailure(error) || attempt === WRANGLER_RETRY_ATTEMPTS) {
        throw error;
      }
      await sleep(1000 * attempt);
    }
  }
  throw lastError;
}

export function runCliIfEntry(argv1 = process.argv[1], moduleUrl = import.meta.url): boolean {
  if (!isCliEntry(argv1, moduleUrl)) return false;
  const argv = process.argv.slice(2).filter((value, index) => !(index === 0 && value === "--"));
  runMigration(argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Cloudinary to R2 migration failed: ${message}`);
    process.exit(1);
  });
  return true;
}

async function loadReferences(
  target: TargetConfig,
  limit: number | null,
  runCommand: NonNullable<MigrationDeps["runCommand"]>,
): Promise<CloudinaryReference[]> {
  const queries = buildReferenceQueries(limit);
  const results: CloudinaryReference[] = [];
  for (const query of queries) {
    const { stdout } = await runPnpm(runCommand, buildD1ExecuteArgs(target, query));
    results.push(...parseWranglerD1Results<CloudinaryReference>(stdout));
  }
  return results;
}

async function downloadImage(url: string, fetchImpl: typeof fetch): Promise<DownloadedImage> {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "user-agent": "Spoonjoy Cloudinary to R2 migration/1.0",
    },
  });

  if (!response.ok) {
    throw new ImageDownloadError(response.status, url);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength === 0) {
    throw new Error(`Downloaded Cloudinary image was empty for ${url}`);
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Downloaded Cloudinary image exceeded ${MAX_IMAGE_BYTES} bytes for ${url}`);
  }

  const detectedContentType = detectImageContentType(bytes);
  const headerContentType = response.headers.get("content-type");
  const normalizedHeader = extensionForContentType(headerContentType) ? headerContentType!.split(";")[0].trim().toLowerCase() : null;
  const contentType = detectedContentType ?? normalizedHeader;
  if (!contentType) {
    throw new Error(`Downloaded Cloudinary asset was not a recognized image for ${url}`);
  }

  return { bytes, contentType };
}

function isMissingCloudinaryAsset(error: unknown): error is ImageDownloadError {
  return error instanceof ImageDownloadError && (error.status === 404 || error.status === 410);
}

async function uploadAsset({
  target,
  asset,
  tempDir,
  fetchImpl,
  runCommand,
  resumeExistingR2,
}: {
  target: TargetConfig;
  asset: CloudinaryAssetPlan;
  tempDir: string;
  fetchImpl: typeof fetch;
  runCommand: NonNullable<MigrationDeps["runCommand"]>;
  resumeExistingR2: boolean;
}): Promise<UploadedAsset> {
  if (resumeExistingR2) {
    const existingPath = path.join(tempDir, `${createHash("sha256").update(asset.url).digest("hex")}.existing`);
    try {
      await runPnpm(runCommand, buildR2GetArgs(target, asset.key, existingPath));
      const existingStat = await stat(existingPath);
      return {
        ...asset,
        contentType: contentTypeForExtension(path.extname(asset.key).toLowerCase()) || "application/octet-stream",
        sizeBytes: existingStat.size,
      };
    } catch (error) {
      if (!isMissingR2Object(error)) {
        throw error;
      }
    }
  }

  const downloaded = await downloadImage(asset.url, fetchImpl);
  const key = keyForCloudinaryUrl(asset.url, downloaded.contentType);
  const filePath = path.join(tempDir, `${createHash("sha256").update(asset.url).digest("hex")}${extensionForContentType(downloaded.contentType) ?? ".img"}`);
  await writeFile(filePath, downloaded.bytes);
  await runPnpm(runCommand, buildR2PutArgs(target, key, filePath, downloaded.contentType));
  return {
    ...asset,
    key,
    migratedUrl: `/photos/${key}`,
    contentType: downloaded.contentType,
    sizeBytes: downloaded.bytes.byteLength,
  };
}

async function writeJsonReport(reportPath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function parseTimeTravelBookmark(stdout: string): string | null {
  const parsed: unknown = JSON.parse(stdout);
  if (!parsed || typeof parsed !== "object" || !("bookmark" in parsed)) return null;
  const bookmark = (parsed as { bookmark: unknown }).bookmark;
  return typeof bookmark === "string" && bookmark.length > 0 ? bookmark : null;
}

async function createBackup(
  target: TargetConfig,
  backupDir: string,
  now: Date,
  plan: CloudinaryMigrationPlan,
  runCommand: NonNullable<MigrationDeps["runCommand"]>,
): Promise<BackupInfo> {
  await mkdir(backupDir, { recursive: true });
  const stamp = timestamp(now);
  const createdAt = now.toISOString();
  const targetedRowsPath = path.join(backupDir, `pre-cloudinary-r2-${target.env}-${stamp}.rows.json`);
  await writeFile(targetedRowsPath, `${JSON.stringify({ createdAt, targetEnv: target.env, references: plan.references }, null, 2)}\n`, "utf8");

  let timeTravelBookmark: string | null = null;
  let timeTravelBookmarkPath: string | null = null;
  try {
    const { stdout } = await runPnpm(runCommand, buildD1TimeTravelInfoArgs(target));
    timeTravelBookmark = parseTimeTravelBookmark(stdout);
    timeTravelBookmarkPath = path.join(backupDir, `pre-cloudinary-r2-${target.env}-${stamp}.time-travel.json`);
    await writeFile(timeTravelBookmarkPath, `${JSON.stringify({ createdAt, targetEnv: target.env, bookmark: timeTravelBookmark }, null, 2)}\n`, "utf8");
  } catch {
    timeTravelBookmark = null;
    timeTravelBookmarkPath = null;
  }

  const exportPath = path.join(backupDir, `pre-cloudinary-r2-${target.env}-${stamp}.sql`);
  try {
    await runPnpm(runCommand, buildD1ExportArgs(target, exportPath));
    return {
      kind: "d1-export",
      createdAt,
      timeTravelBookmark,
      timeTravelBookmarkPath,
      exportPath,
      targetedRowsPath,
      rollbackSqlPath: null,
      exportError: null,
    };
  } catch (error) {
    if (!isVirtualTableExportFailure(error)) {
      throw error;
    }

    return {
      kind: "targeted-rollback",
      createdAt,
      timeTravelBookmark,
      timeTravelBookmarkPath,
      exportPath: null,
      targetedRowsPath,
      rollbackSqlPath: null,
      exportError: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runMigration(argv: string[], deps: MigrationDeps = {}): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const options = parseOptions(argv, now);
  const target = targetConfig(options);
  const io = deps.io ?? {
    log: (message: string) => console.log(message),
    error: (message: string) => console.error(message),
    exit: (code: number) => process.exit(code),
  };
  const runCommand = deps.runCommand ?? defaultRunCommand;
  const fetchImpl = deps.fetchImpl ?? fetch;

  io.log(`Target: ${target.env} D1 ${target.database}, R2 ${target.r2Bucket}`);
  io.log(`Mode: ${options.apply ? "apply" : "dry-run"}`);
  if (options.resumeExistingR2) {
    io.log("Resume: existing R2 objects are reused before Cloudinary fetches.");
  }

  const references = await loadReferences(target, options.limit, runCommand);
  const plan = planCloudinaryMigration(references);
  io.log(`Cloudinary references: ${plan.references.length}`);
  io.log(`Unique Cloudinary assets: ${plan.assets.length}`);
  for (const [field, count] of Object.entries(plan.countsByField).sort()) {
    io.log(`- ${field}: ${count}`);
  }

  if (!options.apply) {
    await writeJsonReport(options.reportPath, {
      mode: "dry-run",
      targetEnv: target.env,
      generatedAt: now.toISOString(),
      plan,
    });
    io.log(`Dry-run report: ${options.reportPath}`);
    return;
  }

  const backupInfo = await createBackup(target, options.backupDir, now, plan, runCommand);
  io.log(`D1 backup mode: ${backupInfo.kind}`);
  if (backupInfo.exportPath) io.log(`D1 export: ${backupInfo.exportPath}`);
  if (backupInfo.timeTravelBookmarkPath) io.log(`Time Travel bookmark: ${backupInfo.timeTravelBookmarkPath}`);
  io.log(`Targeted row backup: ${backupInfo.targetedRowsPath}`);

  if (plan.assets.length === 0) {
    await writeJsonReport(options.reportPath, {
      mode: "apply",
      targetEnv: target.env,
      generatedAt: now.toISOString(),
      backupInfo,
      plan,
      uploadedAssets: [],
      remainingReferences: 0,
    });
    io.log(`No Cloudinary references found. Report: ${options.reportPath}`);
    return;
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "spoonjoy-cloudinary-r2-"));
  const uploadedAssets: UploadedAsset[] = [];
  const missingAssets: MissingAsset[] = [];
  try {
    for (const [index, asset] of plan.assets.entries()) {
      io.log(`Migrating asset ${index + 1}/${plan.assets.length}: ${asset.key}`);
      try {
        uploadedAssets.push(await uploadAsset({
          target,
          asset,
          tempDir,
          fetchImpl,
          runCommand,
          resumeExistingR2: options.resumeExistingR2,
        }));
      } catch (error) {
        if (!isMissingCloudinaryAsset(error)) {
          throw error;
        }
        missingAssets.push({
          ...asset,
          migratedUrl: "",
          missingReason: error.message,
        });
        io.log(`Missing Cloudinary asset ${index + 1}/${plan.assets.length}; clearing references.`);
      }
    }

    const migratedUrlsByOldUrl = new Map(uploadedAssets.map((asset) => [asset.url, asset.migratedUrl]));
    for (const asset of missingAssets) {
      migratedUrlsByOldUrl.set(asset.url, "");
    }
    backupInfo.rollbackSqlPath = path.join(options.backupDir, `rollback-cloudinary-r2-${target.env}-${timestamp(now)}.sql`);
    await writeFile(backupInfo.rollbackSqlPath, buildRollbackSql(plan.references, migratedUrlsByOldUrl), "utf8");
    io.log(`Rollback SQL: ${backupInfo.rollbackSqlPath}`);

    const sqlPath = path.join(tempDir, "cloudinary-r2-update.sql");
    await writeFile(sqlPath, buildMigrationSql(plan.references, migratedUrlsByOldUrl), "utf8");
    await runPnpm(runCommand, buildD1FileArgs(target, sqlPath));

    const remainingReferences = planCloudinaryMigration(await loadReferences(target, options.limit, runCommand)).references.length;
    await writeJsonReport(options.reportPath, {
      mode: "apply",
      targetEnv: target.env,
      generatedAt: now.toISOString(),
      backupInfo,
      plan,
      uploadedAssets,
      missingAssets,
      remainingReferences,
    });

    io.log(`Remaining Cloudinary references: ${remainingReferences}`);
    io.log(`Apply report: ${options.reportPath}`);
    if (remainingReferences > 0) {
      io.error("Cloudinary migration applied but references remain.");
      io.exit(1);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function isCliEntry(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  return path.resolve(argv1) === fileURLToPath(moduleUrl);
}

runCliIfEntry();
