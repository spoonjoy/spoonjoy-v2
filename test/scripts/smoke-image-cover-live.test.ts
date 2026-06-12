import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import {
  DIRTY_APP1_MARKER,
  IMAGE_COVER_REQUIRED_MCP_TOOLS,
  ORIENTED_JPEG_FIXTURE_PATH,
  SMOKE_TOKEN_SCOPES,
  addDirtyApp1Marker,
  assertQaImageProviderSecrets,
  base64FromBytes,
  buildApiToolRequest,
  buildCreateSmokeTokenArgs,
  buildMcpToolRequest,
  buildMcpToolsListRequest,
  buildRevokeSmokeTokenRequest,
  bytesContainAscii,
  extractJpegExifOrientation,
  parseApiToolPayload,
  parseMcpToolPayload,
  parseWranglerSecretNames,
  photoKeyFromImageUrl,
  pollCoverGeneration,
  runImageCoverSmokeFlow,
  validateSmokePhotoKey,
} from "../../scripts/smoke-image-cover-live.mjs";

const QA_BASE_URL = "https://spoonjoy-v2-qa.mendelow-studio.workers.dev";
const textEncoder = new TextEncoder();

const AI_PLACEHOLDER_COVER = {
  id: "cover-ai",
  imageUrl: "/photos/covers/ai-placeholder.jpg",
  stylizedImageUrl: null,
  displayUrl: "/photos/covers/ai-placeholder.jpg",
  provenanceLabel: "AI generated",
  sourceType: "ai-placeholder",
  generationStatus: "succeeded",
  status: "ready",
  activeVariant: "image",
};

const CHEF_PHOTO_COVER = {
  id: "cover-chef",
  imageUrl: "/photos/recipes/user-1/uploads/oriented.jpg",
  stylizedImageUrl: null,
  displayUrl: "/photos/recipes/user-1/uploads/oriented.jpg",
  provenanceLabel: "Chef photo",
  sourceType: "chef-upload",
  generationStatus: "none",
  status: "ready",
  activeVariant: "image",
};

const EDITORIAL_COVER = {
  id: "cover-editorial",
  imageUrl: "/photos/recipes/user-1/uploads/oriented.jpg",
  stylizedImageUrl: "/photos/covers/editorial.jpg",
  displayUrl: "/photos/covers/editorial.jpg",
  provenanceLabel: "Editorialized chef photo",
  sourceType: "chef-upload",
  generationStatus: "succeeded",
  status: "ready",
  activeVariant: "stylized",
};

const SPOON_EDITORIAL_COVER = {
  id: "cover-spoon",
  imageUrl: "/photos/spoons/user-1/uploads/spoon.png",
  stylizedImageUrl: "/photos/covers/spoon-editorial.jpg",
  displayUrl: "/photos/covers/spoon-editorial.jpg",
  provenanceLabel: "Editorialized chef photo",
  sourceType: "spoon",
  sourceSpoonId: "spoon-1",
  generationStatus: "succeeded",
  status: "ready",
  activeVariant: "stylized",
};

const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);

type FlowCall = {
  kind: string;
  name?: string;
  args?: unknown;
};

function terminalStatusCover(cover: typeof EDITORIAL_COVER) {
  return { ...cover, generationStatus: "succeeded", status: "ready" };
}

function createFlowHarness(overrides: Record<string, unknown> = {}) {
  const calls: FlowCall[] = [];
  const deletedKeys: string[] = [];
  const verifiedDeletedKeys: string[] = [];
  let listCoversCount = 0;
  const mcpTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
    calls.push({ kind: "mcp", name, args });
    if (name === "list_recipe_covers") {
      listCoversCount += 1;
      const covers = listCoversCount === 1
        ? [{ ...AI_PLACEHOLDER_COVER, imageUrl: null, displayUrl: null, generationStatus: "processing" }]
        : [AI_PLACEHOLDER_COVER, CHEF_PHOTO_COVER, EDITORIAL_COVER, SPOON_EDITORIAL_COVER];
      return { covers, activeCover: covers[0] };
    }
    if (name === "create_spoon") return { spoon: { id: "spoon-1", photoUrl: "/photos/spoons/user-1/uploads/spoon.png" } };
    if (name === "list_recipe_spoon_images") return { spoonImages: [{ id: "spoon-1", photoUrl: "/photos/spoons/user-1/uploads/spoon.png" }] };
    if (name === "create_recipe_cover_from_upload") {
      return args.generateEditorial === false
        ? { createdCover: CHEF_PHOTO_COVER, activeCover: CHEF_PHOTO_COVER, generationStatus: "none" }
        : { createdCover: { ...EDITORIAL_COVER, stylizedImageUrl: null, generationStatus: "processing" }, generationStatus: "processing" };
    }
    if (name === "create_recipe_cover_from_spoon") {
      return { createdCover: { ...SPOON_EDITORIAL_COVER, stylizedImageUrl: null, generationStatus: "processing" }, generationStatus: "processing" };
    }
    if (name === "regenerate_recipe_cover") {
      return { createdCover: { ...EDITORIAL_COVER, generationStatus: "processing" }, generationStatus: "processing" };
    }
    if (name === "get_cover_generation_status") {
      const coverId = String(args.coverId);
      const cover = coverId === "cover-spoon" ? SPOON_EDITORIAL_COVER : EDITORIAL_COVER;
      return { cover: terminalStatusCover(cover), activeCover: terminalStatusCover(cover) };
    }
    if (name === "set_active_recipe_cover") return { activeCover: CHEF_PHOTO_COVER };
    if (name === "archive_recipe_cover") return { archivedCover: SPOON_EDITORIAL_COVER, activeCover: CHEF_PHOTO_COVER };
    throw new Error(`Unexpected MCP tool ${name}`);
  });

  const harness = {
    calls,
    deletedKeys,
    verifiedDeletedKeys,
    options: {
      baseUrl: QA_BASE_URL,
      email: "codex-smoke@example.com",
      recipeId: "recipe-1",
      recipeTitle: "Codex smoke risotto",
      stamp: "unit2a",
      maxPollAttempts: 3,
      pollDelayMs: 0,
      listQaSecretNames: vi.fn(async () => {
        calls.push({ kind: "secrets" });
        return ["SESSION_SECRET", "OPENAI_API_KEY", "GEMINI_API_KEY"];
      }),
      apiTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ kind: "api", name, args });
        if (name === "create_api_token") {
          return { token: "sj_secret_token", credential: { id: "credential-1" } };
        }
        if (name === "upload_recipe_image") {
          return { imageUrl: "/photos/recipes/user-1/uploads/oriented.jpg", mimeType: "image/jpeg", sizeBytes: 1024 };
        }
        if (name === "upload_spoon_photo") {
          return { imageUrl: "/photos/spoons/user-1/uploads/spoon.png", mimeType: "image/png", sizeBytes: 67 };
        }
        if (name === "revoke_api_token") {
          return { revoked: true, credential: { id: args.credentialId, revokedAt: new Date(0).toISOString() } };
        }
        throw new Error(`Unexpected API tool ${name}`);
      }),
      expectApiToolFailure: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ kind: "api-failure", name, args });
        return { status: 400, message: "GIF uploads are not supported" };
      }),
      mcpToolsList: vi.fn(async () => {
        calls.push({ kind: "mcp-tools-list" });
        return { tools: IMAGE_COVER_REQUIRED_MCP_TOOLS.map((name) => ({ name })) };
      }),
      mcpTool,
      readFileBytes: vi.fn(async (path: string) => {
        if (path.endsWith(".png")) return new Uint8Array(await readFile("e2e/fixtures/spoon-test-photo.png"));
        if (path.endsWith(".gif")) return GIF_BYTES;
        return new Uint8Array(await readFile(ORIENTED_JPEG_FIXTURE_PATH));
      }),
      downloadPhotoBytes: vi.fn(async () => new Uint8Array(await readFile(ORIENTED_JPEG_FIXTURE_PATH))),
      deleteQaR2Object: vi.fn(async (key: string) => {
        deletedKeys.push(key);
      }),
      verifyQaR2ObjectDeleted: vi.fn(async (key: string) => {
        verifiedDeletedKeys.push(key);
      }),
      wait: vi.fn(async () => undefined),
      ...(overrides as object),
    },
  };
  return harness;
}

function app1Segment(payloadBytes: Uint8Array): Uint8Array {
  const length = payloadBytes.length + 2;
  return new Uint8Array([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payloadBytes]);
}

function jpegWithSegments(segments: Uint8Array[], scanData = new Uint8Array([0xff, 0xda, 0x00, 0x02, 0x11, 0x22])) {
  return new Uint8Array([0xff, 0xd8, ...segments.flatMap((segment) => Array.from(segment)), ...scanData]);
}

function littleEndianExifOrientationSegment(orientation: number): Uint8Array {
  const payloadBytes = new Uint8Array(32);
  payloadBytes.set(textEncoder.encode("Exif\0\0"), 0);
  payloadBytes.set(textEncoder.encode("II"), 6);
  payloadBytes[8] = 0x2a;
  payloadBytes[9] = 0x00;
  payloadBytes[10] = 0x08;
  payloadBytes[11] = 0x00;
  payloadBytes[14] = 0x01;
  payloadBytes[16] = 0x12;
  payloadBytes[17] = 0x01;
  payloadBytes[18] = 0x03;
  payloadBytes[20] = 0x01;
  payloadBytes[24] = orientation;
  return app1Segment(payloadBytes);
}

function invalidMagicExifSegment(): Uint8Array {
  const payloadBytes = new Uint8Array(32);
  payloadBytes.set(textEncoder.encode("Exif\0\0"), 0);
  payloadBytes.set(textEncoder.encode("MM"), 6);
  payloadBytes[8] = 0x00;
  payloadBytes[9] = 0x2b;
  return app1Segment(payloadBytes);
}

function unknownEndianExifSegment(): Uint8Array {
  const payloadBytes = new Uint8Array(32);
  payloadBytes.set(textEncoder.encode("Exif\0\0"), 0);
  payloadBytes.set(textEncoder.encode("ZZ"), 6);
  return app1Segment(payloadBytes);
}

function outOfBoundsIfdExifSegment(): Uint8Array {
  const payloadBytes = new Uint8Array(32);
  payloadBytes.set(textEncoder.encode("Exif\0\0"), 0);
  payloadBytes.set(textEncoder.encode("MM"), 6);
  payloadBytes[8] = 0x00;
  payloadBytes[9] = 0x2a;
  payloadBytes[10] = 0xff;
  payloadBytes[11] = 0xff;
  return app1Segment(payloadBytes);
}

function truncatedEntryExifSegment(): Uint8Array {
  const payloadBytes = new Uint8Array(32);
  payloadBytes.set(textEncoder.encode("Exif\0\0"), 0);
  payloadBytes.set(textEncoder.encode("MM"), 6);
  payloadBytes[8] = 0x00;
  payloadBytes[9] = 0x2a;
  payloadBytes[13] = 0x14;
  payloadBytes[27] = 0x01;
  return app1Segment(payloadBytes);
}

function exifWithoutOrientationSegment(): Uint8Array {
  const payloadBytes = new Uint8Array(32);
  payloadBytes.set(textEncoder.encode("Exif\0\0"), 0);
  payloadBytes.set(textEncoder.encode("MM"), 6);
  payloadBytes[8] = 0x00;
  payloadBytes[9] = 0x2a;
  payloadBytes[13] = 0x08;
  payloadBytes[15] = 0x01;
  payloadBytes[16] = 0x99;
  payloadBytes[17] = 0x99;
  payloadBytes[19] = 0x03;
  payloadBytes[23] = 0x01;
  return app1Segment(payloadBytes);
}

describe("smoke image-cover helpers", () => {
  it("builds an oriented JPEG fixture with a dirty APP1 marker", async () => {
    const cleanFixture = new Uint8Array(await readFile(ORIENTED_JPEG_FIXTURE_PATH));
    const dirtyFixture = addDirtyApp1Marker(cleanFixture);

    expect(extractJpegExifOrientation(cleanFixture)).toBe(6);
    expect(extractJpegExifOrientation(dirtyFixture)).toBe(6);
    expect(bytesContainAscii(dirtyFixture, DIRTY_APP1_MARKER)).toBe(true);
    expect(base64FromBytes(dirtyFixture)).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("handles malformed and little-endian JPEG metadata", () => {
    expect(() => addDirtyApp1Marker(new Uint8Array([0x00]))).toThrow(/SOI/);
    expect(extractJpegExifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda]))).toBeNull();
    expect(extractJpegExifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x20]))).toBeNull();
    expect(extractJpegExifOrientation(jpegWithSegments([new Uint8Array([0xff, 0xe0, 0x00, 0x02])]))).toBeNull();
    expect(extractJpegExifOrientation(jpegWithSegments([app1Segment(new Uint8Array([0x45]))]))).toBeNull();
    expect(extractJpegExifOrientation(jpegWithSegments([app1Segment(textEncoder.encode("not exif"))]))).toBeNull();
    expect(extractJpegExifOrientation(jpegWithSegments([unknownEndianExifSegment()]))).toBeNull();
    expect(extractJpegExifOrientation(jpegWithSegments([invalidMagicExifSegment()]))).toBeNull();
    expect(extractJpegExifOrientation(jpegWithSegments([outOfBoundsIfdExifSegment()]))).toBeNull();
    expect(extractJpegExifOrientation(jpegWithSegments([truncatedEntryExifSegment()]))).toBeNull();
    expect(extractJpegExifOrientation(jpegWithSegments([exifWithoutOrientationSegment()]))).toBeNull();
    expect(extractJpegExifOrientation(jpegWithSegments([littleEndianExifOrientationSegment(8)]))).toBe(8);
    expect(bytesContainAscii(new Uint8Array([0x61, 0x62, 0x63]), "z")).toBe(false);
  });

  it("extracts and validates only run-owned upload keys and observed generated cover keys", () => {
    expect(photoKeyFromImageUrl("/photos/recipes/user-1/uploads/photo.jpg")).toBe("recipes/user-1/uploads/photo.jpg");
    expect(photoKeyFromImageUrl("/photos/spoons/user-1/uploads/photo.png")).toBe("spoons/user-1/uploads/photo.png");
    expect(photoKeyFromImageUrl("/photos/covers/123-generated.png")).toBe("covers/123-generated.png");
    expect(() => photoKeyFromImageUrl("https://cdn.example.com/photo.jpg")).toThrow(/\/photos\//);
    expect(() => photoKeyFromImageUrl("/photos/")).toThrow(/Unsafe Spoonjoy photo URL/);
    expect(() => photoKeyFromImageUrl("/photos/recipes/user-1/uploads/photo.jpg?x=1")).toThrow(/Unsafe Spoonjoy photo URL/);

    expect(validateSmokePhotoKey("recipes/user-1/uploads/photo.jpg", { ownerId: "user-1" })).toBe("recipes/user-1/uploads/photo.jpg");
    expect(validateSmokePhotoKey("spoons/user-1/uploads/photo.png", { ownerId: "user-1" })).toBe("spoons/user-1/uploads/photo.png");
    expect(validateSmokePhotoKey("covers/123-generated.png", {
      ownerId: "user-1",
      generatedCoverKeys: new Set(["covers/123-generated.png"]),
    })).toBe("covers/123-generated.png");
    expect(() => validateSmokePhotoKey("recipes/user-2/uploads/photo.jpg", { ownerId: "user-1" })).toThrow(/outside this smoke user/);
    expect(() => validateSmokePhotoKey("profiles/user-1/photo.jpg", { ownerId: "user-1" })).toThrow(/unsafe smoke photo key/);
    expect(() => validateSmokePhotoKey("recipes/user-1/archive/photo.jpg", { ownerId: "user-1" })).toThrow(/unsafe smoke photo key/);
    expect(() => validateSmokePhotoKey("covers/456-generated.png", {
      ownerId: "user-1",
      generatedCoverKeys: new Set(["covers/123-generated.png"]),
    })).toThrow(/not created by this smoke run/);
  });

  it("builds legacy API tool request shapes with the expected URL, body, and bearer header", () => {
    const request = buildApiToolRequest(QA_BASE_URL, "upload_recipe_image", {
      filename: "dish.jpg",
      mimeType: "image/jpeg",
    }, "sj_secret_token");

    expect(request.url).toBe(`${QA_BASE_URL}/api/tools/upload_recipe_image`);
    expect(request.options).toEqual({
      headers: {
        Authorization: "Bearer sj_secret_token",
        "Content-Type": "application/json",
      },
      data: {
        filename: "dish.jpg",
        mimeType: "image/jpeg",
      },
    });
  });

  it("uses explicit smoke token scopes and revokes the created credential through the session", () => {
    expect(SMOKE_TOKEN_SCOPES).toEqual(["recipes:read", "kitchen:write"]);
    expect(buildCreateSmokeTokenArgs("abc123")).toEqual({
      name: "Codex image-cover smoke abc123",
      scopes: ["recipes:read", "kitchen:write"],
    });

    const request = buildRevokeSmokeTokenRequest(QA_BASE_URL, "credential-1");
    expect(request.url).toBe(`${QA_BASE_URL}/api/tools/revoke_api_token`);
    expect(request.options).toEqual({
      headers: { "Content-Type": "application/json" },
      data: { credentialId: "credential-1" },
    });
  });

  it("builds MCP tools/call request shapes with JSON-RPC body and bearer header", () => {
    const request = buildMcpToolRequest(QA_BASE_URL, "sj_secret_token", 7, "list_recipe_covers", {
      recipeId: "recipe-1",
    });

    expect(request.url).toBe(`${QA_BASE_URL}/mcp`);
    expect(request.options).toEqual({
      headers: {
        Authorization: "Bearer sj_secret_token",
        "Content-Type": "application/json",
      },
      data: {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: {
          name: "list_recipe_covers",
          arguments: { recipeId: "recipe-1" },
        },
      },
    });
  });

  it("builds MCP tools/list as its own JSON-RPC method", () => {
    const request = buildMcpToolsListRequest(QA_BASE_URL, "sj_secret_token", 4);

    expect(request.url).toBe(`${QA_BASE_URL}/mcp`);
    expect(request.options).toEqual({
      headers: {
        Authorization: "Bearer sj_secret_token",
        "Content-Type": "application/json",
      },
      data: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
      },
    });
  });

  it("parses API and MCP tool payloads while surfacing failures", () => {
    expect(parseApiToolPayload({ ok: true, data: { token: "sj_token" } })).toEqual({ token: "sj_token" });
    expect(() => parseApiToolPayload({ ok: false, error: { message: "Nope", status: 400 } })).toThrow("Nope");
    expect(() => parseApiToolPayload({ ok: false, error: { status: 500 } })).toThrow(/Legacy API tool request failed/);
    expect(() => parseApiToolPayload({ data: {} })).toThrow(/legacy API tool response/);

    expect(parseMcpToolPayload({
      result: { content: [{ type: "text", text: JSON.stringify({ cover: { id: "cover-1" } }) }] },
    })).toEqual({ cover: { id: "cover-1" } });
    expect(() => parseMcpToolPayload({ error: { message: "Bad MCP" } })).toThrow("Bad MCP");
    expect(() => parseMcpToolPayload({ error: "bad" })).toThrow(/MCP tool request failed/);
    expect(() => parseMcpToolPayload({ result: { content: [] } })).toThrow(/MCP tool response/);
  });

  it("parses QA secret output and enforces placeholder plus edit-provider prerequisites", () => {
    const names = parseWranglerSecretNames(JSON.stringify([
      { name: "SESSION_SECRET" },
      { name: "OPENAI_API_KEY" },
      { name: "GEMINI_API_KEY" },
    ]));

    expect(names).toEqual(["SESSION_SECRET", "OPENAI_API_KEY", "GEMINI_API_KEY"]);
    expect(assertQaImageProviderSecrets(names)).toEqual({
      placeholderProvider: "openai",
      editProviders: ["openai", "gemini"],
    });
    expect(assertQaImageProviderSecrets(["OPENAI_API_KEY"])).toEqual({
      placeholderProvider: "openai",
      editProviders: ["openai"],
    });
    expect(assertQaImageProviderSecrets(["GOOGLE_API_KEY"])).toEqual({
      placeholderProvider: "gemini",
      editProviders: ["gemini"],
    });
    expect(assertQaImageProviderSecrets(["GEMINI_API_KEY"])).toEqual({
      placeholderProvider: "gemini",
      editProviders: ["gemini"],
    });
    expect(() => assertQaImageProviderSecrets(["SESSION_SECRET"])).toThrow(/OPENAI_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY/);
    expect(() => parseWranglerSecretNames("not json")).toThrow(/secret output/);
    expect(() => parseWranglerSecretNames("[not-json]")).toThrow(/Could not parse/);
    expect(() => parseWranglerSecretNames("{}")).toThrow(/secret output/);
    expect(() => parseWranglerSecretNames("[{}]")).not.toThrow();
    expect(parseWranglerSecretNames(JSON.stringify([null, "bad", { name: "" }, { name: "OPENAI_API_KEY" }]))).toEqual([
      "OPENAI_API_KEY",
    ]);
  });

  it("names every MCP tool the image-cover smoke must prove", () => {
    expect(IMAGE_COVER_REQUIRED_MCP_TOOLS).toEqual([
      "create_spoon",
      "list_recipe_spoon_images",
      "create_recipe_cover_from_upload",
      "create_recipe_cover_from_spoon",
      "regenerate_recipe_cover",
      "get_cover_generation_status",
      "set_active_recipe_cover",
      "archive_recipe_cover",
      "list_recipe_covers",
    ]);
  });
});

describe("image-cover live smoke flow", () => {
  it("runs preflight before mutation, proves API/MCP operations, provenance, and exact cleanup", async () => {
    const harness = createFlowHarness();

    const report = await runImageCoverSmokeFlow(harness.options);

    expect(harness.calls[0]).toEqual({ kind: "secrets" });
    const createTokenCall = harness.calls.find((call) => call.kind === "api" && call.name === "create_api_token");
    expect(createTokenCall?.args).toEqual({
      name: "Codex image-cover smoke unit2a",
      scopes: ["recipes:read", "kitchen:write"],
    });

    const listToolsIndex = harness.calls.findIndex((call) => call.kind === "mcp-tools-list");
    const firstMcpIndex = harness.calls.findIndex((call) => call.kind === "mcp");
    expect(listToolsIndex).toBeGreaterThan(-1);
    expect(firstMcpIndex).toBeGreaterThan(listToolsIndex);

    const listCoverIndexes = harness.calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.kind === "mcp" && call.name === "list_recipe_covers")
      .map(({ index }) => index);
    const uploadIndex = harness.calls.findIndex((call) => call.kind === "api" && call.name === "upload_recipe_image");
    expect(listCoverIndexes.length).toBeGreaterThanOrEqual(2);
    expect(uploadIndex).toBeGreaterThan(listCoverIndexes[1]);

    const uploadRecipeCall = harness.calls.find((call) => call.kind === "api" && call.name === "upload_recipe_image");
    expect(uploadRecipeCall?.args).toMatchObject({
      filename: "codex-smoke-oriented-unit2a.jpg",
      mimeType: "image/jpeg",
    });
    const uploadedBytes = Buffer.from(String((uploadRecipeCall?.args as { imageBase64: string }).imageBase64), "base64");
    expect(bytesContainAscii(uploadedBytes, DIRTY_APP1_MARKER)).toBe(true);

    const gifRejection = harness.calls.find((call) => call.kind === "api-failure" && call.name === "upload_recipe_image");
    expect(gifRejection?.args).toMatchObject({
      filename: "codex-smoke-rejected-unit2a.gif",
      mimeType: "image/gif",
    });

    const mcpToolNames = harness.calls
      .filter((call) => call.kind === "mcp")
      .map((call) => call.name);
    expect(mcpToolNames).toEqual(expect.arrayContaining(IMAGE_COVER_REQUIRED_MCP_TOOLS));

    expect(report.exif).toEqual({
      sourceOrientation: 6,
      storedOrientation: 6,
      dirtyMarkerRemoved: true,
    });
    expect(report.provenanceLabels).toEqual(expect.arrayContaining([
      "AI generated",
      "Chef photo",
      "Editorialized chef photo",
    ]));
    expect(report.operations).toEqual(expect.arrayContaining([
      "tools/list",
      "upload_recipe_image",
      "upload_recipe_image:gif_rejected",
      "upload_spoon_photo",
      "create_spoon",
      "list_recipe_spoon_images",
      "create_recipe_cover_from_upload",
      "create_recipe_cover_from_spoon",
      "regenerate_recipe_cover",
      "get_cover_generation_status",
      "set_active_recipe_cover",
      "archive_recipe_cover",
      "list_recipe_covers",
    ]));
    expect(report.coverIds).toEqual(expect.arrayContaining([
      "cover-ai",
      "cover-chef",
      "cover-editorial",
      "cover-spoon",
    ]));
    expect(report.imageUrls).toEqual(expect.arrayContaining([
      "/photos/recipes/user-1/uploads/oriented.jpg",
      "/photos/spoons/user-1/uploads/spoon.png",
      "/photos/covers/ai-placeholder.jpg",
      "/photos/covers/editorial.jpg",
      "/photos/covers/spoon-editorial.jpg",
    ]));
    expect(report.generationPolling).toEqual(expect.arrayContaining([
      { coverId: "cover-editorial", status: "ready", generationStatus: "succeeded" },
      { coverId: "cover-spoon", status: "ready", generationStatus: "succeeded" },
    ]));
    expect(report.r2.deletedKeys).toEqual(expect.arrayContaining([
      "recipes/user-1/uploads/oriented.jpg",
      "spoons/user-1/uploads/spoon.png",
      "covers/ai-placeholder.jpg",
      "covers/editorial.jpg",
      "covers/spoon-editorial.jpg",
    ]));
    expect(harness.verifiedDeletedKeys).toEqual(expect.arrayContaining(report.r2.deletedKeys));
    expect(report.credentialRevocation).toMatchObject({ credentialId: "credential-1", revoked: true });
  });

  it("refuses to mutate QA before provider preflight succeeds", async () => {
    const harness = createFlowHarness({
      listQaSecretNames: vi.fn(async () => {
        harness.calls.push({ kind: "secrets" });
        return ["SESSION_SECRET"];
      }),
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/image provider secret/);
    expect(harness.calls).toEqual([{ kind: "secrets" }]);
    expect(harness.deletedKeys).toEqual([]);
  });

  it("fails before image mutation when token creation does not return a bearer token", async () => {
    const harness = createFlowHarness({
      apiTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
        harness.calls.push({ kind: "api", name, args });
        if (name === "create_api_token") return { credential: { id: "credential-1" } };
        if (name === "revoke_api_token") return { revoked: true, credential: { id: args.credentialId } };
        throw new Error(`Unexpected API tool ${name}`);
      }),
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/scoped API token/);
    expect(harness.calls.some((call) => call.kind === "api" && call.name === "upload_recipe_image")).toBe(false);
  });

  it("times out waiting for the browser-created AI placeholder before uploads", async () => {
    const harness = createFlowHarness();
    harness.options.mcpTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
      harness.calls.push({ kind: "mcp", name, args });
      if (name === "list_recipe_covers") return {};
      throw new Error(`Unexpected MCP tool ${name}`);
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/AI generated placeholder/);
    expect(harness.calls.some((call) => call.kind === "api" && call.name === "upload_recipe_image")).toBe(false);
  });

  it("ignores malformed cover rows while waiting for the AI placeholder", async () => {
    const harness = createFlowHarness();
    const originalMcpTool = harness.options.mcpTool;
    let listCalls = 0;
    harness.options.mcpTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "list_recipe_covers") {
        listCalls += 1;
        if (listCalls === 1) {
          harness.calls.push({ kind: "mcp", name, args });
          return { covers: [{ provenanceLabel: "AI generated", imageUrl: "/photos/covers/malformed.jpg" }] };
        }
      }
      return originalMcpTool(name, args);
    });

    const report = await runImageCoverSmokeFlow(harness.options);

    expect(report.coverIds).not.toContain(undefined);
    expect(report.r2.deletedKeys).toEqual(expect.arrayContaining(["covers/ai-placeholder.jpg"]));
  });

  it("rejects upload URLs outside owner upload namespaces", async () => {
    const harness = createFlowHarness();
    const originalApiTool = harness.options.apiTool;
    harness.options.apiTool = vi.fn(async (name: string, args: Record<string, unknown>, bearerToken: string) => {
      harness.calls.push({ kind: "api", name, args });
      if (name === "upload_recipe_image") {
        return { imageUrl: "/photos/profiles/user-1/photo.jpg", mimeType: "image/jpeg", sizeBytes: 1024 };
      }
      return originalApiTool(name, args, bearerToken);
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/unsafe smoke photo key/);
  });

  it("rejects stored images that keep dirty metadata or lose orientation", async () => {
    const harness = createFlowHarness({
      downloadPhotoBytes: vi.fn(async () => addDirtyApp1Marker(new Uint8Array(await readFile(ORIENTED_JPEG_FIXTURE_PATH)))),
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/preserve orientation/);
    expect(harness.deletedKeys).toEqual(expect.arrayContaining([
      "recipes/user-1/uploads/oriented.jpg",
      "covers/ai-placeholder.jpg",
    ]));
  });

  it("rejects generation status responses without a cover payload", async () => {
    const harness = createFlowHarness();
    const originalMcpTool = harness.options.mcpTool;
    harness.options.mcpTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "get_cover_generation_status") {
        harness.calls.push({ kind: "mcp", name, args });
        return {};
      }
      return originalMcpTool(name, args);
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/generation status cover payload/);
  });

  it("cleans exact observed R2 keys and revokes the credential when the flow fails", async () => {
    const harness = createFlowHarness();
    const originalMcpTool = harness.options.mcpTool;
    harness.options.mcpTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "create_recipe_cover_from_upload") {
        throw new Error("cover creation failed");
      }
      return originalMcpTool(name, args);
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/cover creation failed/);

    const revokeCall = harness.calls.find((call) => call.kind === "api" && call.name === "revoke_api_token");
    expect(revokeCall?.args).toEqual({ credentialId: "credential-1" });
    expect(harness.deletedKeys).toEqual(expect.arrayContaining([
      "recipes/user-1/uploads/oriented.jpg",
      "covers/ai-placeholder.jpg",
    ]));
    expect(harness.verifiedDeletedKeys).toEqual(expect.arrayContaining(harness.deletedKeys));
  });

  it("rejects a missing MCP image-cover tool before running MCP mutations", async () => {
    const harness = createFlowHarness({
      mcpToolsList: vi.fn(async () => {
        harness.calls.push({ kind: "mcp-tools-list" });
        return {};
      }),
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/archive_recipe_cover/);
    expect(harness.calls.some((call) => call.kind === "mcp" && call.name === "create_spoon")).toBe(false);
  });

  it.each([
    {
      label: "spoon id",
      expected: /could not create a spoon/i,
      mutate: (name: string) => name === "create_spoon",
    },
    {
      label: "chef-photo cover id",
      expected: /chef-photo cover/i,
      mutate: (name: string, args: Record<string, unknown>) =>
        name === "create_recipe_cover_from_upload" && args.generateEditorial === false,
    },
    {
      label: "editorial upload cover id",
      expected: /editorial upload cover/i,
      mutate: (name: string, args: Record<string, unknown>) =>
        name === "create_recipe_cover_from_upload" && args.generateEditorial === true,
    },
    {
      label: "editorial spoon cover id",
      expected: /editorial spoon cover/i,
      mutate: (name: string) => name === "create_recipe_cover_from_spoon",
    },
  ])("fails cleanly when MCP omits $label", async ({ expected, mutate }) => {
    const harness = createFlowHarness();
    const originalMcpTool = harness.options.mcpTool;
    harness.options.mcpTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (mutate(name, args)) {
        harness.calls.push({ kind: "mcp", name, args });
        return {};
      }
      return originalMcpTool(name, args);
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(expected);
    expect(harness.deletedKeys).toEqual(expect.arrayContaining([
      "recipes/user-1/uploads/oriented.jpg",
      "spoons/user-1/uploads/spoon.png",
      "covers/ai-placeholder.jpg",
    ]));
  });

  it("fails if the final cover state does not prove every provenance label", async () => {
    const harness = createFlowHarness();
    const originalMcpTool = harness.options.mcpTool;
    harness.options.mcpTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
      const payload = await originalMcpTool(name, args);
      const scrub = (cover: Record<string, unknown> | null | undefined) =>
        cover?.provenanceLabel === "Editorialized chef photo" ? { ...cover, provenanceLabel: null } : cover;
      return {
        ...payload,
        covers: Array.isArray(payload?.covers) ? payload.covers.map(scrub) : payload?.covers,
        cover: scrub(payload?.cover),
        activeCover: scrub(payload?.activeCover),
        createdCover: scrub(payload?.createdCover),
        archivedCover: scrub(payload?.archivedCover),
        previousActiveCover: scrub(payload?.previousActiveCover),
      };
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/Editorialized chef photo/);
  });

  it("surfaces cleanup failures when the flow itself succeeds", async () => {
    const harness = createFlowHarness({
      deleteQaR2Object: vi.fn(async (key: string) => {
        throw new Error(`delete failed for ${key}`);
      }),
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/delete failed/);
  });

  it("fails when credential revocation does not revoke the smoke token", async () => {
    const harness = createFlowHarness();
    const originalApiTool = harness.options.apiTool;
    harness.options.apiTool = vi.fn(async (name: string, args: Record<string, unknown>, bearerToken: string) => {
      if (name === "revoke_api_token") {
        harness.calls.push({ kind: "api", name, args });
        return { revoked: false, credential: { id: args.credentialId, revokedAt: null } };
      }
      return originalApiTool(name, args, bearerToken);
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/credential was not revoked/);
    expect(harness.deletedKeys.length).toBeGreaterThan(0);
    expect(harness.verifiedDeletedKeys).toEqual(expect.arrayContaining(harness.deletedKeys));
  });

  it("still cleans R2 objects when credential revocation throws", async () => {
    const harness = createFlowHarness();
    const originalApiTool = harness.options.apiTool;
    harness.options.apiTool = vi.fn(async (name: string, args: Record<string, unknown>, bearerToken: string) => {
      if (name === "revoke_api_token") {
        harness.calls.push({ kind: "api", name, args });
        throw new Error("revocation failed");
      }
      return originalApiTool(name, args, bearerToken);
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/revocation failed/);
    expect(harness.deletedKeys.length).toBeGreaterThan(0);
    expect(harness.verifiedDeletedKeys).toEqual(expect.arrayContaining(harness.deletedKeys));
  });

  it("surfaces R2 verification failures after deleting the recorded keys", async () => {
    const harness = createFlowHarness({
      verifyQaR2ObjectDeleted: vi.fn(async () => {
        throw new Error("verify failed");
      }),
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/verify failed/);
    expect(harness.deletedKeys.length).toBeGreaterThan(0);
  });

  it("preserves the original flow error when cleanup also fails", async () => {
    const harness = createFlowHarness({
      deleteQaR2Object: vi.fn(async () => {
        throw new Error("cleanup failed too");
      }),
    });
    const originalMcpTool = harness.options.mcpTool;
    harness.options.mcpTool = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "create_recipe_cover_from_upload") {
        throw new Error("cover creation failed");
      }
      return originalMcpTool(name, args);
    });

    await expect(runImageCoverSmokeFlow(harness.options)).rejects.toThrow(/cover creation failed/);
  });
});

describe("pollCoverGeneration", () => {
  it("uses default polling settings when they are omitted", async () => {
    vi.useFakeTimers();
    const getStatus = vi.fn()
      .mockResolvedValueOnce({ cover: { id: "cover-1", generationStatus: "processing", status: "processing" } })
      .mockResolvedValueOnce({ cover: { id: "cover-1", status: "ready" } });

    const promise = pollCoverGeneration({
      recipeId: "recipe-1",
      coverId: "cover-1",
      getStatus,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(promise).resolves.toMatchObject({ cover: { status: "ready" } });
    vi.useRealTimers();
  });

  it("polls until a cover reaches a succeeded terminal state", async () => {
    const statuses = [
      { cover: { id: "cover-1", generationStatus: "processing", status: "processing" } },
      { cover: { id: "cover-1", generationStatus: "processing", status: "processing" } },
      { cover: { id: "cover-1", generationStatus: "succeeded", status: "ready" } },
    ];
    const wait = vi.fn(async () => undefined);
    const getStatus = vi.fn(async () => statuses.shift());

    await expect(pollCoverGeneration({
      recipeId: "recipe-1",
      coverId: "cover-1",
      maxAttempts: 3,
      delayMs: 7,
      wait,
      getStatus,
    })).resolves.toMatchObject({ cover: { generationStatus: "succeeded" } });

    expect(getStatus).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(7);
  });

  it("surfaces failed cover generation without extra polling", async () => {
    await expect(pollCoverGeneration({
      recipeId: "recipe-1",
      coverId: "cover-1",
      maxAttempts: 3,
      delayMs: 7,
      wait: vi.fn(async () => undefined),
      getStatus: vi.fn(async () => ({
        cover: {
          id: "cover-1",
          generationStatus: "failed",
          status: "ready",
          failureReason: "provider quota",
        },
      })),
    })).rejects.toThrow(/provider quota/);
  });

  it("uses a fallback failure message when the provider omits a reason", async () => {
    await expect(pollCoverGeneration({
      recipeId: "recipe-1",
      coverId: "cover-1",
      maxAttempts: 3,
      delayMs: 7,
      wait: vi.fn(async () => undefined),
      getStatus: vi.fn(async () => ({
        cover: { id: "cover-1", generationStatus: "failed", status: "failed" },
      })),
    })).rejects.toThrow(/Cover generation failed for cover-1/);
  });

  it("times out after the fixed attempt budget", async () => {
    const wait = vi.fn(async () => undefined);
    const getStatus = vi.fn(async () => ({
      cover: { id: "cover-1", generationStatus: "processing", status: "processing" },
    }));

    await expect(pollCoverGeneration({
      recipeId: "recipe-1",
      coverId: "cover-1",
      maxAttempts: 2,
      delayMs: 7,
      wait,
      getStatus,
    })).rejects.toThrow(/timed out/i);

    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});
