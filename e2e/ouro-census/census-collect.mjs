export { animationsSettled, censusExclusions, collectInPage, interactiveSelector };

/* global window, document, getComputedStyle */

// The census's in-page side. Playwright runs these functions in the page (page.evaluate,
// page.waitForFunction), so none of them may close over anything outside itself.

/**
 * Every element a person can focus or operate: native controls, links, editable regions, anything
 * in the tab order, and the ARIA widget roles. Ouro UI's own tests mark every one of these.
 * @claim "Every element a person can focus or operate" test/census-collect.test.ts verify:testExists(test/census-collect.test.ts::collectInPage > reports each control's role, from the tag, the input type or an explicit role)
 * @claim "Ouro UI's own tests mark every one of these" scripts/control-matrix.test.mjs verify:testExists(scripts/control-matrix.test.mjs::every interactive component declares its controls, and the fixture lists exactly those)
 */
const interactiveSelector =
  'a[href], button, input:not([type="hidden"]), select, textarea, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="textbox"], [role="searchbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="treeitem"]';

/**
 * The `interactiveSelector` matches that are no control: Base UI's focus guards, which hand focus
 * back into a modal and that no prop reaches.
 * @claim "that are no control" test/census-collect.test.ts verify:testExists(test/census-collect.test.ts::collectInPage > reads Ouro's markers, and leaves out Base UI's focus guards)
 */
const censusExclusions = Object.freeze(["[data-base-ui-focus-guard]"]);

/**
 * Every `selector` match in the document except the `exclusions`: whether it is visible, its role,
 * its accessible name (axe-core's computation, so axe-core must be on `window.axe`), its Ouro
 * marker and part, and its context: the nearest landmark, dialog or named group or region, else
 * the nearest `data-testid`.
 *
 * @param {{ selector: string, exclusions: readonly string[] }} options
 * @claim "match in the document except" test/census-collect.test.ts verify:testExists(test/census-collect.test.ts::collectInPage > gives each control the landmark, dialog or named group around it, named only by its author)
 * @claim "match in the document except" test/census-collect.test.ts verify:testExists(test/census-collect.test.ts::collectInPage > says whether each control is visible)
 */
function collectInPage({ selector, exclusions }) {
  const axe = /** @type {any} */ (window).axe;
  const inputRoles = {
    button: "button",
    checkbox: "checkbox",
    file: "button",
    image: "button",
    number: "spinbutton",
    radio: "radio",
    range: "slider",
    reset: "button",
    submit: "button",
  };
  /** @param {Element} element */
  const controlRole = (element) => {
    const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0];
    if (explicit) return explicit;
    const tag = element.localName;
    if (tag === "a" || tag === "area") return element.hasAttribute("href") ? "link" : "generic";
    if (tag === "button") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "select") {
      const select = /** @type {HTMLSelectElement} */ (element);
      return select.multiple || select.size > 1 ? "listbox" : "combobox";
    }
    if (tag === "input") {
      const type = (element.getAttribute("type") ?? "text").toLowerCase();
      if (type === "search") return element.hasAttribute("list") ? "combobox" : "searchbox";
      if (["email", "tel", "text", "url"].includes(type) && element.hasAttribute("list")) return "combobox";
      return /** @type {Record<string, string>} */ (inputRoles)[type] ?? "textbox";
    }
    if (/** @type {HTMLElement} */ (element).isContentEditable) return "textbox";
    return "generic";
  };
  const sectioning = "article, aside, main, nav, section";
  const landmarkRoles = new Set(["banner", "navigation", "main", "complementary", "contentinfo", "search", "dialog", "alertdialog"]);
  const namedRoles = new Set(["form", "region", "group"]);
  /** @param {Element} element */
  const implicitRole = (element) => {
    switch (element.localName) {
      case "header":
        return element.parentElement?.closest(sectioning) ? null : "banner";
      case "footer":
        return element.parentElement?.closest(sectioning) ? null : "contentinfo";
      case "nav":
        return "navigation";
      case "main":
        return "main";
      case "aside":
        return "complementary";
      case "search":
        return "search";
      case "dialog":
        return "dialog";
      case "form":
        return "form";
      case "section":
        return "region";
      case "fieldset":
        return "group";
      default:
        return null;
    }
  };
  // A landmark, dialog or group is named only by its author (aria-labelledby, aria-label, a
  // fieldset's legend, title), never by its content, which would make the context change with it.
  /** @param {Element} element */
  const authoredName = (element) => {
    const labelledBy = element.getAttribute("aria-labelledby")?.trim();
    if (labelledBy) {
      return labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter((label) => label !== null)
        .map((label) => axe.commons.text.accessibleText(label))
        .join(" ");
    }
    const label = element.getAttribute("aria-label")?.trim();
    if (label) return label;
    if (element.localName === "fieldset") {
      const legend = [...element.children].find((child) => child.localName === "legend");
      if (legend?.textContent?.trim()) return legend.textContent;
    }
    return element.getAttribute("title") ?? "";
  };
  /** @param {Element} element */
  const landmarkOf = (element) => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      const role = node.getAttribute("role")?.trim().split(/\s+/)[0] || implicitRole(node);
      if (!role) continue;
      const name = authoredName(node);
      if (landmarkRoles.has(role) || (namedRoles.has(role) && name.trim())) return { role, name };
    }
    return null;
  };
  /** @param {Element} element */
  const isVisible = (element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility === "visible";
  };

  axe.teardown();
  axe.setup(document);
  try {
    return [...document.querySelectorAll(selector)]
      .filter((element) => !exclusions.some((exclusion) => element.matches(exclusion)))
      .map((element) => {
        const landmark = landmarkOf(element);
        return {
          visible: isVisible(element),
          role: controlRole(element),
          name: axe.commons.text.accessibleText(element),
          control: element.getAttribute("data-ouro-control"),
          part: element.getAttribute("data-ouro-part"),
          landmark,
          testId: landmark ? null : (element.parentElement?.closest("[data-testid]")?.getAttribute("data-testid") ?? null),
        };
      });
  } finally {
    axe.teardown();
  }
}

/**
 * Whether no finite animation is running; infinite ones (spinners) never settle and are ignored.
 *
 * @claim "Whether no finite animation is running" test/census-collect.test.ts verify:testExists(test/census-collect.test.ts::animationsSettled > waits for a finite animation, and ignores an infinite or finished one)
 */
function animationsSettled() {
  return document.getAnimations().every((animation) => {
    if (animation.playState !== "running" && !animation.pending) return true;
    const end = animation.effect?.getComputedTiming().endTime;
    return typeof end === "number" && !Number.isFinite(end);
  });
}
