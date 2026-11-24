// The Move in page's upload of a backup in parts, against a server stand-in that answers like the
// upload endpoints (app/routes/move-in.uploads*.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { FILE_HEAD_BYTES, UPLOAD_ATTEMPTS, fileFingerprint, fileHead, formatBytes, uploadBackup } from "~/lib/move-in-upload";

const PART = 10;

interface Server {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** Every request, as "METHOD path". */
  calls: string[];
  /** The JSON bodies sent to begin. */
  begins: Array<Record<string, unknown>>;
  /** Parts the server holds. */
  parts: Set<number>;
  /** The most parts in flight at once. */
  mostInFlight: number;
  /** Answers to give before the normal one, by "METHOD path": a status, or "drop" for a failed connection. */
  next: Map<string, Array<number | "drop" | Response>>;
  /** What the server already has when the upload begins. */
  done: number[];
}

function server(size: number, { done = [] as number[], finish = (): Response => Response.json({ jobId: "movein_1" }) } = {}): Server {
  const state: Server = { calls: [], begins: [], parts: new Set(done), mostInFlight: 0, next: new Map(), done, fetch: async () => new Response() };
  let inFlight = 0;
  state.fetch = async (url, init) => {
    const call = `${init.method} ${url}`;
    state.calls.push(call);
    expect(init.credentials).toBe("same-origin");
    const scripted = state.next.get(call)?.shift();
    if (scripted === "drop") throw new TypeError("Failed to fetch");
    if (scripted instanceof Response) return scripted;
    if (typeof scripted === "number") return Response.json({ error: `status ${scripted}` }, { status: scripted });
    if (url === "/move-in/uploads") {
      state.begins.push(JSON.parse(String(init.body)));
      return Response.json({ uploadId: "upload_1", partSize: PART, partCount: Math.ceil(size / PART), done: [...state.parts] });
    }
    const part = /\/parts\/(\d+)$/.exec(url);
    if (part) {
      inFlight += 1;
      state.mostInFlight = Math.max(state.mostInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      const n = Number(part[1]);
      expect((init.body as Blob).size).toBe(Math.min(PART, size - (n - 1) * PART));
      state.parts.add(n);
      return Response.json({ partNumber: n });
    }
    return finish();
  };
  return state;
}

function memoryStore() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const backupFile = (size = 35) => new File([new Uint8Array(size)], "mealie.zip", { lastModified: 1_700_000_000_000 });
const noWait = async () => undefined;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** The head of a test backup: every test file holds zeros, so its head is the digest of its zeros, up to 1 MiB. */
const headOf = (file: File) => sha256(new Uint8Array(Math.min(file.size, FILE_HEAD_BYTES)));
const keyFor = (file: File) => `spoonjoy:move-in-upload:${fileFingerprint(file, headOf(file))}`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("formatBytes", () => {
  it("shows megabytes, then gigabytes, rounded down", () => {
    expect([formatBytes(0), formatBytes(84_900_000), formatBytes(999_999_999), formatBytes(1_290_000_000)]).toEqual(["0 MB", "84 MB", "999 MB", "1.2 GB"]);
  });
});

describe("fileHead", () => {
  it("is the SHA-256 of the file's first MiB, so the same file chosen again, whatever its last change, gives the same", async () => {
    const bytes = new Uint8Array(FILE_HEAD_BYTES + 10).map((_, index) => index % 251);
    const file = new File([bytes], "mealie.zip", { lastModified: 1 });
    const again = new File([bytes], "mealie.zip", { lastModified: 2 });
    expect(await fileHead(file)).toBe(sha256(bytes.slice(0, FILE_HEAD_BYTES)));
    expect(await fileHead(again)).toBe(await fileHead(file));
    expect(fileFingerprint(again, await fileHead(again))).toBe(fileFingerprint(file, await fileHead(file)));
    // A byte past the first MiB doesn't change it; one inside it does.
    const changed = bytes.slice();
    changed[FILE_HEAD_BYTES + 1] = 255;
    expect(await fileHead(new File([changed], "mealie.zip"))).toBe(await fileHead(file));
    changed[0] = 255;
    expect(await fileHead(new File([changed], "mealie.zip"))).not.toBe(await fileHead(file));
  });
});

describe("uploadBackup", () => {
  it("begins, sends every part a few at a time, finishes, and says how far it has got", async () => {
    const file = backupFile();
    const api = server(file.size);
    const store = memoryStore();
    const progress: Array<[number, number]> = [];
    const checking = vi.fn();
    const outcome = await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: store, sleep: noWait, concurrency: 2, onProgress: (sent, total) => progress.push([sent, total]), onChecking: checking });
    expect(outcome).toEqual({ ok: true, jobId: "movein_1" });
    expect(api.begins).toEqual([{ app: "mealie", name: "mealie.zip", size: 35, head: headOf(file), resume: null }]);
    expect([...api.parts].sort()).toEqual([1, 2, 3, 4]);
    expect(api.mostInFlight).toBe(2);
    expect(progress[0]).toEqual([0, 35]);
    expect(progress.at(-1)).toEqual([35, 35]);
    expect(checking).toHaveBeenCalledOnce();
    expect(api.calls.at(-1)).toBe("POST /move-in/uploads/upload_1");
    // Moved in, so there is nothing to resume.
    expect(store.values.size).toBe(0);
  });

  it("picks up the upload it kept for the file, sending only the parts that haven't arrived", async () => {
    const file = backupFile();
    const api = server(file.size, { done: [1, 4] });
    const store = memoryStore();
    store.setItem(keyFor(file), "upload_1");
    const progress: number[] = [];
    await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: store, sleep: noWait, onProgress: (sent) => progress.push(sent) });
    expect(api.begins[0].resume).toBe("upload_1");
    expect(api.calls.filter((call) => call.startsWith("PUT")).sort()).toEqual(["PUT /move-in/uploads/upload_1/parts/2", "PUT /move-in/uploads/upload_1/parts/3"]);
    // Parts 1 and 4 (10 and 5 bytes) were already there.
    expect(progress[0]).toBe(15);
  });

  it("picks up the upload kept for the same file chosen again with another last change", async () => {
    const api = server(35, { done: [1] });
    const store = memoryStore();
    // The key as the page wrote it: name, size and the digest of the file's first MiB (all zeros here).
    store.setItem(`spoonjoy:move-in-upload:${JSON.stringify(["mealie.zip", 35, sha256(new Uint8Array(35))])}`, "upload_1");
    const again = new File([new Uint8Array(35)], "mealie.zip", { lastModified: 42 });
    await uploadBackup(again, { app: "mealie", fetch: api.fetch, storage: store, sleep: noWait });
    expect(api.begins[0].resume).toBe("upload_1");
  });

  it("tries a request again after a dropped connection or a server error, waiting longer each time", async () => {
    const file = backupFile();
    const api = server(file.size);
    api.next.set("PUT /move-in/uploads/upload_1/parts/2", ["drop", 503, 429]);
    const sleep = vi.fn(noWait);
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: null, sleep })).toEqual({ ok: true, jobId: "movein_1" });
    expect(sleep.mock.calls).toEqual([[1000], [2000], [4000]]);
  });

  it("stops after its last try and keeps the upload, so the same file carries on from there", async () => {
    const file = backupFile();
    const api = server(file.size);
    api.next.set("PUT /move-in/uploads/upload_1/parts/3", Array(UPLOAD_ATTEMPTS).fill("drop"));
    const store = memoryStore();
    const outcome = await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: store, sleep: noWait, concurrency: 1 });
    expect(outcome).toEqual({ ok: false, error: "The connection dropped after 0 MB of 0 MB was sent. Press Move in again with the same file to carry on from there." });
    expect(store.values.get(keyFor(file))).toBe("upload_1");
    // One part at a time, so nothing after the part that didn't arrive was sent.
    expect(api.parts).toEqual(new Set([1, 2]));
  });

  it("sends the parts the server lost track of, then finishes again", async () => {
    const file = backupFile();
    const finishes = [Response.json({ code: "missing-parts", missing: [2] }, { status: 409 }), Response.json({ jobId: "movein_2" })];
    const api = server(file.size, { finish: () => finishes.shift() as Response });
    const progress: number[] = [];
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: null, sleep: noWait, onProgress: (sent) => progress.push(sent) })).toEqual({ ok: true, jobId: "movein_2" });
    expect(api.calls.filter((call) => call.endsWith("/parts/2"))).toHaveLength(2);
    // A part sent twice counts once, so the page never says more was sent than the file holds.
    expect(Math.max(...progress)).toBe(35);
    expect(progress.at(-1)).toBe(35);
  });

  it("shows the server's message for a backup it turns away, and forgets the upload", async () => {
    const file = backupFile();
    const api = server(file.size, { finish: () => Response.json({ code: "not-a-backup", error: "That zip isn't a backup we recognise." }, { status: 400 }) });
    const store = memoryStore();
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: store, sleep: noWait })).toEqual({ ok: false, error: "That zip isn't a backup we recognise." });
    expect(store.values.size).toBe(0);
  });

  it.each([
    ["an answer that isn't JSON", () => new Response("<html>", { status: 403 }), "Spoonjoy's server answered 403 without saying why, so the backup wasn't sent. Reload the page and press Move in again."],
    ["a conflict it doesn't know", () => Response.json({ code: "finished", error: "That backup has already arrived and is moving in." }, { status: 409 }), "That backup has already arrived and is moving in."],
  ])("says so for %s", async (_name, finish, error) => {
    const file = backupFile();
    const api = server(file.size, { finish });
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: null, sleep: noWait })).toEqual({ ok: false, error });
  });

  it("starts again from the first part once when the upload goes while sending, and not when it goes at the finish", async () => {
    const file = backupFile();
    const gone = () => Response.json({ code: "upload-gone", error: "gone" }, { status: 404 });
    const api = server(file.size);
    api.next.set("PUT /move-in/uploads/upload_1/parts/1", [gone()]);
    const store = memoryStore();
    store.setItem(keyFor(file), "upload_old");
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: store, sleep: noWait, concurrency: 1 })).toEqual({ ok: true, jobId: "movein_1" });
    expect(api.begins.map((body) => body.resume)).toEqual(["upload_old", null]);

    // Gone at the finish may be a backup turned away whose answer was lost: it isn't sent again unasked.
    api.begins.length = 0;
    api.next.set("POST /move-in/uploads/upload_1", [gone()]);
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: store, sleep: noWait })).toEqual({
      ok: false,
      error: "That upload isn't on the server any more. Press Move in to send the backup again from the start.",
    });
    expect(api.begins).toHaveLength(1);
    expect(store.values.size).toBe(0);
  });

  it("says so when every part arrived but the check kept failing, and keeps the upload to check again", async () => {
    const file = backupFile();
    const api = server(file.size, { finish: () => Response.json({ error: "boom" }, { status: 500 }) });
    const store = memoryStore();
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: store, sleep: noWait })).toEqual({
      ok: false,
      error: "Every part arrived, but checking the backup didn't finish. Press Move in again with the same file to check it again.",
    });
    expect(store.values.get(keyFor(file))).toBe("upload_1");
  });

  it("gives up on a request that stalls, as on a dropped phone connection, and tries it again", async () => {
    const file = backupFile();
    const signals: AbortSignal[] = [];
    const stalled = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        signals.push(init.signal as AbortSignal);
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
      });
    expect(await uploadBackup(file, { app: "mealie", fetch: stalled, storage: null, sleep: noWait, attempts: 2, requestMs: 5 })).toEqual({
      ok: false,
      error: "The connection dropped after 0 MB of 0 MB was sent. Press Move in again with the same file to carry on from there.",
    });
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("says so when the browser can't read the file", async () => {
    const file = backupFile();
    vi.spyOn(file, "slice").mockImplementation(() => ({ arrayBuffer: () => Promise.reject(new Error("NotReadableError")) }) as never);
    const api = server(file.size);
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: null, sleep: noWait })).toEqual({
      ok: false,
      error: "The browser refused to read the backup file, which happens when it was moved or changed after you chose it. Choose it again, then press Move in.",
    });
    expect(api.calls).toEqual([]);
  });

  it("uploads in a browser that refuses storage", async () => {
    const file = backupFile();
    const api = server(file.size);
    const refusing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: refusing, sleep: noWait })).toEqual({ ok: true, jobId: "movein_1" });
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, sleep: noWait })).toEqual({ ok: true, jobId: "movein_1" });
  });

  it("uses the page's own fetch, storage and timers by default", async () => {
    const file = backupFile(5);
    const api = server(file.size);
    api.next.set("PUT /move-in/uploads/upload_1/parts/1", [503]);
    vi.stubGlobal("fetch", (url: string, init: RequestInit) => api.fetch(url, init));
    window.localStorage.setItem(keyFor(file), "upload_1");
    expect(await uploadBackup(file, { app: "mealie" })).toEqual({ ok: true, jobId: "movein_1" });
    expect(api.begins[0].resume).toBe("upload_1");
    expect(window.localStorage.getItem(keyFor(file))).toBeNull();
  });
});
