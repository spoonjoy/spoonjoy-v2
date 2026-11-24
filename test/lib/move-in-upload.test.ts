// The Move in page's upload of a backup in parts, against a server stand-in that answers like the
// upload endpoints (app/routes/move-in.uploads*.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { UPLOAD_ATTEMPTS, fileFingerprint, formatBytes, uploadBackup } from "~/lib/move-in-upload";

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
const keyFor = (file: File) => `spoonjoy:move-in-upload:${fileFingerprint(file)}`;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("formatBytes", () => {
  it("shows megabytes, then gigabytes, rounded down", () => {
    expect([formatBytes(0), formatBytes(84_900_000), formatBytes(999_999_999), formatBytes(1_290_000_000)]).toEqual(["0 MB", "84 MB", "999 MB", "1.2 GB"]);
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
    expect(api.begins).toEqual([{ app: "mealie", name: "mealie.zip", size: 35, fingerprint: fileFingerprint(file), resume: null }]);
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
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: null, sleep: noWait })).toEqual({ ok: true, jobId: "movein_2" });
    expect(api.calls.filter((call) => call.endsWith("/parts/2"))).toHaveLength(2);
  });

  it("shows the server's message for a backup it turns away, and forgets the upload", async () => {
    const file = backupFile();
    const api = server(file.size, { finish: () => Response.json({ code: "not-a-backup", error: "That zip isn't a backup we recognise." }, { status: 400 }) });
    const store = memoryStore();
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: store, sleep: noWait })).toEqual({ ok: false, error: "That zip isn't a backup we recognise." });
    expect(store.values.size).toBe(0);
  });

  it.each([
    ["an answer that isn't JSON", () => new Response("<html>", { status: 403 }), "Move-in couldn't take that backup. Reload the page and try again."],
    ["a conflict it doesn't know", () => Response.json({ code: "finished", error: "That backup has already arrived and is moving in." }, { status: 409 }), "That backup has already arrived and is moving in."],
  ])("says so for %s", async (_name, finish, error) => {
    const file = backupFile();
    const api = server(file.size, { finish });
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: null, sleep: noWait })).toEqual({ ok: false, error });
  });

  it("starts again from the first part once when the upload is gone, and says so if it goes again", async () => {
    const file = backupFile();
    const gone = () => Response.json({ code: "upload-gone", error: "gone" }, { status: 404 });
    const api = server(file.size);
    api.next.set("PUT /move-in/uploads/upload_1/parts/1", [gone()]);
    const store = memoryStore();
    store.setItem(keyFor(file), "upload_old");
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: store, sleep: noWait, concurrency: 1 })).toEqual({ ok: true, jobId: "movein_1" });
    expect(api.begins.map((body) => body.resume)).toEqual(["upload_old", null]);

    api.next.set("POST /move-in/uploads/upload_1", [gone(), gone()]);
    expect(await uploadBackup(file, { app: "mealie", fetch: api.fetch, storage: store, sleep: noWait })).toEqual({
      ok: false,
      error: "That upload isn't on the server any more. Press Move in to send the backup again from the start.",
    });
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
