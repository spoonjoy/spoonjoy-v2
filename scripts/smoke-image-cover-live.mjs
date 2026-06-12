import { Buffer } from "node:buffer";

export const ORIENTED_JPEG_FIXTURE_PATH = "e2e/fixtures/asymmetric-exif-orientation.jpg";
export const SPOON_PHOTO_FIXTURE_PATH = "e2e/fixtures/spoon-test-photo.png";
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
const REJECTED_GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);

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
  const hasOpenAi = secrets.has("OPENAI_API_KEY");
  const hasGemini = secrets.has("GEMINI_API_KEY") || secrets.has("GOOGLE_API_KEY");
  if (!hasOpenAi && !hasGemini) {
    throw new Error("QA image-cover smoke requires at least one image provider secret: OPENAI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY.");
  }
  const editProviders = [];
  if (hasOpenAi) editProviders.push("openai");
  if (hasGemini) editProviders.push("gemini");
  return { placeholderProvider: hasOpenAi ? "openai" : "gemini", editProviders };
}

function defaultWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function coverTerminalState(cover) {
  const status = cover?.generationStatus ?? cover?.status;
  if (status === "failed" || cover?.status === "failed") return "failed";
  if (status === "succeeded" || status === "none" || cover?.status === "ready") return "succeeded";
  return "pending";
}

export async function pollCoverGeneration({
  recipeId,
  coverId,
  maxAttempts = 20,
  delayMs = 3_000,
  wait = defaultWait,
  getStatus,
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await getStatus({ recipeId, coverId });
    const state = coverTerminalState(result?.cover);
    if (state === "succeeded") return result;
    if (state === "failed") {
      throw new Error(result?.cover?.failureReason || `Cover generation failed for ${coverId}.`);
    }
    if (attempt < maxAttempts) await wait(delayMs);
  }
  throw new Error(`Cover generation timed out for ${coverId} after ${maxAttempts} attempts.`);
}

function coverListFrom(payload) {
  if (Array.isArray(payload?.covers)) return payload.covers;
  return [];
}

function coverValuesFrom(payload) {
  return [
    ...(Array.isArray(payload?.covers) ? payload.covers : []),
    payload?.cover,
    payload?.activeCover,
    payload?.createdCover,
    payload?.archivedCover,
    payload?.previousActiveCover,
  ].filter(Boolean);
}

function addObservedCoverArtifacts(payload, state) {
  for (const cover of coverValuesFrom(payload)) {
    if (typeof cover.id !== "string" || cover.id.length === 0) continue;
    state.coverIds.add(cover.id);
    if (typeof cover.provenanceLabel === "string" && cover.provenanceLabel.length > 0) {
      state.provenanceLabels.add(cover.provenanceLabel);
    }
    for (const value of [cover.imageUrl, cover.stylizedImageUrl, cover.displayUrl]) {
      if (typeof value !== "string" || !value.startsWith("/photos/")) continue;
      state.imageUrls.add(value);
      const key = photoKeyFromImageUrl(value);
      if (key.startsWith("covers/")) {
        state.generatedCoverKeys.add(key);
      }
      state.r2Keys.add(key);
    }
  }
}

function ownerIdFromUploadKey(key) {
  const match = /^(?:recipes|spoons)\/([^/]+)\/uploads\//.exec(key);
  return match ? match[1] : null;
}

function validateRequiredMcpTools(payload) {
  const names = new Set((payload?.tools ?? []).map((tool) => tool?.name).filter((name) => typeof name === "string"));
  const missing = IMAGE_COVER_REQUIRED_MCP_TOOLS.filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing required MCP image-cover tools: ${missing.join(", ")}`);
  }
}

async function waitForAiPlaceholder({ recipeId, mcpTool, maxAttempts, delayMs, wait }, state) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const payload = await mcpTool("list_recipe_covers", { recipeId, includeArchived: true, limit: 50 });
    addObservedCoverArtifacts(payload, state);
    const aiCover = coverListFrom(payload).find((cover) => cover?.provenanceLabel === "AI generated");
    if (aiCover && coverTerminalState(aiCover) === "succeeded" && (aiCover.imageUrl || aiCover.displayUrl)) {
      return aiCover;
    }
    if (attempt < maxAttempts) await wait(delayMs);
  }
  throw new Error(`AI generated placeholder cover was not ready for recipe ${recipeId}.`);
}

async function cleanupSmokeArtifacts(options, state) {
  let cleanupError = null;

  if (state.credentialId) {
    try {
      const revokePayload = await options.apiTool("revoke_api_token", { credentialId: state.credentialId });
      state.credentialRevocation = {
        credentialId: state.credentialId,
        revoked: revokePayload?.revoked === true,
        payload: revokePayload,
      };
      if (!state.credentialRevocation.revoked) {
        cleanupError = new Error(`Image-cover smoke credential was not revoked: ${state.credentialId}`);
      }
    } catch (error) {
      state.credentialRevocation = {
        credentialId: state.credentialId,
        revoked: false,
        error: String(error),
      };
      cleanupError = error;
    }
  }

  const keys = [...state.r2Keys];
  for (const key of keys) {
    try {
      const safeKey = validateSmokePhotoKey(key, {
        ownerId: state.ownerId,
        generatedCoverKeys: state.generatedCoverKeys,
      });
      await options.deleteQaR2Object(safeKey);
      state.deletedKeys.push(safeKey);
    } catch (error) {
      cleanupError ??= error;
    }
  }
  for (const key of state.deletedKeys) {
    try {
      await options.verifyQaR2ObjectDeleted(key);
      state.verifiedDeletedKeys.push(key);
    } catch (error) {
      cleanupError ??= error;
    }
  }

  if (cleanupError) throw cleanupError;
}

function buildFlowReport(options, providerPreflight, state, exif) {
  return {
    baseUrl: options.baseUrl,
    recipeId: options.recipeId,
    recipeTitle: options.recipeTitle,
    providerPreflight,
    tokenScopes: SMOKE_TOKEN_SCOPES,
    operations: state.operations,
    coverIds: [...state.coverIds],
    imageUrls: [...state.imageUrls],
    generationPolling: state.generationPolling,
    exif,
    provenanceLabels: [...state.provenanceLabels],
    r2: {
      deletedKeys: state.deletedKeys,
      verifiedDeletedKeys: state.verifiedDeletedKeys,
      generatedCoverKeys: [...state.generatedCoverKeys],
    },
    credentialRevocation: state.credentialRevocation,
  };
}

export async function runImageCoverSmokeFlow(options) {
  const wait = options.wait;
  const maxPollAttempts = options.maxPollAttempts;
  const pollDelayMs = options.pollDelayMs;
  const state = {
    credentialId: null,
    credentialRevocation: null,
    coverIds: new Set(),
    deletedKeys: [],
    generatedCoverKeys: new Set(),
    generationPolling: [],
    imageUrls: new Set(),
    operations: [],
    ownerId: null,
    provenanceLabels: new Set(),
    r2Keys: new Set(),
    verifiedDeletedKeys: [],
  };
  let providerPreflight;
  let exif = null;
  let flowError;

  try {
    providerPreflight = assertQaImageProviderSecrets(await options.listQaSecretNames());

    const tokenPayload = await options.apiTool("create_api_token", buildCreateSmokeTokenArgs(options.stamp));
    const bearerToken = tokenPayload?.token;
    state.credentialId = tokenPayload?.credential?.id;
    if (!bearerToken || !state.credentialId) {
      throw new Error("Image-cover smoke could not create a scoped API token.");
    }

    validateRequiredMcpTools(await options.mcpToolsList(bearerToken));
    state.operations.push("tools/list");
    await waitForAiPlaceholder({
      recipeId: options.recipeId,
      mcpTool: (name, args) => options.mcpTool(name, args, bearerToken),
      maxAttempts: maxPollAttempts,
      delayMs: pollDelayMs,
      wait,
    }, state);

    const cleanJpegBytes = await options.readFileBytes(ORIENTED_JPEG_FIXTURE_PATH);
    const dirtyJpegBytes = addDirtyApp1Marker(cleanJpegBytes);
    const sourceOrientation = extractJpegExifOrientation(dirtyJpegBytes);
    const recipeUpload = await options.apiTool("upload_recipe_image", {
      imageBase64: base64FromBytes(dirtyJpegBytes),
      mimeType: "image/jpeg",
      filename: `codex-smoke-oriented-${options.stamp}.jpg`,
    }, bearerToken);
    state.operations.push("upload_recipe_image");
    const recipeImageUrl = recipeUpload?.imageUrl;
    const recipeKey = photoKeyFromImageUrl(recipeImageUrl);
    state.ownerId = ownerIdFromUploadKey(recipeKey);
    state.r2Keys.add(validateSmokePhotoKey(recipeKey, {
      ownerId: state.ownerId,
      generatedCoverKeys: state.generatedCoverKeys,
    }));

    await options.expectApiToolFailure("upload_recipe_image", {
      imageBase64: base64FromBytes(REJECTED_GIF_BYTES),
      mimeType: "image/gif",
      filename: `codex-smoke-rejected-${options.stamp}.gif`,
    }, bearerToken);
    state.operations.push("upload_recipe_image:gif_rejected");

    const storedBytes = await options.downloadPhotoBytes(recipeImageUrl);
    exif = {
      sourceOrientation,
      storedOrientation: extractJpegExifOrientation(storedBytes),
      dirtyMarkerRemoved: !bytesContainAscii(storedBytes, DIRTY_APP1_MARKER),
    };
    if (exif.sourceOrientation !== 6 || exif.storedOrientation !== 6 || !exif.dirtyMarkerRemoved) {
      throw new Error("Stored recipe image did not preserve orientation and strip dirty APP1 metadata.");
    }

    const spoonBytes = await options.readFileBytes(SPOON_PHOTO_FIXTURE_PATH);
    const spoonUpload = await options.apiTool("upload_spoon_photo", {
      imageBase64: base64FromBytes(spoonBytes),
      mimeType: "image/png",
      filename: `codex-smoke-spoon-${options.stamp}.png`,
    }, bearerToken);
    state.operations.push("upload_spoon_photo");
    const spoonImageUrl = spoonUpload?.imageUrl;
    const spoonKey = photoKeyFromImageUrl(spoonImageUrl);
    state.r2Keys.add(validateSmokePhotoKey(spoonKey, {
      ownerId: state.ownerId,
      generatedCoverKeys: state.generatedCoverKeys,
    }));

    const callMcp = async (name, args) => {
      state.operations.push(name);
      const payload = await options.mcpTool(name, args, bearerToken);
      addObservedCoverArtifacts(payload, state);
      return payload;
    };
    const pollCover = (coverId) => pollCoverGeneration({
      recipeId: options.recipeId,
      coverId,
      maxAttempts: maxPollAttempts,
      delayMs: pollDelayMs,
      wait,
      getStatus: async (args) => {
        const payload = await callMcp("get_cover_generation_status", args);
        if (!payload?.cover) throw new Error(`Missing generation status cover payload for ${coverId}.`);
        state.generationPolling.push({
          coverId,
          status: payload.cover.status,
          generationStatus: payload.cover.generationStatus,
        });
        return payload;
      },
    });

    const spoonPayload = await callMcp("create_spoon", {
      recipeId: options.recipeId,
      photoUrl: spoonImageUrl,
      note: "Codex image-cover smoke",
    });
    const spoonId = spoonPayload?.spoon?.id;
    if (!spoonId) throw new Error("Image-cover smoke could not create a spoon.");

    await callMcp("list_recipe_spoon_images", { recipeId: options.recipeId, limit: 20 });

    const chefCoverPayload = await callMcp("create_recipe_cover_from_upload", {
      recipeId: options.recipeId,
      imageUrl: recipeImageUrl,
      activate: true,
      generateEditorial: false,
      idempotencyKey: `codex-${options.stamp}-chef-photo`,
    });
    const chefCoverId = chefCoverPayload?.createdCover?.id;
    if (!chefCoverId) throw new Error("Image-cover smoke could not create a chef-photo cover.");

    const editorialPayload = await callMcp("create_recipe_cover_from_upload", {
      recipeId: options.recipeId,
      imageUrl: recipeImageUrl,
      activate: true,
      generateEditorial: true,
      idempotencyKey: `codex-${options.stamp}-editorial-upload`,
    });
    const editorialCoverId = editorialPayload?.createdCover?.id;
    if (!editorialCoverId) throw new Error("Image-cover smoke could not create an editorial upload cover.");
    addObservedCoverArtifacts(await pollCover(editorialCoverId), state);

    const spoonCoverPayload = await callMcp("create_recipe_cover_from_spoon", {
      recipeId: options.recipeId,
      spoonId,
      activate: true,
      generateEditorial: true,
      idempotencyKey: `codex-${options.stamp}-editorial-spoon`,
    });
    const spoonCoverId = spoonCoverPayload?.createdCover?.id;
    if (!spoonCoverId) throw new Error("Image-cover smoke could not create an editorial spoon cover.");
    addObservedCoverArtifacts(await pollCover(spoonCoverId), state);

    await callMcp("regenerate_recipe_cover", {
      recipeId: options.recipeId,
      coverId: editorialCoverId,
      activateWhenReady: true,
      idempotencyKey: `codex-${options.stamp}-regenerate`,
    });
    addObservedCoverArtifacts(await pollCover(editorialCoverId), state);

    await callMcp("set_active_recipe_cover", {
      recipeId: options.recipeId,
      coverId: chefCoverId,
      variant: "image",
      idempotencyKey: `codex-${options.stamp}-set-active`,
    });
    await callMcp("archive_recipe_cover", {
      recipeId: options.recipeId,
      coverId: spoonCoverId,
      replacementCoverId: chefCoverId,
      replacementVariant: "image",
      idempotencyKey: `codex-${options.stamp}-archive`,
    });
    addObservedCoverArtifacts(await callMcp("list_recipe_covers", {
      recipeId: options.recipeId,
      includeArchived: true,
      limit: 50,
    }), state);

    for (const label of ["AI generated", "Chef photo", "Editorialized chef photo"]) {
      if (!state.provenanceLabels.has(label)) {
        throw new Error(`Image-cover smoke did not observe provenance label: ${label}`);
      }
    }
  } catch (error) {
    flowError = error;
  }

  try {
    await cleanupSmokeArtifacts(options, state);
  } catch (cleanupError) {
    if (!flowError) throw cleanupError;
  }

  if (flowError) throw flowError;
  return buildFlowReport(options, providerPreflight, state, exif);
}
