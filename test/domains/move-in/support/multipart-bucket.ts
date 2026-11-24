// An R2 bucket in memory for the move-in upload tests: put, head, ranged get and delete, and
// uploads in parts that, like R2, keep each part until the upload is completed or aborted, and
// refuse to complete or abort an upload twice.

export interface MemoryMultipartBucket {
  objects: Record<string, Uint8Array>;
  uploads: Map<string, { key: string; parts: Map<number, { etag: string; bytes: Uint8Array }>; state: "open" | "completed" | "aborted" }>;
  put(key: string, value: Blob | Uint8Array): Promise<void>;
  head(key: string): Promise<{ size: number } | null>;
  get(key: string, options: { range: { offset: number; length: number } }): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(keys: string | string[]): Promise<void>;
  createMultipartUpload(key: string, options?: unknown): Promise<ReturnType<MemoryMultipartBucket["resumeMultipartUpload"]>>;
  resumeMultipartUpload(key: string, uploadId: string): {
    key: string;
    uploadId: string;
    uploadPart(partNumber: number, value: ReadableStream | Uint8Array | Blob): Promise<{ partNumber: number; etag: string }>;
    abort(): Promise<void>;
    complete(parts: Array<{ partNumber: number; etag: string }>): Promise<{ size: number }>;
  };
}

async function bytesOf(value: ReadableStream | Uint8Array | Blob): Promise<Uint8Array> {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(await new Response(value).arrayBuffer());
}

export function multipartBucket(): MemoryMultipartBucket {
  const objects: Record<string, Uint8Array> = {};
  const uploads: MemoryMultipartBucket["uploads"] = new Map();
  let etags = 0;
  const bucket: MemoryMultipartBucket = {
    objects,
    uploads,
    put: async (key, value) => void (objects[key] = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value),
    head: async (key) => (objects[key] ? { size: objects[key].length } : null),
    get: async (key, { range: { offset, length } }) => {
      const bytes = objects[key];
      return bytes ? { arrayBuffer: async () => bytes.slice(offset, offset + length).buffer } : null;
    },
    delete: async (keys) => {
      for (const key of [keys].flat()) delete objects[key];
    },
    createMultipartUpload: async (key) => {
      const uploadId = `r2-upload-${uploads.size + 1}`;
      uploads.set(uploadId, { key, parts: new Map(), state: "open" });
      return bucket.resumeMultipartUpload(key, uploadId);
    },
    resumeMultipartUpload: (key, uploadId) => {
      const open = () => {
        const upload = uploads.get(uploadId);
        if (!upload || upload.key !== key || upload.state !== "open") throw new Error("NoSuchUpload");
        return upload;
      };
      return {
        key,
        uploadId,
        async uploadPart(partNumber, value) {
          const upload = open();
          const etag = `etag-${++etags}`;
          upload.parts.set(partNumber, { etag, bytes: await bytesOf(value) });
          return { partNumber, etag };
        },
        async abort() {
          open().state = "aborted";
        },
        async complete(parts) {
          const upload = open();
          const chunks = parts.map(({ partNumber, etag }) => {
            const part = upload.parts.get(partNumber);
            if (!part || part.etag !== etag) throw new Error(`InvalidPart ${partNumber}`);
            return part.bytes;
          });
          const whole = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
          let at = 0;
          for (const chunk of chunks) {
            whole.set(chunk, at);
            at += chunk.length;
          }
          objects[key] = whole;
          upload.state = "completed";
          return { size: whole.length };
        },
      };
    },
  };
  return bucket;
}
