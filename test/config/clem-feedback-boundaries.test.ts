import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildApiV1OpenApiDocument } from "~/lib/api-v1-openapi.server";
import { listSpoonjoyMcpTools } from "~/lib/mcp/spoonjoy-tools.server";

const BASE_SOURCE = "d50b8ff5730c68597f6b80077df799927a56e3bf";
const PROVIDER_TOKEN = ["peb", "ble"].join("");
const CHANGE_MANIFEST_PATH =
  "worker/tasks/2026-07-19-1505-doing-clem-feedback-ship/unit-4.3-change-allowlist.json";
const TASK_EVIDENCE_EXCLUDES = [
  ":(exclude)worker/tasks/2026-07-14-1313-clem-feedback-source.md",
  ":(exclude)worker/tasks/2026-07-19-1505-planning-clem-feedback-ship.md",
  ":(exclude)worker/tasks/2026-07-19-1505-doing-clem-feedback-ship.md",
  ":(exclude)worker/tasks/2026-07-19-1505-doing-clem-feedback-ship/**",
];
const PROVIDER_PATHS = [
  "app/lib/analytics-server.ts",
  "spoonjoy/tasks/2026-06-01-1830-doing-dev-platform-api-docs.md",
  "spoonjoy/tasks/2026-06-01-1830-planning-dev-platform-api-docs.md",
  "test/docs/developer-platform-guide.test.ts",
  "test/lib/analytics-server.test.ts",
  "test/routes/agent-connect.test.tsx",
  "test/routes/api-v1-telemetry.test.ts",
  "test/routes/developers.test.tsx",
].sort();
const HISTORICAL_FILES = [
  {
    path: "spoonjoy/tasks/2026-06-01-1830-doing-dev-platform-api-docs.md",
    blob: "bbdbed615dbaf151d38974156b8ba65f1bc35d41",
    sha256: "072672e4ab96f02790d2959e7f52706366ca7804cbeef36700b6f1cabf407679",
  },
  {
    path: "spoonjoy/tasks/2026-06-01-1830-planning-dev-platform-api-docs.md",
    blob: "4f3c8e894979be318e697a7160b68b86bf887668",
    sha256: "096c0f06cbfd0a7844a3d9da31a86accb277fca2000fc9cee4047aedd57b8180",
  },
];
const AUTHORITY_FILES = [
  {
    path: "worker/tasks/2026-07-14-1313-clem-feedback-source.md",
    sha256: "6cfb65216c4387c1ced9d1c42a68952502ef0966495980403d84fe51e346d5f3",
  },
  {
    path: "worker/tasks/2026-07-19-1505-doing-clem-feedback-ship/product-data-contract.md",
    sha256: "bf57163e073ed41968ad7b241a600f8797c8c417db7c25b314b50b850bf1374b",
  },
  {
    path: "worker/tasks/2026-07-19-1505-doing-clem-feedback-ship/cook-session-protocol-v1.md",
    sha256: "5014c400570d79d09e5d20c168df4c14dccd705db2a140afc0a24abe684d6e8a",
  },
  {
    path: "worker/tasks/2026-07-19-1505-doing-clem-feedback-ship/unit-0-feedback-map.md",
    sha256: "10d8c61cd755b1dc15d1303e46e0e0e83195ba35574fdd537f24e689484009de",
  },
];

function git(...args: string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function treeHitPaths(treeish: string) {
  const prefix = `${treeish}:`;
  return git(
    "grep",
    "-Iil",
    PROVIDER_TOKEN,
    treeish,
    "--",
    ".",
    ...TASK_EVIDENCE_EXCLUDES,
  ).split("\n").map((line) => line.startsWith(prefix) ? line.slice(prefix.length) : line).sort();
}

function workingTreeHitPaths() {
  return git(
    "grep",
    "--untracked",
    "-Iil",
    PROVIDER_TOKEN,
    "--",
    ".",
    ...TASK_EVIDENCE_EXCLUDES,
  ).split("\n").sort();
}

function providerLineBodies(treeish: string) {
  const prefix = `${treeish}:`;
  return git("grep", "-Ini", PROVIDER_TOKEN, treeish, "--", ...PROVIDER_PATHS)
    .split("\n")
    .map((line) => line.startsWith(prefix) ? line.slice(prefix.length) : line)
    .map((line) => line.replace(/:\d+:/, ":"))
    .sort();
}

function sha256File(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function surfaceFiles(paths: string[]) {
  const tracked = git("ls-files", ...paths).split("\n").filter(Boolean);
  const untracked = git("ls-files", "--others", "--exclude-standard", "--", ...paths)
    .split("\n")
    .filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort();
}

function surfaceSources(paths: string[], include: (path: string) => boolean = () => true) {
  return surfaceFiles(paths)
    .filter(include)
    .map((path) => ({ path, source: readFileSync(path, "utf8") }));
}

function semanticWords(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/gi, " ")
    .toLowerCase();
}

const AUTOMATION_ACTION_PATTERN =
  /\b(?:ai|auto|automatic|automated|generate|generated|generating|infer|inferred|inferring|proposal|propose|proposed|recommend|recommended|recommending|suggest|suggested|suggesting|suggestion)\b/;

function denotesAutomatedCategorization(value: string) {
  const words = semanticWords(value);
  const classificationAction = /\b(?:categorize|categorization|classify|classification|taxonomy)\b/.test(words);
  const automationAction = AUTOMATION_ACTION_PATTERN.test(words);
  const categorizationTarget = /\b(?:category|categories|course|label|labels|metadata|tag|tags)\b/.test(words);
  return classificationAction || (automationAction && categorizationTarget);
}

function hasAutomationAction(value: string) {
  return AUTOMATION_ACTION_PATTERN.test(semanticWords(value));
}

function denotesAutomatedUiCategorization(value: string) {
  const words = semanticWords(value);
  const classificationAction = /\b(?:categorize|categorization|classify|classification|taxonomy)\b/.test(words);
  const primaryTarget = /\b(?:category|categories|course|metadata|tag|tags)\b/.test(words);
  return classificationAction || (hasAutomationAction(words) && primaryTarget);
}

function denotesCategorizationPersistenceEntity(value: string) {
  return /(?:categor|classif|label|proposal|suggest|tag|taxonom)/i.test(value);
}

function denotesFirstPartyRecipeImport(value: string) {
  if (/^\s*import\s+(?:type\s+)?[A-Za-z*{].*\bfrom\b/.test(value)) return false;
  if (/import_recipe_from_url|\/api\/v1\/recipes\/import/i.test(value)) return true;
  const words = semanticWords(value);
  const hasRecipe = /\brecipes?\b/.test(words);
  const hasSource = /\b(?:link|url|web|website)\b/.test(words);
  const hasSourceAction = /\b(?:add|bring|clip|create|extract|fetch|import|paste)\b/.test(words);
  const hasImportAction = /\b(?:clip|extract|import)\b/.test(words);
  return hasRecipe && (
    (hasSource && (hasSourceAction || /\bfrom\b/.test(words))) ||
    hasImportAction ||
    /\bbring\s+in\s+(?:a\s+)?recipes?\b/.test(words)
  );
}

function sourceLineContainsFirstPartyRecipeImport(line: string) {
  if (/import_recipe_from_url|\/api\/v1\/recipes\/import/i.test(line)) return true;
  return sourceLineSemanticFragments(line).some(denotesFirstPartyRecipeImport);
}

function sourceLineSemanticFragments(line: string) {
  const identifiers = line.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
  const stringContents = [...line.matchAll(/["'`]([^"'`]+)["'`]/g)]
    .map((match) => match[1] ?? "");
  const jsxText = [...line.matchAll(/>([^<{]+)</g)].map((match) => match[1] ?? "");
  return [...identifiers, ...stringContents, ...jsxText];
}

function isExecutableClientSource(path: string) {
  return /\.tsx?$/.test(path) &&
    !/\.server\.tsx?$/.test(path) &&
    !path.startsWith("app/lib/generated/") &&
    !path.startsWith("app/lib/telemetry-coverage/") &&
    !path.startsWith("app/routes/api") &&
    !path.startsWith("app/routes/developers.") &&
    path !== "app/routes/mcp.tsx" &&
    path !== "app/routes/privacy.tsx";
}

function structuralSemanticText(value: unknown, parentKey = ""): string {
  if (typeof value === "string") {
    return /^(?:description|example|examples)$/i.test(parentKey) ? "" : value;
  }
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    return value.map((child) => structuralSemanticText(child, parentKey)).join(" ");
  }
  return Object.entries(value as Record<string, unknown>)
    .map(([key, child]) => `${key} ${structuralSemanticText(child, key)}`)
    .join(" ");
}

function hasAutomatedCategorizationStructure(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasAutomatedCategorizationStructure);

  const object = value as Record<string, unknown>;
  const properties = object.properties;
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    const entries = Object.entries(properties as Record<string, unknown>);
    const hasCategorizationTarget = entries.some(([key]) =>
      /^(?:category|categories|course|label|labels|tag|tags)$/i.test(key)
    );
    const hasMetadataTarget = entries.some(([key]) => /^metadata$/i.test(key));
    const hasAutomatedKey = entries.some(([key]) => denotesAutomatedCategorization(key));
    const hasAutomationControl = entries.some(([key, child]) => {
      const words = semanticWords(key).trim();
      const isControl = /^(?:action|intent|method|mode|strategy)$/.test(words);
      const isAiProvenance = /^(?:confidence|generated by|model|provenance|score|source|suggested by)$/.test(words);
      return (isControl && hasAutomationAction(structuralSemanticText(child))) || isAiProvenance;
    });
    const hasActionControl = entries.some(([key, child]) =>
      /^(?:action|intent|method|mode|strategy)$/.test(semanticWords(key).trim()) &&
      hasAutomationAction(structuralSemanticText(child))
    );
    if (hasAutomatedKey ||
      (hasCategorizationTarget && hasAutomationControl) ||
      (hasMetadataTarget && hasActionControl)) return true;
  }

  return Object.values(object).some(hasAutomatedCategorizationStructure);
}

function hasAutomatedCategorizationParameters(value: unknown) {
  if (!Array.isArray(value)) return false;
  const properties = Object.fromEntries(value.flatMap((parameter) => {
    if (!parameter || typeof parameter !== "object") return [];
    const record = parameter as { name?: unknown; schema?: unknown };
    return typeof record.name === "string" ? [[record.name, record.schema]] : [];
  }));
  return hasAutomatedCategorizationStructure({ properties });
}

function sqlCreatedTableNames(source: string) {
  return [...source.matchAll(
    /CREATE\s+(?:(?:TEMP|TEMPORARY|VIRTUAL)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z0-9_]+))/gi,
  )].map((match) => match[1] ?? match[2] ?? match[3] ?? match[4] ?? "");
}

function isTaskEvidence(path: string) {
  return path.startsWith(".tasks/") ||
    path.startsWith("spoonjoy/tasks/") ||
    path.startsWith("worker/tasks/");
}

function candidateChanges() {
  const entries = new Map<string, "A" | "D" | "M">();
  const changed = git("diff", "--no-renames", "--name-status", BASE_SOURCE, "--", ".");
  for (const line of changed.split("\n").filter(Boolean)) {
    const [rawStatus, path] = line.split("\t");
    const status = rawStatus?.slice(0, 1) as "A" | "D" | "M";
    if (path && !isTaskEvidence(path)) entries.set(path, status);
  }
  const untracked = git("ls-files", "--others", "--exclude-standard", "--", ".");
  for (const path of untracked.split("\n").filter(Boolean)) {
    if (!isTaskEvidence(path)) entries.set(path, "A");
  }
  return Object.fromEntries([...entries]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, status]) => [
      path,
      status === "D" ? "D" : `${status}:${sha256File(path)}`,
    ]));
}

function sourceBetween(path: string, start: string, end: string) {
  const source = readFileSync(path, "utf8");
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `${start} in ${path}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `${end} in ${path}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("Clem feedback rejected-scope boundaries", () => {
  it("keeps the exact provider-specific path set and source-bearing lines", () => {
    expect(treeHitPaths(BASE_SOURCE)).toEqual(PROVIDER_PATHS);
    expect(treeHitPaths("HEAD")).toEqual(PROVIDER_PATHS);
    expect(workingTreeHitPaths()).toEqual(PROVIDER_PATHS);
    expect(providerLineBodies("HEAD")).toEqual(providerLineBodies(BASE_SOURCE));

    const changedProviderLines = git("diff", "--unified=0", BASE_SOURCE, "--", ...PROVIDER_PATHS)
      .split("\n")
      .filter((line) => (line.startsWith("+") || line.startsWith("-")) &&
        !line.startsWith("+++") && !line.startsWith("---"));
    expect(changedProviderLines.join("\n").toLowerCase()).not.toContain(PROVIDER_TOKEN);
  });

  it("keeps unrelated historical platform task files byte-identical", () => {
    for (const file of HISTORICAL_FILES) {
      expect(git("rev-parse", `${BASE_SOURCE}:${file.path}`)).toBe(file.blob);
      expect(git("rev-parse", `HEAD:${file.path}`)).toBe(file.blob);
      expect(sha256File(file.path)).toBe(file.sha256);
    }
  });

  it("keeps reviewed authority hashes current and explicit", () => {
    for (const file of AUTHORITY_FILES) {
      expect(sha256File(file.path), file.path).toBe(file.sha256);
    }
  });

  it("requires every product-tree change to match the reviewed content allowlist", () => {
    const manifest = JSON.parse(readFileSync(CHANGE_MANIFEST_PATH, "utf8")) as {
      schemaVersion: number;
      baseSource: string;
      entries: Record<string, string>;
    };
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.baseSource).toBe(BASE_SOURCE);
    expect(candidateChanges()).toEqual(manifest.entries);
  });

  it("limits navigation iteration to the demonstrated saved-dock defect", () => {
    const changedNavigation = git(
      "diff",
      "--name-only",
      BASE_SOURCE,
      "--",
      "app/components/navigation",
      "app/root.tsx",
      "app/routes.ts",
    );
    expect(changedNavigation).toBe([
      "app/components/navigation/dock-context.tsx",
      "app/components/navigation/use-recipe-dock-actions.tsx",
    ].join("\n"));
  });

  it("keeps import agentic without a first-party route or MCP tool", () => {
    const routeConfig = readFileSync("app/routes.ts", "utf8");
    const routePairs = [...routeConfig.matchAll(/route\(\s*"([^"]+)",\s*"([^"]+)"/g)]
      .map((match) => `${match[1]} ${match[2]}`);
    expect(routePairs.filter((routePair) => /(?:^|[./_-])import(?:$|[./_-])/i.test(routePair))).toEqual([]);
    expect(listSpoonjoyMcpTools().map((tool) => tool.name)
      .filter((name) => /(?:import|clip|extract).*recipe|recipe.*(?:import|clip|extract)/i.test(name)))
      .toEqual([]);

    const clientSurfaces = surfaceSources(
      ["app/routes", "app/components", "app/hooks", "app/lib", "app/root.tsx"],
      isExecutableClientSource,
    );
    for (const { path, source } of clientSurfaces) {
      const importLines = source.split("\n")
        .filter((line) => !/^\s*(?:\{\/\*|\/\/|\/\*|\*|\*\/)/.test(line))
        .filter(sourceLineContainsFirstPartyRecipeImport);
      expect(importLines, path).toEqual([]);
    }
  });

  it("recognizes rejected import and automated-categorization aliases", () => {
    for (const alias of [
      "Paste recipe link",
      "clipRecipeFromUrl",
      "createRecipeFromUrl",
      "addRecipeFromUrl",
      "recipeFromWebsite",
      "Bring in recipe",
      "fetch('/api/v1/recipes/import')",
      "import_recipe_from_url",
    ]) {
      expect(denotesFirstPartyRecipeImport(alias), alias).toBe(true);
    }
    for (const alias of [
      "categorize_recipe",
      "/recipes/recipe-id/categorize",
      "suggest_recipe_metadata",
      "RecipeClassification",
      "RecipeLabelProposal",
      "RecipeTagSuggestion",
      "Suggest\ncategory",
      "Categorize with AI",
      "Suggest a category",
      "Suggest a label",
      "Generate label",
      "Automatic label",
      "AI label",
      "Classify this recipe",
    ]) {
      expect(denotesAutomatedCategorization(alias), alias).toBe(true);
    }
    expect(denotesFirstPartyRecipeImport("import type { Recipe } from './types'")).toBe(false);
    expect(sourceLineContainsFirstPartyRecipeImport("const helper = createRecipeFromUrl;")).toBe(true);
    expect(sourceLineContainsFirstPartyRecipeImport(
      '<Link href={`/recipes/${recipe.id}/steps/new`} className="sj-link">+ Add Step</Link>',
    )).toBe(false);
    expect(denotesAutomatedCategorization("update_recipe_tags")).toBe(false);
    expect(denotesAutomatedCategorization("Generate an AI placeholder cover candidate")).toBe(false);
    expect(sourceLineSemanticFragments('"Suggest a label"')
      .some(denotesAutomatedCategorization)).toBe(true);
    expect(denotesAutomatedUiCategorization("generateEditorial statusLabel")).toBe(false);
    for (const entity of ["TagSuggestion", "CategoryProposal", "LabelClassification"]) {
      expect(denotesCategorizationPersistenceEntity(entity), entity).toBe(true);
    }
    expect(hasAutomatedCategorizationStructure({
      properties: {
        action: { enum: ["suggest"] },
        tags: { type: "array" },
      },
    })).toBe(true);
    expect(hasAutomatedCategorizationParameters([
      { name: "mode", schema: { enum: ["suggest"] } },
      { name: "tags", schema: { type: "array" } },
    ])).toBe(true);
    expect(sqlCreatedTableNames('CREATE TABLE IF NOT EXISTS "TagSuggestion" (id TEXT);')).toEqual([
      "TagSuggestion",
    ]);
    expect(sqlCreatedTableNames("CREATE VIRTUAL TABLE CategoryProposal USING fts5(value);")).toEqual([
      "CategoryProposal",
    ]);
  });

  it("keeps automated tag generation out of persistence, API, MCP, and UI surfaces", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const migration = readFileSync("migrations/0025_clem_feedback_product.sql", "utf8");
    const tagModel = sourceBetween("prisma/schema.prisma", "model RecipeTag", "model RecipeStep");
    const tagTable = sourceBetween(
      "migrations/0025_clem_feedback_product.sql",
      'CREATE TABLE "RecipeTag"',
      'WITH "normalized_memberships"',
    );
    expect([...schema.matchAll(/^model\s+(\w+)/gm)]
      .map((match) => match[1])
      .filter((name) => denotesCategorizationPersistenceEntity(name!))).toEqual(["RecipeTag"]);
    expect(tagModel.split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("model ") && line !== "}" && !line.startsWith("@@"))
      .map((line) => line.split(/\s+/)[0])).toEqual([
        "id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt", "recipe",
      ]);

    const migrationSources = surfaceSources(
      ["migrations", "prisma/migrations"],
      (path) => path.endsWith(".sql"),
    );
    expect(migrationSources
      .flatMap(({ source }) => sqlCreatedTableNames(source))
      .filter((name) => denotesCategorizationPersistenceEntity(name!))).toEqual(["RecipeTag"]);
    expect(migrationSources
      .filter(({ source }) => /\bRecipeTag\b/.test(source))
      .map(({ path }) => path)).toEqual(["migrations/0025_clem_feedback_product.sql"]);
    expect([...tagTable.matchAll(/^\s+"([^"]+)"\s+[A-Z]/gm)].map((match) => match[1])).toEqual([
      "id", "recipeId", "label", "normalizedLabel", "createdAt", "updatedAt",
    ]);

    const document = buildApiV1OpenApiDocument();
    const inferenceOperations = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.entries(methods).flatMap(([method, operation]) => {
        const operationValue = operation as { operationId?: string; summary?: string };
        const identity = `${method} ${path} ${operationValue.operationId ?? ""} ${operationValue.summary ?? ""}`;
        const input = operation as { parameters?: unknown; requestBody?: unknown };
        const inputShape = {
          parameters: input.parameters,
          requestBody: input.requestBody,
        };
        return denotesAutomatedCategorization(identity) ||
          hasAutomatedCategorizationStructure(inputShape) ||
          hasAutomatedCategorizationParameters(input.parameters)
          ? [identity]
          : [];
      })
    );
    expect(inferenceOperations).toEqual([]);
    expect(listSpoonjoyMcpTools()
      .filter((tool) => denotesAutomatedCategorization(`${tool.name} ${tool.description}`) ||
        hasAutomatedCategorizationStructure(tool.inputSchema))
      .map((tool) => tool.name)).toEqual([]);
    for (const [schemaName, schemaValue] of Object.entries(document.components.schemas)) {
      expect(denotesAutomatedCategorization(schemaName), schemaName).toBe(false);
      expect(hasAutomatedCategorizationStructure(schemaValue), schemaName).toBe(false);
      if (/(?:categor|classif|label|tag|taxonom)/i.test(schemaName)) {
        expect(JSON.stringify(schemaValue), schemaName).not.toMatch(
          /"(?:confidence|generatedBy|inference|inferred|model|provenance|score|source|suggestedBy|suggestion)"\s*:/i,
        );
      }
    }

    for (const { path, source } of surfaceSources(
      ["app/routes", "app/components", "app/hooks", "app/root.tsx"],
      isExecutableClientSource,
    )) {
      const lines = source.split("\n")
        .map((line) => line.replace(/<[^>]*>/g, ""));
      const categorizedWindows = lines.flatMap((_, index) => [
        lines.slice(index, index + 1).join(" "),
        lines.slice(index, index + 2).join(" "),
        lines.slice(index, index + 3).join(" "),
      ]).filter(denotesAutomatedUiCategorization);
      const categorizedFragments = source.split("\n")
        .flatMap(sourceLineSemanticFragments)
        .filter(denotesAutomatedCategorization);
      expect([...categorizedWindows, ...categorizedFragments], path).toEqual([]);
    }
  });

  it("keeps personalized save state out of public recipe read contracts", () => {
    const restReadSerializers = sourceBetween(
      "app/lib/api-v1.server.ts",
      "function recipeReadMetadata",
      "type RecipeCoverOwnerRow",
    );
    const mcpReadSerializers = sourceBetween(
      "app/lib/spoonjoy-api.server.ts",
      "function formatRecipeReadMetadata",
      "function formatShoppingList",
    );
    const restReadHandlers = sourceBetween(
      "app/lib/api-v1.server.ts",
      "async function handleRecipeList",
      "function objectBody",
    );
    const restSearchHandler = sourceBetween(
      "app/lib/api-v1.server.ts",
      "function searchResultPayload",
      "type ApiV1SpoonWithChef",
    );
    const mcpReadHandlers = sourceBetween(
      "app/lib/spoonjoy-api.server.ts",
      "const searchRecipesTool",
      "const createRecipeTool",
    );
    for (const serializers of [
      restReadSerializers,
      mcpReadSerializers,
      restReadHandlers,
      restSearchHandler,
      mcpReadHandlers,
    ]) {
      expect(serializers).not.toMatch(/\bisSaved\b|\bsavedAt\b/);
    }

    const document = buildApiV1OpenApiDocument();
    for (const schemaName of ["RecipeReadSummary", "RecipeReadDetail", "RecipeSearchMetadata"] as const) {
      const properties = document.components.schemas[schemaName].properties;
      expect(properties).not.toHaveProperty("isSaved");
      expect(properties).not.toHaveProperty("savedAt");
    }
  });
});
