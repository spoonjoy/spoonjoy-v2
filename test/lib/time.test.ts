import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "~/lib/time";

const NOW = new Date("2026-05-11T12:00:00Z").getTime();

function ago(ms: number, now: number = NOW): Date {
  return new Date(now - ms);
}

describe("formatRelativeTime", () => {
  it("returns 'just now' for moments under 5 seconds", () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe("just now");
    expect(formatRelativeTime(ago(4_500), NOW)).toBe("just now");
  });

  it("returns 'just now' for future-dated inputs", () => {
    expect(formatRelativeTime(new Date(NOW + 60_000), NOW)).toBe("just now");
  });

  it("returns '{n} seconds ago' for 5–59 seconds", () => {
    expect(formatRelativeTime(ago(5_000), NOW)).toBe("5 seconds ago");
    expect(formatRelativeTime(ago(59_000), NOW)).toBe("59 seconds ago");
  });

  it("returns '1 minute ago' for the 60s–119s boundary", () => {
    expect(formatRelativeTime(ago(60_000), NOW)).toBe("1 minute ago");
    expect(formatRelativeTime(ago(119_000), NOW)).toBe("1 minute ago");
  });

  it("returns '{n} minutes ago' for 2–59 minutes", () => {
    expect(formatRelativeTime(ago(2 * 60_000), NOW)).toBe("2 minutes ago");
    expect(formatRelativeTime(ago(59 * 60_000), NOW)).toBe("59 minutes ago");
  });

  it("returns '1 hour ago' for the 1h–1h59m boundary", () => {
    expect(formatRelativeTime(ago(60 * 60_000), NOW)).toBe("1 hour ago");
    expect(formatRelativeTime(ago(119 * 60_000), NOW)).toBe("1 hour ago");
  });

  it("returns '{n} hours ago' for 2–23 hours", () => {
    expect(formatRelativeTime(ago(2 * 60 * 60_000), NOW)).toBe("2 hours ago");
    expect(formatRelativeTime(ago(23 * 60 * 60_000), NOW)).toBe("23 hours ago");
  });

  it("returns '1 day ago' / '{n} days ago' for 1–6 days", () => {
    expect(formatRelativeTime(ago(24 * 60 * 60_000), NOW)).toBe("1 day ago");
    expect(formatRelativeTime(ago(6 * 24 * 60 * 60_000), NOW)).toBe("6 days ago");
  });

  it("returns '1 week ago' / '{n} weeks ago' for 1–4 weeks", () => {
    expect(formatRelativeTime(ago(7 * 24 * 60 * 60_000), NOW)).toBe("1 week ago");
    expect(formatRelativeTime(ago(28 * 24 * 60 * 60_000), NOW)).toBe("4 weeks ago");
  });

  it("returns '1 month ago' / '{n} months ago' for ≥30 days and <1 year", () => {
    expect(formatRelativeTime(ago(30 * 24 * 60 * 60_000), NOW)).toBe("1 month ago");
    expect(formatRelativeTime(ago(180 * 24 * 60 * 60_000), NOW)).toBe("6 months ago");
  });

  it("returns '1 year ago' / '{n} years ago' for ≥365 days", () => {
    expect(formatRelativeTime(ago(365 * 24 * 60 * 60_000), NOW)).toBe("1 year ago");
    expect(formatRelativeTime(ago(2 * 365 * 24 * 60 * 60_000), NOW)).toBe(
      "2 years ago",
    );
  });

  it("accepts ISO strings", () => {
    expect(
      formatRelativeTime(new Date(NOW - 90_000).toISOString(), NOW),
    ).toBe("1 minute ago");
  });

  it("accepts millisecond numbers", () => {
    expect(formatRelativeTime(NOW - 5_000, NOW)).toBe("5 seconds ago");
  });

  it("defaults `now` to Date.now() when omitted", () => {
    const result = formatRelativeTime(new Date(Date.now() - 1_000));
    expect(result).toBe("just now");
  });
});
