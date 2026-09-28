import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { links, meta } from "~/root";

// Layout and App need React Router's framework context to render, so these read the source. The
// iPhone dock journey (e2e/journeys/dock.mobile.journey.ts) checks the rendered page on QA.
describe("root.tsx safe area and dock clearance", () => {
  const source = readFileSync("app/root.tsx", "utf8");

  it("sets viewport-fit=cover so iOS reports its safe-area insets", () => {
    expect(source).toContain('<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />');
  });

  it("pads main by the dock's bottom margin, its 4.25rem height and a 1rem gap", () => {
    expect(source).toContain("pb-[calc(max(1rem,env(safe-area-inset-bottom))+5.25rem)] lg:pb-0");
    expect(source).not.toContain("pb-[calc(5rem+env(safe-area-inset-bottom))]");
  });
});

describe("root.tsx meta()", () => {
  it("returns the plain brand title as the document default", () => {
    expect(meta()).toEqual([{ title: "Spoonjoy" }]);
  });
});

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
