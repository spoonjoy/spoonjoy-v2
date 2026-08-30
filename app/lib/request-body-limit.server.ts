import { IMAGE_MAX_FILE_SIZE } from "~/lib/recipe-image";

export const IMAGE_UPLOAD_JSON_BODY_MAX_BYTES =
  Math.ceil((IMAGE_MAX_FILE_SIZE * 4) / 3) + 256 * 1024;

export class RequestBodyTooLargeError extends Error {
  readonly status = 413;

  constructor() {
    super("Request body is too large.");
    this.name = "RequestBodyTooLargeError";
  }
}

export class RequestBodyInvalidUtf8Error extends Error {
  readonly status = 400;

  constructor() {
    super("Request body is not valid UTF-8.");
    this.name = "RequestBodyInvalidUtf8Error";
  }
}

export async function readLimitedTextBody(
  request: Request,
  maxBytes: number = IMAGE_UPLOAD_JSON_BODY_MAX_BYTES,
  options: { fatalUtf8?: boolean } = {},
): Promise<string> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError();
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  if (!options.fatalUtf8) return new TextDecoder().decode(body);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new RequestBodyInvalidUtf8Error();
  }
}
