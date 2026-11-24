const BARE_VAR = /^var\(\s*--[\w-]+\s*(,[\s\S]*)?\)$/;

/**
 * Whether a value has a shape() with a var() as one of its top-level segments. Chromium 149 to 157 stops reading a
 * stylesheet at such a value in an ordinary property, dropping every rule after it (ourostack/ouro-ui#3491).
 */
export function hasShapeVarSegment(value: string): boolean {
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
