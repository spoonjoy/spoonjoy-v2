// What every households page and action does first: sign-in, the households flag (a 404 while it's off) and the store
// on the request's D1 binding.

import type { AppLoadContext } from "react-router";
import { isFlagOn } from "~/domains/platform";
import { requestD1, type D1ReadDatabase } from "~/lib/d1-read.server";
import { requireUserId } from "~/lib/session.server";
import type { HouseholdStore } from "../application/household-store";
import { d1HouseholdStore } from "./d1-household-store.server";

export async function householdsRequest(
  request: Request,
  context: AppLoadContext,
): Promise<{ userId: string; store: HouseholdStore }> {
  const env = context.cloudflare?.env;
  const userId = await requireUserId(request, "/login", env);
  if (!isFlagOn("households", env, userId)) throw new Response("Not Found", { status: 404 });
  return { userId, store: d1HouseholdStore(requestD1(context) as D1ReadDatabase) };
}

/**
 * The signed-in cook's households for the Kitchen page's Cook together section, by name: an empty list before they have
 * one, and null while the households flag is off for them or there is no D1 binding, which leaves the section out.
 */
export async function kitchenHouseholds(context: AppLoadContext, userId: string): Promise<{ id: string; name: string }[] | null> {
  const d1 = requestD1(context);
  if (!d1 || !isFlagOn("households", context.cloudflare?.env, userId)) return null;
  const households = await d1HouseholdStore(d1 as D1ReadDatabase).householdsFor(userId);
  return households.map(({ id, name }) => ({ id, name }));
}
