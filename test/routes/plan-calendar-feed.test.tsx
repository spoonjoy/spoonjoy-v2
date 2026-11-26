import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Request as UndiciRequest, FormData as UndiciFormData } from "undici";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTestRoutesStub, createTestUser } from "../utils";
import { db } from "~/lib/db.server";
import { sessionStorage } from "~/lib/session.server";
import { D1WriteUnavailableError, D1_WRITE_UNAVAILABLE_MESSAGE } from "~/lib/d1-write-retry.server";
import PlanPage, { action, loader } from "~/routes/plan";
import { CalendarFeed } from "~/components/plan/calendar-feed";
import { planForFeedToken, prismaFeedLinkStore, webcalUrl, type PlanActionAnswer } from "~/domains/planning";
import { cleanupDatabase } from "../helpers/cleanup";

const NOW = new Date("2026-12-16T12:00:00Z");
let chefId: string;
let cookie: string;

function context(env: Record<string, string> | null = {}) {
  return { cloudflare: { env } } as never;
}

async function signIn(userId: string) {
  const session = await sessionStorage.getSession();
  session.set("userId", userId);
  return (await sessionStorage.commitSession(session)).split(";")[0];
}

function post(fields: Record<string, string>) {
  const form = new UndiciFormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new UndiciRequest("http://localhost:3000/plan", { method: "POST", headers: { Cookie: cookie }, body: form }) as unknown as Request;
}

function load(path = "/plan?week=2026-11-25") {
  const request = new UndiciRequest(`http://localhost:3000${path}`, { headers: { Cookie: cookie } }) as unknown as Request;
  return loader({ request, context: context(), params: {} } as never);
}

async function act(fields: Record<string, string>, env?: Record<string, string> | null) {
  const value = (await action({ request: post(fields), context: context(env), params: {} } as never)) as { type?: string; data?: unknown; init?: { status?: number } | null };
  return value?.type === "DataWithResponseInit" ? { data: value.data as Record<string, unknown>, status: value.init?.status ?? 200 } : { data: value as unknown as Record<string, unknown>, status: 200 };
}

function tokenOf(feedUrl: unknown) {
  return /\/calendar\/([A-Za-z0-9_-]{43})\.ics$/.exec(String(feedUrl))![1];
}

describe("the meal plan's calendar link", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    await cleanupDatabase();
    const chef = await db.user.create({ data: createTestUser() });
    chefId = chef.id;
    cookie = await signIn(chefId);
  });

  afterEach(async () => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    await cleanupDatabase();
  });

  describe("action", () => {
    it("makes a link whose address finds the cook's plan, and the page then says when it was made", async () => {
      expect((await load()).feedMadeAt).toBeNull();
      const made = await act({ intent: "make-feed-link" });
      expect(made.status).toBe(200);
      expect(made.data).toEqual({ intent: "make-feed-link", feedUrl: expect.stringMatching(/^http:\/\/localhost:3000\/calendar\/[A-Za-z0-9_-]{43}\.ics$/), replaced: false });
      expect(await planForFeedToken(prismaFeedLinkStore(db), tokenOf(made.data.feedUrl))).toMatchObject({ ownerId: chefId });
      expect((await load()).feedMadeAt).toBe(NOW.toISOString());
    });

    it("replaces the old link when the cook makes a new one, and says it did", async () => {
      const first = await act({ intent: "make-feed-link" });
      const second = await act({ intent: "make-feed-link" });
      expect(second.data.replaced).toBe(true);
      expect(await planForFeedToken(prismaFeedLinkStore(db), tokenOf(first.data.feedUrl))).toBeNull();
      expect(await planForFeedToken(prismaFeedLinkStore(db), tokenOf(second.data.feedUrl))).toMatchObject({ ownerId: chefId });
    });

    it("puts the link on the site's own address when one is set, and on the request's without an environment", async () => {
      expect((await act({ intent: "make-feed-link" }, { SPOONJOY_BASE_URL: "https://spoonjoy.app" })).data.feedUrl).toMatch(/^https:\/\/spoonjoy\.app\/calendar\//);
      expect((await act({ intent: "make-feed-link" }, null)).data.feedUrl).toMatch(/^http:\/\/localhost:3000\/calendar\//);
    });

    it("turns the link off, and says when there was none", async () => {
      const made = await act({ intent: "make-feed-link" });
      expect(await act({ intent: "revoke-feed-link" })).toEqual({ status: 200, data: { intent: "revoke-feed-link", revoked: true } });
      expect(await planForFeedToken(prismaFeedLinkStore(db), tokenOf(made.data.feedUrl))).toBeNull();
      expect((await load()).feedMadeAt).toBeNull();
      expect(await act({ intent: "revoke-feed-link" })).toEqual({ status: 200, data: { intent: "revoke-feed-link", revoked: false } });
    });

    it("says so when the database is busy", async () => {
      vi.spyOn(db.calendarFeed, "upsert").mockRejectedValueOnce(new D1WriteUnavailableError("calendar_feed.make", new Error("busy")));
      const result = await act({ intent: "make-feed-link" });
      expect(result.status).toBe(503);
      expect(result.data).toMatchObject({ intent: "make-feed-link", error: D1_WRITE_UNAVAILABLE_MESSAGE });
    });
  });

  describe("page", () => {
    // How many times the page's loader has answered: once to open the page, and again after each action.
    let loads = 0;

    function renderLive() {
      loads = 0;
      const Stub = createTestRoutesStub([{
        path: "/plan",
        Component: PlanPage,
        loader: async () => {
          const page = await load();
          loads += 1;
          return page;
        },
        action: async ({ request }: { request: Request }) => (await act(Object.fromEntries(await request.formData()) as Record<string, string>)).data,
      }]);
      render(<Stub initialEntries={["/plan"]} />);
      return screen.findByRole("heading", { level: 1 });
    }

    function sheet() {
      return screen.findByRole("dialog", { name: "Add your meal plan to a calendar" });
    }

    it("makes a link and shows it once, to copy or open in a calendar app", async () => {
      const user = userEvent.setup();
      await renderLive();

      await user.click(screen.getByRole("button", { name: "Add to calendar" }));
      expect(within(await sheet()).getByText(/Anyone with the link can see your plan/)).toBeTruthy();
      expect(within(await sheet()).queryByRole("button", { name: "Turn off link" })).toBeNull();
      await user.click(within(await sheet()).getByRole("button", { name: "Make a calendar link" }));

      const field = (await within(await sheet()).findByRole("textbox", { name: "Calendar link" })) as HTMLInputElement;
      // The link can show before the page's reload after the action lands; waiting for it keeps that update inside
      // the test's act(), instead of during the database read below (#1091).
      await waitFor(() => expect(loads).toBe(2));
      expect(within(await sheet()).getByRole("status")).toHaveTextContent("Made your calendar link. Copy it now: Spoonjoy shows it only this once.");
      // The button that made it is gone, so the link takes the focus.
      expect(field).toHaveFocus();
      expect(within(await sheet()).getByText(/Using Google Calendar\?/)).toBeTruthy();
      // The link is a secret, so analytics records nothing inside the sheet.
      expect((await sheet()).querySelector(".ph-no-capture")).toBeTruthy();
      expect(field.readOnly).toBe(true);
      expect(await planForFeedToken(prismaFeedLinkStore(db), tokenOf(field.value))).toMatchObject({ ownerId: chefId });
      expect(within(await sheet()).getByRole("link", { name: "Open in calendar app" })).toHaveAttribute("href", webcalUrl(field.value));
      expect(within(await sheet()).getByRole("button", { name: "Copy link" })).toBeTruthy();
      expect(within(await sheet()).queryByRole("button", { name: "Make a new link" })).toBeNull();
    });

    it("never shows a link again once its sheet closes: it says when the link was made, and makes a new one or turns it off", async () => {
      const user = userEvent.setup();
      await renderLive();
      await user.click(screen.getByRole("button", { name: "Add to calendar" }));
      await user.click(within(await sheet()).getByRole("button", { name: "Make a calendar link" }));
      expect(await within(await sheet()).findByRole("textbox", { name: "Calendar link" })).toBeTruthy();

      // Closed and opened again, the sheet no longer shows the link: it says when it was made and offers a new one.
      await user.click(within(await sheet()).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await user.click(screen.getByRole("button", { name: "Add to calendar" }));
      expect(within(await sheet()).queryByRole("textbox", { name: "Calendar link" })).toBeNull();
      expect(await within(await sheet()).findByText(/You made your link on/)).toHaveTextContent("Dec 16, 2026");
      await user.click(within(await sheet()).getByRole("button", { name: "Make a new link" }));
      await waitFor(async () => expect(within(await sheet()).getByRole("status")).toHaveTextContent("Made a new calendar link; the old one no longer works."));

      await user.click(within(await sheet()).getByRole("button", { name: "Turn off link" }));
      await waitFor(async () => expect(within(await sheet()).getByRole("status")).toHaveTextContent("Turned off your calendar link. Calendars subscribed to it stop getting your plan."));
      // The turn-off button is gone, so the focus lands on the button that makes a new link.
      expect(await within(await sheet()).findByRole("button", { name: "Make a calendar link" })).toHaveFocus();
      expect(within(await sheet()).queryByRole("textbox", { name: "Calendar link" })).toBeNull();
      expect(await db.calendarFeed.count()).toBe(0);
    });

    it("says when there was no link to turn off, and shows a refusal as an alert", async () => {
      const user = userEvent.setup();
      function show(answer: PlanActionAnswer, madeAt: string | null) {
        cleanup();
        const Stub = createTestRoutesStub([{ path: "/plan", Component: () => <CalendarFeed madeAt={madeAt} answer={answer} /> }]);
        render(<Stub initialEntries={["/plan"]} />);
        return screen.findByRole("button", { name: "Add to calendar" });
      }

      await user.click(await show({ intent: "revoke-feed-link", revoked: false }, null));
      expect(within(await sheet()).getByRole("status")).toHaveTextContent("There was no calendar link to turn off.");
      await user.click(await show({ intent: "make-feed-link", error: D1_WRITE_UNAVAILABLE_MESSAGE }, "2026-12-01T00:00:00.000Z"));
      expect(within(await sheet()).getByRole("alert")).toHaveTextContent(D1_WRITE_UNAVAILABLE_MESSAGE);
      await user.click(await show({ intent: "revoke-feed-link", errors: { general: "Try again." } }, null));
      expect(within(await sheet()).getByRole("alert")).toHaveTextContent("Try again.");
      await user.click(await show({ intent: "add-note" }, null));
      expect(within(await sheet()).getByRole("status")).toBeEmptyDOMElement();
      expect(within(await sheet()).queryByRole("alert")).toBeNull();
      await user.click(await show({ intent: "revoke-feed-link", error: D1_WRITE_UNAVAILABLE_MESSAGE }, null));
      expect(within(await sheet()).getByRole("status")).toBeEmptyDOMElement();
      expect(within(await sheet()).getByRole("button", { name: "Make a calendar link" })).not.toHaveFocus();
    });

    it("opens the link in a calendar app at webcal://", () => {
      expect(webcalUrl("https://spoonjoy.app/calendar/abc.ics")).toBe("webcal://spoonjoy.app/calendar/abc.ics");
      expect(webcalUrl("http://localhost:3000/calendar/abc.ics")).toBe("webcal://localhost:3000/calendar/abc.ics");
    });
  });
});
