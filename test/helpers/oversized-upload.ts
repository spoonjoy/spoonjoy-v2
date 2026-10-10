import { Request as UndiciRequest } from "undici";
import { IMAGE_UPLOAD_MULTIPART_MAX_BYTES } from "~/lib/image-storage.server";

const CHUNK_BYTES = 1024 * 1024;

/**
 * A multipart POST that streams about 20 MB with no Content-Length, so the only way to refuse it
 * early is to stop reading while it streams. `pulled()` reports how many bytes the handler read,
 * which shows whether the body was buffered whole before being refused.
 */
export function oversizedMultipartUpload(url: string, cookie: string) {
  let pulled = 0;
  let sent = 0;
  const chunk = new Uint8Array(CHUNK_BYTES).fill(0x61);
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (sent >= 20) {
          controller.close();
          return;
        }
        sent += 1;
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
    },
    { highWaterMark: 0 },
  );
  const request = new UndiciRequest(url, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "multipart/form-data; boundary=spoonjoy-oversized" },
    body: stream,
    duplex: "half",
  }) as unknown as Request;
  return {
    request,
    /** Bytes read from the body. Within two chunks of the limit means it stopped early. */
    pulled: () => pulled,
    readLimit: IMAGE_UPLOAD_MULTIPART_MAX_BYTES + 2 * CHUNK_BYTES,
  };
}
