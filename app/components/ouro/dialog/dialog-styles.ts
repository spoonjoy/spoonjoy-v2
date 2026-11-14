export { dialogSizes, dialogSizeWarning };
export type { DialogSize };

// Value lists and dev-message helpers shared by Dialog and its parts, apart from the
// components so each component file exports only components (React Fast Refresh). The
// export list comes first because the shadcn CLI drops comments before a file's first statement.

/**
 * A centered dialog's width. By default (`auto`) it fits its content and the screen: at least 32rem, so a form or a short
 * question keeps a comfortable width, and at most 70% of the screen, from 40rem up to 56rem, so a gallery or a table grows
 * on a big screen. Running text (paragraphs, headings, list items, labels, `Text`) wraps at a readable 65ch and does not
 * widen it; bare text in a `div` measures as one long line, so put prose in a `<p>`. `xl` (56rem), `2xl` (72rem) and
 * `full` (the viewport) raise the cap for wide content. `sm` (24rem), `md` (32rem) and `lg` (40rem) pin a fixed width
 * whatever the content. Every size narrows to the viewport less its 1rem margins (or the safe area).
 *
 * @claim "By default (`auto`) it fits" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > fits size %s to its content, from 32rem up to %ipx)
 * @claim "By default (`auto`) it fits" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > follows the screen by default: a wide table makes it %ipx wide on a %ipx screen)
 * @claim "Running text (paragraphs, headings, list" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > keeps running text at a readable 65ch in size %s, so text alone does not widen it)
 * @claim "Running text (paragraphs, headings, list" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > lets the app's own max-width class on a paragraph win over the 65ch measure)
 * @claim "`xl` (56rem), `2xl` (72rem) and" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > caps size %s at %ipx wide)
 * @claim "`sm` (24rem), `md` (32rem) and" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > keeps size %s at %ipx whatever the content)
 * @claim "Every size narrows to the viewport" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::centered dialog > keeps size %s inside a 390px phone's 16px margins when presentation is dialog)
 */
type DialogSize = "auto" | "sm" | "md" | "lg" | "xl" | "2xl" | "full";

/**
 * The seven sizes, for checking a `size` prop. Shared with `Dialog`.
 *
 * @internal
 * @claim "The seven sizes, for checking a" registry/ouro/components/ouro/dialog/dialog.test.tsx verify:testExists(registry/ouro/components/ouro/dialog/dialog.test.tsx::Dialog parts > renders the auto DialogPopup for a size that is not one of Ouro UI's, and warns once with the fix)
 */
const dialogSizes: readonly DialogSize[] = ["auto", "sm", "md", "lg", "xl", "2xl", "full"];

/**
 * The dev message for a size that is not one of {@link dialogSizes}. Development only.
 *
 * @internal
 */
function dialogSizeWarning(size: string, fix: string): readonly [string, string] {
  return [`size="${size}" is not a size; use ${dialogSizes.map((name) => `"${name}"`).join(", ")}`, fix];
}
