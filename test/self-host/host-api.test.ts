import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error -- plain ESM module shipped in the image, without types
import { BusyError, hostApi, oneAtATime } from "../../self-host/host-api.mjs";

const NAME = "spoonjoy-manual-2026-11-23T10-00-00Z.tar.gz";
let dir: string;
let backupsDir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "spoonjoy-host-api-test-"));
  backupsDir = path.join(dir, "backups");
  mkdirSync(backupsDir);
  writeFileSync(path.join(backupsDir, NAME), "backup bytes");
  writeFileSync(path.join(dir, "session-secret"), "secret");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function api(overrides: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const handler = hostApi({
    settings: { schedule: "17 3 * * *", keep: 7, dir: backupsDir },
    backUp: async (kind: string) => {
      calls.push(["backUp", kind]);
      return { name: "spoonjoy-manual-new.tar.gz", rows: 3 };
    },
    restore: async (file: string) => {
      calls.push(["restore", file]);
      return { rows: 3, photos: 1, savedFirst: null };
    },
    exclusive: oneAtATime(),
    Response,
    ...overrides,
  });
  const call = (method: string, pathname: string) => handler(new Request(`http://self-host${pathname}`, { method }));
  return { call, calls };
}

describe("oneAtATime", () => {
  it("runs one piece of work at a time and frees itself when the work fails", async () => {
    const exclusive = oneAtATime();
    let finish!: () => void;
    const first = exclusive(() => new Promise<string>((resolve) => { finish = () => resolve("done"); }));
    await expect(exclusive(async () => "second")).rejects.toBeInstanceOf(BusyError);
    finish();
    await expect(first).resolves.toBe("done");
    await expect(exclusive(async () => { throw new Error("disk full"); })).rejects.toThrow("disk full");
    await expect(exclusive(async () => "next")).resolves.toBe("next");
  });
});

describe("hostApi", () => {
  it("lists the schedule and the backups", async () => {
    const response = await api().call("GET", "/backups");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      schedule: "17 3 * * *",
      keep: 7,
      backups: [{ name: NAME, kind: "manual", size: 12, createdAt: "2026-11-23T10:00:00Z" }],
    });
  });

  it("backs up now and restores a backup in the backups folder", async () => {
    const { call, calls } = api();
    const made = await call("POST", "/backups");
    expect(await made.json()).toEqual({ name: "spoonjoy-manual-new.tar.gz", rows: 3 });
    const restored = await call("POST", `/backups/${NAME}/restore`);
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual({ rows: 3, photos: 1, savedFirst: null });
    expect(calls).toEqual([["backUp", "manual"], ["restore", path.join(backupsDir, NAME)]]);
  });

  it("hands over a backup file to download", async () => {
    const response = await api().call("GET", `/backups/${NAME}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/gzip");
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${NAME}"`);
    expect(await response.text()).toBe("backup bytes");
  });

  it("answers 409 while another backup or restore runs, and 500 with the reason when one fails", async () => {
    const busy = api({ exclusive: async () => { throw new BusyError(); } });
    const refused = await busy.call("POST", "/backups");
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "A backup or restore is already running. Try again when it's done." });

    const failing = api({ restore: async () => { throw new Error("This backup comes from a newer Spoonjoy"); } });
    const failed = await failing.call("POST", `/backups/${NAME}/restore`);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "This backup comes from a newer Spoonjoy" });

    const odd = api({ backUp: async () => { throw "out of space"; } });
    expect(await (await odd.call("POST", "/backups")).json()).toEqual({ error: "out of space" });
  });

  it("serves nothing outside the backups folder, and nothing it doesn't know", async () => {
    const { call, calls } = api();
    for (const [method, pathname] of [
      ["GET", "/backups/..%2Fsession-secret"],
      ["GET", "/backups/session-secret"],
      ["GET", "/backups/spoonjoy-manual-2026-01-01T00-00-00Z.tar.gz"],
      ["POST", "/backups/spoonjoy-manual-2026-01-01T00-00-00Z.tar.gz/restore"],
      ["POST", `/backups/${NAME}`],
      ["GET", `/backups/${NAME}/restore`],
      ["DELETE", "/backups"],
      ["GET", "/elsewhere"],
    ]) {
      const response = await call(method, pathname);
      expect(response.status, `${method} ${pathname}`).toBe(404);
      expect(await response.json()).toEqual({ error: "There's no such backup." });
    }
    expect(calls).toEqual([]);
  });

  describe("account mail", () => {
    const message = { to: "cook@example.com", from: "kitchen@example.com", subject: "Reset your password", text: "Hi", html: "<p>Hi</p>" };
    const post = (handler: (request: Request) => Promise<Response>) =>
      handler(new Request("http://self-host/mail", { method: "POST", body: JSON.stringify(message) }));

    it("sends a message through the SMTP server", async () => {
      const sendMail = vi.fn().mockResolvedValue(undefined);
      const response = await post(hostApiWith({ sendMail }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ sent: true });
      expect(sendMail).toHaveBeenCalledWith(message);
    });

    it("answers with only the SMTP error's code when the server refuses, never its words", async () => {
      const refused = vi.fn().mockRejectedValue(Object.assign(new Error("550 No such user cook@example.com"), { code: "EENVELOPE" }));
      const response = await post(hostApiWith({ sendMail: refused }));
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "EENVELOPE" });

      const codeless = await post(hostApiWith({ sendMail: vi.fn().mockRejectedValue(new TypeError("cook@example.com")) }));
      expect(await codeless.json()).toEqual({ error: "TypeError" });
      const thrown = await post(hostApiWith({ sendMail: vi.fn().mockRejectedValue(undefined) }));
      expect(await thrown.json()).toEqual({ error: "Error" });
    });

    it("answers 404 on a server with no SMTP settings", async () => {
      const response = await post(hostApiWith({}));
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "This server has no SMTP settings." });
    });
  });
});

function hostApiWith(overrides: Record<string, unknown>) {
  return hostApi({ settings: { schedule: null, keep: 7, dir: backupsDir }, backUp: vi.fn(), restore: vi.fn(), exclusive: oneAtATime(), Response, ...overrides });
}
