import { describe, it, expect } from "vitest";
import { links } from "~/root";

describe("root.tsx links()", () => {
  it("includes the manifest.webmanifest link", () => {
    const result = links();
    expect(result).toContainEqual(
      expect.objectContaining({ rel: "manifest", href: "/manifest.webmanifest" }),
    );
  });

  it("still includes the existing apple-touch-icon", () => {
    const result = links();
    expect(result).toContainEqual(
      expect.objectContaining({ rel: "apple-touch-icon", href: "/logos/sj_black.svg" }),
    );
  });
});
