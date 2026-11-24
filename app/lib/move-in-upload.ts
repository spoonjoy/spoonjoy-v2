// The Move in page's upload of a backup straight to storage, in parts (app/routes/move-in.uploads*.ts):
// it begins the upload, sends the parts that haven't arrived a few at a time, trying each again after
// a dropped connection, and finishes it, which starts the move-in. The upload's id is kept for the
// file in this browser, so choosing the same file after a reload carries on from the parts that
// arrived; the server finds the same upload by the file's fingerprint too.

/** Parts in flight at once: enough to keep a phone's connection busy, few enough that a drop loses little. */
export const UPLOAD_CONCURRENCY = 3;
/** Tries per request: the first, then four more after 1, 2, 4 and 8 seconds. */
export const UPLOAD_ATTEMPTS = 5;
/**
 * How long one request may take before it counts as dropped: a stalled phone connection often never fails, it just
 * stops. Two minutes lets a 10 MiB part through at about 85 KB/s, and the finish read the backup's index.
 */
export const UPLOAD_REQUEST_MS = 120_000;
const STORAGE_PREFIX = "spoonjoy:move-in-upload:";

export type UploadOutcome = { ok: true; jobId: string } | { ok: false; error: string };

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface UploadOptions {
  app: string;
  /** Called with the bytes that have arrived and the file's size, each time a part arrives. */
  onProgress?: (sent: number, total: number) => void;
  /** Called once every part has arrived, while the backup is checked. */
  onChecking?: () => void;
  fetch?: Fetch;
  /** Where the upload's id is kept for the file; null keeps it nowhere. */
  storage?: KeyValueStore | null;
  sleep?: (ms: number) => Promise<void>;
  concurrency?: number;
  attempts?: number;
  /** How long one request may take; UPLOAD_REQUEST_MS unless a test shortens it. */
  requestMs?: number;
}

/** A size as the page shows it: "84 MB", or "1.2 GB" from a thousand megabytes on, rounded down so it never overstates. */
export function formatBytes(bytes: number): string {
  if (bytes < 1e9) return `${Math.floor(bytes / 1e6)} MB`;
  return `${(Math.floor(bytes / 1e8) / 10).toFixed(1)} GB`;
}

/** What tells one file from another across a reload: its name, size and last change. */
export function fileFingerprint(file: File): string {
  return JSON.stringify([file.name, file.size, file.lastModified]);
}

function browserStorage(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The store, read and written so that a browser that refuses storage still uploads. */
function remembering(store: KeyValueStore | null, fingerprint: string) {
  const key = `${STORAGE_PREFIX}${fingerprint}`;
  const quietly = <T>(act: () => T): T | null => {
    try {
      return store ? act() : null;
    } catch {
      return null;
    }
  };
  return {
    read: () => quietly(() => store!.getItem(key)),
    keep: (uploadId: string) => void quietly(() => store!.setItem(key, uploadId)),
    forget: () => void quietly(() => store!.removeItem(key)),
  };
}

/** The connection dropped, or the server kept failing, after every try. */
class Dropped extends Error {}
/** The upload is no longer on the server. `finishing` says whether every part had arrived. */
class Gone extends Error {
  constructor(readonly finishing: boolean) {
    super("upload-gone");
  }
}
/** The server turned a step away, with its message for the cook. */
class Refused extends Error {}

const retriable = (status: number) => status === 408 || status === 429 || status >= 500;

interface Plan {
  uploadId: string;
  partSize: number;
  partCount: number;
  done: number[];
}

/** Uploads `file` and starts its move-in, resuming an unfinished upload of the same file. */
export async function uploadBackup(file: File, options: UploadOptions): Promise<UploadOutcome> {
  const fetcher: Fetch = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = options.attempts ?? UPLOAD_ATTEMPTS;
  const concurrency = options.concurrency ?? UPLOAD_CONCURRENCY;
  const requestMs = options.requestMs ?? UPLOAD_REQUEST_MS;
  const fingerprint = fileFingerprint(file);
  const kept = remembering(options.storage === undefined ? browserStorage() : options.storage, fingerprint);
  /** The parts that have arrived, by number, with their sizes: what the page says has been sent. */
  const arrived = new Map<number, number>();
  const sent = () => [...arrived.values()].reduce((total, size) => total + size, 0);
  let finishing = false;

  /** Sends a request, trying again after a dropped connection or a server error, and reads its JSON answer. */
  async function send(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
    for (let attempt = 1; ; attempt++) {
      const response = await fetcher(url, { credentials: "same-origin", signal: AbortSignal.timeout(requestMs), ...init }).catch(() => null);
      if (response && !retriable(response.status)) {
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (response.status === 404 && body.code === "upload-gone") throw new Gone(finishing);
        if (!response.ok && response.status !== 409) throw new Refused(typeof body.error === "string" ? body.error : "Move-in couldn't take that backup. Reload the page and try again.");
        return { status: response.status, body };
      }
      if (attempt >= attempts) throw new Dropped();
      await sleep(1000 * 2 ** (attempt - 1));
    }
  }

  const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  async function sendParts(plan: Plan, parts: number[]) {
    const queue = [...parts];
    let failure: unknown = null;
    const worker = async () => {
      while (queue.length && !failure) {
        const n = queue.shift() as number;
        const blob = file.slice((n - 1) * plan.partSize, Math.min(n * plan.partSize, file.size));
        try {
          await send(`/move-in/uploads/${encodeURIComponent(plan.uploadId)}/parts/${n}`, { method: "PUT", body: blob });
        } catch (error) {
          failure ??= error;
          return;
        }
        arrived.set(n, blob.size);
        options.onProgress?.(sent(), file.size);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, parts.length) }, worker));
    if (failure) throw failure;
  }

  async function once(resume: string | null): Promise<string> {
    const begun = await send("/move-in/uploads", json({ app: options.app, name: file.name, size: file.size, fingerprint, resume }));
    const plan = begun.body as unknown as Plan;
    kept.keep(plan.uploadId);
    arrived.clear();
    for (const n of plan.done) arrived.set(n, Math.min(plan.partSize, file.size - (n - 1) * plan.partSize));
    options.onProgress?.(sent(), file.size);
    await sendParts(plan, Array.from({ length: plan.partCount }, (_, i) => i + 1).filter((n) => !arrived.has(n)));
    options.onChecking?.();
    finishing = true;
    for (;;) {
      const finished = await send(`/move-in/uploads/${encodeURIComponent(plan.uploadId)}`, json({ app: options.app }));
      if (finished.status !== 409) return String(finished.body.jobId);
      // Parts the server lost track of: send them again, then finish again.
      if (finished.body.code !== "missing-parts") throw new Refused(String(finished.body.error));
      finishing = false;
      for (const n of finished.body.missing as number[]) arrived.delete(n);
      await sendParts(plan, finished.body.missing as number[]);
      finishing = true;
    }
  }

  try {
    let jobId: string;
    try {
      jobId = await once(kept.read());
    } catch (error) {
      // Gone before every part arrived: the upload was swept or stopped, so send it afresh. Gone at the finish may be a
      // backup the server turned away whose answer was lost, so that one isn't sent again unasked.
      if (!(error instanceof Gone) || error.finishing) throw error;
      kept.forget();
      jobId = await once(null);
    }
    kept.forget();
    return { ok: true, jobId };
  } catch (error) {
    if (error instanceof Dropped && finishing) {
      return { ok: false, error: "Every part arrived, but checking the backup didn't finish. Press Move in again with the same file to check it again." };
    }
    if (error instanceof Dropped) {
      return {
        ok: false,
        error: `The connection dropped after ${formatBytes(sent())} of ${formatBytes(file.size)} was sent. Press Move in again with the same file to carry on from there.`,
      };
    }
    // A refused backup was deleted on the server, so the next try starts afresh.
    kept.forget();
    if (error instanceof Refused) return { ok: false, error: error.message };
    return { ok: false, error: "That upload isn't on the server any more. Press Move in to send the backup again from the start." };
  }
}
