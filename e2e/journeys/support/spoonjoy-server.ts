// Another Spoonjoy, for the Move in journey that moves a kitchen in from one (move-in.desktop.journey.ts): a cook's
// kitchen on this run's own QA Worker, read through its REST API with an API token that cook made there, as a cook
// moving from spoonjoy.app to their own server (or back) does. A Worker can't be counted on to reach its own
// workers.dev address, so the journey reads what a move-in reads from another Spoonjoy (its health check, the token's
// account and export, and the recipes' photos) from the QA Worker with the real token, and loads those answers into
// the run's Move in stand-in (workers/move-in-stand-in, see support/recipe-server.ts) under a fresh kitchen. The move-in
// then reads them from the stand-in's https address with the kitchen's own token, so the cook's real token stays on
// the runner and is never typed into the page or written to the report.
import { randomBytes } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "./journey";
import { ask, ASK_MS, standIn } from "./recipe-server";

const ANSWER_MS = 30_000;

/** The API paths a move-in from another Spoonjoy reads (app/domains/move-in/adapters/sources/spoonjoy-api/source.ts). */
const READ = ["/api/v1/health", "/api/v1/me", "/api/v1/me/export"] as const;

export interface SpoonjoyServer {
  /** The https address the QA Worker reaches the other Spoonjoy at. */
  address: string;
  /** The stand-in token the cook pastes on the Move in page. */
  token: string;
  /** How many times each path was asked for, so a journey can see the move-in read the other Spoonjoy. */
  asked(): Promise<Map<string, number>>;
  close(): Promise<void>;
}

function appBase(): string {
  const base = process.env.SPOONJOY_JOURNEYS_BASE_URL;
  if (!base) throw new Error("SPOONJOY_JOURNEYS_BASE_URL is required to stand in for another Spoonjoy.");
  return base.replace(/\/+$/, "");
}

/**
 * Makes an API token on the signed-in cook's account with the scopes a move-in asks for, as docs/self-hosting.md
 * says. Returns it with the id of its credential, to delete once the move is done, as the docs ask a cook to.
 */
export async function makeMoveToken(cook: APIRequestContext): Promise<{ token: string; credentialId: string }> {
  const answer = await cook.post("/api/v1/tokens", {
    headers: { origin: new URL(appBase()).origin },
    data: { name: "Move my kitchen", scopes: ["account:read", "kitchen:read"], expiresInDays: 1 },
  });
  expect(answer.status(), "making the move-in token").toBe(201);
  const { data } = (await answer.json()) as { data: { token: string; credential: { id: string } } };
  return { token: data.token, credentialId: data.credential.id };
}

/** Deletes the move-in token, as a cook does on the Spoonjoy they left once the move is done. */
export async function deleteMoveToken(cook: APIRequestContext, credentialId: string): Promise<void> {
  const answer = await cook.delete(`/api/v1/tokens/${encodeURIComponent(credentialId)}`, { headers: { origin: new URL(appBase()).origin } });
  expect(answer.status(), "deleting the move-in token").toBe(200);
}

type Json = Record<string, unknown>;

/** One answer from this run's Spoonjoy, read with the cook's real token, as the move-in would read it. */
async function read(path: string, realToken: string): Promise<{ type: string; body: Buffer }> {
  const answer = await fetch(`${appBase()}${path}`, {
    headers: { authorization: `Bearer ${realToken}`, accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(ANSWER_MS),
  });
  expect(answer.status, `reading ${path} from the other Spoonjoy`).toBe(200);
  return { type: answer.headers.get("content-type") ?? "application/octet-stream", body: Buffer.from(await answer.arrayBuffer()) };
}

/** The /photos/ paths of the recipes' active covers in an export, as the move-in asks for them. */
function photoPaths(exported: Buffer): string[] {
  const recipes = ((JSON.parse(exported.toString("utf8")) as { data?: { recipes?: Json[] } }).data?.recipes ?? []);
  const paths = new Set<string>();
  for (const recipe of recipes) {
    const cover = (Array.isArray(recipe.covers) ? (recipe.covers as Json[]) : []).find((row) => row.active === true);
    const url = cover ? String(cover.imageUrl ?? cover.stylizedImageUrl ?? "") : "";
    const path = url ? new URL(url, "https://spoonjoy.invalid").pathname : "";
    if (path.startsWith("/photos/")) paths.add(path);
  }
  return [...paths];
}

/** Loads the cook's kitchen, as this run's Spoonjoy answers it to their token, into the run's Move in stand-in. */
export async function startSpoonjoyServer(realToken: string): Promise<SpoonjoyServer> {
  const { origin, secret } = standIn();
  const answers = new Map<string, { type: string; body: Buffer }>();
  for (const path of READ) answers.set(path, await read(path, realToken));
  const photos = photoPaths(answers.get("/api/v1/me/export")!.body);
  expect(photos.length, "the other Spoonjoy's kitchen has a photo to move").toBeGreaterThan(0);
  for (const path of photos) answers.set(path, await read(path, realToken));

  const kitchen = randomBytes(16).toString("hex");
  const token = randomBytes(24).toString("hex");
  const routes = [...answers].map(([path, { type, body }]) => ({ path, type, body: body.toString("base64") }));
  const admin = `${origin}/_stand-in/kitchens/${kitchen}`;
  const opened = { authorization: `Bearer ${secret}` };
  await ask(admin, { method: "PUT", headers: { ...opened, "content-type": "application/json" }, body: JSON.stringify({ token, routes }) }, "load the other Spoonjoy's kitchen");
  const address = `${origin}/${kitchen}`;
  // The kitchen answers its token from here, as it will the QA Worker.
  await ask(`${address}/api/v1/health`, { headers: { authorization: `Bearer ${token}` } }, "answer the other Spoonjoy's token");
  return {
    address,
    token,
    asked: async () => new Map(Object.entries((await (await ask(`${admin}/asked`, { headers: opened }, "say what was asked")).json()) as Record<string, number>)),
    close: async () => {
      // The run's teardown deletes the stand-in with everything in it, so a kitchen left here goes with it.
      await fetch(admin, { method: "DELETE", headers: opened, signal: AbortSignal.timeout(ASK_MS) }).catch(() => undefined);
    },
  };
}
