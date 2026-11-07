import { type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelativeTime, type RelativeTimeProps } from "~/components/ouro/relative-time/relative-time";
import { calendarRelative } from "~/components/ouro/relative-time/relative-time-styles";
import { act } from "~/lib/ouro/testing/act";

const roots: Root[] = [];
let mounted: Element[] = [];
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const DAY = 24 * 60 * MINUTE;

async function render(node: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return { host, root, time: host.querySelector<HTMLTimeElement>('[data-ouro="relative-time"]')! };
}

/**
 * Makes `locale` the language Intl falls back to when none is passed, as a server's (Node's
 * en-US) or a reader's browser's own differs from this test browser's. Returns the undo.
 */
function defaultLocale(locale: string): () => void {
  const { DateTimeFormat, RelativeTimeFormat } = Intl;
  Object.assign(Intl, {
    DateTimeFormat: class extends DateTimeFormat {
      constructor(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
        super(locales ?? locale, options);
      }
    },
    RelativeTimeFormat: class extends RelativeTimeFormat {
      constructor(locales?: Intl.LocalesArgument, options?: Intl.RelativeTimeFormatOptions) {
        super(locales ?? locale, options);
      }
    },
  });
  return () => void Object.assign(Intl, { DateTimeFormat, RelativeTimeFormat });
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await act(async () => roots.splice(0).forEach((root) => root.unmount()));
  for (const node of mounted) node.remove();
  mounted = [];
});

describe("RelativeTime", () => {
  it.each([
    [-3 * DAY, "auto", "3 days ago"],
    [-1 * DAY, "auto", "yesterday"],
    [-1 * DAY, "always", "1 day ago"],
    [5 * MINUTE + 10 * SECOND, "auto", "in 5 minutes"],
    [-10 * SECOND, "auto", "now"],
    [-50 * SECOND, "auto", "50 seconds ago"],
    [-2 * 3600 * SECOND, "auto", "2 hours ago"],
    [-14 * DAY, "auto", "2 weeks ago"],
    [-62 * DAY, "auto", "2 months ago"],
    [-800 * DAY, "auto", "2 years ago"],
  ] as const)("says %ims from now as %s: %s", async (offset, numeric, words) => {
    const { time } = await render(<RelativeTime value={Date.now() + offset} numeric={numeric} locale="en-US" />);
    expect(time.textContent).toBe(words);
  });

  it("is a <time> with the exact instant, titled with the full local date and time", async () => {
    const value = new Date(Date.now() - 3 * DAY);
    const { time } = await render(<RelativeTime value={value.toISOString()} locale="en-US" />);
    expect(time.tagName).toBe("TIME");
    expect(time.dateTime).toBe(value.toISOString());
    expect(time.title).toBe(new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(value));
  });

  it("keeps a title of the app's own", async () => {
    const { time } = await render(<RelativeTime value={Date.now()} title="Posted" />);
    expect(time.title).toBe("Posted");
  });

  it("keeps itself current on one shared clock, and stops the clock when none shows", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 5, 1, 12)));
    const every = vi.spyOn(globalThis, "setInterval");
    const stop = vi.spyOn(globalThis, "clearInterval");
    const value = Date.now() - 20 * SECOND;
    const { host, root } = await render(
      <>
        <RelativeTime value={value} locale="en-US" />
        <RelativeTime value={value} numeric="always" locale="en-US" />
      </>,
    );
    const [auto, always] = host.querySelectorAll("time");
    expect(auto!.textContent).toBe("now");
    expect(always!.textContent).toBe("in 0 seconds");
    expect(every).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTime(30 * SECOND));
    expect(auto!.textContent).toBe("50 seconds ago");
    await act(async () => vi.advanceTimersByTime(30 * SECOND));
    expect(always!.textContent).toBe("1 minute ago");
    await act(async () => root.unmount());
    expect(stop).toHaveBeenCalledOnce();
  });

  it("writes the UTC date on the server, hydrates without a mismatch, then says how long ago", async () => {
    const value = new Date(Date.now() - 2 * DAY);
    const node = <RelativeTime value={value} locale="en-US" />;
    const html = renderToString(node);
    expect(html).toContain(`>${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(value)}</time>`);
    expect(html).not.toContain("title=");
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    mounted.push(host);
    const onRecoverableError = vi.fn();
    await act(async () => void roots.push(hydrateRoot(host, node, { onRecoverableError })));
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(host.querySelector("time")!.textContent).toBe("2 days ago");
  });

  it("counts a calendar date in whole days of the reader's calendar, titled with that day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Noon on June 1 where the reader is, whatever their time zone.
    vi.setSystemTime(new Date(2026, 5, 1, 12));
    const { host } = await render(
      <>
        <RelativeTime value="2026-06-02" locale="en-US" />
        <RelativeTime value="2026-06-01" locale="en-US" />
        <RelativeTime value="2026-05-29" locale="en-US" numeric="always" />
        <RelativeTime value="2026-06" locale="en-US" />
      </>,
    );
    const [tomorrow, today, ago, month] = host.querySelectorAll("time");
    expect(tomorrow!.textContent).toBe("tomorrow");
    expect(tomorrow!.title).toBe("Jun 2, 2026");
    expect(tomorrow!.dateTime).toBe("2026-06-02");
    expect(today!.textContent).toBe("today");
    expect(ago!.textContent).toBe("3 days ago");
    expect(month!.textContent).toBe("this month");
    expect(month!.title).toBe("Jun 2026");
    expect(month!.dateTime).toBe("2026-06");
  });

  it("writes a calendar date as that day on the server", () => {
    expect(renderToString(<RelativeTime value="2026-06-02" locale="en-US" />)).toContain('dateTime="2026-06-02" class="">Jun 2, 2026</time>');
  });

  it("hydrates without a mismatch when the reader's language is not the server's, then writes the reader's", async () => {
    const value = new Date(Date.now() - 2 * DAY);
    const node = <RelativeTime value={value} />;
    let undo = defaultLocale("en-US");
    let html: string;
    try {
      html = renderToString(node);
    } finally {
      undo();
    }
    expect(html).toContain(`>${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(value)}</time>`);
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    mounted.push(host);
    const onRecoverableError = vi.fn();
    undo = defaultLocale("de-DE");
    try {
      await act(async () => void roots.push(hydrateRoot(host, node, { onRecoverableError })));
      expect(onRecoverableError).not.toHaveBeenCalled();
      const time = host.querySelector("time")!;
      expect(time.textContent).toBe("vorgestern");
      expect(time.title).toBe(new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(value));
    } finally {
      undo();
    }
  });

  it("forwards a ref and <time> attributes, and lets app layout classes win", async () => {
    let element: HTMLTimeElement | null = null;
    const { time } = await render(<RelativeTime value={Date.now()} id="posted" className="ms-2" ref={(node) => void (element = node)} />);
    expect(element).toBe(time);
    expect(time.id).toBe("posted");
    expect(getComputedStyle(time).marginInlineStart).toBe("8px");
  });
});

describe("calendarRelative", () => {
  const west = "America/Los_Angeles";
  const east = "Asia/Tokyo";
  // 03:00 UTC on June 1: 8 PM on May 31 in Los Angeles, noon on June 1 in Tokyo.
  const morning = Date.UTC(2026, 5, 1, 3);
  // 20:00 UTC on June 1: 1 PM on June 1 in Los Angeles, 5 AM on June 2 in Tokyo.
  const evening = Date.UTC(2026, 5, 1, 20);

  it.each([
    ["2026-06-01", morning, west, "tomorrow"],
    ["2026-06-01", morning, east, "today"],
    ["2026-06-04", morning, west, "in 4 days"],
    ["2026-06-04", morning, east, "in 3 days"],
    ["2026-06-01", evening, west, "today"],
    ["2026-06-01", evening, east, "yesterday"],
    ["2026-05-18", evening, west, "2 weeks ago"],
    ["2026-08-01", evening, west, "in 2 months"],
    ["2024-06-01", evening, east, "2 years ago"],
    ["2026-06", morning, west, "next month"],
    ["2026-06", morning, east, "this month"],
    ["2025-05", evening, east, "last year"],
    ["2028-01", evening, west, "in 2 years"],
  ] as const)("says %s as seen at %i in %s: %s", (value, at, zone, words) => {
    expect(calendarRelative(value, at, "en-US", "auto", zone)).toBe(words);
  });

  it("says today as in 0 days when numeric is always", () => {
    expect(calendarRelative("2026-06-01", evening, "en-US", "always", west)).toBe("in 0 days");
  });
});

describe("RelativeTime development messages", () => {
  it.each([
    ["numeric", { numeric: "never" }, 'numeric="never" is not an option; use "auto" or "always"', '<RelativeTime numeric="always" />'],
    ["value", { value: "soon" }, 'value={"soon"} is not a date', "<RelativeTime value={new Date()} />"],
    ["date", { date: new Date() }, "date is not a prop", "<RelativeTime value={date} />"],
    ["now", { now: Date.now() }, "now is not a prop; RelativeTime keeps itself current", "<RelativeTime value={date} />"],
  ])("explains %s with the fix", async (_name, extra, problem, fix) => {
    const props = { value: Date.now(), ...extra } as unknown as RelativeTimeProps;
    const { time } = await render(<RelativeTime {...props} />);
    expect(warn).toHaveBeenCalledWith(`[ouro-ui] RelativeTime: ${problem}. Fix: ${fix}.`);
    expect(time.hasAttribute("now")).toBe(false);
  });

  it("says nothing for a value that is not a date", async () => {
    const { time } = await render(<RelativeTime value="soon" />);
    expect(time.textContent).toBe("");
    expect(time.hasAttribute("datetime")).toBe(false);
    expect(time.hasAttribute("title")).toBe(false);
  });

  it.each([
    ["text-muted-foreground", 'remove "text-muted-foreground"; style the text around it instead'],
    ["ms-1", ""],
  ])("checks the className %s", async (className, fix) => {
    await render(<RelativeTime value={Date.now()} className={className} />);
    if (fix) expect(warn).toHaveBeenCalledWith(`[ouro-ui] RelativeTime: "${className}" sets appearance, and className is for layout only. Fix: ${fix}.`);
    else expect(warn).not.toHaveBeenCalled();
  });
});
