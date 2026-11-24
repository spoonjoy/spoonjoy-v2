// What every households page and action does first: sign-in and the store on the request's D1 binding.

import type { AppLoadContext } from "react-router";
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
  return { userId, store: d1HouseholdStore(requestD1(context) as D1ReadDatabase) };
}

/**
 * The signed-in cook's households for the Kitchen page's Cook together section, by name: an empty list before they have
 * one, and null when there is no D1 binding, which leaves the section out.
 */
export async function kitchenHouseholds(context: AppLoadContext, userId: string): Promise<{ id: string; name: string }[] | null> {
  const d1 = requestD1(context);
  if (!d1) return null;
  const households = await d1HouseholdStore(d1 as D1ReadDatabase).householdsFor(userId);
  return households.map(({ id, name }) => ({ id, name }));
}
