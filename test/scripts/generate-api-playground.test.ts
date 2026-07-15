import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildApiV1OpenApiDocument } from "../../app/lib/api-v1-openapi.server";
import {
  buildApiPlaygroundManifest,
  OPENAPI_OPERATION_METHODS,
  serializeApiPlaygroundManifest,
} from "../../scripts/generate-api-playground";

describe("generate-api-playground", () => {
  function operation(manifest: ReturnType<typeof buildApiPlaygroundManifest>, id: string) {
    const found = manifest.operations.find((item) => item.id === id);
    expect(found, id).toBeDefined();
    return found!;
  }

  it("derives every playground operation from the OpenAPI document", () => {
    const document = buildApiV1OpenApiDocument();
    const manifest = buildApiPlaygroundManifest(document);
    const openApiOperations = Object.entries(document.paths).flatMap(([path, pathItem]) => (
      Object.keys(pathItem as Record<string, unknown>)
        .filter((method) => (OPENAPI_OPERATION_METHODS as readonly string[]).includes(method))
        .map((method) => `${method.toUpperCase()} ${path}`)
    ));

    expect([...OPENAPI_OPERATION_METHODS]).toEqual(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);
    expect(manifest.source).toBe("buildApiV1OpenApiDocument");
    expect(manifest.version).toBe("v1");
    expect(manifest.operations.map((operation) => operation.id)).toEqual(openApiOperations);
    expect(manifest.operations.find((operation) => operation.id === "POST /api/v1/tokens")).toMatchObject({
      auth: "authenticated",
      scopes: ["tokens:write"],
      requestBody: {
        contentType: "application/json",
        example: expect.stringContaining("\"name\": \"Tiny client\""),
      },
    });
    expect(manifest.operations.find((operation) => operation.id === "GET /api/v1/recipes/{id}")).toMatchObject({
      params: expect.arrayContaining([
        expect.objectContaining({ name: "id", in: "path", placeholder: "recipe_1" }),
        expect.objectContaining({ name: "X-Request-Id", in: "header" }),
      ]),
    });
    const cookbookRecipeDelete = manifest.operations.find((operation) => operation.id === "DELETE /api/v1/cookbooks/{id}/recipes/{recipeId}");
    const cookbookRecipeDeleteExamples = cookbookRecipeDelete?.responseExamples.map((example) => example.example).join("\n") ?? "";
    expect(cookbookRecipeDeleteExamples).toContain("\"removed\": true");
    expect(cookbookRecipeDeleteExamples).not.toContain("\"added\": true");
  });

  it("renders Photo Studio multipart examples as boundary-safe client code", () => {
    const manifest = buildApiPlaygroundManifest(buildApiV1OpenApiDocument());
    const upload = operation(manifest, "POST /api/v1/recipes/{id}/image");

    expect(upload.profiles).toEqual(["full", "sdk"]);
    expect(upload.requestBody?.contentType).toBe("multipart/form-data");
    expect(upload.requestBody?.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "clientMutationId", required: true }),
      expect.objectContaining({ name: "photo", required: true, accept: "image/jpeg,image/png,image/webp" }),
      expect.objectContaining({ name: "activate", required: false }),
      expect.objectContaining({ name: "generateEditorial", required: false }),
      expect.objectContaining({ name: "postAsSpoon", required: false }),
      expect.objectContaining({ name: "note", required: false }),
    ]));
    expect(upload.requestBody?.example).toContain("const body = new FormData();");
    expect(upload.requestBody?.example).toContain("body.append(\"photo\", file);");
    expect(upload.requestBody?.example).toContain("curl --form");
    expect(upload.requestBody?.example).not.toContain("\"Content-Type\": \"multipart/form-data\"");
    expect(upload.requestBody?.example).not.toContain("-H 'Content-Type: multipart/form-data'");
  });

  it("keeps Photo Studio operations visible in playground metadata", () => {
    const manifest = buildApiPlaygroundManifest(buildApiV1OpenApiDocument());

    expect(operation(manifest, "POST /api/v1/recipes/{id}/covers")).toMatchObject({
      profiles: ["full", "sdk"],
      requestBody: {
        contentType: "application/json",
        example: expect.stringContaining("\"generateEditorial\": true"),
      },
      idempotency: expect.objectContaining({ replayStatus: [201] }),
    });
    expect(operation(manifest, "POST /api/v1/recipes/{id}/covers/generate")).toMatchObject({
      profiles: ["full", "sdk"],
      requestBody: {
        contentType: "application/json",
        example: expect.stringContaining("\"promptAddition\": \"brighter herbs and tighter crop\""),
      },
      idempotency: expect.objectContaining({ replayStatus: [201] }),
    });
    expect(operation(manifest, "POST /api/v1/recipes/{id}/covers/regenerate")).toMatchObject({
      profiles: ["full", "sdk"],
      requestBody: {
        contentType: "application/json",
        example: expect.stringContaining("\"promptAddition\": \"keep the plating but brighten the background\""),
      },
      idempotency: expect.objectContaining({ replayStatus: [200] }),
    });
  });

  it("keeps the committed client manifest in sync with the generator output", async () => {
    const generated = await readFile("app/lib/generated/api-v1-playground.ts", "utf8");

    expect(generated).toBe(serializeApiPlaygroundManifest());
  });

  it("derives multipart field requiredness from inline schemas and tolerates unsupported refs", () => {
    const document = {
      openapi: "3.1.0",
      info: { title: "Custom API", version: "custom" },
      paths: {
        "/custom/inline-upload": {
          post: {
            operationId: "postCustomInlineUpload",
            tags: ["Custom"],
            summary: "Inline upload",
            requestBody: {
              required: true,
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    required: ["photo"],
                    properties: {
                      photo: { type: "string", format: "binary" },
                      caption: { type: "string" },
                      sauce: { type: ["string", "null"], description: "Optional sauce note." },
                    },
                  },
                  examples: {
                    example: { value: { photo: "(binary image file)", caption: "Optional caption", sauce: null } },
                  },
                  encoding: {
                    photo: { contentType: "image/png" },
                  },
                },
              },
            },
            responses: { "200": { description: "OK" } },
          },
        },
        "/custom/unsupported-ref-upload": {
          post: {
            operationId: "postCustomUnsupportedRefUpload",
            tags: ["Custom"],
            summary: "Unsupported ref upload",
            requestBody: {
              required: true,
              content: {
                "multipart/form-data": {
                  schema: { $ref: "#/components/requestBodies/Upload" },
                  examples: {
                    example: { value: { photo: "(binary image file)" } },
                  },
                },
              },
            },
            responses: { "200": { description: "OK" } },
          },
        },
        "/custom/null-upload-example": {
          post: {
            operationId: "postCustomNullUploadExample",
            tags: ["Custom"],
            summary: "Null upload example",
            requestBody: {
              required: true,
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    properties: {
                      photo: { type: "string", format: "binary" },
                    },
                  },
                  examples: {
                    example: { value: null },
                  },
                },
              },
            },
            responses: { "200": { description: "OK" } },
          },
        },
      },
      components: { schemas: {} },
    } as ReturnType<typeof buildApiV1OpenApiDocument>;

    const manifest = buildApiPlaygroundManifest(document);

    expect(manifest.operations.find((operation) => operation.id === "POST /custom/inline-upload")?.requestBody?.fields).toEqual([
      expect.objectContaining({ name: "photo", required: true, accept: "image/png" }),
      expect.objectContaining({ name: "caption", required: false }),
      expect.objectContaining({ name: "sauce", required: false, description: "Optional sauce note." }),
    ]);
    expect(manifest.operations.find((operation) => operation.id === "POST /custom/inline-upload")?.requestBody?.example)
      .toContain("body.append(\"sauce\", \"\");");
    expect(manifest.operations.find((operation) => operation.id === "POST /custom/unsupported-ref-upload")?.requestBody?.fields).toEqual([
      expect.objectContaining({ name: "photo", required: false }),
    ]);
    expect(manifest.operations.find((operation) => operation.id === "POST /custom/null-upload-example")?.requestBody)
      .toMatchObject({
        contentType: "multipart/form-data",
        fields: [],
        example: "",
      });
  });

  it("documents Photo Studio cover operations in docs/api.md", async () => {
    const docs = await readFile("docs/api.md", "utf8");

    expect(docs).toContain("| `POST` | `/api/v1/recipes/{id}/image` | Authenticated chef | `kitchen:write` |");
    expect(docs).toContain("| `POST` | `/api/v1/recipes/{id}/covers` | Authenticated chef | `kitchen:write` |");
    expect(docs).toContain("| `POST` | `/api/v1/recipes/{id}/covers/generate` | Authenticated chef | `kitchen:write` |");
    expect(docs).toContain("`POST /api/v1/recipes/{id}/covers` creates a cover candidate from a Spoonjoy uploaded image URL");
    expect(docs).toContain("`POST /api/v1/recipes/{id}/covers/generate` creates an AI placeholder cover candidate");
    expect(docs).toContain("promptAddition");
    expect(docs).toContain("activateWhenReady");
    expect(docs).toContain("curl -fsS -X POST 'https://spoonjoy.app/api/v1/recipes/recipe_1/covers'");
    expect(docs).toContain('"clientMutationId":"cover-create:recipe_1"');
    expect(docs).toContain("curl -fsS -X POST 'https://spoonjoy.app/api/v1/recipes/recipe_1/covers/generate'");
    expect(docs).toContain('"clientMutationId":"cover-generate:recipe_1"');
    expect(docs).toContain('"promptAddition":"brighter herbs and tighter crop"');
    expect(docs).toContain('"promptAddition":"keep the plating but brighten the background"');
  });
});
