import { describe, expect, it } from "vitest";
import { localDateTimeToIso } from "~/lib/cooked-at";
import { withTimeZone } from "../helpers/timezone";

describe("localDateTimeToIso", () => {
  it("reads a datetime-local value as the browser's own wall-clock time", async () => {
    await withTimeZone("America/Los_Angeles", () => {
      // Pacific Daylight Time, UTC-7.
      expect(localDateTimeToIso("2026-09-26T07:30")).toBe("2026-09-26T14:30:00.000Z");
      // Pacific Standard Time, UTC-8: the offset is the one in force on the day typed.
      expect(localDateTimeToIso("2026-01-15T07:30")).toBe("2026-01-15T15:30:00.000Z");
    });
    await withTimeZone("Asia/Kolkata", () => {
      expect(localDateTimeToIso("2026-09-26T07:30")).toBe("2026-09-26T02:00:00.000Z");
    });
  });

  it("keeps seconds and milliseconds when the field has them", async () => {
    await withTimeZone("UTC", () => {
      expect(localDateTimeToIso("2026-09-26T07:30:15")).toBe("2026-09-26T07:30:15.000Z");
      expect(localDateTimeToIso("2026-09-26T07:30:15.5")).toBe("2026-09-26T07:30:15.500Z");
      expect(localDateTimeToIso(" 2026-09-26T07:30:15.250 ")).toBe("2026-09-26T07:30:15.250Z");
    });
  });

  it("reads a two-digit year as that year, not as 19xx", async () => {
    await withTimeZone("UTC", () => {
      expect(localDateTimeToIso("0099-03-04T05:06")).toBe("0099-03-04T05:06:00.000Z");
    });
  });

  it("leaves an empty field empty and passes anything else through for the server to judge", () => {
    expect(localDateTimeToIso("")).toBe("");
    expect(localDateTimeToIso("not a date")).toBe("not a date");
    expect(localDateTimeToIso("2026-09-26T14:30:00.000Z")).toBe("2026-09-26T14:30:00.000Z");
  });
});
