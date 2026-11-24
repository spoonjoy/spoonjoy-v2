import { describe, expect, it } from "vitest";
import { ServerBackupError, serverBackups } from "~/lib/self-host-backups.server";

type Call = { url: string; method: string };

function binding(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  return {
    calls,
    SELF_HOST: {
      fetch: async (url: string, init?: RequestInit) => {
        const call = { url, method: init?.method ?? "GET" };
        calls.push(call);
        return answer(call);
      },
    },
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("serverBackups", () => {
  it("is there only on a self-hosted server with the server's binding", () => {
    const { SELF_HOST } = binding(() => json({}));
    expect(serverBackups(undefined)).toBeNull();
    expect(serverBackups(null)).toBeNull();
    expect(serverBackups({ SELF_HOST } as never)).toBeNull();
    expect(serverBackups({ SPOONJOY_SELF_HOSTED: "true" } as never)).toBeNull();
    expect(serverBackups({ SPOONJOY_SELF_HOSTED: "true", SELF_HOST } as never)).not.toBeNull();
  });

  it("lists, backs up, restores and downloads through the binding", async () => {
    const host = binding(({ url }) => (url.endsWith(".tar.gz") ? new Response("file") : json({ ok: url })));
    const backups = serverBackups({ SPOONJOY_SELF_HOSTED: "true", SELF_HOST: host.SELF_HOST } as never)!;
    const name = "spoonjoy-manual-2026-11-23T10-00-00Z.tar.gz";
    expect(await backups.list()).toEqual({ ok: "http://self-host/backups" });
    expect(await backups.backUpNow()).toEqual({ ok: "http://self-host/backups" });
    expect(await backups.restore(name)).toEqual({ ok: `http://self-host/backups/${name}/restore` });
    expect(await (await backups.download(name)).text()).toBe("file");
    await backups.restore("a/b");
    expect(host.calls).toEqual([
      { url: "http://self-host/backups", method: "GET" },
      { url: "http://self-host/backups", method: "POST" },
      { url: `http://self-host/backups/${name}/restore`, method: "POST" },
      { url: `http://self-host/backups/${name}`, method: "GET" },
      { url: "http://self-host/backups/a%2Fb/restore", method: "POST" },
    ]);
  });

  it("throws the server's reason and status when it refuses", async () => {
    const busy = serverBackups({ SPOONJOY_SELF_HOSTED: "true", SELF_HOST: binding(() => json({ error: "A backup or restore is already running." }, 409)).SELF_HOST } as never)!;
    const refused = await busy.backUpNow().catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ServerBackupError);
    expect(refused).toMatchObject({ message: "A backup or restore is already running.", status: 409 });

    const silent = serverBackups({ SPOONJOY_SELF_HOSTED: "true", SELF_HOST: binding(() => json({}, 502)).SELF_HOST } as never)!;
    await expect(silent.list()).rejects.toMatchObject({ message: "The server answered 502.", status: 502 });
  });
});
