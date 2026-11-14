import { afterEach, describe, expect, it } from "vitest";
import { loadFonts } from "~/lib/ouro/testing/fonts";

const declared: HTMLStyleElement[] = [];

/** Declares a font face in a stylesheet, as an app's stylesheet does, and returns the face the browser lists for it. */
function declareFace(family: string, src: string): FontFace {
  const style = document.createElement("style");
  style.textContent = `@font-face { font-family: "${family}"; src: ${src}; }`;
  document.head.append(style);
  declared.push(style);
  const face = [...document.fonts].find((candidate) => candidate.family.includes(family));
  if (!face) throw new Error(`The browser lists no font face for ${family}`);
  return face;
}

afterEach(() => {
  for (const style of declared.splice(0)) style.remove();
});

describe("loadFonts", () => {
  it("loads a declared font face, which the browser otherwise loads only once text uses it", async () => {
    const face = declareFace("DrainProbe", 'local("Helvetica"), local("Arial"), local("Liberation Sans"), local("DejaVu Sans")');
    expect(face.status).toBe("unloaded");

    await loadFonts();

    expect(face.status).toBe("loaded");
  });

  it("settles a face whose file is missing without rejecting", async () => {
    const face = declareFace("DrainMissing", 'url("/drain-missing/no-such-font.woff2") format("woff2")');

    await expect(loadFonts()).resolves.toBeUndefined();

    expect(face.status).toBe("error");
  });
});
