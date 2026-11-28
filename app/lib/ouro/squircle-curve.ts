export { squircleCorner, splitCornerRadii };

/** Ouro's squircle corner, from its left edge to its top edge, in units of its radius. @internal */
const squircleCorner = [[0, 1], [0, 0.613], [-0.0092, 0.3274], [0.1591, 0.1591], [0.3274, -0.0092], [0.613, 0], [1, 0]] as const;

/** Splits CSS radii outside their nested math expressions. @internal */
function splitCornerRadii(value: string): string[] {
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
