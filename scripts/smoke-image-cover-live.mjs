import { Buffer } from "node:buffer";

export const ORIENTED_JPEG_FIXTURE_PATH = "e2e/fixtures/asymmetric-exif-orientation.jpg";
export const DIRTY_APP1_MARKER = "SPOONJOY_CODEX_DIRTY_APP1";
export const SMOKE_TOKEN_SCOPES = ["recipes:read", "kitchen:write"];
export const IMAGE_COVER_REQUIRED_MCP_TOOLS = [
  "create_spoon",
  "list_recipe_spoon_images",
  "create_recipe_cover_from_upload",
  "create_recipe_cover_from_spoon",
  "regenerate_recipe_cover",
  "get_cover_generation_status",
  "set_active_recipe_cover",
  "archive_recipe_cover",
  "list_recipe_covers",
];

const EXIF_HEADER = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);

function jsonHeaders(bearerToken) {
  return bearerToken
    ? { Authorization: `Bearer ${bearerToken}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

function smokeUrl(baseUrl, pathname) {
  return new URL(pathname, baseUrl).toString();
}

function readUint16(bytes, offset, littleEndian) {
  return littleEndian
    ? bytes[offset] | (bytes[offset + 1] << 8)
    : (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes, offset, littleEndian) {
  return littleEndian
    ? (
        bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)
      ) >>> 0
    : (
        (bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]
      ) >>> 0;
}

function hasPrefix(bytes, prefix) {
  if (bytes.length < prefix.length) return false;
  return prefix.every((byte, index) => bytes[index] === byte);
}

function parseExifOrientation(payload) {
  if (!hasPrefix(payload, EXIF_HEADER) || payload.length < 32) return null;
  const tiffOffset = EXIF_HEADER.length;
  const littleEndian = payload[tiffOffset] === 0x49 && payload[tiffOffset + 1] === 0x49;
  const bigEndian = payload[tiffOffset] === 0x4d && payload[tiffOffset + 1] === 0x4d;
  if (!littleEndian && !bigEndian) return null;
  if (readUint16(payload, tiffOffset + 2, littleEndian) !== 42) return null;

  const ifdStart = tiffOffset + readUint32(payload, tiffOffset + 4, littleEndian);
  if (ifdStart + 2 > payload.length) return null;
  const entryCount = readUint16(payload, ifdStart, littleEndian);
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifdStart + 2 + index * 12;
    if (entryOffset + 12 > payload.length) return null;
    const tag = readUint16(payload, entryOffset, littleEndian);
    const type = readUint16(payload, entryOffset + 2, littleEndian);
    const count = readUint32(payload, entryOffset + 4, littleEndian);
    if (tag === 0x0112 && type === 3 && count === 1) {
      return readUint16(payload, entryOffset + 8, littleEndian);
    }
  }
  return null;
}

function app1Segment(payload) {
  const length = payload.length + 2;
  return new Uint8Array([
    0xff,
    0xe1,
    (length >> 8) & 0xff,
    length & 0xff,
    ...payload,
  ]);
}

export function addDirtyApp1Marker(bytes) {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("JPEG fixture must start with SOI bytes.");
  }
  const payload = new TextEncoder().encode(DIRTY_APP1_MARKER);
  return new Uint8Array([
    bytes[0],
    bytes[1],
    ...app1Segment(payload),
    ...bytes.slice(2),
  ]);
}

export function extractJpegExifOrientation(bytes) {
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.length) break;
    if (marker === 0xe1) {
      const orientation = parseExifOrientation(bytes.subarray(offset + 4, segmentEnd));
      if (orientation !== null) return orientation;
    }
    offset = segmentEnd;
  }
  return null;
}

export function base64FromBytes(bytes) {
  return Buffer.from(bytes).toString("base64");
}

export function bytesContainAscii(bytes, value) {
  return new TextDecoder().decode(bytes).includes(value);
}

export function photoKeyFromImageUrl(imageUrl) {
  if (typeof imageUrl !== "string" || !imageUrl.startsWith("/photos/")) {
    throw new Error("Expected a Spoonjoy /photos/ image URL.");
  }
  const key = imageUrl.slice("/photos/".length);
  if (!key || key.includes("..") || key.includes("?") || key.includes("#")) {
    throw new Error("Unsafe Spoonjoy photo URL.");
  }
  return key;
}

export function validateSmokePhotoKey(key, { ownerId, generatedCoverKeys = new Set() }) {
  const recipePrefix = `recipes/${ownerId}/uploads/`;
  const spoonPrefix = `spoons/${ownerId}/uploads/`;
  if (key.startsWith(recipePrefix) || key.startsWith(spoonPrefix)) return key;
  if (key.startsWith(`recipes/${ownerId}/`) || key.startsWith(`spoons/${ownerId}/`)) {
    throw new Error("unsafe smoke photo key.");
  }
  if (key.startsWith("recipes/") || key.startsWith("spoons/")) {
    throw new Error("Photo key is outside this smoke user.");
  }
  if (key.startsWith("covers/")) {
    if (generatedCoverKeys.has(key)) return key;
    throw new Error("Generated cover key was not created by this smoke run.");
  }
  throw new Error("unsafe smoke photo key.");
}

export function buildApiToolRequest(baseUrl, operation, args, bearerToken) {
  return {
    url: smokeUrl(baseUrl, `/api/tools/${operation}`),
    options: {
      headers: jsonHeaders(bearerToken),
      data: args,
    },
  };
}

export function buildMcpToolRequest(baseUrl, bearerToken, id, name, args) {
  return {
    url: smokeUrl(baseUrl, "/mcp"),
    options: {
      headers: jsonHeaders(bearerToken),
      data: {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name, arguments: args },
      },
    },
  };
}

export function buildMcpToolsListRequest(baseUrl, bearerToken, id) {
  return {
    url: smokeUrl(baseUrl, "/mcp"),
    options: {
      headers: jsonHeaders(bearerToken),
      data: {
        jsonrpc: "2.0",
        id,
        method: "tools/list",
      },
    },
  };
}

export function buildCreateSmokeTokenArgs(stamp) {
  return {
    name: `Codex image-cover smoke ${stamp}`,
    scopes: SMOKE_TOKEN_SCOPES,
  };
}

export function buildRevokeSmokeTokenRequest(baseUrl, credentialId) {
  return buildApiToolRequest(baseUrl, "revoke_api_token", { credentialId });
}

export function parseApiToolPayload(payload) {
  if (!payload || typeof payload !== "object" || !("ok" in payload)) {
    throw new Error("Invalid legacy API tool response.");
  }
  if (payload.ok !== true) {
    const message = payload.error && typeof payload.error === "object" && "message" in payload.error
      ? payload.error.message
      : "Legacy API tool request failed.";
    throw new Error(String(message));
  }
  return payload.data;
}

export function parseMcpToolPayload(payload) {
  if (payload?.error) {
    const message = typeof payload.error === "object" && "message" in payload.error
      ? payload.error.message
      : "MCP tool request failed.";
    throw new Error(String(message));
  }
  const text = payload?.result?.content?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Invalid MCP tool response.");
  }
  return JSON.parse(text);
}

export function parseWranglerSecretNames(stdout) {
  const start = stdout.indexOf("[");
  const end = stdout.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Wrangler secret output did not contain a JSON array.");
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start, end + 1));
  } catch (error) {
    throw new Error("Could not parse Wrangler secret output.");
  }
  return parsed
    .map((row) => row && typeof row === "object" ? row.name : null)
    .filter((name) => typeof name === "string" && name.length > 0);
}

export function assertQaImageProviderSecrets(names) {
  const secrets = new Set(names);
  if (!secrets.has("OPENAI_API_KEY")) {
    throw new Error("QA image-cover smoke requires OPENAI_API_KEY for AI placeholder covers.");
  }
  const editProviders = ["openai"];
  if (secrets.has("GEMINI_API_KEY") || secrets.has("GOOGLE_API_KEY")) editProviders.push("gemini");
  return { placeholderProvider: "openai", editProviders };
}
