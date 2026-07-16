import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("shared recipe cover service architecture", () => {
  it("owns cover schema and orchestration outside the REST and MCP adapters", () => {
    expect(existsSync(resolve(process.cwd(), "app/lib/recipe-cover-schema.server.ts"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "app/lib/recipe-cover-service.server.ts"))).toBe(true);

    const schemaSource = source("app/lib/recipe-cover-schema.server.ts");
    const serviceSource = source("app/lib/recipe-cover-service.server.ts");
    const recipeCoverSource = source("app/lib/recipe-cover.server.ts");
    const restSource = source("app/lib/api-v1.server.ts");
    const mcpSource = source("app/lib/spoonjoy-api.server.ts");

    expect(schemaSource).toContain("RECIPE_COVER_SOURCE_TYPES");
    expect(schemaSource).toContain("RECIPE_COVER_VARIANTS");
    expect(schemaSource).toContain("RECIPE_COVER_STATUSES");
    expect(schemaSource).toContain("RECIPE_COVER_GENERATION_STATUSES");
    expect(recipeCoverSource).toContain('from "~/lib/recipe-cover-schema.server"');

    expect(serviceSource).toContain("scheduleRecipeCoverStylization");
    expect(serviceSource).toContain("scheduleRecipePlaceholderGeneration");
    expect(serviceSource).toContain("activateRecipeCoverWithBestAvailableVariant");
    expect(serviceSource).toContain("validateRecipeCoverImageSource");
    expect(restSource).toContain('from "~/lib/recipe-cover-service.server"');
    expect(mcpSource).toContain('from "~/lib/recipe-cover-service.server"');
  });

  it("keeps duplicated generation and activation wrappers out of REST and MCP adapters", () => {
    const restSource = source("app/lib/api-v1.server.ts");
    const mcpSource = source("app/lib/spoonjoy-api.server.ts");

    for (const adapterSource of [restSource, mcpSource]) {
      expect(adapterSource).not.toContain('from "~/lib/spoon-cover-stylization.server"');
      expect(adapterSource).not.toContain('from "~/lib/ai-placeholder-cover.server"');
      expect(adapterSource).not.toContain("validateRecipeImageAssignment");
      expect(adapterSource).not.toContain("scheduleSpoonCoverStylization(");
      expect(adapterSource).not.toContain("scheduleAiPlaceholderCover(");
    }

    expect(restSource).not.toContain("function runOrQueueCoverStylization");
    expect(restSource).not.toContain("function runOrQueuePlaceholderGeneration");
    expect(mcpSource).not.toContain("function scheduleCoverStylization");
    expect(mcpSource).not.toContain("function schedulePlaceholderCover");
    expect(mcpSource).not.toContain("function activateUploadedRecipeCover");
  });
});
