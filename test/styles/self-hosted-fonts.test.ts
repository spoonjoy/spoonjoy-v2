import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { links } from "~/root";

const ROOT = resolve(__dirname, "../..");
const css = readFileSync(resolve(ROOT, "app/styles/fonts.css"), "utf8");
const faces = Array.from(css.matchAll(/@font-face \{([^}]*)\}/g), (match) => match[1]);
const field = (face: string, name: string) => new RegExp(`${name}: ([^;]+);`).exec(face)?.[1];
const fontFile = (face: string) => /src: url\("\.\.\/fonts\/([a-z0-9-]+\.woff2)"\) format\('woff2'\);/.exec(face)?.[1];

// The table tags in a WOFF2 file's directory (W3C WOFF2, section 5.2). A tag is either an index into
// the spec's known-tag list or four bytes after the flags; each entry's lengths are UIntBase128s.
const KNOWN_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep"];
function woff2Tables(bytes: Buffer): string[] {
  const tags: string[] = [];
  let offset = 48;
  const base128 = () => {
    let value = 0;
    for (;;) {
      const byte = bytes[offset++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
  };
  for (let table = 0; table < bytes.readUInt16BE(12); table++) {
    const flags = bytes[offset++];
    const index = flags & 0x3f;
    const tag = index === 63 ? bytes.subarray(offset, (offset += 4)).toString("latin1") : (KNOWN_TAGS[index] ?? `#${index}`);
    tags.push(tag);
    base128();
    const transform = flags >> 6;
    if (tag === "glyf" || tag === "loca" ? transform === 0 : transform !== 0) base128();
  }
  return tags;
}

describe("self-hosted web fonts", () => {
  it("serves every face from the app's own files, never from Google Fonts", () => {
    expect(faces).toHaveLength(29);
    // Comments may name Google Fonts; no rule may load from it or any other host.
    expect(css.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/googleapis|gstatic|https?:/);
    for (const face of faces) {
      const file = fontFile(face);
      expect(file).toBeDefined();
      const bytes = readFileSync(resolve(ROOT, "app/fonts", file!));
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
    }
    expect(JSON.stringify(links())).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    expect(readFileSync(resolve(ROOT, "app/root.tsx"), "utf8")).toContain('import "./styles/fonts.css";');
  });

  it("ships the hinted build Google served Windows and Linux, which renders there as Google's did", () => {
    for (const face of faces) {
      const tables = woff2Tables(readFileSync(resolve(ROOT, "app/fonts", fontFile(face)!)));
      expect(tables).toContain("glyf");
      expect(tables).toContain("prep");
    }
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
