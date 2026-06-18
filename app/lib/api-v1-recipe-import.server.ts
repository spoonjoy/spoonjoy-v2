import type { PrismaClient as PrismaClientType } from "@prisma/client";
import type { ApiV1ErrorCode } from "~/lib/api-v1-contract.server";
import {
  ImportRecipeError,
  importRecipeFromJsonLd,
  importRecipeFromText,
  importRecipeFromUrl,
  type ImportRecipeResult,
} from "~/lib/recipe-import.server";

type Database = PrismaClientType;

type Env = {
  ARTIFACT_ROOT?: string;
  OPENAI_API_KEY?: string;
  PHOTOS?: R2Bucket;
};

export type RecipeImportInputType = "url" | "text" | "json-ld" | "video-url";

export type ProviderSecretBlocker = {
  blocked: true;
  capability: "ProviderSecret";
  command: string;
  domain: "recipe-import";
  outputPath: string;
  ownerAction: string;
  reason: string;
};

type NativeRecipeImportSource =
  | { type: "url"; url: string }
  | { type: "text"; text: string; url: string | null }
  | { type: "json-ld"; jsonLd: unknown; url: string | null }
  | { type: "video-url"; url: string };

export type NativeRecipeImportInput = {
  clientMutationId: string;
  source: NativeRecipeImportSource;
};

export type ApiV1RecipeImportResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; code: ApiV1ErrorCode; message: string; details?: unknown };

export type NativeRecipeImportData = {
  recipe: unknown | null;
  import: {
    inputType: RecipeImportInputType;
    source: ImportRecipeResult["source"] | null;
    confidence: ImportRecipeResult["confidence"] | null;
    existingRecipeId: string | null;
    coverPending: boolean;
  };
  blockers: ProviderSecretBlocker[];
  warnings: string[];
  nextActions: string[];
  mutation: { clientMutationId: string; replayed: false };
};

export type NativeRecipeImportDeps = {
  db: Database;
  chefId: string;
  env?: Env | null;
  waitUntil?: (promise: Promise<unknown>) => void;
  recipeId?: string;
};

function success<T>(data: T, status = 200): ApiV1RecipeImportResult<T> {
  return { ok: true, status, data };
}

function failure<T>(
  code: ApiV1ErrorCode,
  message: string,
  details?: unknown,
): ApiV1RecipeImportResult<T> {
  return { ok: false, code, message, details };
}

function fieldFailure<T>(field: string, message: string): ApiV1RecipeImportResult<T> {
  return failure("validation_error", "Invalid recipe import request", {
    fieldErrors: { [field]: message },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function assertKnownFields<T>(
  body: Record<string, unknown>,
  allowed: readonly string[],
): ApiV1RecipeImportResult<T> | null {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(body).filter((field) => !allowedSet.has(field));
  return unknown.length > 0
    ? failure("validation_error", "Unknown request body fields", { fields: unknown })
    : null;
}

function requiredText<T>(
  value: unknown,
  field: string,
  message = `${field} must be a nonblank string`,
): ApiV1RecipeImportResult<string> {
  if (typeof value !== "string" || !value.trim()) {
    return fieldFailure<T>(field, message) as ApiV1RecipeImportResult<string>;
  }
  return success(value.trim());
}

function optionalUrl<T>(
  value: unknown,
  field: string,
): ApiV1RecipeImportResult<string | null> {
  if (value === undefined || value === null || value === "") return success(null);
  if (typeof value !== "string") {
    return fieldFailure<T>(field, `${field} must be a URL string or null`) as ApiV1RecipeImportResult<string | null>;
  }
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fieldFailure<T>(field, `${field} must use http or https`) as ApiV1RecipeImportResult<string | null>;
    }
    return success(url.toString());
  } catch {
    return fieldFailure<T>(field, `${field} must be a valid URL`) as ApiV1RecipeImportResult<string | null>;
  }
}

function requiredUrl<T>(
  value: unknown,
  field: string,
): ApiV1RecipeImportResult<string> {
  const parsed = optionalUrl<T>(value, field);
  if (!parsed.ok) return parsed as ApiV1RecipeImportResult<string>;
  if (!parsed.data) {
    return fieldFailure<T>(field, `${field} must be a URL string`) as ApiV1RecipeImportResult<string>;
  }
  return success(parsed.data);
}

function parseSource(source: unknown): ApiV1RecipeImportResult<NativeRecipeImportSource> {
  if (!isRecord(source)) {
    return fieldFailure("source", "source must be an object");
  }
  const type = source.type;
  if (type === "url") {
    const unknown = assertKnownFields<NativeRecipeImportSource>(source, ["type", "url"]);
    if (unknown) return unknown;
    const url = requiredUrl<NativeRecipeImportSource>(source.url, "source.url");
    if (!url.ok) return url;
    return success({ type, url: url.data });
  }
  if (type === "video-url") {
    const unknown = assertKnownFields<NativeRecipeImportSource>(source, ["type", "url"]);
    if (unknown) return unknown;
    const url = requiredUrl<NativeRecipeImportSource>(source.url, "source.url");
    if (!url.ok) return url;
    return success({ type, url: url.data });
  }
  if (type === "text") {
    const unknown = assertKnownFields<NativeRecipeImportSource>(source, ["type", "text", "url"]);
    if (unknown) return unknown;
    const text = requiredText<NativeRecipeImportSource>(source.text, "source.text");
    if (!text.ok) return text;
    const url = optionalUrl<NativeRecipeImportSource>(source.url, "source.url");
    if (!url.ok) return url;
    return success({ type, text: text.data, url: url.data });
  }
  if (type === "json-ld") {
    const unknown = assertKnownFields<NativeRecipeImportSource>(source, ["type", "jsonLd", "url"]);
    if (unknown) return unknown;
    if (source.jsonLd === undefined || source.jsonLd === null) {
      return fieldFailure("source.jsonLd", "source.jsonLd is required");
    }
    if (!isRecord(source.jsonLd) && !Array.isArray(source.jsonLd)) {
      return fieldFailure("source.jsonLd", "source.jsonLd must be an object or array");
    }
    const url = optionalUrl<NativeRecipeImportSource>(source.url, "source.url");
    if (!url.ok) return url;
    return success({ type, jsonLd: source.jsonLd, url: url.data });
  }
  return fieldFailure("source.type", "source.type must be one of url, text, json-ld, or video-url");
}

export function parseNativeRecipeImportBody(
  body: Record<string, unknown>,
): ApiV1RecipeImportResult<NativeRecipeImportInput> {
  const unknown = assertKnownFields<NativeRecipeImportInput>(body, ["clientMutationId", "source"]);
  if (unknown) return unknown;
  const clientMutationId = requiredText<NativeRecipeImportInput>(
    body.clientMutationId,
    "clientMutationId",
    "clientMutationId must be a nonblank string",
  );
  if (!clientMutationId.ok) return clientMutationId;
  const source = parseSource(body.source);
  if (!source.ok) return source;
  return success({ clientMutationId: clientMutationId.data, source: source.data });
}

function envString(env: Env | null | undefined, key: keyof Env): string {
  const value = env?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function hasRecipeImportProviderSecret(env: Env | null | undefined): boolean {
  return Boolean(envString(env, "OPENAI_API_KEY"));
}

export function providerSecretBlocker(env: Env | null | undefined): ProviderSecretBlocker {
  const artifactRoot = envString(env, "ARTIFACT_ROOT");
  const outputPath = artifactRoot
    ? `${artifactRoot.replace(/\/+$/, "")}/web/provider-secret-blocker-recipe-import.json`
    : "web/provider-secret-blocker-recipe-import.json";
  return {
    blocked: true,
    capability: "ProviderSecret",
    command: "Set OPENAI_API_KEY and rerun the recipe import mutation.",
    domain: "recipe-import",
    outputPath,
    ownerAction: "Provide OPENAI_API_KEY for local recipe import extraction and ingredient parsing.",
    reason: "Recipe import requires a provider secret for extraction or ingredient parsing.",
  };
}

type FsPromisesModule = {
  mkdir(path: string, options: { recursive: boolean }): Promise<unknown>;
  writeFile(path: string, data: string, encoding: string): Promise<unknown>;
};

async function writeProviderSecretBlocker(
  blocker: ProviderSecretBlocker,
  env: Env | null | undefined,
): Promise<void> {
  if (!envString(env, "ARTIFACT_ROOT")) return;
  const slashIndex = blocker.outputPath.lastIndexOf("/");
  const directory = blocker.outputPath.slice(0, slashIndex);
  try {
    const fsModule = await import("node:fs/promises") as Partial<FsPromisesModule>;
    await fsModule.mkdir!(directory, { recursive: true });
    await fsModule.writeFile!(blocker.outputPath, `${JSON.stringify(blocker, null, 2)}\n`, "utf8");
  } catch {
    // Local blocker files are validation artifacts; the API response remains authoritative in Workers.
  }
}

export async function providerBlockedRecipeImportData(
  input: NativeRecipeImportInput,
  env: Env | null | undefined,
): Promise<NativeRecipeImportData> {
  const blocker = providerSecretBlocker(env);
  await writeProviderSecretBlocker(blocker, env);
  return {
    recipe: null,
    import: {
      inputType: input.source.type,
      source: null,
      confidence: null,
      existingRecipeId: null,
      coverPending: false,
    },
    blockers: [blocker],
    warnings: [],
    nextActions: ["Set OPENAI_API_KEY and retry the import with a new clientMutationId."],
    mutation: { clientMutationId: input.clientMutationId, replayed: false },
  };
}

function importFailure(error: ImportRecipeError): ApiV1RecipeImportResult<never> {
  if (error.code === "rate-limited") {
    return failure("rate_limited", error.message);
  }
  if (error.status >= 400 && error.status < 500) {
    return failure("validation_error", error.message, { importCode: error.code });
  }
  return failure("internal_error", error.message, { importCode: error.code });
}

export async function runNativeRecipeImport(
  input: NativeRecipeImportInput,
  deps: NativeRecipeImportDeps,
): Promise<ApiV1RecipeImportResult<{
  inputType: RecipeImportInputType;
  importResult: ImportRecipeResult;
}>> {
  try {
    if (input.source.type === "url" || input.source.type === "video-url") {
      const importResult = await importRecipeFromUrl({
        chefId: deps.chefId,
        url: input.source.url,
        recipeId: deps.recipeId,
      }, {
        db: deps.db,
        env: deps.env ?? {},
        bucket: deps.env?.PHOTOS,
        waitUntil: deps.waitUntil,
      });
      return success({ inputType: input.source.type, importResult }, 201);
    }
    if (input.source.type === "text") {
      const importResult = await importRecipeFromText({
        chefId: deps.chefId,
        text: input.source.text,
        sourceUrl: input.source.url,
        recipeId: deps.recipeId,
      }, {
        db: deps.db,
        env: deps.env ?? {},
        bucket: deps.env?.PHOTOS,
        waitUntil: deps.waitUntil,
      });
      return success({ inputType: input.source.type, importResult }, 201);
    }
    const importResult = await importRecipeFromJsonLd({
      chefId: deps.chefId,
      jsonLd: input.source.jsonLd,
      sourceUrl: input.source.url,
      recipeId: deps.recipeId,
    }, {
      db: deps.db,
      env: deps.env ?? {},
      bucket: deps.env?.PHOTOS,
      waitUntil: deps.waitUntil,
    });
    return success({ inputType: input.source.type, importResult }, 201);
  } catch (error) {
    if (error instanceof ImportRecipeError) return importFailure(error);
    throw error;
  }
}
