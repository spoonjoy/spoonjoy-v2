import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { LocalDate } from "~/components/ui/local-date";
import { withTimeZone } from "../../helpers/timezone";

// Server-renders `ui` in the Worker's timezone (UTC), then hydrates that markup in `timeZone`, as a
// viewer's browser there would. Returns the hydrated container and React's recoverable errors
// (a hydration mismatch is reported there). Any console.error during hydration fails the test through
// the global warning gate, so no local console spy is needed.
async function serverThenHydrate(ui: React.ReactElement, timeZone: string) {
  const html = await withTimeZone("UTC", () => renderToString(ui));
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  const serverText = container.textContent;
  const onRecoverableError = vi.fn();
  await withTimeZone(timeZone, async () => {
    await act(async () => {
      hydrateRoot(container, ui, { onRecoverableError });
    });
  });
  return { container, serverText, onRecoverableError };
}

describe("LocalDate", () => {
  it("server-renders the UTC calendar date, then shows the viewer's local date once hydrated", async () => {
    // 20:00 UTC on 1 June is already 2 June in Kiritimati (UTC+14).
    const { container, serverText, onRecoverableError } = await serverThenHydrate(
      <LocalDate value="2026-06-01T20:00:00.000Z" />,
      "Pacific/Kiritimati",
    );
    try {
      expect(serverText).toBe("Jun 1, 2026");
      const time = container.querySelector("time");
      expect(time).toHaveTextContent("Jun 2, 2026");
      expect(time).toHaveAttribute("datetime", "2026-06-01T20:00:00.000Z");
      expect(onRecoverableError).not.toHaveBeenCalled();
    } finally {
      container.remove();
    }
  });

  it("shows the previous day for a viewer behind UTC", async () => {
    // 03:00 UTC on 2 June is still the evening of 1 June in Los Angeles.
    const { container, serverText, onRecoverableError } = await serverThenHydrate(
      <LocalDate value={new Date("2026-06-02T03:00:00Z")} />,
      "America/Los_Angeles",
    );
    try {
      expect(serverText).toBe("Jun 2, 2026");
      expect(container.querySelector("time")).toHaveTextContent("Jun 1, 2026");
      expect(onRecoverableError).not.toHaveBeenCalled();
    } finally {
      container.remove();
    }
  });

  it("keeps the same text when the local day is the UTC day", async () => {
    const { container, serverText, onRecoverableError } = await serverThenHydrate(
      <LocalDate value="2026-06-01T12:00:00.000Z" />,
      "Europe/London",
    );
    try {
      expect(serverText).toBe("Jun 1, 2026");
      expect(container.querySelector("time")).toHaveTextContent("Jun 1, 2026");
      expect(onRecoverableError).not.toHaveBeenCalled();
    } finally {
      container.remove();
    }
  });

  it("with unit=\"month\", server-renders the UTC month, then the viewer's month across a month boundary", async () => {
    // 03:00 UTC on 1 June is still 31 May in Los Angeles.
    const { container, serverText, onRecoverableError } = await serverThenHydrate(
      <LocalDate value="2026-06-01T03:00:00.000Z" unit="month" />,
      "America/Los_Angeles",
    );
    try {
      expect(serverText).toBe("Jun 2026");
      const time = container.querySelector("time");
      expect(time).toHaveTextContent("May 2026");
      expect(time).toHaveAttribute("datetime", "2026-06-01T03:00:00.000Z");
      expect(onRecoverableError).not.toHaveBeenCalled();
    } finally {
      container.remove();
    }
  });

  it("re-formats when the value changes", async () => {
    await withTimeZone("Pacific/Kiritimati", async () => {
      const { rerender } = render(<LocalDate value="2026-06-01T20:00:00.000Z" />);
      expect(await screen.findByText("Jun 2, 2026")).toHaveAttribute("datetime", "2026-06-01T20:00:00.000Z");
      rerender(<LocalDate value="2026-07-01T20:00:00.000Z" />);
      expect(await screen.findByText("Jul 2, 2026")).toHaveAttribute("datetime", "2026-07-01T20:00:00.000Z");
    });
  });
});
