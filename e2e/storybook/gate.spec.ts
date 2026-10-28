// The accessibility gate's own measurements (e2e/journeys/support), run in a real browser against
// small pages whose answer is known, so a measurement that would pass a bad page fails here first.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "../ouro-fixtures";
import { AXE_EXCLUDE } from "../journeys/support/axe";
import { auditShownScheme, describeAuditFailures } from "../journeys/support/accessibility";
import { measureTextContrast } from "../journeys/support/rendered-contrast";
import { verifyHiddenFocus } from "../journeys/support/undecided-checks";
import { auditEachPopupOpen, describePopup } from "./popups";

async function show(page: Page, body: string) {
  await page.setContent(`<!doctype html><html lang="en"><head><title>Gate</title></head><body style="margin:0;font:16px/1.5 sans-serif">${body}</body></html>`);
}

test.describe("the story check", () => {
  test("fails a popup rendered outside the page's landmarks, as a story checks with its popups in its <main>", async ({ page }) => {
    await show(page, `<main><h1>Gate</h1><button type="button" aria-expanded="true" aria-controls="herbs">Herbs</button></main><div id="herbs" role="listbox" aria-label="Herbs"><div role="option" aria-selected="false">Basil</div></div>`);
    expect(describeAuditFailures([await auditShownScheme(page, { target: "story" })])).toMatch(/violation region \(/);
    await page.evaluate(() => document.querySelector("main")!.append(document.querySelector("#herbs")!));
    expect(describeAuditFailures([await auditShownScheme(page, { target: "story" })])).toBeNull();
  });

  test("opens each popup and fails what only the open popup holds, then closes it", async ({ page }) => {
    // A menu whose only item has no name: Base UI renders a popup's content only while it is open.
    await show(
      page,
      `<main><h1>Gate</h1><button type="button" id="herbs" aria-haspopup="menu" aria-expanded="false">Herbs</button><div id="menu"></div></main>` +
        `<script>
          const button = document.querySelector("#herbs");
          const menu = document.querySelector("#menu");
          const show = (open) => {
            button.setAttribute("aria-expanded", String(open));
            menu.replaceChildren();
            if (!open) return;
            const popup = document.createElement("div");
            popup.setAttribute("role", "menu");
            popup.setAttribute("aria-label", "Herbs");
            popup.setAttribute("data-open", "");
            const item = document.createElement("div");
            item.setAttribute("role", "menuitem");
            item.tabIndex = -1;
            popup.append(item);
            menu.append(popup);
          };
          button.addEventListener("click", () => show(true));
          document.addEventListener("keydown", (event) => event.key === "Escape" && show(false));
        </script>`,
    );
    expect(describeAuditFailures([await auditShownScheme(page, { target: "story" })])).toBeNull();
    const opened = await auditEachPopupOpen(page, "main", { target: "story" });
    expect(opened.map(({ trigger }) => trigger)).toEqual(["Herbs"]);
    expect(describeAuditFailures(opened.map(({ audit }) => audit))).toMatch(/violation aria-command-name \(/);
    await expect(page.locator('[role="menu"]')).toHaveCount(0);
  });

  test("hovers each tooltip's trigger, presses each navigation panel's and focuses each hover card's from the keyboard, and fails what only the open popup holds", async ({ page }) => {
    // Each popup holds an image without a name, and exists only while it is open, as Base UI renders it.
    await show(
      page,
      `<main><h1>Gate</h1><button type="button" id="basil" data-base-ui-tooltip-trigger="">Basil</button>` +
        `<button type="button" id="herbs" data-ouro-control="navigation-menu" data-ouro-part="trigger">Herbs</button>` +
        `<a href="#thyme" id="thyme" data-ouro-hover-card-trigger="">Thyme</a><div id="layer"></div></main>` +
        `<script>
          const layer = document.querySelector("#layer");
          const show = (kind) => {
            const popup = document.createElement("div");
            popup.setAttribute("data-ouro", kind);
            popup.setAttribute("data-open", "");
            const image = document.createElement("img");
            image.src = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
            image.width = 8;
            image.height = 8;
            popup.append(image);
            layer.replaceChildren(popup);
          };
          const hide = () => layer.replaceChildren();
          document.querySelector("#basil").addEventListener("mouseenter", () => show("tooltip"));
          document.querySelector("#basil").addEventListener("mouseleave", hide);
          document.querySelector("#herbs").addEventListener("click", () => show("navigation-menu-popup"));
          document.querySelector("#thyme").addEventListener("focus", () => show("hover-card"));
          document.querySelector("#thyme").addEventListener("blur", hide);
          document.addEventListener("keydown", (event) => event.key === "Escape" && hide());
        </script>`,
    );
    expect(describeAuditFailures([await auditShownScheme(page, { target: "story" })])).toBeNull();
    const opened = await auditEachPopupOpen(page, "main", { target: "story" });
    expect(opened.map(describePopup)).toEqual(['the tooltip of "Basil"', 'the navigation panel of "Herbs"', 'the hover card of "Thyme"']);
    for (const { audit } of opened) expect(describeAuditFailures([audit])).toMatch(/violation image-alt \(/);
    await expect(page.locator("#layer > *")).toHaveCount(0);
  });

  test("leaves out what Ouro UI's gate leaves out: Base UI's focus guards", async ({ page }) => {
    const ouro = readFileSync("app/lib/ouro/testing/axe.ts", "utf8").match(/const axeExclude: string\[\] = (\[.*\]);/)?.[1];
    expect(ouro && JSON.parse(ouro)).toEqual(AXE_EXCLUDE);
    const guard = '<span aria-hidden="true" tabindex="0" style="position:fixed;width:1px;height:1px;overflow:hidden"></span>';
    await show(page, `<main><h1>Gate</h1><button type="button">Herbs</button>${guard}</main>`);
    expect(describeAuditFailures([await auditShownScheme(page, { target: "story" })])).toMatch(/violation aria-hidden-focus \(/);
    await page.evaluate(() => document.querySelector("span")!.setAttribute("data-base-ui-focus-guard", ""));
    expect(describeAuditFailures([await auditShownScheme(page, { target: "story" })])).toBeNull();
    expect(describeAuditFailures([await auditShownScheme(page)])).toBeNull();
  });

  test("passes page text an open popup covers, and measures what shows of text it covers only partly", async ({ page }) => {
    // Faint text under a popup's layer: Base UI renders each popup in a portal of its own.
    await show(
      page,
      `<main style="position:relative"><p id="under" style="margin:0;line-height:24px;color:#ccc">Under the panel</p>` +
        `<div id="layer" data-base-ui-portal=""><div role="group" aria-label="Recipes" style="position:absolute;top:0;left:0;right:0;height:48px;background:#222"></div></div><h1>Gate</h1></main>`,
    );
    expect(describeAuditFailures([await auditShownScheme(page, { target: "story" })])).toBeNull();
    await page.evaluate(() => document.querySelector("#layer")!.removeAttribute("data-base-ui-portal"));
    expect(describeAuditFailures([await auditShownScheme(page, { target: "story" })])).toMatch(/line 1 is covered by/);
    // The popup covers the middle third of the line, so axe cannot judge it; the rest still shows,
    // and the text is not hidden from assistive technology.
    await page.evaluate(() => {
      const layer = document.querySelector("#layer")!;
      layer.setAttribute("data-base-ui-portal", "");
      const text = document.createRange();
      text.selectNodeContents(document.querySelector("#under")!);
      const { width } = text.getBoundingClientRect();
      Object.assign((layer.firstElementChild as HTMLElement).style, { left: `${width / 3}px`, right: "auto", width: `${width / 3}px` });
    });
    expect(describeAuditFailures([await auditShownScheme(page, { target: "story" })])).toMatch(/color-contrast measured 1\.\d\d:1, needs 4\.5:1/);
    await page.evaluate(() => document.querySelector<HTMLElement>("#under")!.style.setProperty("color", "#333"));
    expect(describeAuditFailures([await auditShownScheme(page, { target: "story" })])).toBeNull();
  });
});

test.describe("text axe cannot judge", () => {
  test("fails faint text over a gradient", async ({ page }) => {
    await show(page, `<main><h1>Gate</h1><p style="color:#999;background:linear-gradient(#fff,#eee)">Faint text</p></main>`);
    const audit = await auditShownScheme(page);
    expect(describeAuditFailures([audit])).toMatch(/color-contrast measured 2\.\d\d:1, needs 4\.5:1/);
  });

  test("passes dark text over the same gradient", async ({ page }) => {
    await show(page, `<main><h1>Gate</h1><p style="color:#222;background:linear-gradient(#fff,#eee)">Dark text</p></main>`);
    const audit = await auditShownScheme(page);
    expect(audit.contrast).toHaveLength(1);
    expect(audit.contrast[0].passed).toBe(true);
    expect(describeAuditFailures([audit])).toBeNull();
  });

  test("applies a faded group's opacity once", async ({ page }) => {
    // White on grey at opacity 0.5 over black paints 127 on 64: 2.59:1, short of 3:1 for large text.
    await show(
      page,
      `<div style="background:#000;padding:24px"><div style="opacity:0.5;background:linear-gradient(#808080,#808080)"><p id="t" style="margin:0;color:#fff;font-size:24px">Faded</p></div></div>`,
    );
    const measured = await measureTextContrast(page, "#t", "fixture");
    expect(measured.passed).toBe(false);
    expect(measured.ratio).toBeGreaterThan(2.4);
    expect(measured.ratio).toBeLessThan(2.8);
  });

  test("counts a veil drawn over the text as covering it", async ({ page }) => {
    await show(
      page,
      `<p id="t" style="position:relative;color:#000;background:#fff">Veiled<span aria-hidden="true" style="position:absolute;inset:0;pointer-events:none;background:rgba(255,255,255,0.8)"></span></p>`,
    );
    const measured = await measureTextContrast(page, "#t", "fixture");
    expect(measured.passed).toBe(false);
    expect(measured.error).toMatch(/covered by span/);
  });

  test("measures through a strike drawn in the text's own colour", async ({ page }) => {
    await show(
      page,
      `<p id="t" style="position:relative;color:#000;background:#fff">Struck<span aria-hidden="true" style="position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(transparent 45%, currentColor 45% 55%, transparent 55%)"></span></p>`,
    );
    const measured = await measureTextContrast(page, "#t", "fixture");
    expect(measured.passed).toBe(true);
    expect(measured.ratio).toBeGreaterThanOrEqual(20);
  });

  test("fails covered text hidden from assistive technology when no dialog is open", async ({ page }) => {
    await show(page, `<p id="t" aria-hidden="true" style="color:#000;background:#fff">Hidden</p><div style="position:fixed;inset:0;background:#fff"></div>`);
    const measured = await measureTextContrast(page, "#t", "fixture");
    expect(measured.passed).toBe(false);
    expect(measured.error).toMatch(/is covered by div/);
  });
});

test.describe("focus inside a hidden region", () => {
  test("fails when the tab order reaches it", async ({ page }) => {
    await show(page, `<button>Before</button><div id="r" aria-hidden="true"><button id="b">Inside</button></div><button>After</button>`);
    const [outcome] = await verifyHiddenFocus(page, [{ kind: "hidden-focus", selector: "#r", related: ["#b"] }]);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toMatch(/lands inside the hidden region on button#b/);
  });

  test("passes when the tab order skips it", async ({ page }) => {
    await show(page, `<button>Before</button><div id="r" aria-hidden="true"><button id="b" tabindex="-1">Inside</button></div><button>After</button>`);
    const [outcome] = await verifyHiddenFocus(page, [{ kind: "hidden-focus", selector: "#r", related: ["#b"] }]);
    expect(outcome.passed).toBe(true);
  });

  test("walks on past an element that does not take focus, as Tab does", async ({ page }) => {
    await show(page, `<button>Before</button><fieldset disabled><button>Off</button></fieldset><div id="r" aria-hidden="true"><button id="b">Inside</button></div><button>After</button>`);
    const [outcome] = await verifyHiddenFocus(page, [{ kind: "hidden-focus", selector: "#r", related: ["#b"] }]);
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toMatch(/lands inside the hidden region on button#b/);
  });
});
