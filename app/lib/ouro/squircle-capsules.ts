export { installSquircleCapsules, capsuleHalf, ROUND };

/** What stays round, whatever its radius: a switch, a radio, a slider's thumb, a presence dot and a spinner. An app that draws its own squircles leaves these out too. */
const ROUND = [
  '[data-ouro-control="switch"]', '[data-ouro-control="switch"] *', "input[type=radio]", "[role=radio] [data-ouro-menu-indicator]",
  "[role=slider]", "input[type=range]", "[data-ouro-avatar-presence]", "[data-ouro-avatar-presence] *", '[data-ouro="spinner"]', '[data-ouro="spinner"] *',
].join(",");
const ENCLOSING_CIRCLE = 0.543;

/** The radius of a capsule: half its shorter side, in eighths of a pixel so a half-pixel of layout jitter writes nothing. */
function capsuleHalf(inline: number, block: number): number {
  return Math.round(Math.min(inline, block) * 4) / 8;
}

/** A rule's full selectors: a nested rule's are its parents' with its own, `&` standing for the parent. */
function fullSelectors(rule: CSSStyleRule): string[] {
  const own = rule.selectorText.split(/,(?![^(]*\))/);
  let up: CSSRule | null = rule.parentRule;
  while (up && !(up instanceof CSSStyleRule)) up = up.parentRule;
  if (!up) return own;
  return fullSelectors(up).flatMap((outer) =>
    own.map((s) => {
      /* istanbul ignore if @preserve -- Chromium and WebKit serialize every nested selector with its &; see below. */
      // Stryker disable next-line StringLiteral,ConditionalExpression: Chromium and WebKit, where the tests run, serialize every nested selector with its & (CSS Nesting's absolutized form); one left relative, without it, is another engine's.
      if (!s.includes("&")) return `${outer} ${s}`;
      return s.replaceAll("&", outer);
    }),
  );
}

function selectorsOf(rules: CSSRuleList, out: string[]): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule && ["tl", "tr", "br", "bl"].some((c) => rule.style.getPropertyValue(`--sq-${c}`).includes("--sq-half"))) out.push(...fullSelectors(rule));
    if ("cssRules" in rule) selectorsOf((rule as CSSGroupingRule).cssRules, out);
  }
}

/**
 * Draws capsules as squircles where the engine lacks `corner-shape`. Sets `--sq-half` on capsules, the variable the
 * clip from `squircleCorners()` waits on. Use it once at the root; `OuroProvider` calls it for you. It does nothing where `corner-shape` is drawn or
 * `clip-path: shape()` is missing, and returns a function that stops it.
 * @example
 * const stop = installSquircleCapsules(document);
 */
function installSquircleCapsules(doc: Document): () => void {
  const css = doc.defaultView!.CSS;
  if (css.supports("corner-shape", "squircle") || !css.supports("clip-path", "shape(from 0 0, close)")) return () => {};
  const done = new WeakMap<Element, number>();
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const size = entry.borderBoxSize[0]!;
      const half = capsuleHalf(size.inlineSize, size.blockSize);
      if (done.get(entry.target) === half) continue;
      done.set(entry.target, half);
      const style = (entry.target as HTMLElement).style;
      style.setProperty("--sq-half", `${half}px`);
      style.setProperty("--sq-capsule-radius", `${half * ENCLOSING_CIRCLE}px`);
      // An Ouro control paints its own squircle in its surface slot, at --ouro-sq-r: a capsule's is its half too.
      if (entry.target.hasAttribute("data-ouro-squircle")) style.setProperty("--ouro-sq-r", `${half}px`);
    }
  });
  const watched = new Set<Element>();
  // Reads every rule of every sheet: run it only when a sheet is added or loads, never on an ordinary DOM change.
  const readSheets = (): string => {
    // Stryker disable next-line ArrayDeclaration: a stray starting entry is a syntactically valid, unmatched compound selector in the join, so it changes which elements match nothing.
    const selectors: string[] = [];
    for (const sheet of Array.from(doc.styleSheets)) {
      try {
        selectorsOf(sheet.cssRules, selectors);
      } catch {
        // A cross-origin sheet is not ours.
      }
    }
    return selectors.join(",");
  };
  let selector = readSheets();
  const observe = (el: Element) => {
    if (watched.has(el) || el.matches(ROUND)) return;
    watched.add(el);
    observer.observe(el, { box: "border-box" });
  };
  const watchAll = () => {
    if (!selector) return;
    for (const el of Array.from(doc.querySelectorAll(selector))) observe(el);
  };
  const watchAdded = (node: Element) => {
    if (!selector) return;
    if (node.matches(selector)) observe(node);
    for (const el of Array.from(node.querySelectorAll(selector))) observe(el);
  };
  // A linked sheet is read when it loads (onLoad below): before then its rules are not readable.
  const isSheet = (el: Element) => el.localName === "style";
  const holdsSheet = (el: Element) => isSheet(el) || el.querySelector("style") !== null;
  watchAll();
  const mutations = new MutationObserver((records) => {
    const added: Element[] = [];
    let sheetsChanged = false;
    for (const record of records) {
      // A class change can make an element match a capsule rule (a bar shown on hover does): only that element is read.
      // Only `class` is watched, and this writes `style`, so it does not see its own writes.
      if (record.type === "attributes") {
        if (selector && (record.target as Element).matches(selector)) observe(record.target as Element);
        continue;
      }
      // A style element whose text was replaced reports the change on itself.
      if (isSheet(record.target as Element)) sheetsChanged = true;
      for (const node of Array.from(record.addedNodes)) {
        if (node.nodeType !== 1) continue;
        if (holdsSheet(node as Element)) sheetsChanged = true;
        added.push(node as Element);
      }
    }
    if (sheetsChanged) {
      selector = readSheets();
      watchAll();
    } else for (const node of added) watchAdded(node);
  });
  mutations.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  // A linked sheet's rules are readable only once it has loaded.
  const onLoad = (event: Event) => {
    const link = event.target as HTMLLinkElement;
    if (link.localName !== "link" || !link.sheet) return;
    selector = readSheets();
    watchAll();
  };
  doc.addEventListener("load", onLoad, true);
  return () => {
    observer.disconnect();
    mutations.disconnect();
    doc.removeEventListener("load", onLoad, true);
    // Stryker disable next-line CallExpression: both observers are already disconnected, so nothing reads watched again; clearing it only frees the elements it held onto.
    watched.clear();
  };
}
