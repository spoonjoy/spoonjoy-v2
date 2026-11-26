// Calendar feed links: a private link to the meal plan's iCal feed. The token is random, shown to the cook once, and
// only its SHA-256 is stored, so a leaked database row can't be turned back into a working link.
import type { PlanStore } from "./plan";
import { addDays, todayIn, type LocalDate } from "../model/local-date";
import { parseFeedOptions, renderCalendar, type FeedEntry } from "../model/calendar-feed";

export type FeedLinkOwner = { planId: string; ownerId: string };

export interface FeedLinkStore {
  /** Records `tokenHash` as the plan's link, replacing any link the plan had. */
  setLink(planId: string, tokenHash: string, now: Date): Promise<void>;
  /** Deletes the plan's link; false when it had none. */
  deleteLink(planId: string): Promise<boolean>;
  /** When the plan's link was made, or null when it has none. */
  linkMadeAt(planId: string): Promise<Date | null>;
  /** The plan a link hash belongs to, or null. */
  planForLink(tokenHash: string): Promise<FeedLinkOwner | null>;
  /** The plan's live entries from `from` to `to`, both days included, each with its recipe's servings and description. */
  feedEntries(planId: string, from: LocalDate, to: LocalDate): Promise<FeedEntry[]>;
}

/** How far the feed reaches either side of today: calendars keep what they've seen, so the past needs little. */
export const FEED_DAYS_BACK = 28;
export const FEED_DAYS_AHEAD = 90;

/** 32 random bytes in base64url without padding. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function hashFeedToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Makes the cook's feed link and returns its token; any link they had stops working. */
export async function makeFeedLink(plans: PlanStore, links: FeedLinkStore, ownerId: string, now: Date = new Date()): Promise<string> {
  const plan = await plans.planFor({ cook: ownerId });
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = base64Url(bytes);
  await links.setLink(plan.id, await hashFeedToken(token), now);
  return token;
}

/** Turns off the cook's feed link; false when they had none. */
export async function revokeFeedLink(plans: PlanStore, links: FeedLinkStore, ownerId: string): Promise<boolean> {
  const plan = await plans.planFor({ cook: ownerId });
  return links.deleteLink(plan.id);
}

/** When the cook's current feed link was made, or null when they have none. */
export async function feedLinkMadeAt(plans: PlanStore, links: FeedLinkStore, ownerId: string): Promise<Date | null> {
  const plan = await plans.planFor({ cook: ownerId });
  return links.linkMadeAt(plan.id);
}

/** The address a calendar app subscribes to for a token, on the site at `origin`. */
export function feedLinkUrl(origin: string, token: string): string {
  return `${origin}/calendar/${token}.ics`;
}

/** The same feed at webcal://, which opens the device's calendar app to subscribe to it. */
export function webcalUrl(feedUrl: string): string {
  return feedUrl.replace(/^https?:/, "webcal:");
}

/** The plan behind a feed token, or null. A token that can't be one of ours is turned away before any lookup. */
export async function planForFeedToken(links: FeedLinkStore, token: string): Promise<FeedLinkOwner | null> {
  if (!TOKEN_SHAPE.test(token)) return null;
  return links.planForLink(await hashFeedToken(token));
}

/**
 * The calendar behind a feed link, or null when the link doesn't work. Meals are timed in the plan's own time zone
 * unless the link's `tz` asks for another.
 */
export async function feedForToken(
  plans: PlanStore,
  links: FeedLinkStore,
  input: { token: string; params: URLSearchParams; origin: string; now: Date },
): Promise<{ ownerId: string; entries: number; calendar: string } | null> {
  const owner = await planForFeedToken(links, input.token);
  if (!owner) return null;
  const plan = await plans.planFor({ cook: owner.ownerId });
  const today = todayIn(plan.timeZone, input.now);
  const entries = await links.feedEntries(owner.planId, addDays(today, -FEED_DAYS_BACK), addDays(today, FEED_DAYS_AHEAD));
  const options = parseFeedOptions(input.params);
  if (!input.params.get("tz")) options.timeZone = plan.timeZone;
  const calendar = renderCalendar({ name: "Spoonjoy meal plan", origin: input.origin, now: input.now, entries, options });
  return { ownerId: owner.ownerId, entries: entries.length, calendar };
}
