import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const baseUrl = "http://127.0.0.1:5174";
const outputDirectory = new URL("./", import.meta.url).pathname;
const repositoryRoot = new URL("../../../../", import.meta.url).pathname;
const execFileAsync = promisify(execFile);
const longTag = "x".repeat(40);
const longQuery = "q".repeat(160);
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await mkdir(outputDirectory, { recursive: true });

const stamp = Date.now();
await page.goto(`${baseUrl}/signup`, { waitUntil: "domcontentloaded" });
await page.getByLabel("Email").fill(`codex-smoke-filter-qa-${stamp}@example.com`);
await page.getByLabel("Username").fill(`codex_filter_${String(stamp).slice(-6)}`);
await page.getByLabel("Password", { exact: true }).fill("CodexSmoke!2026Qa");
await page.getByLabel("Confirm Password").fill("CodexSmoke!2026Qa");
await page.getByRole("button", { name: "Sign Up" }).click();
await page.waitForURL((url) => !url.pathname.endsWith("/signup"));
await page.waitForLoadState("domcontentloaded");
await page.waitForTimeout(250);

const captures = [];
async function capture(name, path, viewport) {
  await page.setViewportSize(viewport);
  await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("combobox", { name: "Course" }).waitFor();
  await page.waitForTimeout(250);
  const screenshotPath = `${outputDirectory}${name}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const metrics = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const controlRoots = [
      document.querySelector('form[role="search"]'),
      document.querySelector('[role="region"][aria-label$="filters"]'),
    ].filter(Boolean);
    const controls = [...new Set(controlRoots.flatMap((rootElement) => (
      [...rootElement.querySelectorAll('a, button, input:not([type="hidden"]), select')]
    )))].map((element) => {
      const rect = element.getBoundingClientRect();
      const label = element.getAttribute("aria-label")
        ?? element.getAttribute("name")
        ?? element.textContent?.trim()
        ?? element.tagName.toLowerCase();
      const disabled = "disabled" in element && element.disabled;
      return {
        label,
        width: rect.width,
        height: rect.height,
        tabIndex: element.tabIndex,
        disabled,
        nativelyFocusable: disabled || element.tabIndex >= 0,
        meetsTargetSize: disabled || (rect.width >= 44 && rect.height >= 44),
      };
    });
    const removeTargets = [...document.querySelectorAll('a[aria-label^="Remove tag "]')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height, right: rect.right };
      });
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      documentWidth: root.scrollWidth,
      documentHeight: root.scrollHeight,
      bodyWidth: body.scrollWidth,
      horizontalOverflow: root.scrollWidth > window.innerWidth || body.scrollWidth > window.innerWidth,
      controls,
      allEnabledControlsNativelyFocusable: controls.every((control) => control.nativelyFocusable),
      allEnabledControlsMeetTargetSize: controls.every((control) => control.meetsTargetSize),
      removeTargets,
    };
  });
  captures.push({ name, path, screenshotPath, ...metrics });
}

const filters = `course=main&tag=quick+dinner&tag=${longTag}`;
await capture(
  "global-desktop",
  `/search?scope=all&q=tomato+soup&${filters}`,
  { width: 1440, height: 900 },
);
await capture(
  "global-mobile",
  `/search?scope=all&q=tomato+soup&${filters}`,
  { width: 390, height: 844 },
);
await capture(
  "my-recipes-desktop",
  `/my-recipes?q=tomato+soup&${filters}`,
  { width: 1440, height: 900 },
);
await capture(
  "my-recipes-mobile",
  `/my-recipes?q=tomato+soup&${filters}`,
  { width: 390, height: 844 },
);
await capture(
  "global-mobile-long-query",
  `/search?scope=all&q=${longQuery}&${filters}`,
  { width: 390, height: 844 },
);

await writeFile(
  `${outputDirectory}metrics.json`,
  `${JSON.stringify({ browserErrors, captures }, null, 2)}\n`,
);
} finally {
  try {
    await browser?.close();
  } finally {
    await execFileAsync("pnpm", ["cleanup:qa", "--", "--apply"], {
      cwd: repositoryRoot,
      maxBuffer: 5_000_000,
    });
  }
}
