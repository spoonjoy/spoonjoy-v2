import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { audit, axeExclude, describeFindings, measureTextContrast } from "~/lib/ouro/testing/axe";

// The gate fails closed: these pages are each wrong in a way axe alone reports at a low impact or
// cannot decide, and the gate must fail every one of them, and pass the same page done right.

afterEach(() => {
  document.body.innerHTML = "";
  document.body.removeAttribute("style");
});

/** A page with a main landmark and a level-one heading, so only what a test adds can fail. */
function mountPage(content: string): HTMLElement {
  document.body.innerHTML = `<main><h1>Page</h1>${content}</main>`;
  return document.querySelector("main")!;
}

/** Where an element's text is on the screen: its first line. */
function textBox(element: Element): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(element);
  return range.getClientRects()[0]!;
}

const scanPage = () => audit({ include: [document.documentElement], exclude: axeExclude.map((selector) => [selector]) });
const rules = (findings: Awaited<ReturnType<typeof scanPage>>) => findings.map((finding) => `${finding.undecided ? "undecided " : ""}${finding.rule}`);

describe("audit", () => {
  it("passes a page that is right", async () => {
    mountPage('<p style="color:#111;background:#fff">Readable text</p>');
    expect(describeFindings(await scanPage())).toBe("");
  });

  it("describes findings as one line per rule, with its impact and help, and one per node with why it fails", () => {
    const finding = { rule: "region", impact: "moderate", help: "All page content should be contained by landmarks", target: "div", summary: "Fix any of the following", undecided: false };
    expect(describeFindings([finding, { ...finding, target: "p" }, { ...finding, rule: "color-contrast", impact: "serious", help: "Contrast", target: "span", summary: "measured 2.00:1", undecided: true }])).toBe(
      "region (moderate): All page content should be contained by landmarks\n  div: Fix any of the following\n  p: Fix any of the following\nundecided color-contrast (serious): Contrast\n  span: measured 2.00:1",
    );
  });

  it("fails a violation whatever its impact: content outside every landmark is only moderate", async () => {
    mountPage("<p>In the page</p>");
    document.body.insertAdjacentHTML("beforeend", "<div>Outside every landmark</div>");
    expect(rules(await scanPage())).toEqual(["region"]);
  });

  it("fails text a tag covers, which axe cannot judge", async () => {
    mountPage('<p style="margin:0;color:#111;background:#fff;font-size:16px;line-height:24px">Covered text here</p>');
    document.querySelector("main")!.insertAdjacentHTML("beforeend", '<a href="#docs" style="position:absolute;padding:0 4px;background:#3a3a3a;color:#fff;font-size:11px;line-height:16px">tag</a>');
    const box = textBox(document.querySelector("p")!);
    // Over the middle of the line, where axe looks for what lies over text.
    Object.assign(document.querySelector<HTMLElement>("a")!.style, { left: `${box.left + box.width / 2 - 10}px`, top: `${box.top + 4}px` });
    const findings = await scanPage();
    expect(findings.map((finding) => `${finding.undecided ? "undecided " : ""}${finding.rule} ${finding.target}`)).toEqual(["undecided color-contrast p"]);
    expect(findings[0]!.summary).toMatch(/^measured \d+\.\d\d:1 against the worst pixel behind its text, needs 4\.5:1$/);
  });

  it("measures a line drawn over text as what the text is seen against, though axe never sees it", async () => {
    mountPage('<p id="crossed" style="margin:0;color:#111;background:#fff;font-size:16px;line-height:24px">Crossed text</p>');
    document.body.insertAdjacentHTML("beforeend", '<div aria-hidden="true" style="position:fixed;inset:0;pointer-events:none"><div style="position:absolute;left:0;right:0;height:2px;background:#3a3a3a"></div></div>');
    const text = document.querySelector<HTMLElement>("#crossed")!;
    const box = text.getBoundingClientRect();
    document.querySelector<HTMLElement>('[aria-hidden="true"] > div')!.style.top = `${box.top + box.height / 2}px`;
    expect(await measureTextContrast(text, 4.5)).toEqual({ pass: false, reason: expect.stringMatching(/^measured \d+\.\d\d:1/) });
    document.querySelector('[aria-hidden="true"]')!.remove();
    expect(await measureTextContrast(text, 4.5)).toEqual({ pass: true });
  });

  it("measures text the page hides from assistive technology that lets the pointer through, as decorative lettering does", async () => {
    mountPage('<p aria-hidden="true" style="margin:0;color:#bbb;background:#fff;font-size:16px;line-height:24px;pointer-events:none"><span id="decor">Decorative text</span></p>');
    expect(await measureTextContrast(document.querySelector("#decor")!, 4.5)).toEqual({ pass: false, reason: expect.stringMatching(/^measured \d+\.\d\d:1/) });
  });

  it("passes text over a gradient when every pixel behind it meets 4.5:1, and fails faint text over the same gradient", async () => {
    mountPage(
      '<p id="dark" style="margin:0;padding:8px;color:#111;background:linear-gradient(90deg,#fff,#ddd)">Dark text on a gradient</p>' +
        '<p id="faint" style="margin:0;padding:8px;color:#999;background:linear-gradient(90deg,#fff,#ddd)">Faint text on a gradient</p>',
    );
    expect(await measureTextContrast(document.querySelector("#dark")!, 4.5)).toEqual({ pass: true });
    expect(await measureTextContrast(document.querySelector("#faint")!, 4.5)).toEqual({ pass: false, reason: expect.stringMatching(/^measured \d+\.\d\d:1/) });
    const findings = await scanPage();
    expect(findings.map((finding) => `${finding.undecided ? "undecided " : ""}${finding.rule} ${finding.target}`)).toEqual(["undecided color-contrast #faint"]);
  });

  it("measures a heading's second line against the page, not the descenders of the line above", async () => {
    mountPage(
      '<h1 style="margin:0;font-size:64px;line-height:0.95;color:#111"><span style="display:block">Gyppy quip</span>' +
        '<span id="second" style="display:block;color:#666">Second line</span></h1>',
    );
    expect(await measureTextContrast(document.querySelector("#second")!, 3)).toEqual({ pass: true });
    // In a face with tall lines, as Geist's are, the descenders reach further and still do not count.
    document.head.insertAdjacentHTML(
      "beforeend",
      '<style id="tall-face">@font-face { font-family: Tall; src: local("Helvetica"), local("Arial"), local("Liberation Sans"), local("DejaVu Sans"); ascent-override: 110%; descent-override: 32%; }</style>',
    );
    document.querySelector<HTMLElement>("#second")!.parentElement!.style.fontFamily = "Tall";
    await document.fonts.load('64px "Tall"');
    expect(await measureTextContrast(document.querySelector("#second")!, 3)).toEqual({ pass: true });
    document.querySelector("#tall-face")!.remove();
  });

  it("measures text far down a long page under a sticky header as it shows once scrolled to", async () => {
    mountPage(
      '<header style="position:sticky;top:0;height:120px;background:#111;color:#fff">Header</header>' +
        '<div style="height:4000px"></div><p id="far" style="margin:0;color:#555">Far down the page</p><div style="height:4000px"></div>',
    );
    window.scrollTo(0, 0);
    expect(await measureTextContrast(document.querySelector("#far")!, 4.5)).toEqual({ pass: true });
  });

  it("measures every label in one SVG from one screenshot of it, and fails the faint one once it is measured alone too", async () => {
    mountPage(
      '<svg role="img" aria-label="Plan" width="300" height="80"><defs><linearGradient id="paper"><stop offset="0" stop-color="#fff" /><stop offset="1" stop-color="#eee" /></linearGradient></defs>' +
        '<rect width="300" height="80" fill="url(#paper)" /><text id="dark-label" x="10" y="30" fill="#111">232 FEET</text><text id="faint-label" x="10" y="60" fill="#aaa">26 FT</text></svg>',
    );
    const shots = vi.spyOn(page, "screenshot");
    const findings = await scanPage();
    expect(findings.map((finding) => `${finding.undecided ? "undecided " : ""}${finding.rule} ${finding.target}`)).toEqual(["undecided color-contrast #faint-label"]);
    // One picture of the SVG, and one of the faint label alone, as a sticky bar could have covered it.
    expect(shots).toHaveBeenCalledTimes(2);
    shots.mockRestore();
  });

  it("fails text that other text is drawn over, as a tag without a background over a line", async () => {
    mountPage(
      '<div style="position:relative"><p id="under" style="margin:0;padding:8px;color:#111;background:linear-gradient(90deg,#fff,#eee);font-size:16px;line-height:24px">Text under a tag</p>' +
        '<span id="tag" aria-hidden="true" style="position:absolute;left:8px;top:8px;color:#111;font-size:16px;line-height:24px">WWWWWWWWWW</span></div>',
    );
    expect(await measureTextContrast(document.querySelector("#under")!, 4.5)).toEqual({ pass: false, reason: expect.stringMatching(/^measured 1\.\d\d:1/) });
  });

  it("fails what axe could not decide and the kit does not measure, with axe's own message", async () => {
    // A table with a header row and no rows, as the docs' parameter tables once were.
    mountPage('<table><thead><tr><th scope="col">Parameter</th><th scope="col">Type</th></tr></thead><tbody></tbody></table>');
    const findings = await scanPage();
    expect(findings.find((finding) => finding.rule === "th-has-data-cells")).toMatchObject({ undecided: true, summary: expect.stringMatching(/data cells/i) });
  });

  it("scans the page again when a node it found leaves the page while it is measured, as a Searching… line does", async () => {
    mountPage('<p id="searching" style="margin:0;padding:8px;color:#111;background:linear-gradient(90deg,#fff,#eee)">Searching…</p>');
    const take = page.screenshot.bind(page);
    const shots = vi.spyOn(page, "screenshot").mockImplementationOnce((options) => {
      document.querySelector("#searching")?.remove();
      return take(options);
    });
    expect(await scanPage()).toEqual([]);
    shots.mockRestore();
  });

  it("fails a node that leaves the page each time it is measured, three scans running", async () => {
    mountPage('<p id="searching" style="margin:0;padding:8px;color:#111;background:linear-gradient(90deg,#fff,#eee)">Searching…</p>');
    const take = page.screenshot.bind(page);
    const shots = vi.spyOn(page, "screenshot").mockImplementation((options) => {
      const line = document.querySelector("#searching")!;
      line.replaceWith(line.cloneNode(true));
      return take(options);
    });
    const findings = await scanPage();
    shots.mockRestore();
    expect(findings).toEqual([expect.objectContaining({ rule: "color-contrast", undecided: true, summary: expect.stringMatching(/the page never held still/) })]);
  });

  it("measures text once its color transitions finish, as after a switch to dark", async () => {
    mountPage('<p id="switching" style="margin:0;padding:8px;color:#111;background:#fff;transition:color 400ms linear,background-color 400ms linear">Switching scheme</p>');
    const text = document.querySelector<HTMLElement>("#switching")!;
    // Reading the color starts the transition from it.
    void getComputedStyle(text).color;
    Object.assign(text.style, { color: "#fff", backgroundColor: "#111" });
    // Halfway, both are grey: measured then, the text would fail.
    expect(await measureTextContrast(text, 4.5)).toEqual({ pass: true });
  });

  it("fails a popup trigger whose expanded popup is missing, and passes it once the popup is there", async () => {
    mountPage('<button type="button" aria-haspopup="menu" aria-expanded="true" aria-controls="actions-menu">Actions</button>');
    expect(rules(await scanPage())).toEqual(["undecided aria-valid-attr-value"]);
    document.querySelector("main")!.insertAdjacentHTML("beforeend", '<div id="actions-menu" role="menu"><div role="menuitem" tabindex="-1">Print</div></div>');
    expect(describeFindings(await scanPage())).toBe("");
  });

  it("passes a collapsed popup trigger whose popup is not rendered yet", async () => {
    mountPage('<button type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="actions-menu">Actions</button>');
    expect(describeFindings(await scanPage())).toBe("");
  });

  it("fails a control hidden from assistive technology under a modal when Tab still reaches it, and passes it when the page is inert", async () => {
    document.body.innerHTML =
      '<main aria-hidden="true"><h1>Page</h1><a href="#page">Behind the dialog</a></main>' +
      '<div role="dialog" aria-modal="true" aria-label="Edit"><button type="button">Save</button></div>';
    document.querySelector<HTMLElement>('[role="dialog"] button')!.focus();
    const findings = await scanPage();
    expect(rules(findings)).toContain("undecided aria-hidden-focus");
    expect(findings.find((finding) => finding.rule === "aria-hidden-focus")!.summary).toMatch(/^Tab reaches <a> "Behind the dialog"/);
    document.querySelector("main")!.setAttribute("inert", "");
    expect(rules(await scanPage())).not.toContain("undecided aria-hidden-focus");
  });

  it("passes text an open popup covers once the popup shuts it off from assistive technology, and measures what still shows", async () => {
    mountPage('<p id="under" style="margin:0;color:#111;background:#fff;font-size:16px;line-height:24px">Under the list</p>');
    document.body.insertAdjacentHTML("beforeend", '<div role="listbox" aria-label="Herbs" style="position:fixed;background:#222;color:#111;padding:0 4px"><div role="option" aria-selected="false">Basil</div></div>');
    const text = document.querySelector<HTMLElement>("#under")!;
    const box = textBox(text);
    const list = document.querySelector<HTMLElement>('[role="listbox"]')!;
    Object.assign(list.style, { left: `${box.left - 4}px`, top: `${box.top - 4}px`, width: `${box.width + 8}px`, height: `${box.height + 8}px` });
    // Exposed to assistive technology, the covered text is still what is there to read, and it fails.
    expect(await measureTextContrast(text, 4.5)).toEqual({ pass: false, reason: expect.stringMatching(/^measured/) });
    document.querySelector("main")!.setAttribute("aria-hidden", "true");
    expect(await measureTextContrast(text, 4.5)).toEqual({ pass: true });
    // Half uncovered, the half that shows is measured against what is behind it.
    Object.assign(list.style, { width: `${box.width / 2}px` });
    text.style.color = "#ccc";
    expect(await measureTextContrast(text, 4.5)).toEqual({ pass: false, reason: expect.stringMatching(/^measured/) });
  });

  it("passes page text a popup's layer covers, which hides it while the popup is open, and measures what still shows", async () => {
    mountPage('<p id="under" style="margin:0;color:#ccc;background:#fff;font-size:16px;line-height:24px">Under the panel</p>');
    document.body.insertAdjacentHTML("beforeend", '<div data-base-ui-portal=""><div role="group" aria-label="Recipes" style="position:fixed;background:#222;color:#ccc"><p>Panel</p></div></div>');
    const text = document.querySelector<HTMLElement>("#under")!;
    const box = textBox(text);
    const panel = document.querySelector<HTMLElement>('[role="group"]')!;
    Object.assign(panel.style, { left: `${box.left - 4}px`, top: `${box.top - 4}px`, width: `${box.width + 8}px`, height: `${box.height + 8}px` });
    expect(await measureTextContrast(text, 4.5)).toEqual({ pass: true });
    Object.assign(panel.style, { width: `${box.width / 2}px` });
    expect(await measureTextContrast(text, 4.5)).toEqual({ pass: false, reason: expect.stringMatching(/^measured/) });
  });

  it("measures letters set on a curve against what is behind each turned letter, not the box around it", async () => {
    // A light ring with a dark band along its middle, and the motto in the band: each letter turns
    // with the curve, so the box around it reaches the light ring the letter itself never touches.
    const band = (id: string, fill: string) =>
      `<text font-size="14" font-family="sans-serif" font-weight="600" letter-spacing="3" dy="5"><textPath id="${id}" href="#arc" startOffset="50%" text-anchor="middle" fill="${fill}">MOBILIS IN MOBILI</textPath></text>`;
    mountPage(
      '<svg aria-hidden="true" width="260" height="150" style="background:#fff"><path id="arc" d="M 30 140 a 100 100 0 0 1 200 0" fill="none" />' +
        '<path d="M 30 140 a 100 100 0 0 1 200 0" fill="none" stroke="#ddd" stroke-width="40" />' +
        '<path d="M 30 140 a 100 100 0 0 1 200 0" fill="none" stroke="#111" stroke-width="22" />' +
        band("light-motto", "#eee") +
        "</svg>",
    );
    expect(await measureTextContrast(document.querySelector("#light-motto")!, 4.5)).toEqual({ pass: true });
    document.querySelector("#light-motto")!.setAttribute("fill", "#555");
    expect(await measureTextContrast(document.querySelector("#light-motto")!, 4.5)).toEqual({ pass: false, reason: expect.stringMatching(/^measured \d+\.\d\d:1/) });
  });

  it("measures SVG text by its fill, as a chart's axis labels are painted", async () => {
    mountPage(
      '<svg width="200" height="60" style="background:#fff"><text id="dark" x="10" y="20" font-size="12" fill="#595959">Mon</text><text id="faint" x="10" y="50" font-size="12" fill="#999">Tue</text></svg>',
    );
    expect(await measureTextContrast(document.querySelector<HTMLElement>("#dark")!, 4.5)).toEqual({ pass: true });
    expect(await measureTextContrast(document.querySelector<HTMLElement>("#faint")!, 4.5)).toEqual({ pass: false, reason: expect.stringMatching(/^measured 2\.\d\d:1/) });
  });

  it("passes a toggle inside a <label> whose text is its name and description, and fails one whose label says more", async () => {
    mountPage(
      '<label><span role="checkbox" aria-checked="false" tabindex="0" aria-labelledby="pan-label" aria-describedby="pan-hint"></span><span id="pan-label">Heat the pan</span><span id="pan-hint">Medium-high</span></label>',
    );
    expect(describeFindings(await scanPage())).toBe("");
    document.querySelector("label")!.insertAdjacentHTML("beforeend", "<span>Ten minutes</span>");
    expect(rules(await scanPage())).toEqual(["undecided aria-toggle-field-name"]);
  });

  it("passes a field with two labels when aria-labelledby names it, and fails it when nothing settles which label names it", async () => {
    mountPage('<label id="photo-label" for="photo">Recipe photo</label><label>Drop a photo here<input id="photo" type="file" aria-labelledby="photo-label"></label>');
    expect(describeFindings(await scanPage())).toBe("");
    document.querySelector("input")!.removeAttribute("aria-labelledby");
    expect(rules(await scanPage())).toEqual(["undecided form-field-multiple-labels"]);
  });

  it("passes a modal whose focus trap sends focus back a frame after it reaches the trap's edge, as Base UI's does in WebKit", async () => {
    document.body.innerHTML =
      '<main aria-hidden="true"><h1>Page</h1><a href="#page">Behind the dialog</a></main>' +
      '<div role="dialog" aria-modal="true" aria-label="Edit"><span tabindex="0" data-guard></span><button type="button">Save</button><span tabindex="0" data-guard></span></div>';
    const save = document.querySelector<HTMLElement>('[role="dialog"] button')!;
    for (const guard of document.querySelectorAll("[data-guard]")) guard.addEventListener("focus", () => requestAnimationFrame(() => save.focus()));
    save.focus();
    expect(rules(await scanPage())).not.toContain("undecided aria-hidden-focus");
  });

  it("passes a control hidden at rest that shows itself in the event that focuses it, as a toast's dismiss button does", async () => {
    mountPage('<div id="stack" aria-hidden="true"><button type="button">Dismiss</button></div><div role="dialog" aria-modal="true" aria-label="Edit"><button type="button">Save</button></div>');
    const stack = document.querySelector<HTMLElement>("#stack")!;
    stack.addEventListener("focusin", () => stack.removeAttribute("aria-hidden"));
    stack.addEventListener("focusout", () => stack.setAttribute("aria-hidden", "true"));
    document.querySelector<HTMLElement>('[role="dialog"] button')!.focus();
    expect(rules(await scanPage())).not.toContain("undecided aria-hidden-focus");
  });

  it("settles a link in running text whose block's background axe cannot read, as under an open list, by measuring the link against the text around it", async () => {
    // Each paragraph's text is all in elements, so axe reads its background at its middle, below
    // its line, where a box lies over it.
    const paragraph = (id: string, link: string, more = "", background = "#fff") =>
      `<p style="position:relative;margin:0 0 8px;padding-bottom:48px;color:#111;background:${background};font-size:16px;line-height:24px"><span>Read </span><a id="${id}" href="#${id}" style="text-decoration:none;${link}">the notes</a><span id="${id}-after"> before you cook.</span>${more}` +
      '<span style="position:absolute;left:calc(50% - 12px);top:24px;width:24px;height:24px;background:#333"></span></p>';
    mountPage(
      // The same color as the text, on white and on a gradient; a blue that stands out; a gray that does not.
      paragraph("same", "color:inherit") +
        paragraph("graded", "color:inherit", "", "linear-gradient(90deg,#fff,#ccc)") +
        paragraph("blue", "color:#2563eb") +
        paragraph("faint", "color:#333") +
        // A background that stands out, beside a badge and a link whose dark backgrounds are not the paragraph's.
        paragraph("highlit", "color:inherit;background:#7f7f7f", ' <span style="display:inline-block;background:#000;color:#fff">New</span> <a href="#more" style="background:#000;color:#fff">more</a>') +
        // A background that does not, though a dark box covers the text after it.
        paragraph("tinted", "color:inherit;background:#eee"),
    );
    // An open modal list's invisible backdrop over the whole screen, which paints nothing.
    document.body.insertAdjacentHTML("beforeend", '<div data-base-ui-portal=""><div role="presentation" data-base-ui-inert="" style="position:fixed;inset:0"></div></div>');
    const after = textBox(document.querySelector("#tinted-after")!);
    document.querySelector("#tinted-after")!.insertAdjacentHTML("afterend", '<span id="cover" style="position:fixed;background:#000"></span>');
    Object.assign(document.querySelector<HTMLElement>("#cover")!.style, { left: `${after.left + 8}px`, top: `${after.top}px`, width: `${after.width - 8}px`, height: `${after.height}px` });
    const findings = (await scanPage()).filter((finding) => finding.rule === "link-in-text-block");
    expect(findings.map((finding) => `${finding.undecided ? "undecided " : ""}${finding.rule} ${finding.target}: ${finding.summary}`)).toEqual([
      expect.stringMatching(/^undecided link-in-text-block #faint: measured 1\.\d\d:1 between its text and its block's text, and 1\.00:1 between their backgrounds; needs 3:1 for either, or a style that does not rely on color, such as an underline$/),
      expect.stringMatching(/^undecided link-in-text-block #tinted: measured 1\.00:1 between its text and its block's text, and 1\.\d\d:1 between their backgrounds; needs 3:1/),
    ]);
  });

  it("counts a popup's shadow on the text as the popup's, as it is drawn by the open popup", async () => {
    mountPage('<p id="beside" style="margin:0;color:#555;background:#fff;font-size:16px;line-height:24px">Beside the calendar</p>');
    document.body.insertAdjacentHTML("beforeend", '<div data-base-ui-portal=""><div role="dialog" aria-label="Calendar" style="position:fixed;width:120px;height:120px;background:#fff;box-shadow:0 0 16px 16px rgba(0,0,0,0.6)"></div></div>');
    const text = document.querySelector<HTMLElement>("#beside")!;
    const box = textBox(text);
    // The popup sits just past the end of the line, so only its shadow falls on the text.
    Object.assign(document.querySelector<HTMLElement>('[role="dialog"]')!.style, { left: `${box.right + 2}px`, top: `${box.top}px` });
    expect(await measureTextContrast(text, 4.5)).toEqual({ pass: true });
  });
});
