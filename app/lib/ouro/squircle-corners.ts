export { squircleCorners };
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
// Ouro's two-Bezier corner (within 0.03% of the n=4 superellipse) in units of the radius: start, then each curve's two
// controls and end, drawn from the corner's left edge to its top edge.
const CORNER = [[0, 1], [0, 0.613, -0.0092, 0.3274, 0.1591, 0.1591], [0.3274, -0.0092, 0.613, 0, 1, 0]] as const;
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
        const sibling = { selector: rule.selector, nodes: [] as object[] };
        for (const v of vars) sibling.nodes.push({ prop: v.split(": ")[0], value: v.split(": ")[1] });
        sibling.nodes.push({ prop: "border-radius", value: radii.join(" ") });
        const wrap = { name: "supports", params: MISSING, nodes: [sibling] };
        rule.parent!.append(wrap);
        for (const s of rule.selectors ?? []) selectors.add(s);
      });
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
      const [a, b = a, c = a, d = b] = splitTop(value);
      out.splice(0, 4, a ?? null, b ?? null, c ?? null, d ?? null);
    } else if (decl.prop! in LONGHANDS) out[LONGHANDS[decl.prop!]!] = splitTop(value)[0] ?? null;
  }
  return out;
}

function splitTop(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= value.length; i++) {
    const ch = value[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if ((ch === " " || ch === undefined) && depth === 0) {
      if (i > start) parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  return parts;
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
    const pts: [number, number][] = [[CORNER[0]![0]!, CORNER[0]![1]!]];
    for (const c of [CORNER[1], CORNER[2]]) for (let j = 0; j < 6; j += 2) pts.push([c![j]!, c![j + 1]!]);
    const placed = pts.map(([u, v]) => [i === 1 || i === 2 ? -u : u, i >= 2 ? -v : v] as [number, number]);
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
