import { squircleCorner, splitCornerRadii } from "./squircle-curve.ts";

export { squircleCorners };
export { squircleCornersDedupe };
export default squircleCorners;

interface Node {
  type: string;
  name?: string;
  params?: string;
  selector?: string;
  selectors?: string[];
  prop?: string;
  value?: string;
  parent?: Node;
  nodes?: Node[];
  walkDecls?: (cb: (decl: Node) => void) => void;
  append: (node: object) => unknown;
  prepend: (node: object) => unknown;
  walkRules: (cb: (rule: Node) => void) => void;
}

const CLIP = "(clip-path: shape(from 0 0, close))";
const MISSING = `(not (corner-shape: squircle)) and ${CLIP}`;
const ENCLOSING_CIRCLE = 0.543;
const KEYS = ["tl", "tr", "br", "bl"] as const;
const LONGHANDS: Record<string, number> = {
  "border-top-left-radius": 0, "border-start-start-radius": 0,
  "border-top-right-radius": 1, "border-start-end-radius": 1,
  "border-bottom-right-radius": 2, "border-end-end-radius": 2,
  "border-bottom-left-radius": 3, "border-end-start-radius": 3,
};

/**
 * A PostCSS plugin that draws Ouro's squircle corners at build time, in engines without `corner-shape` (WebKit's WKWebView).
 * Where `corner-shape` exists it sets `corner-shape: squircle` instead.
 *
 * @example
 * // vite.config.ts: css: { postcss: { plugins: [squircleCorners()] } }
 *
 * It is the one way Ouro UI draws squircles where the engine lacks `corner-shape`: it needs no code in the page.
 */
function squircleCorners(): { postcssPlugin: string; OnceExit(root: unknown): void } {
  return {
    postcssPlugin: "ouro-squircle-corners",
    OnceExit(input: unknown) {
      const root = input as Node;
      const selectors = new Set<string>();
      // Two rules in the same place (the same @media, @supports or layer) that round to the same radii need the
      // same fallback declarations: grouped by parent and by those declarations, they share one sibling rule
      // instead of each writing its own, which is the only duplication this pass can safely remove (a rule's own
      // class is unique, so no other group ever claims its selector).
      const groups = new Map<Node, Map<string, { vars: string[]; radii: string[]; selectors: string[] }>>();
      root.walkRules((rule) => {
        if (skipped(rule)) return;
        const corners = cornersOf(rule);
        if (!corners.some((c) => c !== null && !isRound(c, rule))) return;
        const vars: string[] = [];
        const radii = corners.map((c, i) => {
          const round = c === null || isRound(c, rule);
          vars.push(`--sq-${KEYS[i]}: ${round ? "0px" : c}`);
          return round ? (c ?? "0") : `calc(${c} * ${ENCLOSING_CIRCLE})`;
        });
        let byBody = groups.get(rule.parent!);
        if (!byBody) groups.set(rule.parent!, (byBody = new Map()));
        const key = `${vars.join(";")}|${radii.join(" ")}`;
        let group = byBody.get(key);
        if (!group) byBody.set(key, (group = { vars, radii, selectors: [] }));
        group.selectors.push(rule.selector!);
        for (const s of rule.selectors ?? []) selectors.add(s);
      });
      for (const [parent, byBody] of groups) {
        for (const group of byBody.values()) {
          const sibling = { selector: group.selectors.join(","), nodes: [] as object[] };
          for (const v of group.vars) sibling.nodes.push({ prop: v.split(": ")[0], value: v.split(": ")[1] });
          sibling.nodes.push({ prop: "border-radius", value: group.radii.join(" ") });
          const wrap = { name: "supports", params: MISSING, nodes: [sibling] };
          parent.append(wrap);
        }
      }
      if (selectors.size === 0) return;
      const list = [...selectors].join(",\n");
      const layer = {
        name: "layer",
        params: "squircle-corners",
        nodes: [
          { name: "supports", params: "(corner-shape: squircle)", nodes: [{ selector: list, nodes: [{ prop: "corner-shape", value: "squircle" }] }] },
          { name: "supports", params: MISSING, nodes: [{ selector: list, nodes: [{ prop: "--sq-clip", value: clipPath() }, { prop: "clip-path", value: "var(--sq-clip)" }] }] },
        ],
      };
      root.append(layer);
      for (const k of KEYS) root.prepend({ name: "property", params: `--sq-${k}`, nodes: [{ prop: "syntax", value: '"<length-percentage>"' }, { prop: "inherits", value: "false" }, { prop: "initial-value", value: "0px" }] });
      root.prepend({ name: "property", params: "--sq-notch", nodes: [{ prop: "syntax", value: '"*"' }, { prop: "inherits", value: "false" }] });
      root.prepend({ name: "layer", params: "squircle-corners" });
    },
  };
}

interface CssAsset { type: string; fileName: string; source: string | Uint8Array }

/**
 * A Vite plugin that collapses duplicate `squircleCorners()` output within a built CSS file.
 * Vite's PostCSS pipeline runs `squircleCorners()` once per source CSS file, so a chunk that bundles several source
 * files ends up with a `@layer squircle-corners` carrying a separately-computed copy of the shared boilerplate per
 * source file. The copies are identical (`clipPath()` reads just custom properties), so this merges them into one
 * pair of rules per chunk, after Vite has decided chunking, since an earlier merge could not see the final chunks.
 *
 * @example
 * // vite.config.ts: plugins: [squircleCornersDedupe()], css: { postcss: { plugins: [squircleCorners()] } }
 *
 * Add it beside `squircleCorners()` in a Vite build (not Storybook's dev server, which emits no bundle to dedupe).
 */
function squircleCornersDedupe(): { name: string; apply: "build"; generateBundle(options: unknown, bundle: Record<string, CssAsset>): void } {
  return {
    name: "ouro-squircle-corners-dedupe",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css") || typeof file.source !== "string") continue;
        file.source = dedupeSquircleCss(file.source);
      }
    },
  };
}

// Finds the index of the character that closes the `open` at `openIndex`, honoring backslash escapes, or -1.
function matchingClose(css: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIndex; i < css.length; i++) {
    const ch = css[i];
    if (ch === "\\") { i++; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Splits a selector list on its top-level commas, skipping escaped characters and the commas inside :is(), [] and similar.
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === "\\") { i++; continue; }
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) { out.push(list.slice(start, i)); start = i + 1; }
  }
  out.push(list.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

// Merges adjacent `selectors{declBody}` rules that share one exact declBody, within one already-bundled span.
function dedupeStyleRules(body: string): string {
  const order: string[] = [];
  const bySelectors = new Map<string, string[]>();
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf("{", i);
    if (open === -1) break;
    const close = matchingClose(body, open, "{", "}");
    if (close === -1) break;
    const selectorText = body.slice(i, open);
    const declBody = body.slice(open + 1, close);
    let selectors = bySelectors.get(declBody);
    if (!selectors) { bySelectors.set(declBody, (selectors = [])); order.push(declBody); }
    selectors.push(...splitSelectors(selectorText));
    i = close + 1;
  }
  return order.map((declBody) => {
    const seen = new Set<string>();
    const merged = bySelectors.get(declBody)!.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
    return `${merged.join(",")}{${declBody}}`;
  }).join("");
}

// Merges adjacent `@supports(params){...}` blocks that share one exact, whitespace-normalized params string, within
// one already-bundled span, and dedupes the style rules inside each merged group.
function dedupeSupportsGroups(layerBody: string): string {
  const order: string[] = [];
  const byParams = new Map<string, { raw: string; body: string }>();
  let i = 0;
  const marker = "@supports";
  while (i < layerBody.length) {
    const at = layerBody.indexOf(marker, i);
    if (at === -1) break;
    const open = layerBody.indexOf("{", at);
    if (open === -1) break;
    const raw = layerBody.slice(at + marker.length, open).trim();
    const close = matchingClose(layerBody, open, "{", "}");
    if (close === -1) break;
    const body = layerBody.slice(open + 1, close);
    const key = raw.replace(/\s+/g, " ");
    let group = byParams.get(key);
    if (!group) { byParams.set(key, (group = { raw, body: "" })); order.push(key); }
    group.body += body;
    i = close + 1;
  }
  return order.map((key) => {
    const group = byParams.get(key)!;
    return `@supports ${group.raw}{${dedupeStyleRules(group.body)}}`;
  }).join("");
}

/**
 * Merges `squircleCorners()`'s repeated boilerplate within one CSS string, working inside its own
 * `@layer squircle-corners` blocks, which hold rules from this plugin alone, so the cascade order of the rest of
 * the file stays as it was. A named CSS layer's content accumulates across its `@layer <name>{...}` blocks
 * wherever they sit, so folding the later blocks into the first one's spot keeps the same cascade.
 */
function dedupeSquircleCss(css: string): string {
  const marker = "@layer squircle-corners{";
  const spans: { start: number; end: number; body: string }[] = [];
  let i = 0;
  while (true) {
    const at = css.indexOf(marker, i);
    if (at === -1) break;
    const open = at + marker.length - 1;
    const close = matchingClose(css, open, "{", "}");
    if (close === -1) break;
    spans.push({ start: at, end: close + 1, body: css.slice(open + 1, close) });
    i = close + 1;
  }
  if (spans.length === 0) return css;
  const merged = dedupeSupportsGroups(spans.map((s) => s.body).join(""));
  let out = "";
  let cursor = 0;
  spans.forEach((span, index) => {
    out += css.slice(cursor, span.start);
    out += index === 0 ? `${marker}${merged}}` : "";
    cursor = span.end;
  });
  out += css.slice(cursor);
  return out;
}

function skipped(rule: Node): boolean {
  for (let p = rule.parent; p; p = p.parent) {
    if (p.type === "rule") return true;
    if (p.type === "atrule" && (/keyframes$/.test(p.name!) || p.name === "property" || p.name === "font-face" || /corner-shape|--corner-shape/.test(p.params ?? ""))) return true;
  }
  return false;
}

// The four corners' radii as written (top-left, top-right, bottom-right, bottom-left), or null for a corner the rule leaves alone.
function cornersOf(rule: Node): (string | null)[] {
  const out: (string | null)[] = [null, null, null, null];
  for (const decl of rule.nodes ?? []) {
    if (decl.type !== "decl") continue;
    const value = decl.value!.trim();
    if (decl.prop === "border-radius" && !value.includes("/")) {
      const [a, b = a, c = a, d = b] = splitCornerRadii(value);
      out.splice(0, 4, a ?? null, b ?? null, c ?? null, d ?? null);
    } else if (decl.prop! in LONGHANDS) out[LONGHANDS[decl.prop!]!] = splitCornerRadii(value)[0] ?? null;
  }
  return out;
}

const px = (v: string) => (/px$/.test(v) ? parseFloat(v) : /rem$/.test(v) ? parseFloat(v) * 16 : NaN);

// Round by intent: a pill, a circle, half the box, half a height or width the same rule sets, or corner-shape: round.
function isRound(value: string, rule: Node): boolean {
  if (/infinity/.test(value) || (/%$/.test(value) && parseFloat(value) >= 50) || px(value) >= 999) return true;
  return (rule.nodes ?? []).some((d) => (d.prop === "corner-shape" && d.value === "round") || ((d.prop === "height" || d.prop === "width") && px(value) >= px(d.value!) / 2 - 0.5));
}

// One path: a rectangle far outside, minus the box, plus the squircle. Under the nonzero rule the slivers a plain circular corner
// leaves are the only part cut, so a shadow, an outline and overflow outside the corners survive. --sq-notch is one more subpath an
// element may set (a circle wound like the box cuts a hole, as an avatar's presence dot does); unset, it is an empty one. The caller
// reads this shape() back through --sq-clip rather than writing it straight into clip-path: Chromium 149 to 157 drops every later
// rule in the stylesheet when a shape() segment is a bare var(), and --sq-notch's fallback here is exactly that (ourostack/ouro-ui#3491).
function clipPath(): string {
  const n = (x: number, k: string) => `calc(var(--sq-${k}) * ${Number(x.toFixed(4))})`;
  const curves = KEYS.map((k, i) => {
    const placed = squircleCorner.map(([u, v]) => [i === 1 || i === 2 ? -u : u, i >= 2 ? -v : v] as [number, number]);
    if (i === 1 || i === 3) placed.reverse();
    const rel = (p: [number, number], from: [number, number]) => `${n(p[0] - from[0], k)} ${n(p[1] - from[1], k)}`;
    return [0, 3].map((s) => `curve by ${rel(placed[s + 3]!, placed[s]!)} with ${rel(placed[s + 1]!, placed[s]!)} / ${rel(placed[s + 2]!, placed[s]!)}`).join(", ");
  });
  return [
    "shape(nonzero from -9999px -9999px", "hline to calc(100% + 9999px)", "vline to calc(100% + 9999px)", "hline to -9999px", "close",
    "move to 0 0", "vline to 100%", "hline to 100%", "vline to 0", "close",
    "move to 0 var(--sq-tl)", curves[0], "hline by calc(100% - var(--sq-tl) - var(--sq-tr))", curves[1],
    "vline by calc(100% - var(--sq-tr) - var(--sq-br))", curves[2], "hline by calc(var(--sq-br) + var(--sq-bl) - 100%)", curves[3],
    "vline by calc(var(--sq-bl) + var(--sq-tl) - 100%)", "close", "var(--sq-notch, move to 0 0, close))",
  ].join(", ");
}
