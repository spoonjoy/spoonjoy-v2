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

  it("leaves the phone tab bar's clearance to HX TabBar, which reserves it below the page", () => {
    expect(source).not.toMatch(/<main[^>]*pb-\[/);
  });

  it("marks the document hydrated from Layout, which wraps App and the error boundary alike", () => {
    expect(source).toMatch(/export function Layout\([^)]*\) \{[^}]*\n  useHydratedMark\(\);\n  return \(\n    <html/);
  });

  it("renders Ouro UI's popups last in <main>, in App and the error boundary alike", () => {
    expect(source).toContain("<OuroProvider linkComponent={OuroRouterLink} portalContainer={popups}>");
    expect(source).toContain("<PopupLayerContext.Provider value={popups}>");
    expect(source.match(/<PopupLayer \/>\n\s*<\/main>/g)).toHaveLength(2);
    expect(source.match(/^\s*<main\b/gm)).toHaveLength(2);
  });

  it("puts no stacking context or vertical clip around the popups, so they show whole over the bars", () => {
    expect(source).not.toMatch(/sj-app-shell[^"]*\bisolate\b/);
    const css = readFileSync("app/styles/tailwind.css", "utf8");
    const main = css.match(/\.sj-desktop-surface,\n\.sj-mobile-surface \{([^}]*)\}/)?.[1];
    expect(main).toContain("overflow-x: clip;");
    expect(main).toContain("display: flow-root;");
    expect(main).not.toMatch(/isolation|overflow:|overflow-y|transform|filter|contain/);
  });
});

describe("root.tsx site footer and X-ray", () => {
  const source = readFileSync("app/root.tsx", "utf8");

  it("puts the footer after <main>, before the phone tab bar and its room at the end of the page", () => {
    const shell = source.slice(source.indexOf('<div className="sj-app-shell'));
    expect(shell).toMatch(/<\/main>\n\s*<SiteFooter \/>\n\s*<\/div>\n\s*<MobileNav /);
  });

  it("wraps the whole app in one X-ray, at the running commit, so every page can open it", () => {
    expect(source).toContain("<XrayProvider sourceSha={sourceSha}>");
    expect(source.match(/<Inspector\b/g)).toBeNull();
  });

  it("hides the footer in cook mode, the full-screen view", () => {
    const css = readFileSync("app/styles/tailwind.css", "utf8");
    expect(css).toMatch(/body:has\(#cook\) \.sj-site-footer[^{]*\{\s*display: none;/);
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
