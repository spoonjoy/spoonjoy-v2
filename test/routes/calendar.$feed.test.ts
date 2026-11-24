import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Request as UndiciRequest } from "undici";
import { createTestUser } from "../utils";
import { db } from "~/lib/db.server";
import { loader } from "~/routes/calendar.$feed";
import { makeFeedLink, prismaFeedLinkStore, prismaPlanStore, revokeFeedLink } from "~/domains/planning";
import { cleanupDatabase } from "../helpers/cleanup";

const ENV: Record<string, string> = {};

function load(feed: string, env: Record<string, string> = ENV) {
  const request = new UndiciRequest(`http://localhost:3000/calendar/${feed}?include_notes=true`) as unknown as Request;
  return loader({ request, context: { cloudflare: { env } } as never, params: { feed } } as never);
}

async function status(promise: Promise<Response>): Promise<number> {
  try {
    return (await promise).status;
  } catch (thrown) {
    return (thrown as Response).status;
  }
}

describe("calendar feed route", () => {
  let token: string;
  let chefId: string;

  beforeEach(async () => {
    await cleanupDatabase();
    const chef = await db.user.create({ data: createTestUser() });
    chefId = chef.id;
    token = await makeFeedLink(prismaPlanStore(db), prismaFeedLinkStore(db), chef.id);
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("serves the plan as a private iCal calendar at the link's .ics address", async () => {
    const response = await load(`${token}.ics`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=900");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(await response.text()).toMatch(/^BEGIN:VCALENDAR\r\n[\s\S]*END:VCALENDAR\r\n$/);
  });

  it("serves the same calendar without the .ics ending", async () => {
    expect((await load(token)).status).toBe(200);
  });

  it("is not found for a link that doesn't exist, or a revoked one", async () => {
    expect(await status(load(`${"a".repeat(43)}.ics`))).toBe(404);
    expect(await status(load("nonsense.ics"))).toBe(404);
    await revokeFeedLink(prismaPlanStore(db), prismaFeedLinkStore(db), chefId);
    expect(await status(load(`${token}.ics`))).toBe(404);
  });

  it("serves the feed with no flag set", async () => {
    expect(await status(load(`${token}.ics`, {}))).toBe(200);
  });
});
