import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { links } from "~/root";

const ROOT = resolve(__dirname, "../..");
const css = readFileSync(resolve(ROOT, "app/styles/fonts.css"), "utf8");
const faces = Array.from(css.matchAll(/@font-face \{([^}]*)\}/g), (match) => match[1]);
const field = (face: string, name: string) => new RegExp(`${name}: ([^;]+);`).exec(face)?.[1];

describe("self-hosted web fonts", () => {
  it("serves every face from the app's own files, never from Google Fonts", () => {
    expect(faces).toHaveLength(29);
    // Comments may name Google Fonts; no rule may load from it or any other host.
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/googleapis|gstatic|https?:/);
    for (const face of faces) {
      const file = /src: url\("\.\.\/fonts\/([a-z0-9-]+\.woff2)"\) format\('woff2'\);/.exec(face)?.[1];
      expect(file).toBeDefined();
      const bytes = readFileSync(resolve(ROOT, "app/fonts", file!));
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
    }
    expect(JSON.stringify(links())).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(readFileSync(resolve(ROOT, "app/root.tsx"), "utf8")).toContain('import "./styles/fonts.css";');
  });

  it("gives Storybook the same local files, with no Google Fonts link", () => {
    expect(readFileSync(resolve(ROOT, ".storybook/preview.tsx"), "utf8")).toContain("import '../app/styles/fonts.css'");
    expect(existsSync(resolve(ROOT, ".storybook/preview-head.html"))).toBe(false);
  });

  it("keeps the families, weights and font-display the Google Fonts request asked for", () => {
    const weights = (family: string) =>
      Array.from(new Set(faces.filter((face) => field(face, "font-family") === `'${family}'`).map((face) => field(face, "font-weight")))).sort();
    expect(weights("Fraunces")).toEqual(["400 900"]);
    expect(weights("IBM Plex Sans Condensed")).toEqual(["300", "400", "500", "600", "700"]);
    expect(weights("Source Serif 4")).toEqual(["400 800"]);
    for (const face of faces) {
      expect(field(face, "font-display")).toBe("swap");
      expect(field(face, "unicode-range")).toBeDefined();
    }
  });

  it("ships each font's SIL Open Font License beside its files", () => {
    for (const family of ["fraunces", "ibmplexsanscondensed", "sourceserif4"]) {
      const licence = resolve(ROOT, "app/fonts", `OFL-${family}.txt`);
      expect(existsSync(licence)).toBe(true);
      expect(readFileSync(licence, "utf8")).toContain("SIL OPEN FONT LICENSE Version 1.1");
    }
  });
});
