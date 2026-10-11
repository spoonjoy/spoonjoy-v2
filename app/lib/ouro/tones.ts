export { renamedTones, toneWarning };
export type { ToneName };

// The export list comes first because the shadcn CLI drops comments before a file's
// first statement, which would take the JSDoc below with it.

/**
 * The five tones every component maps its `tone` prop to. They are the theme's token
 * names (shadcn's, plus Ouro's success and warning), so `tone="primary"` reads `--primary`.
 */
type ToneName = "primary" | "secondary" | "destructive" | "success" | "warning";

/**
 * Tone names agents bring from other libraries (and Ouro UI's earlier names), with the
 * tone to use instead. They are type errors; at run time they warn and render the default.
 */
const renamedTones: Readonly<Record<string, ToneName>> = {
  danger: "destructive",
  accent: "primary",
  neutral: "secondary",
};

/**
 * The dev message for a tone that is not one of `tones`: a renamed one points to its
 * new name, anything else to the list. Development only.
 */
function toneWarning(component: string, tone: string, tones: readonly string[]): readonly [string, string] {
  const renamed = Object.hasOwn(renamedTones, tone) ? renamedTones[tone] : undefined;
  return renamed
    ? [`tone="${tone}" is not a tone`, `<${component} tone="${renamed}">`]
    : [`tone="${tone}" is not a tone; use ${tones.map((name) => `"${name}"`).join(", ")}`, `<${component} tone="${tones[0]}">`];
}
