// @vitest-environment node
// The lookup page's redirect carries a Set-Cookie header, which the jsdom Response hides.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { action as lookupAction } from "~/routes/agent.connect";
import { startAgentConnection } from "~/lib/agent-connection.server";
import { typedCodeFor } from "~/lib/agent-connection-route.server";
import { getLocalDb } from "~/lib/db.server";
import { cleanupDatabase } from "../helpers/cleanup";

describe("agent connect lookup cookie", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("remembers the typed code in a signed, HttpOnly cookie scoped to the agent connect pages", async () => {
    const db = await getLocalDb();
    const started = await startAgentConnection(db, { now: new Date("2099-05-26T12:00:00Z") });
    const formData = new UndiciFormData();
    formData.set("code", started.request.userCode.toLowerCase());
    const response = await lookupAction({
      request: new UndiciRequest("http://localhost/agent/connect", { method: "POST", body: formData }),
      context: { cloudflare: { env: null } },
    } as any).then(() => expect.fail("expected a redirect"), (thrown: Response) => thrown);

    expect(response.status).toBe(302);
    const setCookie = response.headers.get("Set-Cookie")!;
    expect(setCookie).toMatch(/^__agent_code=/);
    expect(setCookie).toContain("Path=/agent/connect");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=600");

    const cookie = setCookie.split(";")[0];
    const request = new Request(`http://localhost/agent/connect/${started.request.id}`, { headers: { Cookie: cookie } });
    await expect(typedCodeFor(null, request, started.request.id)).resolves.toBe(started.request.userCode);
    await expect(typedCodeFor(null, request, "another-request")).resolves.toBeNull();

    // A tampered cookie is ignored.
    const tampered = new Request(`http://localhost/agent/connect/${started.request.id}`, { headers: { Cookie: `${cookie}x` } });
    await expect(typedCodeFor(null, tampered, started.request.id)).resolves.toBeNull();
  });
});
