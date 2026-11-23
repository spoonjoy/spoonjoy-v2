// What every organizer page and action does first: sign-in, the organizers flag (a 404 while it's off) and the store on
// the request's database.
import type { AppLoadContext } from "react-router";
import type { PrismaClient } from "@prisma/client";
import { isFlagOn } from "~/domains/platform";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import type { OrganizerStore } from "../application/organizers";
import { prismaOrganizerStore } from "./prisma-organizer-store";

export async function organizersRequest(
  request: Request,
  context: AppLoadContext,
): Promise<{ userId: string; store: OrganizerStore; db: PrismaClient }> {
  const env = context.cloudflare?.env;
  const userId = await requireUserId(request, "/login", env);
  if (!isFlagOn("organizers", env, userId)) throw new Response("Not Found", { status: 404 });
  const db = await getRequestDb(context);
  return { userId, store: prismaOrganizerStore(db), db };
}

/** Splits a comma-separated list of tags, categories or tools as typed into one name per entry. */
export function organizerNamesFromInput(value: FormDataEntryValue | null): string[] {
  return typeof value === "string" ? value.split(",") : [];
}
