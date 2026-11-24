import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { db } from "~/lib/db.server";
import { createUserSessionCookie } from "~/lib/session.server";
import { gateAccountCreation } from "~/lib/server-access.server";
import { loader } from "~/routes/account.server-backups.$name";
import { cleanupDatabase } from "../helpers/cleanup";
import { createTestUser } from "../utils";

const NAME = "spoonjoy-manual-2026-11-23T10-00-00Z.tar.gz";
const selfHosted = { SPOONJOY_SELF_HOSTED: "true" };

function host(answer: (url: string) => Response) {
  const asked: string[] = [];
  return { asked, env: { ...selfHosted, SELF_HOST: { fetch: async (url: string) => (asked.push(url), answer(url)) } } };
}

async function chef(env: object) {
  const gate = await gateAccountCreation(db, env as never, { inviteToken: null });
  const user = await db.user.create({ data: createTestUser() });
  if (gate.allowed) await gate.created(user.id);
  return (await createUserSessionCookie(user.id)).split(";")[0]!;
}

async function download(cookie: string, env: object, name = NAME) {
  try {
    return await loader({
      request: new UndiciRequest(`http://localhost:3000/account/server/backups/${name}`, { headers: { Cookie: cookie } }),
      context: { cloudflare: { env } },
      params: { name },
    } as never);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

beforeEach(cleanupDatabase);
afterEach(cleanupDatabase);

describe("/account/server/backups/:name", () => {
  it("hands the admin the backup file, never cached", async () => {
    const { env, asked } = host(() => new Response("backup bytes", { headers: { "Content-Disposition": `attachment; filename="${NAME}"` } }));
    const admin = await chef(env);
    const response = await download(admin, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/gzip");
    expect(response.headers.get("Content-Disposition")).toBe(`attachment; filename="${NAME}"`);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("backup bytes");
    expect(asked).toEqual([`http://self-host/backups/${NAME}`]);
  });

  it("still downloads when the server names no file", async () => {
    const { env } = host(() => new Response("backup bytes"));
    const response = await download(await chef(env), env);
    expect(response.headers.get("Content-Disposition")).toBe("attachment");
  });

  it("is not there for anyone but the admin, on a server without backups, or for a backup the server doesn't have", async () => {
    const { env, asked } = host(() => new Response(JSON.stringify({ error: "There's no such backup." }), { status: 404 }));
    const admin = await chef(env);
    const other = await chef(env);
    expect((await download(other, env)).status).toBe(404);
    expect((await download(admin, selfHosted)).status).toBe(404);
    expect(asked).toEqual([]);
    expect((await download(admin, env, "spoonjoy-manual-2020-01-01T00-00-00Z.tar.gz")).status).toBe(404);
    expect(asked).toEqual(["http://self-host/backups/spoonjoy-manual-2020-01-01T00-00-00Z.tar.gz"]);
  });
});
