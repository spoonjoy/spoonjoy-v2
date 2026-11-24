// What every organizer page and action does first: sign-in, the organizers flag (a 404 while it's off) and the store on
// the request's database.
import type { AppLoadContext } from "react-router";
import type { PrismaClient } from "@prisma/client";
import { isFlagOn } from "~/domains/platform";
import { getRequestDb } from "~/lib/route-platform.server";
import { requireUserId } from "~/lib/session.server";
import type { OrganizerStore } from "../application/organizers";
import { ORGANIZE_MARKER } from "../model/organizer";
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

/**
 * The names a form gives for one kind: one per chip, with any typed list split at commas, or null when the form
 * neither sends the field nor marks it as shown (a kind left out stays as it is).
 */
export function organizerNamesFromForm(form: FormData, field: string): string[] | null {
  if (!form.has(field) && !form.getAll(ORGANIZE_MARKER).includes(field)) return null;
  return form.getAll(field).flatMap((value) => (typeof value === "string" ? value.split(",") : []));
}
