import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { API_V1_PLAYGROUND_MANIFEST } from "~/lib/generated/api-v1-playground";

const root = resolve(__dirname, "..", "..");

function source(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("recipe read scaling boundaries", () => {
  it("keeps the committed playground manifest scale-aware", () => {
    const detail = API_V1_PLAYGROUND_MANIFEST.operations.find(
      (operation) => operation.id === "GET /api/v1/recipes/{id}",
    );
    const scale = detail?.params.find((parameter) => parameter.name === "scale");

    expect(scale).toMatchObject({
      in: "query",
      required: false,
      schema: { type: "number", minimum: 0.1, maximum: 100 },
    });
    expect(detail?.responseExamples.map((example) => example.name)).toEqual(
      expect.arrayContaining(["unscaled", "scaled"]),
    );
  });

  it.each(["docs/api.md", "app/routes/developers.tsx"])(
    "documents scaled and unscaled recipe-detail reads in %s",
    (path) => {
      const content = source(path);
      expect(content, path).toContain("GET /api/v1/recipes/{id}?scale=2");
      expect(content, path).toMatch(/get_recipe[^\n]*scale[^\n]*2/i);
      expect(content, path).toContain("ingredient_quantities");
      expect(content, path).toMatch(/servings[^\n]*(?:unchanged|does not change)/i);
      expect(content, path).toMatch(/(?:omit|without)[^\n]*scale/i);
    },
  );
});
