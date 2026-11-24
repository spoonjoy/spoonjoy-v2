// Chromium 149 to 157 stop parsing a stylesheet at a declaration whose shape() has a var() as a whole segment
// (`clip-path: shape(from 0 0, close, var(--sq-notch))`, with or without a fallback in the var()): every rule after it
// is dropped, so the page loses most of its CSS. Chrome 158 parses it. Ouro UI v1.3.513 writes two: ouro-base's avatar
// presence notch, early in the stylesheet, and squircleCorners()' clip path. The same shape() read from a custom
// property parses and draws in every engine, so this moves each such value into --sj-clip-path, on the same rule, and
// sets the property to var(--sj-clip-path). --sj-clip-path does not inherit, so it never reaches a child. Drop this
// once ouro-base and squircleCorners() write their clip paths that way themselves (ourostack/ouro-ui#3491).

const PROPERTY = "--sj-clip-path";
const BARE_VAR = /^var\(\s*--[\w-]+\s*(,[\s\S]*)?\)$/;

/** Whether a value has a shape() with a var() as one of its top-level segments. */
export function hasShapeVarSegment(value) {
  for (let start = value.indexOf("shape("); start !== -1; start = value.indexOf("shape(", start + 1)) {
    let depth = 0;
    let segmentStart = start + "shape(".length;
    for (let i = segmentStart; i < value.length; i++) {
      const ch = value[i];
      const closing = ch === ")" && depth === 0;
      if ((ch === "," && depth === 0) || closing) {
        if (BARE_VAR.test(value.slice(segmentStart, i).trim())) return true;
        segmentStart = i + 1;
        if (closing) break;
      } else if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
  }
  return false;
}

/** A PostCSS plugin, run after squircleCorners(): each such shape() is read through --sj-clip-path. */
export function shapeVarFallback() {
  return {
    postcssPlugin: "spoonjoy-shape-var-fallback",
    OnceExit(root, { AtRule }) {
      let moved = false;
      root.walkDecls(/^(-webkit-)?clip-path$/, (decl) => {
        if (!hasShapeVarSegment(decl.value)) return;
        decl.cloneBefore({ prop: PROPERTY, value: decl.value, important: false });
        decl.value = `var(${PROPERTY})`;
        moved = true;
      });
      if (!moved) return;
      const property = new AtRule({ name: "property", params: PROPERTY });
      property.append({ prop: "syntax", value: '"*"' }, { prop: "inherits", value: "false" });
      root.prepend(property);
    },
  };
}
