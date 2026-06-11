import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

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
  validateSmokePhotoKey,
} from "../../scripts/smoke-image-cover-live.mjs";

const QA_BASE_URL = "https://spoonjoy-v2-qa.mendelow-studio.workers.dev";
const textEncoder = new TextEncoder();

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
    expect(() => assertQaImageProviderSecrets(["GEMINI_API_KEY"])).toThrow(/OPENAI_API_KEY/);
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
