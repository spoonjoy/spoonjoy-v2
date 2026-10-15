const number = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`;
const channel = `${number}%?`;
const legacy = new RegExp(String.raw`^rgb\(\s*${channel}\s*,\s*${channel}\s*,\s*${channel}\s*\)$`, "i");
const legacyAlpha = new RegExp(String.raw`^rgba\(\s*${channel}\s*,\s*${channel}\s*,\s*${channel}\s*,\s*(${channel})\s*\)$`, "i");
const profile = "(?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)";
const modern = new RegExp(String.raw`^(?:(?:rgba?|lab|lch|oklab|oklch)\(|color\(${profile}\s+)\s*${channel}\s+${channel}\s+${channel}(?:\s*/\s*(${channel}))?\s*\)$`, "i");
const zero = /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?%?$/i;

/** Reads serialized getComputedStyle colors; unsupported forms fail rather than hiding paint. */
export function isTransparent(color: string): boolean {
  if (legacy.test(color)) return false;
  const match = legacyAlpha.exec(color) ?? modern.exec(color);
  if (!match) throw new Error(`Unsupported computed color: ${JSON.stringify(color)}`);
  const alpha = match[1];
  if (alpha === undefined) return false;
  const value = Number(alpha.replace(/%$/, "")) / (alpha.endsWith("%") ? 100 : 1);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Unsupported computed color alpha: ${JSON.stringify(color)}`);
  }
  // Compare the token, not pixels or a float that could underflow a tiny painted alpha to zero.
  return zero.test(alpha);
}
