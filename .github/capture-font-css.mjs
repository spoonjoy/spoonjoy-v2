import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { devices } from "@playwright/test";

assert.equal(process.env.GITHUB_ACTIONS, "true", "Font-source control runs only in isolated CI");
const url = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT,WONK@9..144,500..900,50..100,0..1&family=IBM+Plex+Sans+Condensed:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400..800&display=swap";
const directory = join(process.env.RUNNER_TEMP, "axe-network");
await mkdir(directory, { recursive: true });
const variants = [];
for (const name of ["Desktop Chrome", "Desktop Safari"]) {
  const userAgent = devices[name].userAgent;
  const response = await fetch(url, { headers: { "User-Agent": userAgent } });
  assert.equal(response.status, 200);
  const css = await response.text();
  assert.ok(response.headers.get("content-type")?.includes("text/css"));
  for (const family of ["Fraunces", "IBM Plex Sans Condensed", "Source Serif 4"]) assert.ok(css.includes(`font-family: '${family}'`));
  const filename = name.replaceAll(" ", "-") + ".css";
  await writeFile(join(directory, filename), css);
  variants.push({ name, userAgent, filename, css, sha256: createHash("sha256").update(css).digest("hex") });
}
const metadata = {
  source: url,
  variants: variants.map(({ css, ...variant }) => ({
    ...variant, bytes: Buffer.byteLength(css),
    fontUrls: [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g))],
  })),
  sameCssForBothBrowsers: variants[0].css === variants[1].css,
  change: "Stylesheet origin only; same complete font-face rules and remote font binary URLs. Axe, preload defaults and spec assertions are unchanged.",
};
await writeFile(join(directory, "font-source.json"), JSON.stringify(metadata, null, 2));
assert.equal(metadata.sameCssForBothBrowsers, true, "Browser font variants differ; do not choose a snapshot silently");
await writeFile(".storybook/font-faces.css", variants[0].css);
console.log(JSON.stringify(metadata, null, 2));
