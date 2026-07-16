import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ReleaseReadiness, {
  action,
  loader,
} from "~/routes/well-known.spoonjoy-release-readiness";
import { createTestRoutesStub } from "../utils";

describe("release readiness route", () => {
  it("serves side-effect-free loader and action responses without caching", async () => {
    for (const response of [loader(), action()]) {
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({ status: "ready" });
    }
  });

  it("renders a real React Router mutation form for the release canary", async () => {
    const Stub = createTestRoutesStub([
      {
        path: "/.well-known/spoonjoy-release-readiness",
        Component: ReleaseReadiness,
        loader,
        action,
      },
    ]);

    render(<Stub initialEntries={["/.well-known/spoonjoy-release-readiness"]} />);

    const button = await screen.findByRole("button", { name: "Probe Worker mutation channel" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button.closest("form")).toHaveAttribute("method", "post");
  });
});
