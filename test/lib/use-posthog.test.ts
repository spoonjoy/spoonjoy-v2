// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const client = { capture: vi.fn() };
vi.mock("@posthog/react", () => ({ usePostHog: () => client }));

import { usePostHog } from "~/lib/use-posthog";

describe("usePostHog", () => {
  it("returns the client @posthog/react provides", () => {
    expect(usePostHog()).toBe(client);
  });
});
